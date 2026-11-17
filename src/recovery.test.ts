import http from 'http';
import { AddressInfo } from 'net';
// node-fetch is what the Kubernetes client sends every request with, which is why
// the fake client below uses it. It is that client's dependency, not ours, so it is
// deliberately not declared in package.json.
// eslint-disable-next-line @backstage/no-undeclared-imports
import nodeFetch from 'node-fetch';
import { Entity } from '@backstage/catalog-model';
import { Config, ConfigReader } from '@backstage/config';
import { LoggerService } from '@backstage/backend-plugin-api';
import { LocationSpec } from '@backstage/plugin-catalog-common';
import {
  CatalogProcessorCache,
  CatalogProcessorEmit,
} from '@backstage/plugin-catalog-node';

import { GrafanaServiceModelProcessor, requestTimeout } from './processor';

// These tests run the real processor against a real HTTP server that stands in for
// the ServiceModel API, so that what is checked is how the whole sync behaves when
// the API misbehaves, not how one function reacts to an error we made up.
//
// Two parts stay fake. The Kubernetes client is ESM only and cannot be imported
// under jest, so a small client sends the same three calls over HTTP with the
// processor's own timeout middleware. And the connection step, which needs GCOM,
// is replaced by a processor that is already connected.

type Request = { method: string; path: string; body?: any };
type Reply = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
};
// Return a Reply to answer a request, 'hang' to never answer, or undefined to let
// the server behave normally
type Fault = (request: Request) => Reply | 'hang' | undefined;

class FakeServiceModelApi {
  readonly requests: Request[] = [];
  readonly objects = new Map<string, any>();
  fault: Fault = () => undefined;
  // How long the server takes to answer, so that requests overlap when allowed to
  delayMs = 0;
  // How many requests the server is working on at once, and the most it ever was
  private active = 0;
  peak = 0;
  private readonly server: http.Server;
  private readonly hung: http.ServerResponse[] = [];

  constructor() {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => this.handle(req, res, Buffer.concat(chunks)));
    });
  }

  async start(): Promise<number> {
    await new Promise<void>(resolve =>
      this.server.listen(0, '127.0.0.1', resolve),
    );
    return (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    if (!this.server.listening) {
      return;
    }
    this.hung.forEach(res => res.destroy());
    this.server.closeAllConnections();
    await new Promise(resolve => this.server.close(resolve));
  }

  count(method: string): number {
    return this.requests.filter(r => r.method === method).length;
  }

  private handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    raw: Buffer,
  ) {
    const request: Request = {
      method: req.method!,
      path: req.url!,
      body: raw.length ? JSON.parse(raw.toString()) : undefined,
    };
    this.requests.push(request);
    this.active++;
    this.peak = Math.max(this.peak, this.active);
    res.on('close', () => {
      this.active--;
    });

    const fault = this.fault(request);
    if (fault === 'hang') {
      this.hung.push(res);
      return;
    }
    setTimeout(() => {
      if (fault) {
        res.writeHead(fault.status, {
          'content-type': 'application/json',
          ...fault.headers,
        });
        res.end(JSON.stringify(fault.body ?? {}));
        return;
      }
      this.answer(request, res);
    }, this.delayMs);
  }

  private answer(request: Request, res: http.ServerResponse) {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const name = request.path.split('/').pop()!;
    if (request.method === 'GET') {
      const found = this.objects.get(name);
      return found ? send(200, found) : send(404, { message: 'not found' });
    }
    if (request.method === 'POST') {
      const created = request.body;
      if (this.objects.has(created.metadata.name)) {
        return send(409, { message: 'already exists' });
      }
      this.objects.set(created.metadata.name, created);
      return send(201, created);
    }
    this.objects.set(name, request.body);
    return send(200, request.body);
  }
}

