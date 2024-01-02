export interface Config {
    // TODO: None of these are used at the moment
    grafanaCloudConnectionInfo?: {
        /**
         * @visibility backend
         * 
         * @description The ID of the stack to use for the Grafana service
         */
        stack_id: string;

        /**
         * @visibility backend
         * 
         * @description The bearer token to use for the Grafana service
         */
        token: string;
    }

}