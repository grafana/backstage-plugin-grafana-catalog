import { Entity } from '@backstage/catalog-model';
import { Config, ConfigReader } from '@backstage/config';
import { LoggerService } from '@backstage/backend-plugin-api';
import { LocationSpec } from '@backstage/plugin-catalog-common';
import {
  CatalogProcessorCache,
  CatalogProcessorEmit,
} from '@backstage/plugin-catalog-node';
import { makeValidator } from '@backstage/catalog-model';
import type { KubeConfig } from '@kubernetes/client-node';
import { metrics as otelMetrics } from '@opentelemetry/api';
import {
  GrafanaServiceModelProcessor,
  entityToServiceModel,
  isValidK8sObjectName,
  requestTimeout,
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

describe('isValidK8sObjectName', () => {
  it.each([
    ['an ordinary name', 'my-service'],
    ['dot-separated labels', 'service.name.with.dots'],
    ['two characters', 'a1'],
    ['a single character', 'a'],
    ['a single digit', '7'],
    ['a label at its 63 char limit', 'a'.repeat(63)],
    ['several labels at their limit', `${'a'.repeat(63)}.${'b'.repeat(63)}`],
    // 63 chars, a dot, three times over, then 61 more: 253 exactly
    [
      'exactly the 253 char total limit',
      `${'a'.repeat(63)}.`.repeat(3) + 'a'.repeat(61),
    ],
  ])('accepts %s', (_description, name) => {
    expect(name.length).toBeLessThanOrEqual(253);
    expect(isValidK8sObjectName(name)).toBe(true);
  });

  it.each([
    ['an empty name', ''],
    ['a leading dash', '-starts-with-dash'],
    ['a trailing dash', 'ends-with-dash-'],
    ['a leading dot', '.starts-with-dot'],
    ['a trailing dot', 'ends-with-dot.'],
    ['an empty label between dots', 'a..b'],
    ['a label starting with a dash', 'a.-b'],
    ['a space', 'has spaces'],
    ['a path separator', 'foo/bar'],
    ['path traversal', '../../admin'],
    ['one char over the 253 char total', 'a'.repeat(254)],
    // Under the 253 total, but the first label is over its own 63 char limit
    ['a label one char over its 63 char limit', `${'a'.repeat(64)}.b`],
  ])('rejects %s', (_description, name) => {
    expect(isValidK8sObjectName(name)).toBe(false);
  });

  // Backstage validates entity names with the Kubernetes *label value* rules,
  // which are looser than the object name rules the ServiceModel API applies.
  // These names are legal in Backstage and illegal as object names, which is
  // the entire reason this check exists.
  it.each([
    ['HAS-UPPERCASE', 'uppercase letters'],
    ['My-Service', 'mixed case'],
    ['has_underscore', 'an underscore'],
  ])('rejects %j, which Backstage allows (%s)', name => {
    expect(isValidK8sObjectName(name)).toBe(false);
  });

  // Asserted against Backstage's own validator rather than a copy of its regex,
  // so that if Backstage ever tightens entity names to match Kubernetes object
  // names, this fails and the check above can be dropped.
  it('disagrees with Backstage only where Kubernetes is stricter', () => {
    const { isValidEntityName } = makeValidator();

    for (const name of [
      'HAS-UPPERCASE',
      'My-Service',
      'has_underscore',
      'a..b',
    ]) {
      expect(isValidEntityName(name)).toBe(true);
      expect(isValidK8sObjectName(name)).toBe(false);
    }

    // And agrees everywhere else, single characters included
    for (const name of ['a', '7', 'my-service', 'service.name.with.dots']) {
      expect(isValidEntityName(name)).toBe(true);
      expect(isValidK8sObjectName(name)).toBe(true);
    }
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
  let connect: jest.SpyInstance;

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(),
    } as unknown as jest.Mocked<LoggerService>;

    connect = jest
      .spyOn(GrafanaServiceModelProcessor.prototype as any, 'connect')
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

  it('logs and stays disabled when the startup connection throws', async () => {
    // A constructor cannot await, so an uncaught rejection here would surface as
    // an unhandled rejection and take the backend down.
    connect.mockRejectedValue(new Error('TLS handshake failed'));

    const processor = await newProcessor();

    expect(processor.grafanaAvailable).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('TLS handshake failed'),
    );
    // and it still counts as a failure, so the backoff starts where it should
    expect(lastRetrySeconds()).toBe(60);
  });

  it('keeps processing entities after the startup connection throws', async () => {
    connect.mockRejectedValue(new Error('TLS handshake failed'));
    const processor = await newProcessor();

    await expect(process(processor)).resolves.toBe(entity);
  });
});

describe('entities with unusable names', () => {
  const CONFIG = {
    grafanaCloudCatalogInfo: {
      enable: true,
      stack_slug: 'dev',
      grafana_endpoint: 'https://grafana-dev.com',
      token: 'token',
      allow: ['kind=Component,spec.type=service'],
    },
  };

  let logger: jest.Mocked<LoggerService>;
  let processor: GrafanaServiceModelProcessor;

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(),
    } as unknown as jest.Mocked<LoggerService>;

    jest
      .spyOn(GrafanaServiceModelProcessor.prototype as any, 'connect')
      .mockResolvedValue(true);

    processor = GrafanaServiceModelProcessor.fromConfig({
      logger,
      config: new ConfigReader(CONFIG) as Config,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function componentNamed(name: string): Entity {
    return {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: { name },
      spec: { type: 'service' },
    };
  }

  it('skips the entity without calling the API', async () => {
    const getModel = jest.spyOn(processor, 'getModel');

    await expect(
      processor.createOrUpdateModel(componentNamed('Has-Uppercase')),
    ).resolves.toBe(false);

    expect(getModel).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Has-Uppercase'),
    );
  });

  it('warns once per name, not once per catalog cycle', async () => {
    jest.spyOn(processor, 'getModel');

    for (let cycle = 0; cycle < 20; cycle++) {
      await processor.createOrUpdateModel(componentNamed('Has-Uppercase'));
    }

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('warns separately for each distinct unusable name', async () => {
    await processor.createOrUpdateModel(componentNamed('Has-Uppercase'));
    await processor.createOrUpdateModel(componentNamed('has_underscore'));

    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('still uploads entities whose names are fine', async () => {
    const getModel = jest
      .spyOn(processor, 'getModel')
      .mockImplementation(async (entity: Entity) =>
        entityToServiceModel(entity, '', ''),
      );

    await expect(
      processor.createOrUpdateModel(componentNamed('a')),
    ).resolves.toBe(true);

    expect(getModel).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('requestTimeout', () => {
  // The real Observable is a bare promise wrapper, and the client is ESM only so
  // it cannot be imported here. This matches its shape.
  class FakeObservable<T> {
    constructor(private readonly promise: Promise<T>) {}
    toPromise(): Promise<T> {
      return this.promise;
    }
  }

  const build = (timeoutMs: number) =>
    requestTimeout(FakeObservable as never, timeoutMs);

  // Drives pre() the way the client does, returning the signal it installed
  function signalFrom(options: ReturnType<typeof build>): AbortSignal {
    const setSignal = jest.fn();
    options.middleware![0].pre({ setSignal } as unknown as never);
    expect(setSignal).toHaveBeenCalledTimes(1);
    return setSignal.mock.calls[0][0];
  }

  it('installs an abort signal on the request', () => {
    const signal = signalFrom(build(30_000));

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  it('aborts once the timeout elapses', async () => {
    const signal = signalFrom(build(20));

    await new Promise(resolve => setTimeout(resolve, 60));

    expect(signal.aborted).toBe(true);
    expect((signal.reason as Error).name).toBe('TimeoutError');
  });

  it('gives each request its own signal', () => {
    const options = build(30_000);

    const first = signalFrom(options);
    const second = signalFrom(options);

    // A signal shared across requests would abort every later request 30s after
    // the first one started.
    expect(first).not.toBe(second);
  });

  it('appends its middleware so the auth middleware survives', () => {
    expect(build(30_000).middlewareMergeStrategy).toBe('append');
  });

  it('passes the request and response through untouched', async () => {
    const options = build(30_000);
    const request = { setSignal: jest.fn() };
    const response = { status: 200 };

    await expect(
      (
        options.middleware![0].pre(request as unknown as never) as any
      ).toPromise(),
    ).resolves.toBe(request);
    await expect(
      (
        options.middleware![0].post(response as unknown as never) as any
      ).toPromise(),
    ).resolves.toBe(response);
  });
});

describe('bounding ServiceModel API calls', () => {
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
    metadata: { name: 'my-service' },
    spec: { type: 'service' },
  };

  let processor: GrafanaServiceModelProcessor;
  let client: {
    getNamespacedCustomObject: jest.Mock;
    replaceNamespacedCustomObject: jest.Mock;
    createNamespacedCustomObject: jest.Mock;
  };
  const options = { middleware: [], middlewareMergeStrategy: 'append' };

  beforeEach(() => {
    jest
      .spyOn(GrafanaServiceModelProcessor.prototype as any, 'connect')
      .mockResolvedValue(true);

    processor = GrafanaServiceModelProcessor.fromConfig({
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        child: jest.fn(),
      } as unknown as LoggerService,
      config: new ConfigReader(CONFIG) as Config,
    });

    client = {
      getNamespacedCustomObject: jest.fn().mockResolvedValue({}),
      replaceNamespacedCustomObject: jest.fn().mockResolvedValue({}),
      createNamespacedCustomObject: jest.fn().mockResolvedValue({}),
    };
    processor.client = client as never;
    processor.requestOptions = options as never;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('bounds getModel', async () => {
    await processor.getModel(entity);

    expect(client.getNamespacedCustomObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'my-service' }),
      options,
    );
  });

  it('bounds updateModel', async () => {
    await processor.updateModel(entity, { metadata: {} });

    expect(client.replaceNamespacedCustomObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'my-service' }),
      options,
    );
  });

  it('bounds both calls createModel can make', async () => {
    // createModel reads first, and creates only if the read fails
    client.getNamespacedCustomObject.mockRejectedValue(
      Object.assign(new Error('not found'), { code: 404 }),
    );

    await processor.createModel(entity);

    expect(client.getNamespacedCustomObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'my-service' }),
      options,
    );
    expect(client.createNamespacedCustomObject).toHaveBeenCalledWith(
      expect.objectContaining({ plural: 'components' }),
      options,
    );
  });
});

describe('rate limited requests', () => {
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
    metadata: { name: 'my-service' },
    spec: { type: 'service' },
  };

  let logger: jest.Mocked<LoggerService>;
  let processor: GrafanaServiceModelProcessor;
  let sleep: jest.Mock;
  let apiRequests: jest.SpyInstance;
  let client: {
    getNamespacedCustomObject: jest.Mock;
    replaceNamespacedCustomObject: jest.Mock;
    createNamespacedCustomObject: jest.Mock;
  };

  const limited = (retryAfter?: string) =>
    Object.assign(new Error('HTTP 429'), {
      code: 429,
      headers: retryAfter === undefined ? {} : { 'retry-after': retryAfter },
    });
  const status = (code: number) =>
    Object.assign(new Error(`HTTP ${code}`), { code, headers: {} });

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(),
    } as unknown as jest.Mocked<LoggerService>;

    jest
      .spyOn(GrafanaServiceModelProcessor.prototype as any, 'connect')
      .mockResolvedValue(true);

    processor = GrafanaServiceModelProcessor.fromConfig({
      logger,
      config: new ConfigReader(CONFIG) as Config,
    });
    processor.grafanaAvailable = true;

    sleep = jest.fn().mockResolvedValue(undefined);
    processor.rateLimitSleep = sleep;
    apiRequests = jest.spyOn((processor as any).metrics, 'recordApiRequest');

    client = {
      getNamespacedCustomObject: jest.fn().mockResolvedValue({}),
      replaceNamespacedCustomObject: jest.fn().mockResolvedValue({}),
      createNamespacedCustomObject: jest.fn().mockResolvedValue({}),
    };
    processor.client = client as never;
    processor.requestOptions = { middleware: [] } as never;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('retries a rate limited read, waiting as long as the API asked', async () => {
    client.getNamespacedCustomObject
      .mockRejectedValueOnce(limited('2'))
      .mockResolvedValue({ spec: {} });

    await expect(processor.getModel(entity)).resolves.toEqual({ spec: {} });

    expect(client.getNamespacedCustomObject).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('retries a rate limited update', async () => {
    client.replaceNamespacedCustomObject
      .mockRejectedValueOnce(limited('1'))
      .mockResolvedValue({});

    await processor.updateModel(entity, { metadata: {} });

    expect(client.replaceNamespacedCustomObject).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('retries a rate limited create', async () => {
    client.getNamespacedCustomObject.mockRejectedValue(status(404));
    client.createNamespacedCustomObject
      .mockRejectedValueOnce(limited('1'))
      .mockResolvedValue({});

    await expect(processor.createModel(entity)).resolves.toBe(true);

    expect(client.createNamespacedCustomObject).toHaveBeenCalledTimes(2);
  });

  it('retries a rate limited read inside createModel', async () => {
    client.getNamespacedCustomObject
      .mockRejectedValueOnce(limited('1'))
      .mockResolvedValue({});

    await expect(processor.createModel(entity)).resolves.toBe(true);

    expect(client.getNamespacedCustomObject).toHaveBeenCalledTimes(2);
    expect(client.createNamespacedCustomObject).not.toHaveBeenCalled();
  });

  it('gives up after three attempts and reports the failure', async () => {
    client.getNamespacedCustomObject.mockRejectedValue(limited('1'));

    await expect(processor.getModel(entity)).rejects.toMatchObject({
      code: 429,
    });

    expect(client.getNamespacedCustomObject).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not wait out a Retry-After longer than ten seconds', async () => {
    client.getNamespacedCustomObject.mockRejectedValue(limited('60'));

    await expect(processor.getModel(entity)).rejects.toMatchObject({
      code: 429,
    });

    expect(client.getNamespacedCustomObject).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry anything but a 429', async () => {
    client.getNamespacedCustomObject.mockRejectedValue(status(500));

    await expect(processor.getModel(entity)).rejects.toMatchObject({
      code: 500,
    });

    expect(client.getNamespacedCustomObject).toHaveBeenCalledTimes(1);
  });

  it('does not create an object when the read stayed rate limited', async () => {
    // The read said nothing about whether the object exists
    client.getNamespacedCustomObject.mockRejectedValue(limited('1'));

    await expect(processor.createModel(entity)).resolves.toBe(false);

    expect(client.createNamespacedCustomObject).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('HTTP 429'),
      expect.anything(),
    );
  });

  it('counts every refused attempt as an API request with code 429', async () => {
    client.getNamespacedCustomObject
      .mockRejectedValueOnce(limited('1'))
      .mockRejectedValueOnce(limited('1'))
      .mockResolvedValue({});

    await processor.getModel(entity);

    expect(apiRequests.mock.calls).toEqual([
      ['get', 429],
      ['get', 429],
      ['get', 200],
    ]);
  });

  it('counts the attempt it gives up on once, not twice', async () => {
    client.getNamespacedCustomObject.mockRejectedValue(limited('1'));

    await processor.getModel(entity).catch(() => undefined);

    expect(apiRequests.mock.calls).toEqual([
      ['get', 429],
      ['get', 429],
      ['get', 429],
    ]);
  });

  it('logs a retry at debug level only', async () => {
    client.getNamespacedCustomObject
      .mockRejectedValueOnce(limited('1'))
      .mockResolvedValue({});

    await processor.getModel(entity);

    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('get was rate limited (attempt 1)'),
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('syncs the entity when a 429 clears within the retries', async () => {
    client.getNamespacedCustomObject
      .mockRejectedValueOnce(limited('1'))
      .mockResolvedValue({});
    const set = jest.fn().mockResolvedValue(undefined);

    await processor.postProcessEntity!(
      entity,
      {} as LocationSpec,
      jest.fn() as CatalogProcessorEmit,
      {
        get: jest.fn().mockResolvedValue(undefined),
        set,
      } as unknown as CatalogProcessorCache,
    );

    expect(set).toHaveBeenCalledWith('component:default/my-service', entity);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('leaves an entity uncached when a 429 outlasts the retries, so the next cycle tries it again', async () => {
    client.getNamespacedCustomObject.mockRejectedValue(limited('1'));
    const set = jest.fn().mockResolvedValue(undefined);

    await processor.postProcessEntity!(
      entity,
      {} as LocationSpec,
      jest.fn() as CatalogProcessorEmit,
      {
        get: jest.fn().mockResolvedValue(undefined),
        set,
      } as unknown as CatalogProcessorCache,
    );

    expect(set).not.toHaveBeenCalled();
  });
});

describe('caching uploads', () => {
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
    metadata: { name: 'my-service' },
    spec: { type: 'service' },
  };

  let logger: jest.Mocked<LoggerService>;
  let processor: GrafanaServiceModelProcessor;
  let upload: jest.SpyInstance<Promise<boolean>, [Entity]>;

  // Stands in for the catalog's per-entity processing cache. The catalog only
  // persists a new state when it differs from the one it passed in, so "never
  // written" and "written with the same value" both keep the stored copy.
  let stored: Entity | undefined;
  let cache: CatalogProcessorCache;
  let writes: number;

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(),
    } as unknown as jest.Mocked<LoggerService>;

    stored = undefined;
    writes = 0;
    cache = {
      get: jest.fn(async () => stored),
      set: jest.fn(async (_key: string, value: any) => {
        stored = value;
        writes++;
      }),
    } as unknown as CatalogProcessorCache;

    jest
      .spyOn(GrafanaServiceModelProcessor.prototype as any, 'connect')
      .mockResolvedValue(true);

    processor = GrafanaServiceModelProcessor.fromConfig({
      logger,
      config: new ConfigReader(CONFIG) as Config,
    });
    processor.grafanaAvailable = true;

    upload = jest.spyOn(processor, 'createOrUpdateModel');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const process = () =>
    processor.postProcessEntity!(
      entity,
      {} as LocationSpec,
      jest.fn() as CatalogProcessorEmit,
      cache,
    );

  it('caches the entity once the upload succeeds', async () => {
    upload.mockResolvedValue(true);

    await expect(process()).resolves.toBe(entity);

    expect(upload).toHaveBeenCalledTimes(1);
    expect(stored).toEqual(entity);
  });

  it('does not cache the entity when the upload reports failure', async () => {
    upload.mockResolvedValue(false);

    await expect(process()).resolves.toBe(entity);

    expect(stored).toBeUndefined();
    expect(writes).toBe(0);
  });

  it('does not cache the entity when the upload throws', async () => {
    upload.mockRejectedValue(new Error('429 Too Many Requests'));

    await expect(process()).resolves.toBe(entity);

    expect(stored).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('429 Too Many Requests'),
      expect.anything(),
    );
  });

  it('retries on the next cycle after a failure, then caches on success', async () => {
    upload.mockResolvedValue(false);
    await process();
    expect(upload).toHaveBeenCalledTimes(1);

    // Nothing was cached, so the next cycle tries again rather than skipping
    await process();
    expect(upload).toHaveBeenCalledTimes(2);

    upload.mockResolvedValue(true);
    await process();
    expect(upload).toHaveBeenCalledTimes(3);
    expect(stored).toEqual(entity);

    // And now it stops re-uploading
    await process();
    expect(upload).toHaveBeenCalledTimes(3);
  });

  it('does not touch the cache when the entity is unchanged', async () => {
    upload.mockResolvedValue(true);
    await process();
    expect(writes).toBe(1);

    await process();
    await process();

    // No further uploads, and no rewrites: leaving the key alone is what keeps
    // the stored copy, so there is nothing to re-set.
    expect(upload).toHaveBeenCalledTimes(1);
    expect(writes).toBe(1);
  });

  it('re-uploads when the entity has changed since it was cached', async () => {
    upload.mockResolvedValue(true);
    await process();
    expect(upload).toHaveBeenCalledTimes(1);

    stored = { ...entity, spec: { type: 'service', owner: 'someone-else' } };
    await process();

    expect(upload).toHaveBeenCalledTimes(2);
    expect(stored).toEqual(entity);
  });

  // Credit to #166, which spotted that an unreadable cache hangs the entity.
  it('treats an unreadable cache as a miss instead of hanging', async () => {
    upload.mockResolvedValue(true);
    cache.get = jest.fn().mockRejectedValue(new Error('cache backend down'));

    // Without handling, the rejection leaves postProcessEntity pending forever
    await expect(process()).resolves.toBe(entity);

    expect(upload).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('cache backend down'),
    );
  });

  it('survives a cache write failure after a successful upload', async () => {
    upload.mockResolvedValue(true);
    cache.set = jest.fn().mockRejectedValue(new Error('cache write failed'));

    await expect(process()).resolves.toBe(entity);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('cache write failed'),
    );
  });

  it('waits for the upload before resolving', async () => {
    let finishUpload!: (value: boolean) => void;
    upload.mockImplementation(
      () =>
        new Promise<boolean>(resolve => {
          finishUpload = resolve;
        }),
    );

    let settled = false;
    const processing = process().then(result => {
      settled = true;
      return result;
    });

    await new Promise(resolve => setImmediate(resolve));
    // The catalog snapshots the cache as soon as this resolves, so resolving
    // early would make the cache write below unpersistable.
    expect(settled).toBe(false);
    expect(stored).toBeUndefined();

    finishUpload(true);
    await processing;

    expect(settled).toBe(true);
    expect(stored).toEqual(entity);
  });
});

describe('upload concurrency', () => {
  const CONFIG = {
    grafanaCloudCatalogInfo: {
      enable: true,
      stack_slug: 'dev',
      grafana_endpoint: 'https://grafana-dev.com',
      token: 'token',
      allow: ['kind=Component,spec.type=service'],
    },
  };

  let logger: LoggerService;

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(),
    } as unknown as LoggerService;

    jest
      .spyOn(GrafanaServiceModelProcessor.prototype as any, 'connect')
      .mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function componentNamed(name: string): Entity {
    return {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: { name },
      spec: { type: 'service' },
    };
  }

  it('never has more than 10 uploads in flight at once', async () => {
    const processor = GrafanaServiceModelProcessor.fromConfig({
      logger,
      config: new ConfigReader(CONFIG) as Config,
    });

    let active = 0;
    let peak = 0;

    // Resolve with a model identical to the one the processor would build, so
    // createOrUpdateModel decides nothing has changed and makes no further calls.
    jest
      .spyOn(processor, 'getModel')
      .mockImplementation(async (entity: Entity) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise(resolve => setImmediate(resolve));
        active--;
        return entityToServiceModel(entity, '', '');
      });

    const entities = Array.from({ length: 50 }, (_, i) =>
      componentNamed(`entity-${i}`),
    );
    const results = await Promise.all(
      entities.map(entity => processor.createOrUpdateModel(entity)),
    );

    expect(results.every(result => result === true)).toBe(true);
    expect(peak).toBe(10);
    expect(active).toBe(0);
  });

  it('releases the slot when an upload fails', async () => {
    const processor = GrafanaServiceModelProcessor.fromConfig({
      logger,
      config: new ConfigReader(CONFIG) as Config,
    });

    // 404 means "not there yet", which createOrUpdateModel turns into a create
    const notFound = Object.assign(new Error('nope'), { code: 500 });
    jest.spyOn(processor, 'getModel').mockRejectedValue(notFound);

    // Twelve failures against a limit of ten: if a failing upload leaked its
    // slot, the last two would never run.
    const attempts = Array.from({ length: 12 }, (_, i) =>
      processor.createOrUpdateModel(componentNamed(`entity-${i}`)),
    );

    await expect(Promise.allSettled(attempts)).resolves.toHaveLength(12);
    for (const attempt of attempts) {
      await expect(attempt).rejects.toThrow('nope');
    }

    // The semaphore is not wedged
    jest
      .spyOn(processor, 'getModel')
      .mockImplementation(async (entity: Entity) =>
        entityToServiceModel(entity, '', ''),
      );
    await expect(
      processor.createOrUpdateModel(componentNamed('after-failures')),
    ).resolves.toBe(true);
  });
});

describe('createAndTestGrafanaConnection', () => {
  const CONFIG = {
    grafanaCloudCatalogInfo: {
      // Disabled, so the constructor does not start an attempt of its own
      enable: false,
      stack_slug: 'dev',
      grafana_endpoint: 'https://grafana-dev.com',
      token: 'token',
      allow: ['kind=Component,spec.type=service'],
    },
  };

  const API_VERSIONS = {
    groups: [
      {
        name: 'servicemodel.ext.grafana.com',
        preferredVersion: { version: 'v1alpha1' },
      },
    ],
  };

  let logger: jest.Mocked<LoggerService>;
  let getAPIVersions: jest.Mock;
  let makeApiClient: jest.Mock;
  let loadK8sClient: jest.SpyInstance;

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(),
    } as unknown as jest.Mocked<LoggerService>;

    getAPIVersions = jest.fn().mockResolvedValue(API_VERSIONS);
    makeApiClient = jest.fn().mockReturnValue({ getAPIVersions });

    // The real dynamic import() cannot run under jest, see #175
    loadK8sClient = jest
      .spyOn(GrafanaServiceModelProcessor.prototype as any, 'loadK8sClient')
      .mockResolvedValue({
        CustomObjectsApi: class {},
        ApisApi: class {},
        Observable: class {},
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function newProcessor() {
    const processor = GrafanaServiceModelProcessor.fromConfig({
      logger,
      config: new ConfigReader(CONFIG) as Config,
    });
    // Already configured, so an attempt only has to check the ServiceModel API
    processor.kc = { makeApiClient } as unknown as KubeConfig;
    return processor;
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  // Let an attempt run until it is waiting on the API server
  const flush = () => new Promise(resolve => setImmediate(resolve));

  it('resolves false when the API client cannot be created, rather than never settling', async () => {
    makeApiClient.mockImplementation(() => {
      throw new Error('No active cluster!');
    });
    const processor = newProcessor();

    await expect(processor.createAndTestGrafanaConnection()).resolves.toBe(
      false,
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('No active cluster!'),
      expect.anything(),
    );
    expect(processor.grafanaAvailable).toBe(false);
  });

  it('shares one attempt between concurrent callers and gives them the real result', async () => {
    const apiVersions = deferred<typeof API_VERSIONS>();
    getAPIVersions.mockReturnValue(apiVersions.promise);
    const processor = newProcessor();

    // Two callers in the same tick, and a third once the attempt is under way
    const first = processor.createAndTestGrafanaConnection();
    const second = processor.createAndTestGrafanaConnection();
    await flush();
    const third = processor.createAndTestGrafanaConnection();
    await flush();

    apiVersions.resolve(API_VERSIONS);

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      true,
      true,
      true,
    ]);
    expect(getAPIVersions).toHaveBeenCalledTimes(1);
  });

  it('shares a failed attempt too', async () => {
    const apiVersions = deferred<typeof API_VERSIONS>();
    getAPIVersions.mockReturnValue(apiVersions.promise);
    const processor = newProcessor();

    const first = processor.createAndTestGrafanaConnection();
    const second = processor.createAndTestGrafanaConnection();
    await flush();
    const third = processor.createAndTestGrafanaConnection();
    await flush();

    apiVersions.reject(new Error('connection refused'));

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      false,
      false,
      false,
    ]);
    expect(getAPIVersions).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('starts a new attempt once the previous one has settled', async () => {
    getAPIVersions.mockRejectedValueOnce(new Error('connection refused'));
    const processor = newProcessor();

    await expect(processor.createAndTestGrafanaConnection()).resolves.toBe(
      false,
    );
    await expect(processor.createAndTestGrafanaConnection()).resolves.toBe(
      true,
    );

    expect(getAPIVersions).toHaveBeenCalledTimes(2);
  });

  it('resolves false rather than rejecting when an attempt throws, and does not stay locked', async () => {
    loadK8sClient.mockRejectedValueOnce(new Error('cannot load client'));
    const processor = newProcessor();

    await expect(processor.createAndTestGrafanaConnection()).resolves.toBe(
      false,
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('cannot load client'),
    );
    await expect(processor.createAndTestGrafanaConnection()).resolves.toBe(
      true,
    );
  });

  it('records a shared failed attempt once, however many callers share it', async () => {
    const apiVersions = deferred<typeof API_VERSIONS>();
    getAPIVersions.mockReturnValue(apiVersions.promise);
    const processor = newProcessor();

    const callers = [
      processor.createAndTestGrafanaConnection(),
      processor.createAndTestGrafanaConnection(),
      processor.createAndTestGrafanaConnection(),
    ];
    apiVersions.reject(new Error('connection refused'));
    await Promise.all(callers);

    expect((processor as any).consecutiveFailures).toBe(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('attempt 1'),
    );
  });

  it('sets grafanaAvailable from the attempt result', async () => {
    const processor = newProcessor();

    await expect(processor.createAndTestGrafanaConnection()).resolves.toBe(
      true,
    );
    expect(processor.grafanaAvailable).toBe(true);
  });

  it('lets postProcessEntity settle when the reconnect attempt throws', async () => {
    loadK8sClient.mockRejectedValue(new Error('cannot load client'));
    const processor = newProcessor();
    // Enabled, so postProcessEntity takes the reconnect path
    (processor as any).enable = true;
    const entity: Entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: { name: 'test-entity' },
      spec: { type: 'service' },
    };
    const cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    } as unknown as CatalogProcessorCache;

    await expect(
      processor.postProcessEntity!(
        entity,
        {} as LocationSpec,
        jest.fn() as unknown as CatalogProcessorEmit,
        cache,
      ),
    ).resolves.toBe(entity);
    expect(processor.grafanaAvailable).toBe(false);
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
  let connect: jest.SpyInstance;
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

    // Stub the single attempt, so the real createAndTestGrafanaConnection
    // records the result as it does in production
    connect = jest
      .spyOn(GrafanaServiceModelProcessor.prototype as any, 'connect')
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
    // Let the constructor's connection attempt settle
    await new Promise(r => setImmediate(r));
    // A 429 is retried after a wait, which these tests have no reason to sit through
    processor.rateLimitSleep = () => Promise.resolve();
    return processor;
  }

  // postProcessEntity waits for the ServiceModel write, so this drain is only a
  // guard. setImmediate runs after all pending microtasks regardless of chain
  // depth.
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

      // The cache is written only after a successful upload
      expect(cache.set).not.toHaveBeenCalled();
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

      expect(cache.set).not.toHaveBeenCalled();
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

    it('counts a throttled update with its status code, once per attempt', async () => {
      const processor = await newProcessor();
      installClient(processor, {
        get: () => Promise.resolve({ spec: { type: 'stale' }, metadata: {} }),
        update: () =>
          Promise.reject(Object.assign(new Error('slow down'), { code: 429 })),
      });
      await process(processor, component);

      // The update is tried three times before it is given up on
      expect(meter.of('grafana_servicemodel.api.requests')).toEqual([
        { value: 1, attributes: { operation: 'get', code: '200' } },
        { value: 1, attributes: { operation: 'update', code: '429' } },
        { value: 1, attributes: { operation: 'update', code: '429' } },
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
  describe('additions on top of #195', () => {
    it('counts an entity with an unusable name as skipped, so the counters still add up', async () => {
      const processor = await newProcessor();
      installClient(processor, {});

      await process(processor, {
        ...component,
        metadata: { name: 'My_Service' },
      });

      expect(
        meter.of('grafana_servicemodel.entities.skipped')[0].attributes,
      ).toEqual({ kind: 'Component', reason: 'invalid_name' });
      expect(meter.of('grafana_servicemodel.entities.processed')).toHaveLength(
        1,
      );
      expect(meter.of('grafana_servicemodel.sync.duration')).toHaveLength(0);
      expect(meter.of('grafana_servicemodel.api.requests')).toHaveLength(0);
    });

    it('labels a request cut off by the request timeout as timeout', async () => {
      const processor = await newProcessor();
      const timedOut = Object.assign(new Error('The operation was aborted.'), {
        name: 'AbortError',
      });
      installClient(processor, {
        get: () => Promise.reject(timedOut),
      });

      await process(processor, component);

      expect(meter.of('grafana_servicemodel.api.requests')).toEqual([
        { value: 1, attributes: { operation: 'get', code: 'timeout' } },
      ]);
      expect(
        meter.of('grafana_servicemodel.entities.failed')[0].attributes,
      ).toEqual({ kind: 'Component', code: 'timeout' });
    });

    it('caches an entity once its create has succeeded', async () => {
      const processor = await newProcessor();
      installClient(processor, {});
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

      expect(cache.set).toHaveBeenCalledTimes(1);
    });

    it('records a shared connection attempt once', async () => {
      connect.mockResolvedValue(false);
      const processor = await newProcessor();
      meter.of('grafana_servicemodel.connection.attempts').length = 0;

      await Promise.all([
        processor.createAndTestGrafanaConnection(),
        processor.createAndTestGrafanaConnection(),
      ]);

      expect(meter.of('grafana_servicemodel.connection.attempts')).toEqual([
        { value: 1, attributes: { outcome: 'failure' } },
      ]);
    });
  });
});
