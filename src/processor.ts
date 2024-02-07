import { PluginEnvironment } from '../../../packages/backend/src/types';
import { JsonObject } from '@backstage/types';
import { Config } from '@backstage/config';

import {
  ComponentEntityV1alpha1,
  GroupEntityV1alpha1,
} from '@backstage/catalog-model';

import * as k8s from '@kubernetes/client-node';
const _ = require('lodash');
import http from 'http';

import {
  CatalogProcessor,
  CatalogProcessorEmit,
} from '@backstage/plugin-catalog-node';

import { LocationSpec } from '@backstage/plugin-catalog-common';
import { Entity } from '@backstage/catalog-model';
import { CatalogProcessorCache } from '@backstage/plugin-catalog-node';

import { getGrafanaCloudK8sConfig, GrafanaCloudK8sConfig} from './kube_config';

const API_GROUP = 'servicemodel.ext.grafana.com';
const LABELS = {
  OWNER          : `${API_GROUP}/owner`,
  SYSTEM         : `${API_GROUP}/system`,
  SUBCOMPONENT_OF: `${API_GROUP}/subcomponentOf`,
  PARENT         : `${API_GROUP}/parent`,
  TYPE           : `${API_GROUP}/type`,
};

interface ServiceModelSpec {
  metadata: object;
  resourceVersion?: string;
}

// A processor that writes entities to the GrafanaServiceModelProcessor
export class GrafanaServiceModelProcessor implements CatalogProcessor {
  kc: k8s.KubeConfig;
  client: k8s.CustomObjectsApi;
  serviceModelVersion: string = '';
  grafanaAvailable: boolean = false;
  k8sNamespace: string = '';

  static fromConfig(env: PluginEnvironment) {
    // The Config bits are a in env.config.
    return new GrafanaServiceModelProcessor(env);
  }

  constructor(private readonly env: PluginEnvironment) {
    this.grafanaAvailable = false;
    this.env.logger.info('GrafanaServiceModelProcessor config: ' + JSON.stringify(env.config));
    getGrafanaCloudK8sConfig(env)
    .then((config: GrafanaCloudK8sConfig) => {
      this.kc = config.config;
      this.k8sNamespace = config.namespace;
      this.client = this.kc.makeApiClient(k8s.CustomObjectsApi);
      this.testGrafanaConnection()
      .then((available) => {
        this.grafanaAvailable = available;
      });
    });
  }

  async testGrafanaConnection(): Promise<boolean> {
    try {
      const apiApiClient = this.kc.makeApiClient(k8s.ApisApi);
      const { body } = await apiApiClient.getAPIVersions();

      const apiGroup = body.groups.find(group => group.name === API_GROUP);
      if (!apiGroup) {
        this.env.logger.info('GrafanaServiceModelProcessor ApiGroup not available in the api server');
        return false;
      }

      // Capture the latest (preferred) version of the ServiceModel API
      this.serviceModelVersion = apiGroup.preferredVersion?.version ?? 'notfound';
      if (this.serviceModelVersion === 'notfound') {
        this.env.logger.info('GrafanaServiceModelProcessor ApiGroup not available in the api server');
        return false;
      }
    } catch (error: any) {
      this.env.logger.info('GrafanaServiceModelProcessor: k8s not available: ' + JSON.stringify(error));
      return false;
    }
    this.env.logger.info('GrafanaServiceModelProcessor: k8s available. Found ServiceModel API version: ' + this.serviceModelVersion + '. Using namespace: ' + this.k8sNamespace);
    return true;
  }

  getProcessorName(): string {
    return 'GrafanaServiceModelProcessor';
  }

  async postProcessEntity?(
    entity: Entity,
    _location: LocationSpec,
    _emit: CatalogProcessorEmit,
    cache: CatalogProcessorCache,
  ): Promise<Entity> {
    if (!this.grafanaAvailable) {
      this.grafanaAvailable = await this.testGrafanaConnection();
      // Catch you next time
      return entity;
    }

    // Skip if kind is a Location or API
    if (entity.kind === 'Location' || entity.kind === 'API') {
      return entity;
    }

    this.env.logger.debug(
      "GrafanaServiceModelProcessor.postProcessEntity entity '" + entity.kind + "' with name '" + entity.metadata.name
    );

    // The only info I could find about how to use CatalogProcessorCache is here: https://github.com/backstage/backstage/discussions/17399
    const CACHE_KEY = 'ServiceModel';
    const cachedEntity = await cache.get(CACHE_KEY);

    if(!cachedEntity || (cachedEntity && !_.isEqual(entity, cachedEntity))) {
      this.env.logger.debug("GrafanaServiceModelProcessor.postProcessEntity entity '" + entity.kind + "' with name '" + entity.metadata.name + "' not found in cache or they differ");
      try {
        if (await this.createOrUpdateModel(entity)) {
          // Update the cache if we were successful in storing the model
          cache.set(CACHE_KEY, entity);
        }
      } catch (err: any) {
        this.env.logger.error("GrafanaServiceModelProcessor.postProcessEntity error: " + JSON.stringify(err));
        // Eat the error, we don't want to stop the catalog from processing
      }
    }

    return entity;
  }

