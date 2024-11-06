import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node/alpha';
import { GrafanaServiceModelProcessor } from './processor';

export const catalogModuleGrafanaServiceModelCustomProcessor =
  createBackendModule({
    pluginId: 'catalog',
    moduleId: 'grafana-service-model-catalog',
    register(env) {
      env.registerInit({
        deps: {
          catalog: catalogProcessingExtensionPoint,
          logger: coreServices.logger,
          config: coreServices.rootConfig,
        },
        async init({ config, catalog, logger }) {
          catalog.addProcessor(
            GrafanaServiceModelProcessor.fromConfig({
              logger: logger,
              config: config,
            }),
          );
        },
      });
    },
  });
