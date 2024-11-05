import https from 'https';
import { Config } from '@backstage/config';
import { KubeConfig, Cluster, Context, User } from '@kubernetes/client-node';
import { LoggerService } from '@backstage/backend-plugin-api';

type GrafanaConnectionInfo = {
  caData: string;
  url: string;
  token: string;
};

export type GrafanaCloudK8sConfig = {
  config: KubeConfig;
  namespace: string;
};

// Make connection to gcom and get the caData using the token in the config
// Construct the kubeconfig object from the response
export async function getGrafanaCloudK8sConfig(
  config: Config,
  logger: LoggerService,
): Promise<GrafanaCloudK8sConfig> {
  // If there is an envornment variable for CI testing, return the default kubeconfig
  if (process.env.CI === 'true') {
    logger.info(
      'CI environment detected. Using default kubeconfig for testing.',
    );
    const kubeConfig = new KubeConfig();
    kubeConfig.loadFromCluster();
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
    throw new Error(`Error getting Grafana Cloud K8s config: ${error.message}`);
  });

  // Cook up the kubeconfig object
  const cluster: Cluster = {
    name: grafanaEndpoint,
    server: connectionInfo.url,
    caData: connectionInfo.caData,
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
  const kubeConfig = new KubeConfig();
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

async function getIdFromSlug(
  logger: LoggerService,
  grafanaEndpoint: string,
  stackSlug: string,
  token: string,
): Promise<string> {
  const url = `${grafanaEndpoint}/api/instances/${stackSlug}`;
  logger.debug(`Getting stack id from ${url}`);

  const options = {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };

  return new Promise<string>((resolve, reject) => {
    https
      .get(url, options, res => {
        let data = '';

        res.on('data', chunk => {
          data += chunk;
        });

        res.on('end', () => {
          logger.debug(`Got response from ${url}: ${data}`);
          try {
            const json = JSON.parse(data);
            const id = json.id;
            resolve(id);
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', error => {
        logger.error(`Error getting stack id from ${url}: ${error}`);
        reject(error);
      });
  });
}

async function getGrafanaConnectionInfo(
  logger: LoggerService,
  grafanaEndpoint: string,
  stackSlug: string,
  token: string,
): Promise<GrafanaConnectionInfo> {
  const path = `/api/instances/${stackSlug}/connections`;
  const url = `${grafanaEndpoint}${path}`;
  logger.debug(`Getting connection info from ${url}`);
  const options = {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };

  return new Promise<GrafanaConnectionInfo>((resolve, reject) => {
    https
      .get(url, options, res => {
        let data = '';

        res.on('data', chunk => {
          data += chunk;
        });

        res.on('end', () => {
          logger.debug(`Got response from ${url}: ${data}`);

          try {
            const json = JSON.parse(data);
            if (json.code === 'InvalidCredentials') {
              // throw error object
              throw new Error(`Invalid credentials for ${url}`);
            }
            if (json.appPlatform === undefined) {
              throw new Error(
                `No appPlatform object found in response from ${url}`,
              );
            }
            const connectionInfo: GrafanaConnectionInfo = {
              caData: json.appPlatform.caData,
              url: json.appPlatform.url,
              token: token,
            };
            resolve(connectionInfo);
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', error => {
        logger.error(`Error getting connection info from ${url}: ${error}`);
        reject(error);
      });
  });
}
