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

import {
  getGrafanaCloudK8sConfig,
  GrafanaCloudK8sConfig,
  PluginEnvironment,
} from './kube_config';

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
  enable: boolean = false;
  kc: k8s.KubeConfig | undefined = undefined;
  client: k8s.CustomObjectsApi = new k8s.CustomObjectsApi();
  serviceModelVersion: string = '';
  grafanaAvailable: boolean = false;
  k8sNamespace: string = '';
  filter: EntityFilter;

  static fromConfig(env: PluginEnvironment) {
    // The Config bits are a in env.config.
    return new GrafanaServiceModelProcessor(env);
  }

  constructor(private readonly env: PluginEnvironment) {
    this.grafanaAvailable = false;

    const allowedKinds = env.config.getStringArray(
      'grafanaCloudCatalogInfo.allow',
    );

    const filter = anyOfMultipleFilters(allowedKinds);
    if (!filter) {
      // This should never happen, as the config schema should enforce this
      throw new Error(
        'GrafanaServiceModelProcessor: No allowed kinds found in config',
      );
    }
    this.filter = filter;
    env.logger.info(
      'GrafanaServiceModelProcessor: Configured with filter: ',
      filter,
    );

    this.enable = env.config.getBoolean('grafanaCloudCatalogInfo.enable');
    if (!this.enable) {
      env.logger.info(
        'GrafanaServiceModelProcessor: Disabled. Set grafanaCloudCatalogInfo.enabled to true to enable',
      );
      return;
    }

    getGrafanaCloudK8sConfig(env).then((cloudConfig: GrafanaCloudK8sConfig) => {
      this.kc = cloudConfig.config;
      this.k8sNamespace = cloudConfig.namespace;
      this.client = this.kc.makeApiClient(k8s.CustomObjectsApi);

      this.testGrafanaConnection().then(result => {
        this.grafanaAvailable = result;
      });
    });
  }

  async testGrafanaConnection(): Promise<boolean> {
    return new Promise((resolve, _reject) => {
      if (!this.kc) {
        this.env.logger.info(
          'GrafanaServiceModelProcessor: k8s not available. No kubeconfig',
        );
        resolve(false);
        return;
      }
      const apiApiClient = this.kc?.makeApiClient(k8s.ApisApi);
      apiApiClient
        .getAPIVersions()
        .then(({ body }) => {
          const apiGroup = body.groups.find(group => group.name === API_GROUP);
          if (!apiGroup) {
            this.env.logger.info(
              'GrafanaServiceModelProcessor ApiGroup not available in the api server',
            );
            resolve(false);
            return;
          }
          // Capture the latest (preferred) version of the ServiceModel API
          this.serviceModelVersion =
            apiGroup.preferredVersion?.version ?? 'notfound';
          if (this.serviceModelVersion === 'notfound') {
            this.env.logger.info(
              'GrafanaServiceModelProcessor ApiGroup not available in the api server',
            );
            resolve(false);
            return;
          }
          this.env.logger.info(
            `GrafanaServiceModelProcessor: k8s available. Found ServiceModel API version: ${this.serviceModelVersion}. Using namespace: ${this.k8sNamespace}`,
          );
          resolve(true);
          return;
        })
        .catch((error: any) => {
          this.env.logger.error(
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
        await this.testGrafanaConnection().then(result => {
          this.grafanaAvailable = result;
          // Catch you next time
          resolve(entity);
          return;
        });
      } else {
        // Skip if kind is a Location or API
        if (entity.kind === 'Location' || entity.kind === 'API') {
          resolve(entity);
          return;
        }

        // Skip if the kind is not in the list of allowed kinds
        if (!entityMatch(entity, this.filter)) {
          resolve(entity);
          return;
        }

        this.env.logger.debug(
          `GrafanaServiceModelProcessor.postProcessEntity entity '${entity.kind}' with name '${entity.metadata.name}`,
        );

        const CACHE_KEY = stringifyEntityRef(entity);
        cache.get(CACHE_KEY).then(cachedEntity => {
          if (
            !cachedEntity ||
            (cachedEntity && !_.isEqual(entity, cachedEntity))
          ) {
            this.env.logger.debug(
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
                this.env.logger.error(
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

  async createOrUpdateModel(entity: Entity): Promise<boolean> {
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

        if (!_.isEqual(model.spec, storedModel.spec)) {
          // Update requires the last resourceVersion to be passed in
          model.metadata!.resourceVersion =
            storedModel.metadata?.resourceVersion;
          return this.updateModel(entity, model)
            .then(() => true)
            .catch(err => {
              this.env.logger.error(
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
        this.env.logger.debug(
          `GrafanaServiceModelProcessor.updateModel replaceNamespacedCustomObject() response: ${JSON.stringify(
            k8sObject,
          )}`,
        );
      })
      .catch((err: any) => {
        this.env.logger.error(
          `GrafanaServiceModelProcessor.updateModel error: ${JSON.stringify(
            err,
          )}`,
        );
        throw err;
      });
  }

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
        this.env.logger.debug(
          `GrafanaServiceModelProcessor.createModel getNamespacedCustomObject() response: ${JSON.stringify(
            k8sObject,
          )}`,
        );
      })
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
            this.env.logger.debug(
              `GrafanaServiceModelProcessor.createModel response: ${JSON.stringify(
                k8sObject,
              )}`,
            );
          })
          .catch((e: any) => {
            this.env.logger.error(
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
