FROM node:20

WORKDIR /app
ENV BACKSTAGE_APP_NAME=backstage
RUN npx @backstage/create-app

WORKDIR /app/plugin
COPY src package.json package-lock.json configSchema.d.ts tsconfig.json yarn.lock ./

WORKDIR /app/backstage
RUN yarn add --cwd packages/backend file:/app/plugin

COPY ./tests/integration/app-config/catalog ./catalog
COPY ./tests/integration/app-config/catalog.ts packages/backend/src/plugins/catalog.ts
COPY ./tests/integration/app-config/package.json .
COPY ./tests/integration/app-config/app-config.local.yaml .

ENV LOG_LEVEL=info
ENTRYPOINT [ "yarn", "start-backend" ]
