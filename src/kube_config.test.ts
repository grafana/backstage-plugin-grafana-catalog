import { EventEmitter } from 'events';
import https from 'https';
import { LoggerService } from '@backstage/backend-plugin-api';

import { getGrafanaConnectionInfo, getIdFromSlug } from './kube_config';

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
});
