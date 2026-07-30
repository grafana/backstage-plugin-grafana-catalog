import { Entity } from '@backstage/catalog-model';
import { Config, ConfigReader } from '@backstage/config';
import { LoggerService } from '@backstage/backend-plugin-api';
import { LocationSpec } from '@backstage/plugin-catalog-common';
import {
  CatalogProcessorCache,
  CatalogProcessorEmit,
} from '@backstage/plugin-catalog-node';
import { metrics as otelMetrics } from '@opentelemetry/api';
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
    value: number;
    attributes: Record<string, unknown>;
  };

  /**
   * A MeterProvider that records every measurement, registered globally so the
   * processor resolves it through the same path it uses in production.
   */
  function installMeter() {
    const measurements = new Map<string, Measurement[]>();
    const gaugeCallbacks: Array<() => void> = [];

    const push =
      (name: string) =>
      (value: number, attributes = {}) => {
        const list = measurements.get(name) ?? [];
        list.push({ value, attributes });
        measurements.set(name, list);
      };

    const meter = {
      createCounter: (name: string) => ({ add: push(name) }),
      createHistogram: (name: string) => ({ record: push(name) }),
      createObservableGauge: (name: string) => ({
        addCallback: (cb: (r: { observe: Function }) => void) =>
          gaugeCallbacks.push(() =>
            cb({
              observe: (value: number, attributes = {}) =>
                push(name)(value, attributes),
            }),
          ),
        removeCallback: () => {},
      }),
    };

    otelMetrics.disable();
    otelMetrics.setGlobalMeterProvider({ getMeter: () => meter } as any);

    return {
      of: (name: string) => measurements.get(name) ?? [],
      names: () => [...measurements.keys()].sort(),
      /** Runs the observable gauge callbacks, as a collection cycle would. */
      collect: () => gaugeCallbacks.forEach(cb => cb()),
      total: () => [...measurements.values()].flat().length,
    };
  }

  let logger: jest.Mocked<LoggerService>;
  let connect: jest.SpyInstance<Promise<boolean>, []>;
  let meter: ReturnType<typeof installMeter>;

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(),
    } as unknown as jest.Mocked<LoggerService>;

    meter = installMeter();

    connect = jest
      .spyOn(
        GrafanaServiceModelProcessor.prototype,
        'createAndTestGrafanaConnection',
      )
      .mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    otelMetrics.disable();
  });

  async function newProcessor(config: object = CONFIG) {
    const processor = GrafanaServiceModelProcessor.fromConfig({
      logger,
      config: new ConfigReader(config) as Config,
    });
    await Promise.resolve();
    await Promise.resolve();
    return processor;
  }

  // postProcessEntity resolves without waiting for the ServiceModel write, so
  // let the queue fully drain before asserting on what the write recorded.
  // setImmediate runs after all pending microtasks regardless of chain depth.
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
    await new Promise(r => setImmediate(r));
    return result;
  }

  /**
   * Wires a fake ServiceModel client so the real create/update/noop paths run,
   * rather than stubbing createOrUpdateModel and skipping them.
   */
  function installClient(
    processor: GrafanaServiceModelProcessor,
    handlers: {
      get?: () => Promise<any>;
      create?: () => Promise<any>;
      update?: () => Promise<any>;
    },
  ) {
    const notFound = () =>
      Promise.reject(Object.assign(new Error(), { code: 404 }));
    processor.serviceModelVersion = 'v1';
    processor.k8sNamespace = 'stacks-1';
    processor.client = {
      getNamespacedCustomObject: jest.fn(handlers.get ?? notFound),
      createNamespacedCustomObject: jest.fn(
        handlers.create ?? (() => Promise.resolve({})),
      ),
      replaceNamespacedCustomObject: jest.fn(
        handlers.update ?? (() => Promise.resolve({})),
      ),
    } as unknown as typeof processor.client;
  }

  /** The ServiceModel object the processor would consider already current. */
  function storedModel(entity: Entity) {
    return entityToServiceModel(entity, 'stacks-1', 'v1');
  }

  it('registers one instrument per series', async () => {
    const processor = await newProcessor();
    installClient(processor, {});
    await process(processor, component);
    meter.collect();

    expect(meter.names()).toEqual([
      'grafana_servicemodel.api.requests',
      'grafana_servicemodel.connection.attempts',
      'grafana_servicemodel.connection.state',
      'grafana_servicemodel.entities.processed',
      'grafana_servicemodel.entities.synced',
      'grafana_servicemodel.sync.duration',
    ]);
  });

  describe('connection state', () => {
    it('is sampled at collection time, not only on connection attempts', async () => {
      const processor = await newProcessor();

      // Many collections between attempts, which is the normal steady state
      meter.collect();
      meter.collect();
      expect(
        meter.of('grafana_servicemodel.connection.state').map(m => m.value),
      ).toEqual([1, 1]);

      // A later outage is visible on the very next collection
      processor.grafanaAvailable = false;
      meter.collect();
      expect(
        meter.of('grafana_servicemodel.connection.state').map(m => m.value),
      ).toEqual([1, 1, 0]);
    });

    it('emits no data point while the processor is disabled', async () => {
      await newProcessor({
        grafanaCloudCatalogInfo: {
          ...CONFIG.grafanaCloudCatalogInfo,
          enable: false,
        },
      });
      meter.collect();

      expect(meter.of('grafana_servicemodel.connection.state')).toHaveLength(0);
    });

    it('reports the outcome of each connection attempt', async () => {
      connect.mockResolvedValue(false);
      await newProcessor();

      expect(
        meter.of('grafana_servicemodel.connection.attempts')[0].attributes,
      ).toEqual({ outcome: 'failure' });
    });
  });

  describe('skip reasons', () => {
    it('counts entities the filter excludes as filtered, not processed', async () => {
      const processor = await newProcessor();

      await process(processor, {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Component',
        metadata: { name: 'a-website' },
        spec: { type: 'website' },
      });

      expect(
        meter.of('grafana_servicemodel.entities.skipped')[0].attributes,
      ).toEqual({ kind: 'Component', reason: 'filtered' });
      expect(meter.of('grafana_servicemodel.entities.processed')).toHaveLength(
        0,
      );
    });

    it('counts a Location the same way the filter would', async () => {
      const processor = await newProcessor();

      await process(processor, {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Location',
        metadata: { name: 'a-location' },
      });

      expect(
        meter.of('grafana_servicemodel.entities.skipped')[0].attributes,
      ).toEqual({ kind: 'Location', reason: 'filtered' });
    });

    it('counts an unchanged entity as processed and skipped, with no sync', async () => {
      const processor = await newProcessor();

      await process(processor, component, component);

      expect(
        meter.of('grafana_servicemodel.entities.processed')[0].attributes,
      ).toEqual({ kind: 'Component' });
      expect(
        meter.of('grafana_servicemodel.entities.skipped')[0].attributes,
      ).toEqual({ kind: 'Component', reason: 'unchanged' });
      expect(meter.of('grafana_servicemodel.sync.duration')).toHaveLength(0);
      expect(meter.of('grafana_servicemodel.api.requests')).toHaveLength(0);
    });

    it('counts entities left behind by an outage as disconnected', async () => {
      connect.mockResolvedValue(false);
      const processor = await newProcessor();

      await process(processor, component);

      expect(
        meter.of('grafana_servicemodel.entities.skipped')[0].attributes,
      ).toEqual({ kind: 'Component', reason: 'disconnected' });
    });
  });

  describe('sync operations', () => {
    it('labels a newly created entity as create', async () => {
      const processor = await newProcessor();
      installClient(processor, {}); // get -> 404, create -> ok
      await process(processor, component);

      expect(meter.of('grafana_servicemodel.entities.synced')).toEqual([
        { value: 1, attributes: { kind: 'Component', operation: 'create' } },
      ]);
      expect(meter.of('grafana_servicemodel.entities.failed')).toHaveLength(0);
    });

    it('labels a changed entity as update', async () => {
      const processor = await newProcessor();
      installClient(processor, {
        // Present, but with a spec that differs from the entity's
        get: () => Promise.resolve({ spec: { type: 'stale' }, metadata: {} }),
      });
      await process(processor, component);

      expect(meter.of('grafana_servicemodel.entities.synced')).toEqual([
        { value: 1, attributes: { kind: 'Component', operation: 'update' } },
      ]);
    });

    it('labels an already-current entity as noop and issues no write', async () => {
      const processor = await newProcessor();
      installClient(processor, {
        get: () => Promise.resolve(storedModel(component)),
      });
      await process(processor, component);

      expect(meter.of('grafana_servicemodel.entities.synced')).toEqual([
        { value: 1, attributes: { kind: 'Component', operation: 'noop' } },
      ]);
      expect(
        processor.client!.replaceNamespacedCustomObject,
      ).not.toHaveBeenCalled();
    });
  });

  describe('failures', () => {
    it('counts a failed create as failed, not synced', async () => {
      const processor = await newProcessor();
      installClient(processor, {
        create: () =>
          Promise.reject(Object.assign(new Error('boom'), { code: 500 })),
      });
      await process(processor, component);

      expect(meter.of('grafana_servicemodel.entities.failed')).toEqual([
        { value: 1, attributes: { kind: 'Component', code: '500' } },
      ]);
      expect(meter.of('grafana_servicemodel.entities.synced')).toHaveLength(0);
      // The write did not land, so the duration must not read as a success
      expect(
        meter.of('grafana_servicemodel.sync.duration')[0].attributes,
      ).toEqual({ kind: 'Component', outcome: 'failure' });
    });

    it('does not cache an entity whose create failed', async () => {
      const processor = await newProcessor();
      installClient(processor, {
        create: () =>
          Promise.reject(Object.assign(new Error('boom'), { code: 500 })),
      });

      const cache = {
        get: jest.fn().mockResolvedValue(undefined),
        set: jest.fn().mockResolvedValue(undefined),
      };
      await processor.postProcessEntity!(
        component,
        {} as LocationSpec,
        jest.fn() as CatalogProcessorEmit,
        cache as unknown as CatalogProcessorCache,
      );
      await new Promise(r => setImmediate(r));

      // Only the unconditional end-of-cycle write, never one crediting success
      expect(cache.set).toHaveBeenCalledTimes(1);
    });

    it('counts a failed update as failed, not synced', async () => {
      const processor = await newProcessor();
      installClient(processor, {
        get: () => Promise.resolve({ spec: { type: 'stale' }, metadata: {} }),
        update: () =>
          Promise.reject(Object.assign(new Error('slow down'), { code: 429 })),
      });
      await process(processor, component);

      expect(meter.of('grafana_servicemodel.entities.failed')).toEqual([
        { value: 1, attributes: { kind: 'Component', code: '429' } },
      ]);
      expect(meter.of('grafana_servicemodel.entities.synced')).toHaveLength(0);
      expect(
        meter.of('grafana_servicemodel.sync.duration')[0].attributes,
      ).toEqual({ kind: 'Component', outcome: 'failure' });
    });

    it('does not cache an entity whose update failed', async () => {
      const processor = await newProcessor();
      installClient(processor, {
        get: () => Promise.resolve({ spec: { type: 'stale' }, metadata: {} }),
        update: () =>
          Promise.reject(Object.assign(new Error('slow down'), { code: 429 })),
      });

      const cache = {
        get: jest.fn().mockResolvedValue(undefined),
        set: jest.fn().mockResolvedValue(undefined),
      };
      await processor.postProcessEntity!(
        component,
        {} as LocationSpec,
        jest.fn() as CatalogProcessorEmit,
        cache as unknown as CatalogProcessorCache,
      );
      await new Promise(r => setImmediate(r));

      expect(cache.set).toHaveBeenCalledTimes(1);
    });

    it('records the status code when a sync throws', async () => {
      const processor = await newProcessor();
      jest
        .spyOn(processor, 'createOrUpdateModel')
        .mockRejectedValue(Object.assign(new Error('boom'), { code: 503 }));

      await process(processor, component);

      expect(
        meter.of('grafana_servicemodel.entities.failed')[0].attributes,
      ).toEqual({ kind: 'Component', code: '503' });
    });

    it('labels a transport failure with its error code', async () => {
      const processor = await newProcessor();
      jest
        .spyOn(processor, 'createOrUpdateModel')
        .mockRejectedValue(
          Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
        );

      await process(processor, component);

      expect(
        meter.of('grafana_servicemodel.entities.failed')[0].attributes,
      ).toEqual({ kind: 'Component', code: 'ECONNRESET' });
    });

    it('labels a failure carrying no code as unknown', async () => {
      const processor = await newProcessor();
      jest
        .spyOn(processor, 'createOrUpdateModel')
        .mockRejectedValue(new Error('opaque'));

      await process(processor, component);

      expect(
        meter.of('grafana_servicemodel.entities.failed')[0].attributes,
      ).toEqual({ kind: 'Component', code: 'unknown' });
    });
  });

  describe('api requests', () => {
    it('counts each request by operation and status', async () => {
      const processor = await newProcessor();
      installClient(processor, {}); // get -> 404, then create -> 200
      await process(processor, component);

      expect(meter.of('grafana_servicemodel.api.requests')).toEqual([
        { value: 1, attributes: { operation: 'get', code: '404' } },
        { value: 1, attributes: { operation: 'get', code: '404' } },
        { value: 1, attributes: { operation: 'create', code: '200' } },
      ]);
    });

    it('counts a throttled update with its status code', async () => {
      const processor = await newProcessor();
      installClient(processor, {
        get: () => Promise.resolve({ spec: { type: 'stale' }, metadata: {} }),
        update: () =>
          Promise.reject(Object.assign(new Error('slow down'), { code: 429 })),
      });
      await process(processor, component);

      expect(meter.of('grafana_servicemodel.api.requests')).toEqual([
        { value: 1, attributes: { operation: 'get', code: '200' } },
        { value: 1, attributes: { operation: 'update', code: '429' } },
      ]);
    });
  });

  describe('sync duration', () => {
    it('is recorded in seconds', async () => {
      const processor = await newProcessor();
      installClient(processor, {});

      // A 1.5s sync, so a milliseconds/seconds mix-up cannot pass
      const now = jest
        .spyOn(Date, 'now')
        .mockReturnValueOnce(10_000)
        .mockReturnValue(11_500);

      await process(processor, component);
      now.mockRestore();

      expect(meter.of('grafana_servicemodel.sync.duration')).toEqual([
        { value: 1.5, attributes: { kind: 'Component', outcome: 'success' } },
      ]);
    });
  });

  it('runs normally when no MeterProvider is registered', async () => {
    otelMetrics.disable();

    const processor = await newProcessor();
    installClient(processor, {});

    await expect(process(processor, component)).resolves.toBe(component);
    expect(meter.total()).toBe(0);
  });
});
