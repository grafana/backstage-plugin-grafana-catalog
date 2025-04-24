# @grafana/backstage-plugin-grafana-catalog

The grafana-service-model backend module for the Backstage catalog.

Grafana Cloud can track your Backstage catalog and use that data to control behavior of Grafana Cloud systems.

Initially this integration will allow you to associate "Services" (Components of type: service) to objects in Grafana OnCall. In the future we will be able to use this data to track Team ownership and Service <-> Service dependencies.

The Grafana "ServiceModel" is basically a mirror of the Backstage Catalog model.

This work is very early. We are still exploring ways to utilize your Backstage Catalog. Please reach out if you have ideas!

## Quick Start Guide

Follow the [quick start guide](docs/quickstart.md) to test this plugin with a new Backstage install. The instructions should carry over to your production install.

## Notes for developers

To create a backstage instance and install this plugin for local development, run the following:

```
> BACKSTAGE_APP_NAME=backstage-testing npx @backstage/create-app@0.5.25
> cd backstage-testing
> git clone https://github.com/grafana/backstage-plugin-grafana-catalog.git  plugins/catalog-backend-module-grafana-servicemodel
> sed -i 's/"name": "@grafana\/catalog-backend-module-grafana-servicemodel",/"name": "@internal\/catalog-backend-module-grafana-servicemodel",/' plugins/catalog-backend-module-grafana-servicemodel/package.json

> yarn --cwd packages/backend add @internal/catalog-backend-module-grafana-servicemodel
```

`yarn prepare` will install a pre-commit hook to check for the `internal` name in `package.json`

add this line to `packages/backend/src/index.ts`:

```
backend.add(import('@internal/catalog-backend-module-grafana-servicemodel'));
```

Then to run:

```
> LOG_LEVEL=debug yarn dev
```

If you want to run against the k8s cluster in your default context:

```
> LOG_LEVEL=debug DEV_MODE=true yarn dev

```
