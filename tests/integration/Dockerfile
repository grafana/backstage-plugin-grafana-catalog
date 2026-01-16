FROM node:22

# Install build dependencies for native modules (isolated-vm, better-sqlite3, etc.)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV BACKSTAGE_APP_NAME=backstage
# Configure Yarn to allow optional dependency failures
ENV YARN_ENABLE_IMMUTABLE_INSTALLS=false
RUN npx @backstage/create-app@latest --skip-install && \
    cd backstage && \
    yarn install --inline-builds

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
