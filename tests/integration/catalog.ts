import { CatalogBuilder } from '@backstage/plugin-catalog-backend';
import { ScaffolderEntitiesProcessor } from '@backstage/plugin-catalog-backend-module-scaffolder-entity-model';
import { Router } from 'express';
import { PluginEnvironment } from '../types';
import { GrafanaServiceModelProcessor } from '@grafana/backstage-plugin-grafana-catalog';

export default async function createPlugin(
  env: PluginEnvironment,
): Promise<Router> {
  const builder = await CatalogBuilder.create(env);
  builder.addProcessor(new ScaffolderEntitiesProcessor());
  builder.addProcessor(GrafanaServiceModelProcessor.fromConfig(env));
  const { processingEngine, router } = await builder.build();
  await processingEngine.start();
  return router;
}
