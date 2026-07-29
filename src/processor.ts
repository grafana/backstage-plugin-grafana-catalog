import type {
  KubeConfig,
  ConfigurationOptions,
  CustomObjectsApi,
  KubernetesObject,
  Observable,
  ObservableMiddleware,
  RequestContext,
  ResponseContext,
  V1APIGroup,
  V1ObjectMeta,
} from '@kubernetes/client-node';
import _ from 'lodash';

import {
  ComponentEntityV1alpha1,
  Entity,
  GroupEntityV1alpha1,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import {
  CatalogProcessor,
  CatalogProcessorEmit,
} from '@backstage/plugin-catalog-node';
import { LocationSpec } from '@backstage/plugin-catalog-common';
import {
  CatalogProcessorCache,
  EntityFilter,
} from '@backstage/plugin-catalog-node';
import { Config } from '@backstage/config';
import { LoggerService } from '@backstage/backend-plugin-api';

import { getGrafanaCloudK8sConfig } from './kube_config';

import { anyOfMultipleFilters, entityMatch } from './entityFilter';
import { Semaphore } from './semaphore';

const API_GROUP = 'servicemodel.ext.grafana.com';

// Reconnect backoff schedule: 1min, 2min, 4min, 8min, ... capped at 1hr.
// Without this, a persistent connection failure produces one error log per
// entity per catalog cycle, which in a large catalog is millions of errors.
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 3_600_000;

// The catalog hands us one entity at a time but does not wait for us, so in a
// large catalog every entity's upload starts at once. Cap the in-flight requests
// so we do not get rate limited by the ServiceModel API.
const MAX_CONCURRENT_K8S_REQUESTS = 10;

// The Kubernetes client applies no timeout of its own. Since postProcessEntity
// waits for the upload, an unbounded request would stall that entity's catalog
// processing and hold one of the MAX_CONCURRENT_K8S_REQUESTS slots for as long as
// the socket stayed open. Ten such requests would stop uploads altogether.
const K8S_REQUEST_TIMEOUT_MS = 30_000;

// new k8s.Observable, which cannot be imported directly here: the client is an
// ESM-only package, so this module can only reach it through a dynamic import.
type ObservableConstructor = new <T>(promise: Promise<T>) => Observable<T>;

// A Kubernetes object name must be an RFC 1123 DNS subdomain: up to 253 chars
// of dot-separated DNS labels, each at most 63 chars of lowercase alphanumerics
// and dashes, starting and ending alphanumeric.
//
// Backstage's own entity name rule is looser. isValidEntityName in
// @backstage/catalog-model is isValidObjectName:
//
//   value.length >= 1 && value.length <= 63 &&
//   /^([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]$/.test(value)
//
// which follows the Kubernetes *label value* rules, not the object name rules.
// So a name Backstage accepts can still be illegal here in three ways:
// uppercase letters, underscores, and empty dot-separated segments ('a..b').
const MAX_OBJECT_NAME_LENGTH = 253;
const MAX_DNS_LABEL_LENGTH = 63;
const DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

const LABELS = {
  OWNER: `${API_GROUP}/owner`,
  SYSTEM: `${API_GROUP}/system`,
  SUBCOMPONENT_OF: `${API_GROUP}/subcomponentOf`,
  PARENT: `${API_GROUP}/parent`,
  TYPE: `${API_GROUP}/type`,
};

// Extend KubernetesObject to include spec
export interface KubernetesObjectWithSpec extends KubernetesObject {
  spec?: any;
}

/**
 * A processor that writes entities to the GrafanaServiceModelProcessor.
 *
 * This processor hooks the poatProcess lifecycle of the catalog processor to
 * upload Entities to the GrafanaCloud ServiceModel.
 *
 * Config for this processor needs to define which entities are allowdd, by kind and type.
 *
 *
 */
export class GrafanaServiceModelProcessor implements CatalogProcessor {
  private readonly logger: LoggerService;
  private readonly config: Config;

  // Weather the processor is enabled
  enable: boolean = false;
  // The k8s connection
  kc: KubeConfig | undefined = undefined;
  // The k8s for interacting with custom resources, which is what the ServiceModel is
  client: CustomObjectsApi | undefined = undefined;
  // The time of the last connection attempt, tomorrow sometime
  lastConnectionAttempt: Date | undefined = undefined;
  // Lock to prevent multiple simultaneous connection attempts
  private isConnecting: boolean = false;
  // Number of consecutive connection failures, which drives the retry backoff
  private consecutiveFailures: number = 0;

  // The version of the ServiceModel API we are using
  serviceModelVersion: string = '';
  // Weather the connection to Grafana is available
  grafanaAvailable: boolean = false;
  // The namespace in which for the tenant we are talking to
  k8sNamespace: string = '';
  // The filter for entities that are allowed to be uploaded
  filter: EntityFilter;
  // Per-request options that bound every ServiceModel API call, set up alongside
  // the client because both need the dynamically imported k8s module
  requestOptions: ConfigurationOptions<ObservableMiddleware> | undefined =
    undefined;
  // Caps how many ServiceModel API requests are in flight at once
  private readonly semaphore = new Semaphore(MAX_CONCURRENT_K8S_REQUESTS);
  // Entity names already reported as unusable, so each is only logged once
  private readonly warnedAboutNames = new Set<string>();

  /**
   * fromComfig creates a new GrafanaServiceModelProcessor from the config
   * @param logger - The logger service
   * @param config - The config service
   * @returns - A new GrafanaServiceModelProcessor
   */
  public static fromConfig({
    logger,
    config,
  }: {
    logger: LoggerService;
    config: Config;
  }) {
    return new GrafanaServiceModelProcessor(logger, config);
  }

  /**
   * Create a new GrafanaServiceModelProcessor
   * @param logger - The logger service
   * @param config - The config service
   * @returns - A new GrafanaServiceModelProcessor
   */
  private constructor(logger: LoggerService, config: Config) {
    this.logger = logger;
    this.config = config;
    this.grafanaAvailable = false;

    // Gracefully disable if config block is absent (e.g. local development)
    if (!config.has('grafanaCloudCatalogInfo')) {
      this.enable = false;
      this.filter = { key: '', values: [] } as unknown as EntityFilter;
      logger.info(
        'GrafanaServiceModelProcessor: No grafanaCloudCatalogInfo config found. Disabled.',
      );
      return;
    }

    // Restrict the kinds of entities that are allowed to be uploaded to Grafana
    const allowedKinds = config.getStringArray('grafanaCloudCatalogInfo.allow');

    const filter = anyOfMultipleFilters(allowedKinds);
    if (!filter) {
      // This should never happen, as the config schema should enforce this
      throw new Error(
        'GrafanaServiceModelProcessor: No allowed kinds found in config',
      );
    }
    this.filter = filter;
    logger.info(
      'GrafanaServiceModelProcessor: Configured with filter: ',
      filter,
    );

    // Check if the processor is enabled. If not, log a message and return
    // Useful if you want the plugin installed, but not running.
    this.enable = config.getBoolean('grafanaCloudCatalogInfo.enable');
    if (!this.enable) {
      logger.info(
        'GrafanaServiceModelProcessor: Disabled. Set grafanaCloudCatalogInfo.enabled to true to enable',
      );
      return;
    }

    this.lastConnectionAttempt = new Date();
    this.createAndTestGrafanaConnection()
      .then(result => {
        this.grafanaAvailable = result;
        this.recordConnectionResult(result);
      })
      .catch(error => {
        // A constructor cannot await, so without this catch a rejection here is
        // an unhandled rejection, which terminates the backend by default in
        // Node 16 and later.
        this.logger.error(
          `GrafanaServiceModelProcessor: Initial connection attempt threw: ${
            error?.message || String(error)
          }`,
        );
        this.grafanaAvailable = false;
        this.recordConnectionResult(false);
      });
  }

  /**
   * connectionBackoffMs is how long to wait before the next connection attempt,
   * based on how many consecutive failures we have seen.
   * @returns - The backoff window in milliseconds
   */
  private connectionBackoffMs(): number {
    const doublings = Math.max(0, this.consecutiveFailures - 1);
    return Math.min(BACKOFF_BASE_MS * 2 ** doublings, BACKOFF_MAX_MS);
  }

  /**
   * recordConnectionResult updates the failure count that drives the backoff and
   * logs the transition. Only logs on failure or on recovery, so a healthy
   * connection stays quiet.
   * @param connected - Whether the connection attempt succeeded
   */
  private recordConnectionResult(connected: boolean): void {
    if (connected) {
      if (this.consecutiveFailures > 0) {
        this.logger.info('GrafanaServiceModelProcessor: Connection restored.');
      }
      this.consecutiveFailures = 0;
      return;
    }

    this.consecutiveFailures++;
    this.logger.warn(
      `GrafanaServiceModelProcessor: Connection failed (attempt ${
        this.consecutiveFailures
      }). Next retry in ${Math.round(this.connectionBackoffMs() / 1000)}s.`,
    );
  }

  /**
   * createAndTestGrafanaConnection creates a connection to Grafana Cloud and tests it
   * @returns - A promise that resolves to true if the connection to Grafana is available, false otherwise
   */
  async createAndTestGrafanaConnection(): Promise<boolean> {
    // If already connecting, wait for the result
    if (this.isConnecting) {
      this.logger.debug(
        'GrafanaServiceModelProcessor: Connection attempt already in progress, waiting...',
      );
      // Wait for a short time and check again
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.grafanaAvailable;
    }

    this.isConnecting = true;
    try {
      const k8s = await import('@kubernetes/client-node');
      // Built here because this is the only place the ESM-only client is in scope
      this.requestOptions = requestTimeout(k8s.Observable);
      return new Promise(async (resolve, _reject) => {
        if (!this.kc) {
          this.logger.debug(
            'GrafanaServiceModelProcessor: Trying to get connection to Grafana Cloud.',
          );

          try {
            // Get the Grafana Cloud K8s Config using configured Cloud Access Policies
            const cloudConfig = await getGrafanaCloudK8sConfig(
              this.config,
              this.logger,
            );
            this.kc = cloudConfig.config;
            this.k8sNamespace = cloudConfig.namespace;
            this.client = this.kc.makeApiClient(k8s.CustomObjectsApi);
          } catch (error: any) {
            this.logger.error(
              `GrafanaServiceModelProcessor: Error getting Grafana Cloud K8s Config: ${error.message}}`,
            );
            resolve(false);
            return;
          }

          if (!this.kc) {
            this.logger.info(
              'GrafanaServiceModelProcessor: k8s not available. No kubeconfig. Will try again.',
            );
            resolve(false);
            return;
          }
        }

        // Check if the ServiceModel API is available
        const apiApiClient = this.kc?.makeApiClient(k8s.ApisApi);
        try {
          const response = await apiApiClient.getAPIVersions(
            undefined,
            this.requestOptions,
          );
          this.logger.debug(
            `GrafanaServiceModelProcessor: API versions response: ${JSON.stringify(
              response,
            )}`,
          );

          // Check if response has the expected structure
          if (!response || !response.groups) {
            this.logger.error(
              'GrafanaServiceModelProcessor: Invalid API versions response structure',
            );
            resolve(false);
            return;
          }

          const apiGroup = response.groups.find(
            (group: V1APIGroup) => group.name === API_GROUP,
          );
          if (!apiGroup) {
            this.logger.info(
              'GrafanaServiceModelProcessor ApiGroup not available in the api server',
            );
            resolve(false);
            return;
          }
          // Capture the latest (preferred) version of the ServiceModel API
          this.serviceModelVersion =
            apiGroup.preferredVersion?.version ?? 'notfound';
          if (this.serviceModelVersion === 'notfound') {
            this.logger.info(
              'GrafanaServiceModelProcessor ApiGroup not available in the api server',
            );
            resolve(false);
            return;
          }
          this.logger.info(
            `GrafanaServiceModelProcessor: k8s available. Found ServiceModel API version: ${this.serviceModelVersion}. Using namespace: ${this.k8sNamespace}`,
          );
          this.grafanaAvailable = true;
          resolve(true);
          return;
        } catch (error: any) {
          // Deliberately no error.body: k8s API error bodies can carry request
          // detail we do not want in the logs.
          this.logger.error(
            `GrafanaServiceModelProcessor: k8s not available. Error: ${
              error?.message || String(error) || 'Unknown error'
            }`,
            {
              error: {
                name: error?.name,
                code: error?.code,
                status: error?.status,
              },
            },
          );
          resolve(false);
          return;
        }
      });
    } finally {
      this.isConnecting = false;
    }
  }

  getProcessorName(): string {
    return 'GrafanaServiceModelProcessor';
  }

  /**
   * postProcessEntity processes the entity and uploads it to the GrafanaServiceModel. This is the latest in the chain
   * we could hook into.
   * @param entity - The Backstage entity to process
   * @param _location - Not used
   * @param _emit - Not used
   * @param cache - The cache to store the entity in
   * @returns - A promise that resolves to the entity
   */
  postProcessEntity?(
    entity: Entity,
    _location: LocationSpec,
    _emit: CatalogProcessorEmit,
    cache: CatalogProcessorCache,
  ): Promise<Entity> {
    return new Promise(async (resolve, _reject) => {
      if (!this.enable) {
        resolve(entity);
        return;
      } else if (!this.grafanaAvailable) {
        // Still inside the backoff window from the last failure. Stay quiet and
        // let a later entity trigger the retry.
        const now = new Date();
        if (
          this.lastConnectionAttempt !== undefined &&
          now.getTime() - this.lastConnectionAttempt.getTime() <
            this.connectionBackoffMs()
        ) {
          resolve(entity);
          return;
        }

        // Claimed synchronously so the other entities in this cycle see the new
        // window and only one of them actually attempts the reconnect.
        this.lastConnectionAttempt = now;
        await this.createAndTestGrafanaConnection().then(result => {
          this.grafanaAvailable = result;
          this.recordConnectionResult(result);
          // Catch you next time
          resolve(entity);
          return;
        });
      } else {
        // Skip if kind is a Location or API
        if (entity.kind === 'Location') {
          resolve(entity);
          return;
        }

        // Skip if the kind is not in the list of allowed kinds
        if (!entityMatch(entity, this.filter)) {
          resolve(entity);
          return;
        }

        this.logger.debug(
          `GrafanaServiceModelProcessor.postProcessEntity entity '${entity.kind}' with name '${entity.metadata.name}`,
        );

        const CACHE_KEY = stringifyEntityRef(entity);

        // An unhandled rejection here would leave this promise pending forever,
        // stalling the entity rather than failing it. An unreadable cache is
        // treated as a miss, which re-uploads; that is idempotent.
        let cachedEntity: Entity | undefined;
        try {
          cachedEntity = await cache.get<Entity>(CACHE_KEY);
        } catch (err: any) {
          this.logger.warn(
            `GrafanaServiceModelProcessor: Could not read the cache for ${CACHE_KEY}, treating it as a miss: ${
              err?.message || String(err)
            }`,
          );
        }

        if (cachedEntity && _.isEqual(entity, cachedEntity)) {
          // Already uploaded and unchanged. Writing nothing to the cache leaves
          // the stored copy in place: the catalog only persists a new cache
          // state when it differs from the one it handed us.
          resolve(entity);
          return;
        }

        this.logger.debug(
          cachedEntity
            ? `GrafanaServiceModelProcessor.postProcessEntity entity '${entity.kind}' with name '${entity.metadata.name}' differs from cached version`
            : `GrafanaServiceModelProcessor.postProcessEntity entity '${entity.kind}' with name '${entity.metadata.name}' not found in cache`,
        );

        // Awaited deliberately. The catalog snapshots the cache as soon as this
        // promise resolves, so a cache write from a still-running upload would
        // arrive too late to be persisted.
        let uploaded = false;
        try {
          uploaded = await this.createOrUpdateModel(entity);
        } catch (err: any) {
          this.logger.error(
            `GrafanaServiceModelProcessor.postProcessEntity error: ${
              err.message || 'Unknown error'
            }`,
            {
              error: {
                name: err.name,
                message: err.message,
                stack: err.stack,
                ...(err instanceof Error ? {} : { details: err }),
              },
              entity: {
                kind: entity.kind,
                metadata: {
                  name: entity.metadata.name,
                  namespace: entity.metadata.namespace,
                },
              },
            },
          );
          // Eat the error, we don't want to stop the catalog from processing.
        }

        if (uploaded) {
          try {
            await cache.set(CACHE_KEY, entity);
          } catch (err: any) {
            this.logger.warn(
              `GrafanaServiceModelProcessor: Uploaded ${CACHE_KEY} but could not write the cache, so it will be uploaded again next cycle: ${
                err?.message || String(err)
              }`,
            );
          }
        }
        // On failure the cache is deliberately left alone, so this entity is
        // tried again on the next cycle instead of being treated as uploaded.

        resolve(entity);
        return;
      }
    });
  }

  /**
   * createOrUpdateModel creates or updates the entity in the GrafanaServiceModel,
   * waiting for a free request slot first.
   * @param entity - The entity to create or update in the GrafanaServiceModel
   * @returns - A promise that resolves to true if the entity was created or updated, false otherwise
   */
  async createOrUpdateModel(entity: Entity): Promise<boolean> {
    // Checked before taking a slot, since a name we will not send is not worth
    // queueing behind the entities we will.
    if (!isValidK8sObjectName(entity.metadata.name)) {
      this.warnOnceAboutName(entity);
      return false;
    }

    // The slot is held until the whole upload settles, so no more than
    // MAX_CONCURRENT_K8S_REQUESTS uploads are ever in flight.
    return this.semaphore.run(() => this.uploadModel(entity));
  }

  /**
   * warnOnceAboutName reports an entity whose name cannot be used as a
   * Kubernetes object name. Only the first sighting of each name is logged:
   * every catalog cycle revisits the same entities, so warning each time would
   * be the same log flood the reconnect backoff exists to avoid.
   * @param entity - The entity being skipped
   */
  private warnOnceAboutName(entity: Entity): void {
    if (this.warnedAboutNames.has(entity.metadata.name)) {
      return;
    }
    this.warnedAboutNames.add(entity.metadata.name);

    this.logger.warn(
      `GrafanaServiceModelProcessor: Skipping ${entity.kind} '${entity.metadata.name}': the name is not a valid Kubernetes object name, so the ServiceModel API would reject it. Names may only contain lowercase letters, digits, '-' and '.', and must start and end with a letter or digit. Backstage permits uppercase letters and underscores in entity names, Kubernetes does not.`,
    );
  }

  /**
   * uploadModel gets, then creates or replaces, the entity's model in the
   * GrafanaServiceModel. Callers should go through createOrUpdateModel so that
   * the concurrency limit is applied.
   * @param entity - The entity to upload
   * @returns - A promise that resolves to true if the entity was created or updated, false otherwise
   */
  private async uploadModel(entity: Entity): Promise<boolean> {
    // This is where we convert the Backstage entity to the GrafanaServiceModel makeing any
    // shape changes needed to conform to the GrafanaServiceModel API
    const model: KubernetesObjectWithSpec = entityToServiceModel(
      entity,
      this.k8sNamespace,
      this.serviceModelVersion,
    );

    return this.getModel(entity)
      .then(storedModel => {
        if (!storedModel) {
          this.logger.debug(
            `GrafanaServiceModelProcessor.createOrUpdateModel: No existing model found for ${entity.kind}/${entity.metadata.name}, creating new one`,
          );
          return this.createModel(entity).then(() => true);
        }
        // As Backstage is the system of record, we just override the model in Grafana.
        // In the future, we may need to do some reconciliation of state, such at alerts
        // firing or incidents in progress.
        _.unset(storedModel, 'spec.metadata.uid');

        // We need to check if the entity has changed, so we need to convert the entity
        // to the same format as the model.
        const entityModel = entityToServiceModel(
          entity,
          this.k8sNamespace,
          this.serviceModelVersion,
        );

        if (!_.isEqual(entityModel.spec, storedModel.spec)) {
          // Update requires the last resourceVersion to be passed in
          model.metadata!.resourceVersion =
            storedModel.metadata?.resourceVersion;
          return this.updateModel(entity, model)
            .then(() => true)
            .catch(err => {
              if (err.code !== 409) {
                this.logger.error(
                  `GrafanaServiceModelProcessor.createOrUpdateModel error updating model`,
                  {
                    error: {
                      name: err.name,
                      message: err.message,
                      stack: err.stack,
                      code: err.code,
                    },
                    entity: {
                      kind: entity.kind,
                      metadata: {
                        name: entity.metadata.name,
                        namespace: entity.metadata.namespace,
                      },
                    },
                  },
                );
              }
              return false;
            });
        }

        return true;
      })
      .catch(err => {
        // Seems a GET on a non-existent object throws an error with a 404
        if (err.code === 404) {
          this.logger.debug(
            `GrafanaServiceModelProcessor.createOrUpdateModel: Model not found for ${entity.kind}/${entity.metadata.name}, creating new one`,
          );
          return this.createModel(entity).then(() => true);
        }

        this.logger.error(
          `GrafanaServiceModelProcessor.createOrUpdateModel error getting model`,
          {
            error: {
              name: err.name,
              message: err.message,
              stack: err.stack,
              code: err.code,
            },
            entity: {
              kind: entity.kind,
              metadata: {
                name: entity.metadata.name,
                namespace: entity.metadata.namespace,
              },
            },
          },
        );
        throw err;
      })
      .finally(() => {
        // We don't want to stop the catalog from processing
        return true;
      });
  }

  /**
   * getModel gets the model from the GrafanaServiceModel
   * @param entity - The entity to get from the GrafanaServiceModel
   * @returns - A promise that resolves to the model from the GrafanaServiceModel
   */
  async getModel(entity: Entity): Promise<KubernetesObjectWithSpec> {
    if (!this.client) {
      throw new Error('Kubernetes client not initialized');
    }

    return this.client
      .getNamespacedCustomObject(
        {
          group: API_GROUP,
          version: this.serviceModelVersion,
          namespace: this.k8sNamespace,
          plural: pluralize(entity.kind),
          name: entity.metadata.name,
        },
        this.requestOptions,
      )
      .then((response: any) => {
        this.logger.debug(
          `GrafanaServiceModelProcessor.getModel response: ${JSON.stringify(
            response,
          )}`,
        );
        return response as KubernetesObjectWithSpec;
      })
      .catch((err: any) => {
        throw err;
      });
  }

  /**
   * updateModel updates the model in the GrafanaServiceModel
   * @param entity - The entity to update in the GrafanaServiceModel
   * @param model - The model to update in the GrafanaServiceModel
   * @returns - A promise that resolves to the updated model in the GrafanaServiceModel
   */
  async updateModel(entity: Entity, model: KubernetesObjectWithSpec) {
    if (!this.client) {
      throw new Error('Kubernetes client not initialized');
    }
    let k8sObject: KubernetesObjectWithSpec | undefined;

    return this.client
      .replaceNamespacedCustomObject(
        {
          group: API_GROUP,
          version: this.serviceModelVersion,
          namespace: this.k8sNamespace,
          plural: pluralize(entity.kind),
          name: entity.metadata.name,
          body: model,
        },
        this.requestOptions,
      )
      .then((response: any) => {
        k8sObject = response as KubernetesObjectWithSpec;
        this.logger.debug(
          `GrafanaServiceModelProcessor.updateModel replaceNamespacedCustomObject() response: ${JSON.stringify(
            k8sObject,
          )}`,
        );
      })
      .catch((err: any) => {
        // JSON.stringify on an Error yields '{}' because message and stack are
        // non-enumerable, so this used to log nothing useful at all.
        this.logger.error(
          `GrafanaServiceModelProcessor.updateModel error: ${
            err?.message || String(err) || 'Unknown error'
          }`,
          {
            error: { name: err?.name, code: err?.code, status: err?.status },
          },
        );
        throw err;
      });
  }

  /**
   * createModel creates the model in the GrafanaServiceModel
   * @param entity - The entity to create in the GrafanaServiceModel
   * @returns - A promise that resolves to the created model in the GrafanaServiceModel
   */
  async createModel(entity: Entity) {
    if (!this.client) {
      throw new Error('Kubernetes client not initialized');
    }
    let k8sObject: KubernetesObjectWithSpec | undefined;

    return (
      this.client
        .getNamespacedCustomObject(
          {
            group: API_GROUP,
            version: this.serviceModelVersion,
            namespace: this.k8sNamespace,
            plural: pluralize(entity.kind),
            name: entity.metadata.name,
          },
          this.requestOptions,
        )
        .then((response: any) => {
          k8sObject = response as KubernetesObjectWithSpec;
          this.logger.debug(
            `GrafanaServiceModelProcessor.createModel getNamespacedCustomObject() response: ${JSON.stringify(
              k8sObject,
            )}`,
          );
        })
        // A 404 is expected if the object does not exist
        .catch((_err: any) => {
          const k8sModel = entityToServiceModel(
            entity,
            this.k8sNamespace,
            this.serviceModelVersion,
          );
          if (!this.client) {
            throw new Error('Kubernetes client not initialized');
          }
          return this.client
            .createNamespacedCustomObject(
              {
                group: API_GROUP,
                version: this.serviceModelVersion,
                namespace: this.k8sNamespace,
                plural: pluralize(entity.kind),
                body: k8sModel,
              },
              this.requestOptions,
            )
            .then((response: any) => {
              k8sObject = response as KubernetesObjectWithSpec;
              this.logger.debug(
                `GrafanaServiceModelProcessor.createModel response: ${JSON.stringify(
                  k8sObject,
                )}`,
              );
            })
            .catch((e: any) => {
              this.logger.error(
                `GrafanaServiceModelProcessor.createModel error: ${
                  e?.message || String(e) || 'Unknown error'
                }`,
                {
                  error: { name: e?.name, code: e?.code, status: e?.status },
                },
              );
            });
        })
    );
  }
}

function pluralize(s: string): string {
  return `${s.toLowerCase()}s`;
}

/**
 * requestTimeout builds the per-request options that bound a single ServiceModel
 * API call. The client hands RequestContext's signal straight to node-fetch, so
 * this aborts the request rather than merely abandoning it, which matters because
 * an abandoned request would still hold its concurrency slot.
 *
 * A fresh signal is created per request, inside pre().
 * @param ObservableCtor - The client's Observable, from the dynamic import
 * @param timeoutMs - How long any one request may take
 * @returns - Options to pass as the second argument to a client method
 */
export function requestTimeout(
  ObservableCtor: ObservableConstructor,
  timeoutMs: number = K8S_REQUEST_TIMEOUT_MS,
): ConfigurationOptions<ObservableMiddleware> {
  const passThrough = <T>(context: T): Observable<T> =>
    new ObservableCtor(Promise.resolve(context));

  const timeoutMiddleware: ObservableMiddleware = {
    pre: (context: RequestContext) => {
      context.setSignal(AbortSignal.timeout(timeoutMs));
      return passThrough(context);
    },
    post: (context: ResponseContext) => passThrough(context),
  };

  return {
    middleware: [timeoutMiddleware],
    // Append rather than replace, so the auth middleware the KubeConfig installs
    // is preserved.
    middlewareMergeStrategy: 'append',
  };
}

/**
 * isValidK8sObjectName reports whether a name can be used as a Kubernetes
 * object name, and so whether it is safe to put in a ServiceModel API path.
 * Note that a single character is a valid name.
 * @param name - The name to check, normally entity.metadata.name
 * @returns - True if the name is a valid RFC 1123 DNS subdomain
 */
export function isValidK8sObjectName(name: string): boolean {
  if (name.length === 0 || name.length > MAX_OBJECT_NAME_LENGTH) {
    return false;
  }

  return name
    .split('.')
    .every(
      label => label.length <= MAX_DNS_LABEL_LENGTH && DNS_LABEL.test(label),
    );
}

// According to the k8s spec for labels:
//   - must be 63 characters or less (can be empty),
//   - unless empty, must begin and end with an alphanumeric character ([a-z0-9A-Z]),
//   - could contain dashes (-), underscores (_), dots (.), and alphanumerics between.
// So we will "lay down" the offending characters with
//  - .. for :
//  - __ for /
//
// There may be an alternative, https://github.com/prometheus/proposals/blob/main/proposals/2023-08-21-utf8.md#text-escaping
function cleanEntityRef(ref: string): string {
  return ref.replace(/:/g, '..').replace(/\//g, '__');
}

// Create the Grafana Resource for the Backstage Entity
// Basically copy the Entity metadata to the spec slot then
// add some labels for the one-to-one relations we know about
// Then just copy the spec to the spec slot, and see what sticks
export function entityToServiceModel(
  entity: Entity,
  namespace: string,
  serviceModelVersion: string,
): KubernetesObjectWithSpec {
  const labels: Record<string, string> = {};

  // Raise up the well-known relations
  // I've not seen these from Backstage yet
  for (const relation of entity.relations || []) {
    labels[`${API_GROUP}/${relation.type}`] = cleanEntityRef(
      relation.targetRef,
    );
  }

  // Raise up the well-known relations onto labels, for identity.
  // Most of these are the 1:1 relations. The 1:N relations will be handed by Gamma
  //
  // There might be a better type-safe way to do this.
  if (entity.spec?.owner) {
    labels[LABELS.OWNER] = cleanEntityRef(entity.spec?.owner as string);
  }

  if (entity.spec?.system) {
    labels[LABELS.SYSTEM] = cleanEntityRef(entity.spec?.system as string);
  }

  if (entity.spec?.subcomponentOf) {
    labels[LABELS.SUBCOMPONENT_OF] = cleanEntityRef(
      (entity as ComponentEntityV1alpha1).spec.subcomponentOf ?? '',
    );
  }

  if (entity.spec?.parent) {
    labels[LABELS.PARENT] = cleanEntityRef(
      (entity as GroupEntityV1alpha1).spec.parent ?? '',
    );
  }

  if (entity.spec?.type) {
    labels[LABELS.TYPE] = entity.spec.type as string;
  }

  const metadata: V1ObjectMeta = {
    name: entity.metadata.name,
    namespace: namespace,
    labels: labels,
  };

  const serviceModel: KubernetesObjectWithSpec = {
    // Set the API version and kind
    apiVersion: `${API_GROUP}/${serviceModelVersion}`,
    kind: entity.kind,
    metadata: metadata,

    // Copy original metadata to spec.metadata
    spec: {
      backstageMetadata: entity.metadata,
    },
  };

  // copy all fields from entity.spec to serviceModel.spec
  // Kubernetes will drop any fields that are not in the CRD spec
  Object.assign(serviceModel.spec, entity.spec);

  return serviceModel;
}
