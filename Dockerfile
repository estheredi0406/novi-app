# Builds the Novi server for hosting (Railway, D58): the API, which also
# serves the MFI console. The mobile app is not part of this image; members
# use the app on their phones, which talks to this server.
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

COPY . .
RUN npm run build:server

ENV NODE_ENV=production
WORKDIR /app/apps/api
# Applies any new database migrations, then starts the API. The host sets PORT.
CMD ["npm", "run", "start:prod"]
