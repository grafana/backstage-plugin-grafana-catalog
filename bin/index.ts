#! /usr/bin/env npx ts-node

import { Config } from '@backstage/config';
import { getGrafanaCloudK8sConfig } from '@grafana/backstage-plugin-grafana-catalog';
import { getRootLogger, loadBackendConfig } from '@backstage/backend-common';

// import { parseArgs } from "node:util";
import * as fs from 'fs';
import { dump } from 'js-yaml';

export async function writeKubeConfigFile(
  config: Config,
  kubeconfigPath: string,
): Promise<void> {
  getGrafanaCloudK8sConfig({ config: config, logger: getRootLogger() }).then(
    kubeConfig => {
      const kubeConfigJson = kubeConfig.config.exportConfig();
      const parsedData = JSON.parse(kubeConfigJson);

      // convert json to yaml
      const kubeConfigYaml = dump(parsedData);
      console.log(kubeConfigYaml);
      return new Promise<void>((resolve, _) => {
        fs.writeFileSync(kubeconfigPath, kubeConfigYaml);
        console.log('Kubeconfig file written');
        resolve();
      });
    },
  );
}

// Define the main function that takes named command line arguments.
async function main(): Promise<void> {
  // Define the options for parseArgs.
  // const args = ['--config', '--kubeconfig'];
  // const { values } = parseArgs({ args, options: {
  //     'config': {
  //         type: 'string',
  //         short: 'c',
  //     },
  //     'kubeconfig': {
  //         type: 'string',
  //         short: 'k',
  //     },
  // }});

  // // Extract the "config-file" and "output-file" arguments.
  // const kubeconfig: string = values['kubeconfig'] as string;

  loadBackendConfig({
    logger: getRootLogger(),
    argv: process.argv,
  })
    .then(async config => {
      writeKubeConfigFile(config, 'kubeconfig.yaml').then(() => {
        console.log('main: Kubeconfig file written');
      });
    })
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
  return;
}

// Call the main function.
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});

// .then(() => {
//     console.log('Kubeconfig file written');
//     process.exit(0);
// }).catch((error) => {
//     console.error(error);
//     process.exit(1);
// });
