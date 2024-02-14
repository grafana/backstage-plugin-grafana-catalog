import https from 'https';
import { Logger } from 'winston';
import { Config } from '@backstage/config';
import {
  KubeConfig, Cluster, Context, User
} from '@kubernetes/client-node';

export type PluginEnvironment = {
  config: Config;
  logger: Logger;
};

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
export async function getGrafanaCloudK8sConfig(env: PluginEnvironment): Promise<GrafanaCloudK8sConfig> {
  const config = env.config;

  const stackSlug = config.getString('grafanaCloudConnectionInfo.stack_slug');
  const token = config.getString('grafanaCloudConnectionInfo.token');
  let grafanaEndpoint = config.getString('grafanaCloudConnectionInfo.grafana_endpoint');

  // if grafanaEndpoint ends with /, trim it
  if (grafanaEndpoint.endsWith('/')) {
    grafanaEndpoint = grafanaEndpoint.slice(0, -1);
  }

  const stackId = await getIdFromSlug(env, grafanaEndpoint, stackSlug, token);
  const connectionInfo = await getGrafanaConnectionInfo(env, grafanaEndpoint, stackSlug, token);

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

async function getIdFromSlug(env: PluginEnvironment, grafanaEndpoint: string, stackSlug: string, token: string): Promise<string> {
  const url = `${grafanaEndpoint}/api/instances/${stackSlug}`;
  env.logger.debug(`Getting stack id from ${url}`);

  const options = {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };

  return new Promise<string>((resolve, reject) => {
    https.get(url, options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        env.logger.debug(`Got response from ${url}: ${data}`);
        try {
          const json = JSON.parse(data);
          const id = json.id;
          resolve(id);
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', (error) => {
      env.logger.error(`Error getting stack id from ${url}: ${error}`);
      reject(error);
    });
  });
}

async function getGrafanaConnectionInfo(env: PluginEnvironment, grafanaEndpoint: string, stackSlug: string, token: string): Promise<GrafanaConnectionInfo> {
  const path = `/api/instances/${stackSlug}/connections`;
  const url = `${grafanaEndpoint}${path}`;
  env.logger.debug(`Getting connection info from ${url}`);
  const options = {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };

  return new Promise<GrafanaConnectionInfo>((resolve, reject) => {
    https.get(url, options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          env.logger.debug(`Got response from ${url}: ${data}`);
          const json = JSON.parse(data);
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
    }).on('error', (error) => {
      env.logger.error(`Error getting connection info from ${url}: ${error}`);
      reject(error);
    });
  });
}
