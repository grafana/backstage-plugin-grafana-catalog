export interface Config {
  grafanaCloudConnectionInfo?: {
    /**
     * @visibility backend
     *
     * @description A list of Backstage Kinds to send to Grafana Cloud.
     *   e.g. Component, Group, Resource, etc
     */
    allow: string[];

    /**
     * @visibility backend
     *
     * @description The slug (string) of the stack to use for the Grafana service.
     */
    stack_slug: string;

    /**
     * @visibility backend
     *
     * @description The grafana.com server name. This will usually be https://grafana.com
     */
    grafana_endpoint: string;

    /**
     * @visibility backend
     *
     * @description The Cloud Access token you created in Grafana Cloud.
     */
    token: string;
  };
}
