FROM node:20

WORKDIR /app
ENV BACKSTAGE_APP_NAME=backstage
RUN npx @backstage/create-app@0.5.25

WORKDIR /app/plugin
COPY src src/
COPY package.json configSchema.d.ts tsconfig.json yarn.lock ./

WORKDIR /app/backstage
RUN cp -r /app/plugin plugins/catalog-backend-module-grafana-servicemodel
RUN sed -i 's/"name": "@grafana\/catalog-backend-module-grafana-servicemodel",/"name": "@internal\/catalog-backend-module-grafana-servicemodel",/' plugins/catalog-backend-module-grafana-servicemodel/package.json
RUN yarn --cwd packages/backend add @internal/catalog-backend-module-grafana-servicemodel

COPY ./tests/integration/app-config/catalog ./catalog
COPY ./tests/integration/app-config/index.ts.template packages/backend/src/index.ts
COPY ./tests/integration/app-config/package.json .
COPY ./tests/integration/app-config/app-config.local.yaml .

ENV LOG_LEVEL=debug
ENTRYPOINT [ "yarn", "start-backend" ]
