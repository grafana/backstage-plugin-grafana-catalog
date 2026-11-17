import { EventEmitter } from 'events';
import https from 'https';
import { Config, ConfigReader } from '@backstage/config';
import { LoggerService } from '@backstage/backend-plugin-api';

import {
  getGrafanaCloudK8sConfig,
  getGrafanaConnectionInfo,
  getIdFromSlug,
} from './kube_config';
import type { K8sClient } from './k8sClient';

const ENDPOINT = 'https://grafana-dev.com';
const SLUG = 'dev';
const TOKEN = 'a-token';

type Outcome =
  | { body: string; status?: number }
  | { timeout: true }
  | { networkError: NodeJS.ErrnoException };

describe('GCOM requests', () => {
  let logger: jest.Mocked<LoggerService>;
  let destroyed: Error[];
  let requests: Array<{ url: string; options: any }>;

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(),
    } as unknown as jest.Mocked<LoggerService>;

    destroyed = [];
    requests = [];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Stand in for https.get, driving whichever outcome the test asks for.
  function mockHttpsGet(outcome: Outcome) {
    return jest.spyOn(https, 'get').mockImplementation(((
      url: any,
      options: any,
      callback: any,
    ) => {
      requests.push({ url: String(url), options });

      const req: any = new EventEmitter();
      req.destroy = (error?: Error) => {
        if (error) {
          destroyed.push(error);
          req.emit('error', error);
        }
      };

      // Let the caller attach its 'timeout' and 'error' handlers first.
      setImmediate(() => {
        if ('timeout' in outcome) {
          req.emit('timeout');
        } else if ('networkError' in outcome) {
          req.emit('error', outcome.networkError);
        } else {
          const res: any = new EventEmitter();
          res.statusCode = outcome.status ?? 200;
          callback(res);
          res.emit('data', outcome.body);
          res.emit('end');
        }
      });

      return req;
    }) as any);
  }

  describe('getIdFromSlug', () => {
    it('resolves the stack id as a string', async () => {
      mockHttpsGet({ body: JSON.stringify({ id: 42 }) });

      await expect(getIdFromSlug(logger, ENDPOINT, SLUG, TOKEN)).resolves.toBe(
        '42',
      );
      expect(requests[0].url).toBe('https://grafana-dev.com/api/instances/dev');
    });

    it.each([
      ['no id', {}],
      ['a null id', { id: null }],
      ['a zero id', { id: 0 }],
      ['a negative id', { id: -3 }],
      ['a fractional id', { id: 1.5 }],
      ['a non-numeric id', { id: 'abc' }],
      ['an object id', { id: { value: 1 } }],
    ])('rejects a response with %s', async (_name, body) => {
      mockHttpsGet({ body: JSON.stringify(body) });

      await expect(
        getIdFromSlug(logger, ENDPOINT, SLUG, TOKEN),
      ).rejects.toThrow(
        /https:\/\/grafana-dev\.com\/api\/instances\/dev did not return a valid stack id/,
      );
    });

    it('names the fields received, not their values', async () => {
      mockHttpsGet({ body: JSON.stringify({ message: 'secret-detail' }) });

      const error = await getIdFromSlug(logger, ENDPOINT, SLUG, TOKEN).catch(
        e => e,
      );

      expect(error.message).toContain('fields received: message');
      expect(error.message).not.toContain('secret-detail');
    });

    it('sends the bearer token and a 30s timeout', async () => {
      mockHttpsGet({ body: JSON.stringify({ id: 42 }) });

      await getIdFromSlug(logger, ENDPOINT, SLUG, TOKEN);

      expect(requests[0].options).toMatchObject({
        headers: { Authorization: `Bearer ${TOKEN}` },
        timeout: 30_000,
      });
    });
  });

  describe('getGrafanaConnectionInfo', () => {
    const connectionsBody = JSON.stringify({
      appPlatform: { caData: 'a-ca-cert', url: 'https://apiserver' },
    });

    it('resolves the connection info', async () => {
      mockHttpsGet({ body: connectionsBody });

      await expect(
        getGrafanaConnectionInfo(logger, ENDPOINT, SLUG, TOKEN),
      ).resolves.toEqual({
        caData: 'a-ca-cert',
        url: 'https://apiserver',
        token: TOKEN,
      });
      expect(requests[0].url).toBe(
        'https://grafana-dev.com/api/instances/dev/connections',
      );
    });

    it('rejects when the token is not accepted', async () => {
      mockHttpsGet({ body: JSON.stringify({ code: 'InvalidCredentials' }) });

      await expect(
        getGrafanaConnectionInfo(logger, ENDPOINT, SLUG, TOKEN),
      ).rejects.toThrow(/Invalid credentials/);
    });

    it('rejects when the response has no appPlatform', async () => {
      mockHttpsGet({ body: JSON.stringify({ somethingElse: true }) });

      await expect(
        getGrafanaConnectionInfo(logger, ENDPOINT, SLUG, TOKEN),
      ).rejects.toThrow(/No appPlatform object found/);
    });
  });

  describe('logging', () => {
    const body = JSON.stringify({
      id: 42,
      appPlatform: { caData: 'CA-DATA-MARKER', url: 'https://apiserver' },
      somethingElse: 'SENSITIVE-MARKER',
    });

    const logged = (...levels: Array<keyof typeof logger>) =>
      levels
        .flatMap(level => (logger[level] as jest.Mock).mock.calls)
        .flat()
        .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join('\n');

    const everything = () => logged('debug', 'info', 'warn', 'error');

    it('does not log the response body at any level', async () => {
      mockHttpsGet({ body });

      await getIdFromSlug(logger, ENDPOINT, SLUG, TOKEN);
      await getGrafanaConnectionInfo(logger, ENDPOINT, SLUG, TOKEN);

      expect(everything()).not.toContain('CA-DATA-MARKER');
      expect(everything()).not.toContain('SENSITIVE-MARKER');
    });

    it('logs the status and size of the response instead', async () => {
      mockHttpsGet({ body, status: 200 });

      await getIdFromSlug(logger, ENDPOINT, SLUG, TOKEN);

      expect(logger.debug).toHaveBeenCalledWith(
        `GrafanaServiceModelProcessor: Got response from ${ENDPOINT}/api/instances/${SLUG}: status 200, ${Buffer.byteLength(
          body,
        )} bytes`,
      );
    });

    it('logs the fields the code goes on to use', async () => {
      mockHttpsGet({ body });

      await getIdFromSlug(logger, ENDPOINT, SLUG, TOKEN);
      await getGrafanaConnectionInfo(logger, ENDPOINT, SLUG, TOKEN);

      expect(logged('debug')).toContain('Stack id is 42');
      expect(logged('debug')).toContain('url https://apiserver');
      expect(logged('debug')).toContain('caData present');
    });

    it('says when the connection info has no caData, without logging it', async () => {
      mockHttpsGet({
        body: JSON.stringify({ appPlatform: { url: 'https://apiserver' } }),
      });

      await getGrafanaConnectionInfo(logger, ENDPOINT, SLUG, TOKEN);

      expect(logged('debug')).toContain('caData missing');
    });

    it('does not quote the body when it is not JSON', async () => {
      mockHttpsGet({ body: '<html>SENSITIVE-MARKER</html>', status: 502 });

      const error = await getIdFromSlug(logger, ENDPOINT, SLUG, TOKEN).catch(
        e => e,
      );

      expect(error.message).toMatch(/status 502/);
      expect(error.message).toMatch(/not valid JSON/);
      expect(error.message).not.toContain('SENSITIVE-MARKER');
      expect(everything()).not.toContain('SENSITIVE-MARKER');
    });
  });

  describe('failure handling', () => {
    it('aborts and rejects when the request times out', async () => {
      mockHttpsGet({ timeout: true });

      await expect(
        getIdFromSlug(logger, ENDPOINT, SLUG, TOKEN),
      ).rejects.toThrow(/timed out after 30s/);

      // A 'timeout' event leaves the socket open on its own, so the request has
      // to be destroyed for the promise to settle at all.
      expect(destroyed).toHaveLength(1);
      expect(destroyed[0].message).toMatch(/timed out after 30s/);
    });

    it('rejects on a network error', async () => {
      mockHttpsGet({
        networkError: Object.assign(new Error('socket hang up'), {
          code: 'ECONNRESET',
        }),
      });

      await expect(
        getIdFromSlug(logger, ENDPOINT, SLUG, TOKEN),
      ).rejects.toThrow(/socket hang up/);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('socket hang up'),
      );
    });

    it('rejects with the url when the response is not JSON', async () => {
      mockHttpsGet({ body: '<html>502 Bad Gateway</html>' });

      await expect(
        getIdFromSlug(logger, ENDPOINT, SLUG, TOKEN),
      ).rejects.toThrow(
        /Could not parse response from https:\/\/grafana-dev\.com/,
      );
    });

    it('does not put the bearer token in the logs', async () => {
      mockHttpsGet({
        networkError: Object.assign(new Error('socket hang up'), {
          code: 'ECONNRESET',
        }),
      });

      await expect(
        getIdFromSlug(logger, ENDPOINT, SLUG, TOKEN),
      ).rejects.toThrow();

      const logged = [
        ...logger.error.mock.calls,
        ...logger.warn.mock.calls,
        ...logger.info.mock.calls,
      ]
        .flat()
        .map(arg => JSON.stringify(arg))
        .join(' ');
      expect(logged).not.toContain(TOKEN);
    });
  });

  // The real @kubernetes/client-node cannot be imported under jest (#175), so
  // these tests hand getGrafanaCloudK8sConfig a fake module. Everything else in
  // it, including the GCOM requests, is the real code.
  describe('getGrafanaCloudK8sConfig', () => {
    const originalEnv = { CI: process.env.CI, DEV_MODE: process.env.DEV_MODE };

    class FakeKubeConfig {
      static instances: FakeKubeConfig[] = [];
      loadFromOptions = jest.fn();
      loadFromCluster = jest.fn();
      loadFromDefault = jest.fn();
      constructor() {
        FakeKubeConfig.instances.push(this);
      }
    }
    const fakeK8s = { KubeConfig: FakeKubeConfig } as unknown as K8sClient;

    function configWith(endpoint: string) {
      return new ConfigReader({
        grafanaCloudCatalogInfo: {
          stack_slug: SLUG,
          grafana_endpoint: endpoint,
          token: TOKEN,
        },
      }) as Config;
    }

    // Answer each GCOM request from a table keyed by URL.
    function mockGcom(bodies: Record<string, unknown>) {
      return jest.spyOn(https, 'get').mockImplementation(((
        url: any,
        _options: any,
        callback: any,
      ) => {
        requests.push({ url: String(url), options: _options });
        const req: any = new EventEmitter();
        setImmediate(() => {
          const res: any = new EventEmitter();
          res.statusCode = 200;
          callback(res);
          res.emit('data', JSON.stringify(bodies[String(url)]));
          res.emit('end');
        });
        return req;
      }) as any);
    }

    beforeEach(() => {
      FakeKubeConfig.instances = [];
      delete process.env.CI;
      delete process.env.DEV_MODE;
    });

    afterEach(() => {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });

    it('builds a kubeconfig for the stack from the GCOM responses', async () => {
      mockGcom({
        'https://grafana-dev.com/api/instances/dev': { id: 42 },
        'https://grafana-dev.com/api/instances/dev/connections': {
          appPlatform: { caData: 'a-ca-cert', url: 'https://apiserver' },
        },
      });

      const result = await getGrafanaCloudK8sConfig(
        configWith('https://grafana-dev.com'),
        logger,
        fakeK8s,
      );

      expect(result.namespace).toBe('stacks-42');
      const [kubeConfig] = FakeKubeConfig.instances;
      expect(result.config).toBe(kubeConfig);
      expect(kubeConfig.loadFromOptions).toHaveBeenCalledWith({
        clusters: [
          {
            name: 'https://grafana-dev.com',
            server: 'https://apiserver',
            caData: 'a-ca-cert',
            skipTLSVerify: false,
          },
        ],
        users: [{ name: 'auth', token: TOKEN }],
        contexts: [
          {
            name: 'auth',
            cluster: 'https://grafana-dev.com',
            namespace: 'stacks-42',
            user: 'auth',
          },
        ],
        currentContext: 'auth',
      });
    });

    it('trims a trailing slash from the endpoint before requesting', async () => {
      mockGcom({
        'https://grafana-dev.com/api/instances/dev': { id: 42 },
        'https://grafana-dev.com/api/instances/dev/connections': {
          appPlatform: { caData: 'a-ca-cert', url: 'https://apiserver' },
        },
      });

      await getGrafanaCloudK8sConfig(
        configWith('https://grafana-dev.com/'),
        logger,
        fakeK8s,
      );

      expect(requests.map(r => r.url).sort()).toEqual([
        'https://grafana-dev.com/api/instances/dev',
        'https://grafana-dev.com/api/instances/dev/connections',
      ]);
      expect(
        FakeKubeConfig.instances[0].loadFromOptions.mock.calls[0][0].clusters[0]
          .name,
      ).toBe('https://grafana-dev.com');
    });

    it('wraps a failed GCOM request in an error that names the cause', async () => {
      mockGcom({
        'https://grafana-dev.com/api/instances/dev': { id: 42 },
        'https://grafana-dev.com/api/instances/dev/connections': {
          code: 'InvalidCredentials',
        },
      });

      await expect(
        getGrafanaCloudK8sConfig(
          configWith('https://grafana-dev.com'),
          logger,
          fakeK8s,
        ),
      ).rejects.toThrow(
        /Error getting Grafana Cloud K8s config: .*Invalid credentials/,
      );
      // Nothing is built from a failed lookup
      expect(FakeKubeConfig.instances).toHaveLength(0);
    });

    it('uses the in-cluster config in CI, without calling GCOM', async () => {
      process.env.CI = 'true';
      const get = jest.spyOn(https, 'get');

      const result = await getGrafanaCloudK8sConfig(
        configWith('https://grafana-dev.com'),
        logger,
        fakeK8s,
      );

      expect(result.namespace).toBe('default');
      expect(FakeKubeConfig.instances[0].loadFromCluster).toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    });

    it('uses the default kubeconfig in DEV_MODE, without calling GCOM', async () => {
      process.env.DEV_MODE = 'true';
      const get = jest.spyOn(https, 'get');

      const result = await getGrafanaCloudK8sConfig(
        configWith('https://grafana-dev.com'),
        logger,
        fakeK8s,
      );

      expect(result.namespace).toBe('default');
      expect(FakeKubeConfig.instances[0].loadFromDefault).toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    });
  });
});
