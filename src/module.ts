import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { metricsServiceRef } from '@backstage/backend-plugin-api/alpha';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node/alpha';
import { GrafanaServiceModelProcessor } from './processor';

export const catalogModuleGrafanaServiceModelCustomProcessor =
  createBackendModule({
    pluginId: 'catalog',
    moduleId: 'grafana-servicemodel',
    register(env) {
      env.registerInit({
        deps: {
          catalog: catalogProcessingExtensionPoint,
          logger: coreServices.logger,
          config: coreServices.rootConfig,
          metrics: metricsServiceRef,
        },
        async init({ config, catalog, logger, metrics }) {
          catalog.addProcessor(
            GrafanaServiceModelProcessor.fromConfig({
              logger: logger,
              config: config,
              metrics: metrics,
            }),
          );
        },
      });
    },
  });
