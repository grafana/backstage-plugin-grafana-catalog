import { X509Certificate } from 'crypto';
import https from 'https';
import { Config } from '@backstage/config';
import { LoggerService } from '@backstage/backend-plugin-api';

// Import types from @kubernetes/client-node
import type {
  KubeConfig,
  Cluster,
  Context,
  User,
} from '@kubernetes/client-node';

type GrafanaConnectionInfo = {
  caData: string;
  url: string;
  token: string;
};

export type TlsTrust = 'cluster-ca' | 'public';

/**
 * Decide which certificate authorities verify the App Platform endpoint.
 *
 * - `cluster-ca` (default): trust only the CA GCOM returns. This is how a
 *   kubeconfig's certificate-authority-data behaves in Kubernetes clients. If
 *   GCOM returns no CA at all, the client falls back to Node's trust store, as
 *   it did before this option existed.
 * - `public`: ignore the cluster CA and use Node's trust store (the default
 *   roots, plus anything added through NODE_EXTRA_CA_CERTS). For endpoints that
 *   present a public chain (for example Let's Encrypt behind a CDN), where the
 *   private CA can never verify and only produces
 *   UNABLE_TO_GET_ISSUER_CERT_LOCALLY.
 *
 * The cluster CA is never merged with the public roots: trusting both would
 * accept any publicly issued certificate for the host as well as the private CA.
 */
export function resolveClusterCa(
  caData: string | undefined,
  trust: TlsTrust,
): string | undefined {
  if (trust === 'public') {
    return undefined;
  }
  if (!caData) {
    return undefined;
  }
  const pem = Buffer.from(caData, 'base64').toString('utf8');
  const blocks = pem.match(
    /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
  );
  const invalid = () =>
    new Error(
      'GCOM returned cluster CA data that is not a base64 PEM certificate, so ' +
        'the cluster CA cannot be used. If this endpoint is expected to present ' +
        "a public certificate, set grafanaCloudCatalogInfo.tls_trust to 'public'.",
    );
  if (!blocks) {
    throw invalid();
  }
  for (const block of blocks) {
    try {
      // Parsing proves the block is a real certificate, not just a header.
      void new X509Certificate(block);
    } catch {
      throw invalid();
    }
  }
  return caData;
}

export function readTlsTrust(config: Config): TlsTrust {
  const value = config.getOptionalString('grafanaCloudCatalogInfo.tls_trust');
  if (value === undefined || value === 'cluster-ca' || value === 'public') {
    return value ?? 'cluster-ca';
  }
  throw new Error(
    `grafanaCloudCatalogInfo.tls_trust must be 'cluster-ca' or 'public', got '${value}'`,
  );
}

// Exported for tests only: the kubernetes client cannot be imported under jest.
export function buildCluster(
  name: string,
  connectionInfo: Pick<GrafanaConnectionInfo, 'caData' | 'url'>,
  tlsTrust: TlsTrust,
): Cluster {
  return {
    name,
    server: connectionInfo.url,
    caData: resolveClusterCa(connectionInfo.caData, tlsTrust),
    skipTLSVerify: false,
  };
}

export type GrafanaCloudK8sConfig = {
  config: KubeConfig;
  namespace: string;
};

// Without a timeout, a hung TCP connection to GCOM never settles, and because
// the processor only reconnects once the previous attempt finishes, a single
// hung socket blocks reconnection forever.
const HTTP_TIMEOUT_MS = 30_000;

// Make connection to gcom and get the caData using the token in the config
// Construct the kubeconfig object from the response
export async function getGrafanaCloudK8sConfig(
  config: Config,
  logger: LoggerService,
): Promise<GrafanaCloudK8sConfig> {
  const k8s = await import('@kubernetes/client-node');
  // If there is an envornment variable for CI testing, return the default kubeconfig
  if (process.env.CI === 'true') {
    logger.info(
      'CI environment detected. Using default kubeconfig for testing.',
    );
    const kubeConfig = new k8s.KubeConfig();
    kubeConfig.loadFromCluster();
    return {
      config: kubeConfig,
      namespace: 'default',
    };
  }

  // Set the DEV_MODE environment variable to true to use the default kubeconfig
  // useful for local development, runnign the service model in tilt, or connecting
  // to any k8s cluster
  if (process.env.DEV_MODE === 'true') {
    logger.info(
      'Development environment detected. Using default kubeconfig for testing.',
    );
    // const k8s = await import('@kubernetes/client-node');
    const kubeConfig = new k8s.KubeConfig();
    kubeConfig.loadFromDefault();

    return {
      config: kubeConfig,
      namespace: 'default',
    };
  }

  const tlsTrust = readTlsTrust(config);
  const stackSlug = config.getString('grafanaCloudCatalogInfo.stack_slug');
  const token = config.getString('grafanaCloudCatalogInfo.token');
  let grafanaEndpoint = config.getString(
    'grafanaCloudCatalogInfo.grafana_endpoint',
  );

  // if grafanaEndpoint ends with /, trim it
  if (grafanaEndpoint.endsWith('/')) {
    grafanaEndpoint = grafanaEndpoint.slice(0, -1);
  }

  const stackIdPromise = getIdFromSlug(
    logger,
    grafanaEndpoint,
    stackSlug,
    token,
  );
  const connectionInfoPromise = getGrafanaConnectionInfo(
    logger,
    grafanaEndpoint,
    stackSlug,
    token,
  );

  const [stackId, connectionInfo] = await Promise.all([
    stackIdPromise,
    connectionInfoPromise,
  ]).catch(error => {
    throw new Error(
      `GrafanaServiceModelProcessor: Error getting Grafana Cloud K8s config: ${error.message}`,
    );
  });

  logger.debug(
    `Verifying the App Platform endpoint with tls_trust=${tlsTrust}`,
  );

  // Cook up the kubeconfig object
  const cluster = buildCluster(grafanaEndpoint, connectionInfo, tlsTrust);
  const user: User = {
    name: 'auth',
    token: connectionInfo.token,
  };
  const context: Context = {
    name: 'auth',
    cluster: cluster.name,
    namespace: `stacks-${stackId}`,
    user: user.name,
  };
  const kubeConfig = new k8s.KubeConfig();
  kubeConfig.loadFromOptions({
    clusters: [cluster],
    users: [user],
    contexts: [context],
    currentContext: context.name,
  });
  return {
    config: kubeConfig,
    namespace: `stacks-${stackId}`,
  };
}

