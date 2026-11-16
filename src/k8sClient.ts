/**
 * The shape of the @kubernetes/client-node module, as the connection code uses it.
 */
export type K8sClient = typeof import('@kubernetes/client-node');

/**
 * loadK8sClient loads the Kubernetes client on demand.
 *
 * The client is ESM-only, so it can only be reached through a dynamic import().
 * That import cannot run under jest without --experimental-vm-modules, so this
 * is the single place that performs it. The connection code takes the loaded
 * module as a parameter (see getGrafanaCloudK8sConfig), which lets tests pass a
 * fake client through the real connection code instead of stubbing it wholesale
 * (#175).
 */
export function loadK8sClient(): Promise<K8sClient> {
  return import('@kubernetes/client-node');
}
