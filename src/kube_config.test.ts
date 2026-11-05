import { EventEmitter } from 'events';
import https from 'https';
import { LoggerService } from '@backstage/backend-plugin-api';

import { getGrafanaConnectionInfo, getIdFromSlug } from './kube_config';

const ENDPOINT = 'https://grafana-dev.com';
const SLUG = 'dev';
const TOKEN = 'a-token';

type Outcome =
  | { body: string }
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
          const res = new EventEmitter();
          callback(res);
          res.emit('data', outcome.body);
          res.emit('end');
        }
      });

      return req;
    }) as any);
  }

  describe('getIdFromSlug', () => {
    it('resolves the stack id', async () => {
      mockHttpsGet({ body: JSON.stringify({ id: 42 }) });

      await expect(getIdFromSlug(logger, ENDPOINT, SLUG, TOKEN)).resolves.toBe(
        42,
      );
      expect(requests[0].url).toBe('https://grafana-dev.com/api/instances/dev');
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
});
