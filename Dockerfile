# Builds the Novi server for hosting (Render, D58, D60): the API, which also
# serves the MFI console and (D119) the member app's web version at /app, for
# members without an Android phone. The Android app is built apart (EAS).
FROM node:24-slim

# Prisma needs OpenSSL to talk to PostgreSQL.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so a code change does not reinstall them.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/console/package.json apps/console/
COPY apps/mobile/package.json apps/mobile/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund
# D119: what the web version needs and the phone app does not (React for the
# browser). Installed here only, so the lockfile the phone app uses is unchanged.
RUN npm install --no-save --no-audit --no-fund -w @novi/mobile react-native-web@0.21.4 react-dom@19.3.0

COPY . .
RUN npm run build:server
# Built without EXPO_PUBLIC_API_URL: the web version talks to the server it is served from.
RUN npm run build:web

ENV NODE_ENV=production
WORKDIR /app/apps/api
# Applies any new database migrations, then starts the API. The host sets PORT.
CMD ["npm", "run", "start:prod"]
