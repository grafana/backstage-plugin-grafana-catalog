export interface Config {
    // TODO: None of these are used at the moment
    grafanaServiceModel?: {
        /**
         * @visibility backend
         */
        url: string;

        /**
         * @visibility backend
         */
        apiKey: string;
    }

}