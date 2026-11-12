export interface Config {
  grafanaCloudCatalogInfo?: {
    /**
     * @visibility backend
     *
     * @description Whether to enable the Grafana Cloud Catalog Plugin.
     */
    enable: boolean;

    /**
     * @visibility backend
     *
     * @description A list of Backstage Kinds + types to send to Grafana Cloud.
     * Note: User, System, and Domain do not have 'type' attributes
     *  e.g.
     *   allow: # These will be OR'd together
     *     - 'kind=Component,spec.type=service'
     *     - 'kind=Group,spec.type=team'
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

    /**
     * @visibility backend
     *
     * @description Which certificate authorities verify the App Platform
     * endpoint. 'cluster-ca' (default) trusts only the CA that Grafana Cloud
     * returns (if it returns none, Node's trust store is used). 'public'
     * ignores the cluster CA and uses Node's trust store, for endpoints that
     * present a public certificate chain. The two are never merged.
     */
    tls_trust?: 'cluster-ca' | 'public';
  };
}
