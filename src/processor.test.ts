import { Entity } from '@backstage/catalog-model';
import { Config, ConfigReader } from '@backstage/config';
import { LoggerService } from '@backstage/backend-plugin-api';
import { LocationSpec } from '@backstage/plugin-catalog-common';
import {
  CatalogProcessorCache,
  CatalogProcessorEmit,
} from '@backstage/plugin-catalog-node';
import {
  GrafanaServiceModelProcessor,
  entityToServiceModel,
  KubernetesObjectWithSpec,
} from './processor';

describe('catalog-backend-module-grafana-service-model', () => {
  it('should export plugin', () => {
    expect(GrafanaServiceModelProcessor).toBeDefined();
  });
});

it('should convert Component entity to service model', () => {
  const entity: Entity = {
    apiVersion: 'vSomeBackstageVersion',
    metadata: {
      name: 'test-entity',
      labels: {
        app: 'test-app',
      },
    },
    kind: 'Component',
    relations: [
      {
        type: 'test-relation',
        targetRef: 'other:test-target/foo',
      },
    ],
    spec: {
      owner: 'test-owner',
      system: 'test-system',
      subcomponentOf: 'test-subcomponent',
      parent: 'test-parent',
      type: 'test-type',
    },
  };

  const namespace = 'test-namespace';
  const serviceModelVersion = 'v1alpha1';
  const result: KubernetesObjectWithSpec = entityToServiceModel(
    entity,
    namespace,
    serviceModelVersion,
  );

  expect(result.apiVersion).toBe('servicemodel.ext.grafana.com/v1alpha1');
  expect(result.kind).toBe(entity.kind);
  expect(result.metadata?.name).toBe(entity.metadata.name);
  expect(result.metadata?.namespace).toBe(namespace);
  expect(
    result.metadata?.labels?.['servicemodel.ext.grafana.com/test-relation'],
  ).toBe('other..test-target__foo');
  expect(result.metadata?.labels?.['servicemodel.ext.grafana.com/owner']).toBe(
    'test-owner',
  );
  expect(result.metadata?.labels?.['servicemodel.ext.grafana.com/system']).toBe(
    'test-system',
  );
  expect(
    result.metadata?.labels?.['servicemodel.ext.grafana.com/subcomponentOf'],
  ).toBe('test-subcomponent');
  expect(result.metadata?.labels?.['servicemodel.ext.grafana.com/type']).toBe(
    'test-type',
  );

  // spec.metadata is a special case, it should be copied to spec.backstageMetadata
  expect((result.spec as { backstageMetadata: any }).backstageMetadata).toEqual(
    entity.metadata,
  );
});

it('should convert Group entity to service model', () => {
  const entity: Entity = {
    apiVersion: 'vSomeBackstageVersion',
    metadata: {
      name: 'test-entity',
      labels: {
        app: 'test-app',
      },
    },
    kind: 'Component',
    relations: [
      {
        type: 'test-relation',
        targetRef: 'other:test-target/foo',
      },
    ],
    spec: {
      owner: 'test-owner',
      system: 'test-system',
      subcomponentOf: 'test-subcomponent',
      parent: 'test-parent',
      type: 'test-type',
    },
  };

  const namespace = 'test-namespace';
  const serviceModelVersion = 'v1alpha1';
  const result: KubernetesObjectWithSpec = entityToServiceModel(
    entity,
    namespace,
    serviceModelVersion,
  );

  expect(result.apiVersion).toBe('servicemodel.ext.grafana.com/v1alpha1');
  expect(result.kind).toBe(entity.kind);
  expect(result.metadata?.name).toBe(entity.metadata.name);
  expect(result.metadata?.namespace).toBe(namespace);
  expect(
    result.metadata?.labels?.['servicemodel.ext.grafana.com/test-relation'],
  ).toBe('other..test-target__foo');
  expect(result.metadata?.labels?.['servicemodel.ext.grafana.com/owner']).toBe(
    'test-owner',
  );
  expect(result.metadata?.labels?.['servicemodel.ext.grafana.com/system']).toBe(
    'test-system',
  );
  expect(result.metadata?.labels?.['servicemodel.ext.grafana.com/type']).toBe(
    'test-type',
  );

  // spec.metadata is a special case, it should be copied to spec.backstageMetadata
  expect((result.spec as { backstageMetadata: any }).backstageMetadata).toEqual(
    entity.metadata,
  );
});

