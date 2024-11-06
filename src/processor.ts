import * as k8s from '@kubernetes/client-node';
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

import { getGrafanaCloudK8sConfig, GrafanaCloudK8sConfig } from './kube_config';

import { anyOfMultipleFilters, entityMatch } from './entityFilter';

const API_GROUP = 'servicemodel.ext.grafana.com';
const LABELS = {
  OWNER: `${API_GROUP}/owner`,
  SYSTEM: `${API_GROUP}/system`,
  SUBCOMPONENT_OF: `${API_GROUP}/subcomponentOf`,
  PARENT: `${API_GROUP}/parent`,
  TYPE: `${API_GROUP}/type`,
};

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
  kc: k8s.KubeConfig | undefined = undefined;
  // The k8s for interacting with custom resources, which is what the ServiceModel is
  client: k8s.CustomObjectsApi = new k8s.CustomObjectsApi();
  // The time of the last connection attempt
  lastConnectionAttempt: Date = new Date();

  // The version of the ServiceModel API we are using
  serviceModelVersion: string = '';
  // Weather the connection to Grafana is available
  grafanaAvailable: boolean = false;
  // The namespace in which for the tenant we are talking to
  k8sNamespace: string = '';
  // The filter for entities that are allowed to be uploaded
  filter: EntityFilter;


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

    this.createAndTestGrafanaConnection().then(result => {
      this.grafanaAvailable = result;
      this.lastConnectionAttempt = new Date();
    });
  }

  /**
   * createAndTestGrafanaConnection creates a connection to Grafana Cloud and tests it
   * @returns - A promise that resolves to true if the connection to Grafana is available, false otherwise
   */
  async createAndTestGrafanaConnection(): Promise<boolean> {
    return new Promise((resolve, _reject) => {
      if (!this.kc) {
        this.logger.info(
          'GrafanaServiceModelProcessor: Trying to get connection to Grafana Cloud.',
        );

        const now = new Date();
        if (now.getTime() - this.lastConnectionAttempt.getTime() < 1000) {
          this.logger.info(
            'GrafanaServiceModelProcessor: Trying to get connection to Grafana Cloud too soon after last attempt.',
          );
          this.lastConnectionAttempt = now;
          resolve(false);
          return;
        }
        this.lastConnectionAttempt = now;

        // Get the Grafana Cloud K8s Config using configured Cloud Access Policies
        getGrafanaCloudK8sConfig(this.config, this.logger)
          .then((cloudConfig: GrafanaCloudK8sConfig) => {
            this.kc = cloudConfig.config;
            this.k8sNamespace = cloudConfig.namespace;
            this.client = this.kc.makeApiClient(k8s.CustomObjectsApi);
          })
          // catch and log the error
          .catch((error: any) => {
            this.logger.error(
              `GrafanaServiceModelProcessor: Error getting Grafana Cloud K8s Config: ${error.message}}`,
            );
            resolve(false);
            return;
          });

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
      apiApiClient
        .getAPIVersions()
        .then(({ body }) => {
          const apiGroup = body.groups.find(group => group.name === API_GROUP);
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
          resolve(true);
          return;
        })
        .catch((error: any) => {
          this.logger.error(
            `GrafanaServiceModelProcessor: k8s not available: ${JSON.stringify(
              error,
            )}`,
          );
          resolve(false);
          return;
        });
    });
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
        await this.createAndTestGrafanaConnection().then(result => {
          this.grafanaAvailable = result;
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
        cache.get(CACHE_KEY).then(cachedEntity => {
          if (
            !cachedEntity ||
            (cachedEntity && !_.isEqual(entity, cachedEntity))
          ) {
            this.logger.debug(
              `GrafanaServiceModelProcessor.postProcessEntity entity '${entity.kind}' with name '${entity.metadata.name}' not found in cache or they differ`,
            );
            this.createOrUpdateModel(entity)
              .then(async result => {
                if (result) {
                  // Update the cache if we were successful in storing the model
                  cache.set(CACHE_KEY, entity);
                }
              })
              .catch((err: any) => {
                this.logger.error(
                  `GrafanaServiceModelProcessor.postProcessEntity error: ${JSON.stringify(
                    err,
                  )}`,
                );
                // Eat the error, we don't want to stop the catalog from processing
              });
          }
          cache.set(CACHE_KEY, entity);
          resolve(entity);
          return;
        });
      }
    });
  }

  /**
   * createOrUpdateModel creates or updates the entity in the GrafanaServiceModel
   * @param entity - The entity to create or update in the GrafanaServiceModel
   * @returns - A promise that resolves to true if the entity was created or updated, false otherwise
   */
  async createOrUpdateModel(entity: Entity): Promise<boolean> {
    // This is where we convert the Backstage entity to the GrafanaServiceModel makeing any 
    // shape changes needed to conform to the GrafanaServiceModel API
    const model: k8s.KubernetesObjectWithSpec = entityToServiceModel(
      entity,
      this.k8sNamespace,
      this.serviceModelVersion,
    );

    return this.getModel(entity)
      .then(storedModel => {
        // As Backstage is the system of record, we just override the model in Grafana.
        // In the future, we may need to do some reconciliation of state, such at alerts
        // firing or incidents in progress.
        _.unset(storedModel, 'spec.metadata.uid');

        // TODO: 
        if (!_.isEqual(model.spec, storedModel.spec)) {
          // Update requires the last resourceVersion to be passed in
          model.metadata!.resourceVersion =
            storedModel.metadata?.resourceVersion;
          return this.updateModel(entity, model)
            .then(() => true)
            .catch(err => {
              this.logger.error(
                `GrafanaServiceModelProcessor createOrUpdateModel error: ${JSON.stringify(
                  err,
                )}`,
              );
              return false;
            });
        }

        return true;
      })
      .catch(err => {
        // Seems a GET on a non-existent object throws an error with a 404
        // eslint-disable-next-line eqeqeq
        if (err.body.code == 404) {
          return this.createModel(entity).then(() => true);
        }
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
  async getModel(entity: Entity): Promise<k8s.KubernetesObjectWithSpec> {
    return this.client
      .getNamespacedCustomObject(
        API_GROUP,
        this.serviceModelVersion,
        this.k8sNamespace,
        pluralize(entity.kind),
        entity.metadata.name,
      )
      .then(({ body }) => body as k8s.KubernetesObjectWithSpec)
      .catch(err => {
        throw err;
      });
  }

  /**
   * updateModel updates the model in the GrafanaServiceModel
   * @param entity - The entity to update in the GrafanaServiceModel
   * @param model - The model to update in the GrafanaServiceModel
   * @returns - A promise that resolves to the updated model in the GrafanaServiceModel
   */
  async updateModel(entity: Entity, model: k8s.KubernetesObject) {
    let k8sObject: k8s.KubernetesObject | undefined;

    return this.client
      .replaceNamespacedCustomObject(
        API_GROUP,
        this.serviceModelVersion,
        this.k8sNamespace,
        pluralize(entity.kind),
        entity.metadata.name,
        model,
      )
      .then(({ body }) => {
        k8sObject = body as k8s.KubernetesObject;
        this.logger.debug(
          `GrafanaServiceModelProcessor.updateModel replaceNamespacedCustomObject() response: ${JSON.stringify(
            k8sObject,
          )}`,
        );
      })
      .catch((err: any) => {
        this.logger.error(
          `GrafanaServiceModelProcessor.updateModel error: ${JSON.stringify(
            err,
          )}`,
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
    let k8sObject: k8s.KubernetesObject | undefined;

    return this.client
      .getNamespacedCustomObject(
        API_GROUP,
        this.serviceModelVersion,
        this.k8sNamespace,
        pluralize(entity.kind),
        entity.metadata.name,
      )
      .then(({ body }) => {
        k8sObject = body as k8s.KubernetesObject;
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
        return this.client
          .createNamespacedCustomObject(
            API_GROUP,
            this.serviceModelVersion,
            this.k8sNamespace,
            pluralize(entity.kind),
            k8sModel,
          )
          .then(({ body }) => {
            k8sObject = body as k8s.KubernetesObject;
            this.logger.debug(
              `GrafanaServiceModelProcessor.createModel response: ${JSON.stringify(
                k8sObject,
              )}`,
            );
          })
          .catch((e: any) => {
            this.logger.error(
              `GrafanaServiceModelProcessor.createModel error: ${JSON.stringify(
                e.body,
              )} ${JSON.stringify(k8sObject)}`,
            );
          });
      });
  }
}

function pluralize(s: string): string {
  return `${s.toLowerCase()}s`;
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
// So we don't have to do that in the admission controller
export function entityToServiceModel(
  entity: Entity,
  namespace: string,
  serviceModelVersion: string,
): k8s.KubernetesObjectWithSpec {
  const labels: Record<string, string> = {};

  // Raise up the well-known relations
  // I've not seen these from Backstage yet
  for (const relation of entity.relations || []) {
    labels[`${API_GROUP}/${relation.type}`] = cleanEntityRef(
      relation.targetRef,
    );
  }

  // Raise up the well-known relations onto labels, for identity.
  // Most of these are the 1:1 relations. The 1:N relations will be handed in admission control.
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

  const metadata = new k8s.V1ObjectMeta();

  // copy all fields from entity.metadata to serviceModel.metadata
  Object.assign(metadata, entity.metadata);
  // Override the namespace and labels
  metadata.name = entity.metadata.name;
  metadata.namespace = namespace;
  metadata.labels = labels;

  const serviceModel: k8s.KubernetesObjectWithSpec = {
    // Set the API version and kind
    apiVersion: `${API_GROUP}/${serviceModelVersion}`,
    kind: entity.kind,
    metadata: metadata,

    // Copy original metadata to spec.metadata
    spec: {
      metadata: entity.metadata,
    },
  };

  // copy all fields from entity.spec to serviceModel.spec
  Object.assign(serviceModel.spec, entity.spec);

  return serviceModel;
}
