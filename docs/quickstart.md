## Getting started

Following the getting started directions in [Getting Started | Backstage Software Catalog and Developer Platform](https://backstage.io/docs/getting-started/)

```sh
$ npx @backstage/create-app
```

Pick a name for your testing, `backstage` might be a good start.

Follow the [Installation](./docs/installation.md) instruction to create your GrafanaCloud access Token, and install the plugin.

Go get some test catalog data. I suggest the example data from Backstage: [backstage/packages/catalog-model/examples at master · backstage/backstage](https://github.com/backstage/backstage/tree/master/packages/catalog-model/examples). Place the contents of this `examples` dir in the `catalog` dir at the top-level of this directory

Create an `app-config.local.yaml` that looks like this

The `allow` selectors follow the same query pattern as the [Backstage API](https://backstage.io/docs/features/software-catalog/software-catalog-api/#filtering). The elements in the list will the OR'd together.

```yaml
# Backstage override configuration for your local development environment
grafanaCloudConnectionInfo:
  stack_slug: <YOUR STACK SLUG>
  grafana_endpoint: https://grafana-dev.com
  token: <YOUR TOKEN>
  allow: # These will be ORed together
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
```
