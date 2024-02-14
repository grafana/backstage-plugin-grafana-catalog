import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node/alpha';
import { GrafanaServiceModelProcessor } from './processor';
import { loggerToWinstonLogger } from '@backstage/backend-common';

/**
 * Registers the `GrafanaServiceModelProcessor` processor with the catalog processing extension point.
 */
export const catalogModuleGrafanaServiceModel = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'grafana-service-model',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        config: coreServices.rootConfig,
        catalog: catalogProcessingExtensionPoint,
      },
      async init({ logger, config, catalog }) {
        catalog.addProcessor(
          GrafanaServiceModelProcessor.fromConfig({
            logger: loggerToWinstonLogger(logger),
            config,
          }),
        );
      },
    });
  },
});
