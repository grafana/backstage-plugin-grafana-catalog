/**
 * The grafana-service-model backend module for the catalog plugin.
 *
 * @packageDocumentation
 */

export { catalogModuleGrafanaServiceModelCustomProcessor as default } from './module';
export { GrafanaServiceModelProcessor } from './processor';
export { getGrafanaCloudK8sConfig } from './kube_config';
