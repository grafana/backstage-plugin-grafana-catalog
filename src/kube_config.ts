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

  // Cook up the kubeconfig object
  const cluster: Cluster = {
    name: grafanaEndpoint,
    server: connectionInfo.url,
    caData: connectionInfo.caData,
    skipTLSVerify: false,
  };
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
        logger.debug(
          `GrafanaServiceModelProcessor: Got response from ${url}: ${data}`,
        );
        try {
          resolve(JSON.parse(data));
        } catch (error: any) {
          reject(
            new Error(
              `GrafanaServiceModelProcessor: Could not parse response from ${url}: ${error.message}`,
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

  return {
    caData: json.appPlatform.caData,
    url: json.appPlatform.url,
    token: token,
  };
}
