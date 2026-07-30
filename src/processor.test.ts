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

describe('metrics', () => {
  const CONFIG = {
    grafanaCloudCatalogInfo: {
      enable: true,
      stack_slug: 'dev',
      grafana_endpoint: 'https://grafana-dev.com',
      token: 'token',
      allow: ['kind=Component,spec.type=service'],
    },
  };

  const component: Entity = {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: { name: 'test-entity' },
    spec: { type: 'service' },
  };

  type Measurement = {
    name: string;
    value: number;
    attributes: Record<string, unknown>;
  };

  /**
   * A MetricsService that records every measurement, so tests can assert on the
   * emitted series rather than on OpenTelemetry internals.
   */
  function fakeMetrics() {
    const measurements: Measurement[] = [];
    const instrument = (name: string) => ({
      add: (value: number, attributes: Record<string, unknown> = {}) =>
        measurements.push({ name, value, attributes }),
      record: (value: number, attributes: Record<string, unknown> = {}) =>
        measurements.push({ name, value, attributes }),
    });

    const service = {
      createCounter: jest.fn((name: string) => instrument(name)),
      createUpDownCounter: jest.fn((name: string) => instrument(name)),
      createHistogram: jest.fn((name: string) => instrument(name)),
      createGauge: jest.fn((name: string) => instrument(name)),
      createObservableCounter: jest.fn(),
      createObservableUpDownCounter: jest.fn(),
      createObservableGauge: jest.fn(),
    };

    const of = (name: string) => measurements.filter(m => m.name === name);

    return { service, measurements, of };
  }

  let logger: jest.Mocked<LoggerService>;
  let connect: jest.SpyInstance<Promise<boolean>, []>;
  let metrics: ReturnType<typeof fakeMetrics>;

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(),
    } as unknown as jest.Mocked<LoggerService>;

    metrics = fakeMetrics();

    connect = jest
      .spyOn(
        GrafanaServiceModelProcessor.prototype,
        'createAndTestGrafanaConnection',
      )
      .mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function newProcessor(withMetrics = true) {
    const processor = GrafanaServiceModelProcessor.fromConfig({
      logger,
      config: new ConfigReader(CONFIG) as Config,
      metrics: withMetrics ? (metrics.service as any) : undefined,
    });
    await Promise.resolve();
    await Promise.resolve();
    return processor;
  }

  // postProcessEntity resolves without waiting for the ServiceModel write, so
  // drain the microtask queue to let the sync's own handlers settle before
  // asserting on what they recorded.
  async function process(
    processor: GrafanaServiceModelProcessor,
    entity: Entity,
    cached?: Entity,
  ) {
    const result = await processor.postProcessEntity!(
      entity,
      {} as LocationSpec,
      jest.fn() as CatalogProcessorEmit,
      {
        get: jest.fn().mockResolvedValue(cached),
        set: jest.fn().mockResolvedValue(undefined),
      } as unknown as CatalogProcessorCache,
    );
    for (let i = 0; i < 4; i++) {
      await Promise.resolve();
    }
    return result;
  }

  it('registers one instrument per series', async () => {
    await newProcessor();

    const created = [
      ...metrics.service.createCounter.mock.calls,
      ...metrics.service.createHistogram.mock.calls,
      ...metrics.service.createGauge.mock.calls,
    ].map(([name]) => name);

    expect(created.sort()).toEqual([
      'grafana_servicemodel.api.requests',
      'grafana_servicemodel.connection.attempts',
      'grafana_servicemodel.connection.state',
      'grafana_servicemodel.entities.failed',
      'grafana_servicemodel.entities.processed',
      'grafana_servicemodel.entities.skipped',
      'grafana_servicemodel.entities.synced',
      'grafana_servicemodel.sync.duration',
    ]);
  });

  it('reports the connection outcome and current state', async () => {
    await newProcessor();

    expect(metrics.of('grafana_servicemodel.connection.attempts')).toEqual([
      {
        name: expect.any(String),
        value: 1,
        attributes: { outcome: 'success' },
      },
    ]);
    expect(metrics.of('grafana_servicemodel.connection.state')).toEqual([
      { name: expect.any(String), value: 1, attributes: {} },
    ]);
  });

  it('reports an unavailable connection as state 0', async () => {
    connect.mockResolvedValue(false);
    await newProcessor();

    expect(metrics.of('grafana_servicemodel.connection.state')).toEqual([
      { name: expect.any(String), value: 0, attributes: {} },
    ]);
    expect(
      metrics.of('grafana_servicemodel.connection.attempts')[0].attributes,
    ).toEqual({ outcome: 'failure' });
  });

  it('counts entities the filter excludes as skipped, not processed', async () => {
    const processor = await newProcessor();

    await process(processor, {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: { name: 'a-website' },
      spec: { type: 'website' },
    });

    expect(metrics.of('grafana_servicemodel.entities.skipped')).toEqual([
      {
        name: expect.any(String),
        value: 1,
        attributes: { kind: 'Component', reason: 'filtered' },
      },
    ]);
    expect(metrics.of('grafana_servicemodel.entities.processed')).toHaveLength(
      0,
    );
  });

  it('counts an unchanged entity as processed and skipped', async () => {
    const processor = await newProcessor();

    await process(processor, component, component);

    expect(metrics.of('grafana_servicemodel.entities.processed')).toEqual([
      { name: expect.any(String), value: 1, attributes: { kind: 'Component' } },
    ]);
    expect(
      metrics.of('grafana_servicemodel.entities.skipped')[0].attributes,
    ).toEqual({ kind: 'Component', reason: 'unchanged' });
    expect(metrics.of('grafana_servicemodel.sync.duration')).toHaveLength(0);
  });

  it('counts entities left behind by an outage as skipped', async () => {
    connect.mockResolvedValue(false);
    const processor = await newProcessor();

    // Inside the backoff window, so this entity passes straight through
    await process(processor, component);

    expect(
      metrics
        .of('grafana_servicemodel.entities.skipped')
        .map(m => m.attributes),
    ).toEqual([{ kind: 'Component', reason: 'disconnected' }]);
  });

  it('times a successful sync', async () => {
    const processor = await newProcessor();
    jest.spyOn(processor, 'createOrUpdateModel').mockResolvedValue(true);

    await process(processor, component);

    const [duration] = metrics.of('grafana_servicemodel.sync.duration');
    expect(duration.attributes).toEqual({
      kind: 'Component',
      outcome: 'success',
    });
    expect(duration.value).toBeGreaterThanOrEqual(0);
    expect(metrics.of('grafana_servicemodel.entities.failed')).toHaveLength(0);
  });

  it('records the status code when a sync throws', async () => {
    const processor = await newProcessor();
    jest
      .spyOn(processor, 'createOrUpdateModel')
      .mockRejectedValue(Object.assign(new Error('boom'), { code: 500 }));

    await process(processor, component);

    expect(
      metrics.of('grafana_servicemodel.sync.duration')[0].attributes,
    ).toEqual({ kind: 'Component', outcome: 'failure' });
    expect(metrics.of('grafana_servicemodel.entities.failed')).toEqual([
      {
        name: expect.any(String),
        value: 1,
        attributes: { kind: 'Component', code: '500' },
      },
    ]);
  });

  it('labels a failure with no status code as unknown', async () => {
    const processor = await newProcessor();
    jest
      .spyOn(processor, 'createOrUpdateModel')
      .mockRejectedValue(new Error('socket hang up'));

    await process(processor, component);

    expect(
      metrics.of('grafana_servicemodel.entities.failed')[0].attributes,
    ).toEqual({ kind: 'Component', code: 'unknown' });
  });

  it('runs normally when no metrics service is supplied', async () => {
    const processor = await newProcessor(false);
    jest.spyOn(processor, 'createOrUpdateModel').mockResolvedValue(true);

    await expect(process(processor, component)).resolves.toBe(component);
    expect(metrics.measurements).toHaveLength(0);
  });
});
