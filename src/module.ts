import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';

export const catalogModuleGrafanaServiceModel = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'grafana-service-model',
  register(reg) {
    reg.registerInit({
      deps: { logger: coreServices.logger },
      async init({ logger }) {
        logger.info('Hello World!')
      },
    });
  },
});
export { GrafanaServiceModelProcessor } from './processor';