  async createOrUpdateModel(entity: Entity): Promise<boolean> {
    const model: k8s.KubernetesObjectWithSpec = this.entityToServiceModel(entity);
    let storedModel: k8s.KubernetesObjectWithSpec;

    try {
      storedModel = await this.getModel(entity);
    } catch (err: any) {
      // Seems a GET on a non-existent object throws an error with a 404
      if (err.body.code == 404) {
        this.createModel(entity);
        return true;
      }
      throw err;
    }

    // As Backstage is the system of record, we just override the model in Grafana.
    // In the future, we may need to do some reconciliation of state, such at alerts
    // firing or incidents in progress.
    _.unset(storedModel, 'spec.metadata.uid');
   if(!_.isEqual(model.spec, storedModel.spec)) {

     try {
        // Update requires the last resourceVersion to be passed in
        model.metadata!.resourceVersion = storedModel.metadata?.resourceVersion;
        this.updateModel(entity, model);
      } catch (err: any) {
        this.env.logger.error('GrafanaServiceModelProcessor createOrUpdateModel error: ' + JSON.stringify(err));
        return false;
      }
    }
    return true;
  }

  async getModel(entity: Entity): Promise<k8s.KubernetesObjectWithSpec> {
    try {
      const { response, body } = await this.client.getNamespacedCustomObject(
        API_GROUP,
        this.serviceModelVersion,
        this.k8sNamespace,
        this.pluralize(entity.kind),
        entity.metadata.name,
      );
      return <k8s.KubernetesObjectWithSpec>body;
    } catch (err: any) {
      throw err;
    }
  }


  async updateModel(entity: Entity, model: k8s.KubernetesObject) {
    try {
          const { response, body } =
            await this.client.replaceNamespacedCustomObject(
              API_GROUP,
              this.serviceModelVersion,
              this.k8sNamespace,
              this.pluralize(entity.kind),
              entity.metadata.name,
              model,
            );
          const updated = <k8s.KubernetesObject>body;
    } catch (err: any) {
      this.env.logger.error('GrafanaServiceModelProcessor.updateModel error: ' + JSON.stringify(err));
      throw err;
    }
  }

  async createModel(entity: Entity) {
    var k8sObject: k8s.KubernetesObject | undefined = undefined;
    try {
      const { response, body } = await this.client.getNamespacedCustomObject(API_GROUP, this.serviceModelVersion, this.k8sNamespace, this.pluralize(entity.kind), entity.metadata.name);
      k8sObject = <k8s.KubernetesObject>body;
      this.env.logger.debug("GrafanaServiceModelProcessor.createModel getNamespacedCustomObject() response: " + JSON.stringify(k8sObject));
    } catch (err: any) {
      try {
        const k8sModel = this.entityToServiceModel(entity);
        const { response, body } = await this.client.createNamespacedCustomObject(API_GROUP, this.serviceModelVersion, this.k8sNamespace, this.pluralize(entity.kind), k8sModel);
        k8sObject = <k8s.KubernetesObject>body;
        this.env.logger.debug("GrafanaServiceModelProcessor.createModel response: " + JSON.stringify(k8sObject));
      } catch (err: any) {
        this.env.logger.error("GrafanaServiceModelProcessor.createModel error: " + JSON.stringify(err.body) + " " + JSON.stringify(k8sObject));
      }
    }
  }

  pluralize(s: string): string {
    return s.toLowerCase() + 's';
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
  cleanEntityRef(ref: string): string {
    return ref.replace(/:/g, '..').replace(/\//g, '__');
  }


  // Create the Grafana Resource for the Backstage Entity
  // Basically copy the Entity metadata to the spec slot then
  // add some labels for the one-to-one relations we know about
  // So we don't have to do that in the admission controller
  entityToServiceModel(entity: Entity): k8s.KubernetesObjectWithSpec {
    const labels: Record<string, string> = {};

    // Raise up the well-known relations
    // I've not seen these from Backstage yet
    for (const relation of entity.relations || []) {
      labels[API_GROUP + '/' + relation.type] =
        this.cleanEntityRef(relation.targetRef);
    }

    // Raise up the well-known relations onto labels, for identity.
    // Most of these are the 1:1 relations. The 1:N relations will be handed in admission control.
    //
    // There might be a better type-safe way to do this.
    if (entity.spec?.owner) {
      labels[LABELS.OWNER] = this.cleanEntityRef(
        <string>entity.spec?.owner,
      );
    }

    if (entity.spec?.system) {
      labels[LABELS.SYSTEM] = this.cleanEntityRef(
        <string>entity.spec?.system,
      );
    }

    if (entity.spec?.subcomponentOf) {
      labels[LABELS.SUBCOMPONENT_OF] =
        this.cleanEntityRef(
          (entity as ComponentEntityV1alpha1).spec.subcomponentOf ?? '',
        );
    }

    if (entity.spec?.parent) {
      labels[LABELS.PARENT] = this.cleanEntityRef(
        (entity as GroupEntityV1alpha1).spec.parent ?? '',
      );
    }

    if (entity.spec?.type) {
      labels[LABELS.TYPE] = <string>entity.spec.type;
    }

    const metadata = new k8s.V1ObjectMeta();

    // copy all fields from entity.metadata to serviceModel.metadata
    Object.assign(metadata, entity.metadata);
    // Override the namespace and labels
    metadata.name = entity.metadata.name;
    metadata.namespace = this.k8sNamespace;
    metadata.labels = labels;

    const serviceModel: k8s.KubernetesObjectWithSpec = {
      // Set the API version and kind
      apiVersion: `${API_GROUP}/${this.serviceModelVersion}`,
      kind      : entity.kind,

      // Init the metadata object
      metadata: metadata,

      // Create an empty spec object
      spec: {
        metadata: metadata,
      },
    };

    // copy all fields from entity.spec to serviceModel.spec
    Object.assign(serviceModel.spec, entity.spec);

    return serviceModel;
  }
}
