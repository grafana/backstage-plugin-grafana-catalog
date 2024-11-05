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
> BACKSTAGE_APP_NAME=backstage npx @backstage/create-app@latest
> cd backstage
> yarn set version 3.8.3
> yarn plugin import @yarnpkg/plugin-workspace-tools
> yarn install
> npm i -g concurrently
> yarn --cwd packages/backend add <path to this repo> && LOG_LEVEL=debug yarn dev


yarn set version 3.8.3; yarn plugin import @yarnpkg/plugin-workspace-tools; yarn install

```

plugin-catalog -backend- module- grafana-service-model-catalog