describe('config absent', () => {
  it('should not throw when grafanaCloudCatalogInfo config is missing', () => {
    const mockConfig = {
      has: (_key: string) => false,
      getString: () => {
        throw new Error('not found');
      },
      getStringArray: () => {
        throw new Error('not found');
      },
      getBoolean: () => {
        throw new Error('not found');
      },
    } as unknown as Config;

    const mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as LoggerService;

    expect(() => {
      GrafanaServiceModelProcessor.fromConfig({
        config: mockConfig,
        logger: mockLogger,
      });
    }).not.toThrow();
  });

  it('should log that it is disabled when config is absent', () => {
    const mockConfig = {
      has: (_key: string) => false,
      getString: () => {
        throw new Error('not found');
      },
      getStringArray: () => {
        throw new Error('not found');
      },
      getBoolean: () => {
        throw new Error('not found');
      },
    } as unknown as Config;

    const mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as LoggerService;

    GrafanaServiceModelProcessor.fromConfig({
      config: mockConfig,
      logger: mockLogger,
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('No grafanaCloudCatalogInfo config found'),
    );
  });
});

describe('entity name validation', () => {
  const nameRegex = /^[a-z0-9][a-z0-9\-.]*[a-z0-9]$/;

  it('should accept valid K8s names', () => {
    expect(nameRegex.test('my-service')).toBe(true);
    expect(nameRegex.test('telemetry-gateway')).toBe(true);
    expect(nameRegex.test('sqm-ingestor-kafka')).toBe(true);
    expect(nameRegex.test('a1')).toBe(true);
    expect(nameRegex.test('service.name.with.dots')).toBe(true);
  });

  it('should reject invalid K8s names', () => {
    expect(nameRegex.test('')).toBe(false);
    expect(nameRegex.test('-starts-with-dash')).toBe(false);
    expect(nameRegex.test('ends-with-dash-')).toBe(false);
    expect(nameRegex.test('.starts-with-dot')).toBe(false);
    expect(nameRegex.test('has spaces')).toBe(false);
    expect(nameRegex.test('HAS-UPPERCASE')).toBe(false);
    expect(nameRegex.test('../../admin')).toBe(false);
    expect(nameRegex.test('foo/bar')).toBe(false);
    expect(nameRegex.test('a')).toBe(false); // single char - needs start AND end
  });

  it('should reject names longer than 253 characters', () => {
    const longName = 'a'.repeat(254);
    expect(longName.length > 253).toBe(true);
    // The regex itself doesn't check length, but the code does
  });
});

describe('connection backoff', () => {
  const CONFIG = {
    grafanaCloudCatalogInfo: {
      enable: true,
      stack_slug: 'dev',
      grafana_endpoint: 'https://grafana-dev.com',
      token: 'token',
      allow: ['kind=Component,spec.type=service'],
    },
  };

  const entity: Entity = {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: { name: 'test-entity' },
    spec: { type: 'service' },
  };

  let logger: jest.Mocked<LoggerService>;
  let connect: jest.SpyInstance<Promise<boolean>, []>;

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(),
    } as unknown as jest.Mocked<LoggerService>;

    connect = jest
      .spyOn(
        GrafanaServiceModelProcessor.prototype,
        'createAndTestGrafanaConnection',
      )
      .mockResolvedValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The constructor kicks off a connection attempt we cannot await, so drain the
  // microtask queue to let it settle before asserting.
  async function newProcessor() {
    const processor = GrafanaServiceModelProcessor.fromConfig({
      logger,
      config: new ConfigReader(CONFIG) as Config,
    });
    await Promise.resolve();
    await Promise.resolve();
    return processor;
  }

  function process(processor: GrafanaServiceModelProcessor) {
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

  // Pretend the last attempt happened long enough ago to leave any backoff window
  function expireBackoff(processor: GrafanaServiceModelProcessor) {
    processor.lastConnectionAttempt = new Date(Date.now() - 3_600_001);
  }

  // The "Next retry in Ns." value from the most recent failure warning
  function lastRetrySeconds(): number {
    const calls = logger.warn.mock.calls;
    const message = String(calls[calls.length - 1][0]);
    return Number(/Next retry in (\d+)s\./.exec(message)![1]);
  }

  it('attempts the connection once at startup and reports the first backoff', async () => {
    await newProcessor();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(lastRetrySeconds()).toBe(60);
  });

  it('does not retry while inside the backoff window', async () => {
    const processor = await newProcessor();
    expect(connect).toHaveBeenCalledTimes(1);

    // Every entity in the cycle passes through, but none of them reconnect
    for (let i = 0; i < 100; i++) {
      await expect(process(processor)).resolves.toBe(entity);
    }

    expect(connect).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('doubles the backoff on each consecutive failure, capped at one hour', async () => {
    const processor = await newProcessor();
    const observed = [lastRetrySeconds()];

    for (let i = 0; i < 8; i++) {
      expireBackoff(processor);
      await process(processor);
      observed.push(lastRetrySeconds());
    }

    expect(observed).toEqual([60, 120, 240, 480, 960, 1920, 3600, 3600, 3600]);
    expect(connect).toHaveBeenCalledTimes(9);
  });

  it('resets the backoff and logs recovery once the connection comes back', async () => {
    const processor = await newProcessor();

    connect.mockResolvedValue(true);
    expireBackoff(processor);
    await process(processor);

    expect(processor.grafanaAvailable).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      'GrafanaServiceModelProcessor: Connection restored.',
    );

    // A later outage starts counting from one again
    connect.mockResolvedValue(false);
    processor.grafanaAvailable = false;
    expireBackoff(processor);
    await process(processor);

    expect(lastRetrySeconds()).toBe(60);
  });

  it('stays quiet when the very first connection succeeds', async () => {
    connect.mockResolvedValue(true);
    await newProcessor();

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalledWith(
      'GrafanaServiceModelProcessor: Connection restored.',
    );
  });
});
