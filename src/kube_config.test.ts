import { EventEmitter } from 'events';
import https from 'https';
import { LoggerService } from '@backstage/backend-plugin-api';
import { ConfigReader } from '@backstage/config';

import {
  buildCluster,
  getGrafanaConnectionInfo,
  getIdFromSlug,
  readTlsTrust,
  resolveClusterCa,
} from './kube_config';

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

// A throwaway self-signed CA standing in for the cluster CA GCOM returns.
const clusterCa = `-----BEGIN CERTIFICATE-----
MIIDLjCCAhagAwIBAgIUOXM+WhLF0YakyTeXieoEKi/uG1QwDQYJKoZIhvcNAQEL
BQAwNjEXMBUGA1UECgwOa3ViZS1hcGlzZXJ2ZXIxGzAZBgNVBAMMEmt1YmVybmV0
ZXMtY2EtdGVzdDAgFw0yNjExMTIxMDM3NTVaGA8yMTI2MTAxOTEwMzc1NVowNjEX
MBUGA1UECgwOa3ViZS1hcGlzZXJ2ZXIxGzAZBgNVBAMMEmt1YmVybmV0ZXMtY2Et
dGVzdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAKsfiUnb7d2NrAt+
mxLYXFPjuACtPcKJcKCJ6O85KUXwwLxIi/c6Yif7ih8IVSweeyjNHamrjzemWeug
Dx3AncUT79YstPyzDF4zQsSK5mOtZ8oWE1jhf8UR4JRfnkvN9C7MLau4trXxNYK7
kK9eBsQjvfRsHJ2gulidNL+vDdEmoPs8ty1F3OBaD/eiHPEzLOBwT/vNVeapyRXT
oqQfLz1fx04jIniTFGoTJdvV4OJBegKhsXxjg8N9p0vzkL4WsmAxubtRynxGOCZ/
x2YuqwZuF6Bk13neZ5gQksIkCwHiMDks2xmVnSJsB0Ris6I5gYRBpbI2ZGlamxts
C26RxncCAwEAAaMyMDAwHQYDVR0OBBYEFLeZqh2kLkciGGriL8ndRYQuKuj3MA8G
A1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAJchDdurGqwvxU7FFMCe
YO+NXu9m0tXaULSWA0C3IWo3mabpbfjWIXPEGdZSAucp74BCc8w7q5gOMaAzQzUU
5q8buzDYIt/0rOI/Kkzljvwx1epuNjTVv/5iCIXe06q/RZMUfTvmJ6bWMCQQLtsl
kUoqnca3RfOMEaCe9ZOiThGaLlTHK/Yj7Vv18eLTIlJvbwFqGwfwNI65Qu2c6+8e
xb9whv+udu4pdJLekYAPzgIL7H2kx8reBmNGPXcZS05NFm+ZZYsCdMfv0/Y5jSe6
SXr7gV6KBSwGZLx+zhUWH7ecJ4uPkC/0OdDj0yTG0BZe26908/chTbIf9TBs983w
sPk=
-----END CERTIFICATE-----`;

describe('resolveClusterCa', () => {
  const encode = (pem: string) => Buffer.from(pem, 'utf8').toString('base64');

  it('cluster-ca passes the cluster CA through unchanged, and only it', () => {
    const out = resolveClusterCa(encode(clusterCa), 'cluster-ca')!;

    expect(Buffer.from(out, 'base64').toString('utf8')).toBe(clusterCa);
  });

  it('public drops the cluster CA so the default roots apply', () => {
    expect(resolveClusterCa(encode(clusterCa), 'public')).toBeUndefined();
  });

  it('cluster-ca with no CA data leaves the client defaults in charge', () => {
    expect(resolveClusterCa(undefined, 'cluster-ca')).toBeUndefined();
    expect(resolveClusterCa('', 'cluster-ca')).toBeUndefined();
  });

  it('cluster-ca rejects CA data that is not a PEM certificate', () => {
    expect(() => resolveClusterCa(encode('not a cert'), 'cluster-ca')).toThrow(
      /not a base64 PEM certificate/,
    );
  });

  it('cluster-ca rejects a PEM block that is not a real certificate', () => {
    const fake = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----';

    expect(() => resolveClusterCa(encode(fake), 'cluster-ca')).toThrow(
      /not a base64 PEM certificate/,
    );
  });

  it('cluster-ca rejects a bundle when any block is not a real certificate', () => {
    const bundle = `${clusterCa}\n-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----`;

    expect(() => resolveClusterCa(encode(bundle), 'cluster-ca')).toThrow(
      /not a base64 PEM certificate/,
    );
  });
});

describe('readTlsTrust', () => {
  const read = (value?: string) =>
    readTlsTrust(
      new ConfigReader({
        grafanaCloudCatalogInfo:
          value === undefined ? {} : { tls_trust: value },
      }),
    );

  it('defaults to cluster-ca when unset', () => {
    expect(read()).toBe('cluster-ca');
  });

  it.each(['cluster-ca', 'public'])('accepts %s', value => {
    expect(read(value)).toBe(value);
  });

  it.each(['both', 'Public', 'true'])('rejects %j', value => {
    expect(() => read(value)).toThrow(/tls_trust must be/);
  });
});

describe('buildCluster', () => {
  const CA_DATA = Buffer.from(clusterCa, 'utf8').toString('base64');
  const info = { caData: CA_DATA, url: 'https://apiserver' };

  it('passes the cluster CA to the client for cluster-ca', () => {
    expect(buildCluster('stack', info, 'cluster-ca')).toEqual({
      name: 'stack',
      server: 'https://apiserver',
      caData: CA_DATA,
      skipTLSVerify: false,
    });
  });

  it('leaves the CA out for public, so the default roots apply', () => {
    const cluster = buildCluster('stack', info, 'public');

    expect(cluster.caData).toBeUndefined();
    expect(cluster.server).toBe('https://apiserver');
  });

  it('never turns certificate verification off', () => {
    for (const mode of ['cluster-ca', 'public'] as const) {
      expect(buildCluster('stack', info, mode).skipTLSVerify).toBe(false);
    }
  });
});
