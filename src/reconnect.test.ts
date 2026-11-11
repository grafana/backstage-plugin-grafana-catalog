import { Entity } from '@backstage/catalog-model';
import { Config, ConfigReader } from '@backstage/config';
import { LoggerService } from '@backstage/backend-plugin-api';
import { LocationSpec } from '@backstage/plugin-catalog-common';
import {
  CatalogProcessorCache,
  CatalogProcessorEmit,
} from '@backstage/plugin-catalog-node';

import { getGrafanaCloudK8sConfig } from './kube_config';
import { GrafanaServiceModelProcessor } from './processor';

// getGrafanaCloudK8sConfig reaches Grafana Cloud, so it is replaced. This file
// exercises the real connect(), which the other processor tests stub out.
jest.mock('./kube_config', () => ({
  getGrafanaCloudK8sConfig: jest.fn(),
}));

describe('reconnecting after the connection was lost', () => {
  const CONFIG = {
    grafanaCloudCatalogInfo: {
      enable: true,
      stack_slug: 'dev',
      grafana_endpoint: 'https://grafana-dev.com',
      token: 'token',
      allow: ['kind=Component,spec.type=service'],
    },
  };

  class FakeObservable {}
  class FakeCustomObjectsApi {}
  class FakeApisApi {}

  const getConfig = getGrafanaCloudK8sConfig as jest.Mock;
  let logger: jest.Mocked<LoggerService>;
  let processor: GrafanaServiceModelProcessor;
  let customObjects: { getNamespacedCustomObject: jest.Mock };
  // Counted failures are spaced on performance.now(), so the clock is driven here.
  // Each process() moves it on, like requests made a moment apart.
  let clock = 0;

  function newKubeConfig() {
    return {
      makeApiClient: jest.fn((api: unknown) =>
        api === FakeApisApi
          ? {
              getAPIVersions: jest.fn().mockResolvedValue({
                groups: [
                  {
                    name: 'servicemodel.ext.grafana.com',
                    preferredVersion: { version: 'v1alpha1' },
                  },
                ],
              }),
            }
          : customObjects,
      ),
    };
  }

  beforeEach(async () => {
    clock = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => clock);
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(),
    } as unknown as jest.Mocked<LoggerService>;

    customObjects = {
      getNamespacedCustomObject: jest.fn().mockResolvedValue({}),
    };
    getConfig.mockReset();
    getConfig.mockImplementation(async () => ({
      config: newKubeConfig(),
      namespace: 'stacks-1',
    }));

    jest
      .spyOn(GrafanaServiceModelProcessor.prototype as any, 'loadK8sClient')
      .mockResolvedValue({
        Observable: FakeObservable,
        CustomObjectsApi: FakeCustomObjectsApi,
        ApisApi: FakeApisApi,
      });

    processor = GrafanaServiceModelProcessor.fromConfig({
      logger,
      config: new ConfigReader(CONFIG) as Config,
    });
    await new Promise(resolve => setImmediate(resolve));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  let n = 0;
  function process() {
    clock += 1_100;
    const entity: Entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: { name: `service-${n++}` },
      spec: { type: 'service' },
    };
    return processor.postProcessEntity!(
      entity,
      {} as LocationSpec,
      jest.fn() as CatalogProcessorEmit,
      {
        get: jest.fn().mockResolvedValue(undefined),
        set: jest.fn().mockResolvedValue(undefined),
      } as unknown as CatalogProcessorCache,
    );
  }

  it('connects once at startup', () => {
    expect(processor.grafanaAvailable).toBe(true);
    expect(getConfig).toHaveBeenCalledTimes(1);
  });

  it('fetches a fresh kubeconfig, since the old one is what just failed', async () => {
    const stale = processor.kc;
    customObjects.getNamespacedCustomObject.mockRejectedValue(
      Object.assign(new Error('certificate has expired'), {
        code: 'CERT_HAS_EXPIRED',
      }),
    );
    for (let i = 0; i < 3; i++) {
      await process();
    }
    expect(processor.grafanaAvailable).toBe(false);

    processor.lastConnectionAttempt = new Date(Date.now() - 3_600_001);
    await process();

    expect(getConfig).toHaveBeenCalledTimes(2);
    expect(processor.kc).not.toBe(stale);
    expect(processor.grafanaAvailable).toBe(true);
  });

  it('keeps the old client in place while the new kubeconfig is fetched', async () => {
    customObjects.getNamespacedCustomObject.mockRejectedValue(
      Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      }),
    );
    for (let i = 0; i < 3; i++) {
      await process();
    }
    const client = processor.client;
    getConfig.mockRejectedValue(new Error('GCOM is down'));

    processor.lastConnectionAttempt = new Date(Date.now() - 3_600_001);
    await process();

    // Requests already in flight do not find the client gone
    expect(processor.client).toBe(client);
    expect(processor.grafanaAvailable).toBe(false);
  });

  it('tries the fresh kubeconfig again on the next attempt after one fails', async () => {
    customObjects.getNamespacedCustomObject.mockRejectedValue(
      Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      }),
    );
    for (let i = 0; i < 3; i++) {
      await process();
    }

    getConfig.mockRejectedValueOnce(new Error('GCOM is down'));
    processor.lastConnectionAttempt = new Date(Date.now() - 3_600_001);
    await process();
    expect(getConfig).toHaveBeenCalledTimes(2);

    processor.lastConnectionAttempt = new Date(Date.now() - 3_600_001);
    await process();
    expect(getConfig).toHaveBeenCalledTimes(3);
    expect(processor.grafanaAvailable).toBe(true);
  });
});