describe('the sync against a misbehaving ServiceModel API', () => {
  const CONFIG = {
    grafanaCloudCatalogInfo: {
      enable: true,
      stack_slug: 'dev',
      grafana_endpoint: 'https://grafana-dev.com',
      token: 'token',
      allow: ['kind=Component,spec.type=service'],
    },
  };
  const BASE = '/apis/servicemodel.ext.grafana.com/v1/namespaces/stacks-1';

  class Obs<T> {
    constructor(private readonly promise: Promise<T>) {}
    toPromise() {
      return this.promise;
    }
  }

  let api: FakeServiceModelApi;
  let port: number;
  let logger: jest.Mocked<LoggerService>;
  let processor: GrafanaServiceModelProcessor;
  let cached: Map<string, Entity>;
  let cache: CatalogProcessorCache;

  // Sends the calls the processor makes to the fake server over HTTP, with the
  // processor's own timeout middleware, and fails the way the real client does:
  // an error carrying the HTTP status as `code`, or the transport error itself.
  function httpClient(timeoutMs: number) {
    const options = requestTimeout(Obs as never, timeoutMs);
    const send = async (method: string, path: string, body?: unknown) => {
      let signal: AbortSignal | undefined;
      options.middleware![0].pre({
        setSignal: (value: AbortSignal) => {
          signal = value;
        },
      } as never);
      const response = await nodeFetch(`http://127.0.0.1:${port}${path}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal as never,
      });
      const parsed = await response.json();
      if (!response.ok) {
        throw Object.assign(new Error(`HTTP ${response.status}`), {
          code: response.status,
          headers: Object.fromEntries(response.headers.entries()),
        });
      }
      return parsed;
    };
    return {
      getNamespacedCustomObject: (p: { plural: string; name: string }) =>
        send('GET', `${BASE}/${p.plural}/${p.name}`),
      createNamespacedCustomObject: (p: { plural: string; body: unknown }) =>
        send('POST', `${BASE}/${p.plural}`, p.body),
      replaceNamespacedCustomObject: (p: {
        plural: string;
        name: string;
        body: unknown;
      }) => send('PUT', `${BASE}/${p.plural}/${p.name}`, p.body),
    };
  }

  const service = (name: string): Entity => ({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: { name },
    spec: { type: 'service' },
  });

  const names = (count: number) =>
    Array.from({ length: count }, (_, i) => `service-${i}`);

  // One catalog cycle: every entity is handed over at once, as the catalog does
  async function runCycle(entities: Entity[]) {
    await Promise.all(
      entities.map(entity =>
        processor.postProcessEntity!(
          entity,
          {} as LocationSpec,
          jest.fn() as CatalogProcessorEmit,
          cache,
        ),
      ),
    );
  }

  beforeEach(async () => {
    api = new FakeServiceModelApi();
    port = await api.start();
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
    // Let the connection attempt the constructor starts settle first
    await new Promise(resolve => setImmediate(resolve));

    processor.grafanaAvailable = true;
    processor.serviceModelVersion = 'v1';
    processor.k8sNamespace = 'stacks-1';
    processor.client = httpClient(2_000) as never;
    processor.requestOptions = { middleware: [] } as never;
    // A rate limit is waited out in these tests without sitting through the wait
    processor.rateLimitSleep = jest.fn().mockResolvedValue(undefined);

    cached = new Map();
    cache = {
      get: async (key: string) => cached.get(key),
      set: async (key: string, value: Entity) => {
        cached.set(key, value);
      },
    } as unknown as CatalogProcessorCache;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await api.stop();
  });

  it('creates every entity, never more than ten at a time', async () => {
    api.delayMs = 10;
    const entities = names(300).map(service);

    await runCycle(entities);

    expect(api.objects.size).toBe(300);
    expect(cached.size).toBe(300);
    // Reaches the limit, so the check below is not passing for lack of overlap
    expect(api.peak).toBe(10);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('does not write what is already current', async () => {
    const entities = names(20).map(service);
    await runCycle(entities);
    const writes = api.count('POST') + api.count('PUT');
    cached.clear();

    await runCycle(entities);

    expect(api.count('POST') + api.count('PUT')).toBe(writes);
  });

  describe('when the API is rate limiting', () => {
    it('waits out a 429 and then succeeds', async () => {
      let refused = 0;
      api.fault = request =>
        request.method === 'POST' && refused++ < 2
          ? { status: 429, headers: { 'retry-after': '1' } }
          : undefined;

      await runCycle([service('limited')]);

      expect(api.objects.has('limited')).toBe(true);
      expect(cached.has('component:default/limited')).toBe(true);
      expect(processor.rateLimitSleep).toHaveBeenCalledTimes(2);
      expect(processor.rateLimitSleep).toHaveBeenCalledWith(1000);
    });

    it('gives up after a bounded number of attempts and does not cache', async () => {
      api.fault = request =>
        request.method === 'POST' ? { status: 429 } : undefined;

      await runCycle([service('limited')]);

      expect(api.count('POST')).toBe(3);
      expect(api.objects.has('limited')).toBe(false);
      expect(cached.has('component:default/limited')).toBe(false);
    });

    it('does not retry a wait longer than it is willing to sit through', async () => {
      api.fault = request =>
        request.method === 'POST'
          ? { status: 429, headers: { 'retry-after': '3600' } }
          : undefined;

      await runCycle([service('limited')]);

      expect(api.count('POST')).toBe(1);
      expect(processor.rateLimitSleep).not.toHaveBeenCalled();
    });
  });

  describe('when the API fails', () => {
    it('does not cache an entity whose create failed, and syncs it next cycle', async () => {
      let healthy = false;
      api.fault = request =>
        request.method === 'POST' && !healthy ? { status: 500 } : undefined;
      const entities = names(25).map(service);

      await runCycle(entities);
      expect(cached.size).toBe(0);
      expect(api.objects.size).toBe(0);

      healthy = true;
      await runCycle(entities);

      expect(api.objects.size).toBe(25);
      expect(cached.size).toBe(25);
    });

    it('does not cache an entity whose update lost to a conflict, and updates it next cycle', async () => {
      const entity = service('conflicted');
      await runCycle([entity]);
      cached.clear();
      // The object changed on the server, so the next cycle has to replace it
      api.objects.set('conflicted', { spec: { type: 'stale' }, metadata: {} });
      let conflicts = 1;
      api.fault = request =>
        request.method === 'PUT' && conflicts-- > 0
          ? { status: 409 }
          : undefined;

      await runCycle([entity]);
      expect(cached.has('component:default/conflicted')).toBe(false);

      await runCycle([entity]);
      expect(cached.has('component:default/conflicted')).toBe(true);
      expect(api.objects.get('conflicted').spec).not.toEqual({
        type: 'stale',
      });
    });

    it('recovers a request that hangs, and keeps syncing the rest', async () => {
      processor.client = httpClient(100) as never;
      api.fault = request =>
        request.path.endsWith('/stuck') ? 'hang' : undefined;
      const entities = [...names(15), 'stuck'].map(service);

      await runCycle(entities);

      expect(api.objects.size).toBe(15);
      expect(api.objects.has('stuck')).toBe(false);
      expect(cached.has('component:default/stuck')).toBe(false);
      expect(cached.size).toBe(15);
    });

    it('survives a server that is gone, without throwing into the catalog', async () => {
      await api.stop();
      processor.client = httpClient(500) as never;

      await expect(runCycle(names(5).map(service))).resolves.toBeUndefined();

      expect(cached.size).toBe(0);
    });
  });
});