/**
 * getJson issues an authenticated GET against GCOM and resolves the parsed JSON
 * body. Both GCOM calls go through here so the timeout cannot be forgotten on
 * one of them.
 */
async function getJson(
  logger: LoggerService,
  url: string,
  token: string,
): Promise<any> {
  const options = {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    timeout: HTTP_TIMEOUT_MS,
  };

  return new Promise<any>((resolve, reject) => {
    const req = https.get(url, options, res => {
      let data = '';

      res.on('data', chunk => {
        data += chunk;
      });

      res.on('end', () => {
        // Deliberately not the body. GCOM returns the whole instance payload,
        // including connection details, and the contract for what it contains is
        // not ours. Log the status and size, and let each caller log the fields
        // it actually uses.
        logger.debug(
          `GrafanaServiceModelProcessor: Got response from ${url}: status ${
            res.statusCode ?? 'unknown'
          }, ${Buffer.byteLength(data)} bytes`,
        );
        try {
          resolve(JSON.parse(data));
        } catch {
          // Not error.message either: for a JSON syntax error it quotes the
          // start of the body.
          reject(
            new Error(
              `GrafanaServiceModelProcessor: Could not parse response from ${url} (status ${
                res.statusCode ?? 'unknown'
              }): the body is not valid JSON`,
            ),
          );
        }
      });
    });

    // The 'timeout' event does not abort the request on its own. Destroying it
    // surfaces the failure through the 'error' handler below.
    req.on('timeout', () => {
      req.destroy(
        new Error(
          `GrafanaServiceModelProcessor: Request to ${url} timed out after ${
            HTTP_TIMEOUT_MS / 1000
          }s`,
        ),
      );
    });

    req.on('error', error => {
      logger.error(
        `GrafanaServiceModelProcessor: Error requesting ${url}: ${error.message}`,
      );
      reject(error);
    });
  });
}

// Exported for tests only, and deliberately not re-exported from index.ts.
// getGrafanaCloudK8sConfig itself cannot be exercised under jest because of its
// dynamic import of @kubernetes/client-node.
export async function getIdFromSlug(
  logger: LoggerService,
  grafanaEndpoint: string,
  stackSlug: string,
  token: string,
): Promise<string> {
  const url = `${grafanaEndpoint}/api/instances/${stackSlug}`;
  logger.debug(`Getting stack id from ${url}`);

  const json = await getJson(logger, url, token);
  logger.debug(`GrafanaServiceModelProcessor: Stack id is ${json.id}`);
  return json.id;
}

// Exported for tests only, see getIdFromSlug above.
export async function getGrafanaConnectionInfo(
  logger: LoggerService,
  grafanaEndpoint: string,
  stackSlug: string,
  token: string,
): Promise<GrafanaConnectionInfo> {
  const url = `${grafanaEndpoint}/api/instances/${stackSlug}/connections`;
  logger.debug(`Getting connection info from ${url}`);

  const json = await getJson(logger, url, token);
  if (json.code === 'InvalidCredentials') {
    throw new Error(
      `GrafanaServiceModelProcessor: Invalid credentials for ${url}`,
    );
  }
  if (json.appPlatform === undefined) {
    throw new Error(
      `GrafanaServiceModelProcessor: No appPlatform object found in response from ${url}`,
    );
  }

  logger.debug(
    `GrafanaServiceModelProcessor: Connection info for ${stackSlug}: url ${
      json.appPlatform.url
    }, caData ${json.appPlatform.caData ? 'present' : 'missing'}`,
  );
  return {
    caData: json.appPlatform.caData,
    url: json.appPlatform.url,
    token: token,
  };
}
