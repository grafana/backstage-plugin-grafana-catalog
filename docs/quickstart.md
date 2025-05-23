## Getting started for local dev testing

Following the getting started directions in [Getting Started | Backstage Software Catalog and Developer Platform](https://backstage.io/docs/getting-started/)

```sh
$ npx @backstage/create-app@latest
```

Pick a name for your testing, `backstage` might be a good start.

Install the plugin:

```bash
cd backstage # or whatever name you picked
yarn --cwd packages/backend add @grafana/catalog-backend-module-grafana-servicemodel
```

Follow the [Grafana cloud access token](grafana-cloud-access-token.md) instructions to create your GrafanaCloud access Token. You will need this for the next section.

Make changes similar to this to `packages/backend/src/index.ts`:

```js
backend.add(import('@grafana/catalog-backend-module-grafana-servicemodel'));
```

Go get some test catalog data. I suggest the example data from Backstage: [backstage/packages/catalog-model/examples at master · backstage/backstage](https://github.com/backstage/backstage/tree/master/packages/catalog-model/examples). Place the contents of the Backstage `examples` dir in the `catalog` dir at the top-level of this directory.

Create an `app-config.local.yaml` that looks like this.

The `allow` selectors follow the same query pattern as the [Backstage API](https://backstage.io/docs/features/software-catalog/software-catalog-api/#filtering). The elements in the list will the OR'd together.

```yaml
# Backstage override configuration for your local development environment
grafanaCloudCatalogInfo:
  enable: true
  stack_slug: <YOUR STACK SLUG>
  grafana_endpoint: https://grafana.com
  token: <YOUR TOKEN>
  allow: # These will be ORed together. Services and Teams are the only thing that Grafana will do something interesting with.
    - kind=Component,spec.type=service
    - kind=Group,spec.type=team

# Setup a Catalog in the local directory
catalog:
  rules:
    - allow:
        [
          Component,
          API,
          Resource,
          Location,
          Template,
          User,
          Group,
          System,
          Domain,
          Library,
        ]
  locations:
    - type: file
      target: ../../catalog/all.yaml
      rules:
        - allow:
            [
              Component,
              Resource,
              Location,
              Template,
              User,
              Group,
              System,
              Domain,
              Library,
            ]
```

Change `package.json` to tell `yarn dev` to use this config:

```diff
  "scripts": {
    "dev": "concurrently \"yarn start\" \"yarn start-backend\"",
    "start": "yarn workspace app start",
-   "start-backend": "yarn workspace backend start",
+   "start-backend": "yarn workspace backend start --config ../../app-config.yaml --config ../../app-config.local.yaml",
    "build:backend": "yarn workspace backend build",
    "build:all": "backstage-cli repo build --all",

```

To start Backstage, run:

```
$ yarn dev
# or if you want debugging
$ LOG_LEVEL=debug yarn dev

```
