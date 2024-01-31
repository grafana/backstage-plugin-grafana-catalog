export interface Config {
    // TODO: None of these are used at the moment
    grafanaCloudConnectionInfo?: {
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
    }

}