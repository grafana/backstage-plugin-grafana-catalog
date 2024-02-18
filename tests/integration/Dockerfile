FROM node:20

WORKDIR /app/plugin
COPY . .
RUN yarn install 
RUN yarn tsc && yarn build

WORKDIR /app
ENV BACKSTAGE_APP_NAME=backstage
RUN npx @backstage/create-app
WORKDIR /app/backstage

RUN yarn add --cwd packages/backend file:/app/plugin

COPY ./tests/integration/catalog ./catalog
COPY ./tests/integration/catalog.ts packages/backend/src/plugins/catalog.ts
COPY ./tests/integration/package.json .
COPY ./tests/integration/app-config.local.yaml .

ENV LOG_LEVEL=debug
ENTRYPOINT [ "yarn", "start-backend" ]
