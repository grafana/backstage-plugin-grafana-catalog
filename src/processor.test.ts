import { Entity } from '@backstage/catalog-model';
import { Config, ConfigReader } from '@backstage/config';
import { LoggerService } from '@backstage/backend-plugin-api';
import { LocationSpec } from '@backstage/plugin-catalog-common';
import {
  CatalogProcessorCache,
  CatalogProcessorEmit,
} from '@backstage/plugin-catalog-node';
import { makeValidator } from '@backstage/catalog-model';
import {
  GrafanaServiceModelProcessor,
  entityToServiceModel,
  isValidK8sObjectName,
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
      .spyOn(
        GrafanaServiceModelProcessor.prototype,
        'createAndTestGrafanaConnection',
      )
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
      .spyOn(
        GrafanaServiceModelProcessor.prototype,
        'createAndTestGrafanaConnection',
      )
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
