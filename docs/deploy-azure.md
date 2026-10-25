# Deploying Novi on Microsoft Azure

Novi's server (the API, which also serves the MFI console at `/console`) runs
as a Docker container on **Azure App Service**, with **Azure Database for
PostgreSQL**. GitHub builds the image on every push to `main` and tells Azure
to run it (`.github/workflows/deploy-azure.yml`, D59).

Everything below is done by you in the Azure portal and on GitHub. Secrets
are typed there, never committed and never pasted into a chat.

## 0. Account

Sign up for **Azure for Students** with your university email (no card needed;
check Microsoft's current terms). Choose one **region** for everything,
preferably in Europe (for example France Central or West Europe), which is
usually closer to Lomé than South Africa; use another if your student
subscription does not allow it.

## 1. Resource group

Portal › Resource groups › Create: name `novi`, your region.

## 2. PostgreSQL database

Portal › **Azure Database for PostgreSQL flexible server** › Create:
- Resource group `novi`, server name e.g. `novi-db-<something>`, your region.
- Workload: **Development**; compute **Burstable B1ms**; storage 32 GB.
- Authentication: PostgreSQL authentication only; admin name `noviadmin`
  and a strong password (keep it in a password manager).
- Networking: **Public access**; tick **Allow public access from any Azure
  service within Azure**; also **Add current client IP address** (your laptop,
  to run scripts against it later).
- Create. Then open the server › **Databases** › Add: `novi`.

Your connection string (used in step 4):

`postgresql://noviadmin:<password>@<server-name>.postgres.database.azure.com:5432/novi?sslmode=require`

If the password contains characters such as `@ : / ? #`, write them
URL-encoded (for example `@` as `%40`).

## 3. Web app (App Service)

Portal › **App Services** › Create › **Web App**:
- Resource group `novi`, name e.g. `novi-api-<something>` (this becomes
  `https://<name>.azurewebsites.net`).
- Publish: **Container**; operating system **Linux**; your region.
- Pricing plan: **Basic B1** (stays awake; covered by the student credit).
- Container: image source **Other container registries**, then
  - Server URL `https://ghcr.io`
  - Image `estheredi0406/novi-api:latest`
  - Access: **Private**, username `estheredi0406`, password = a GitHub token
    (GitHub › Settings › Developer settings › Personal access tokens ›
    classic, scope **read:packages** only).
  The first start will fail until GitHub has pushed the image (step 5): that is expected.
- Create.

Then, in the web app:
- **Settings › Configuration › General settings**: **Always on** = On;
  **SCM Basic Auth Publishing Credentials** = On (needed for step 5). Save.
- **Monitoring › Health check**: path `/health`.

## 4. The web app's settings (environment variables)

Web app › **Settings › Environment variables** › App settings, add:

| Name | Value |
|---|---|
| `DATABASE_URL` | the connection string from step 2 |
| `JWT_SECRET` | a new random value |
| `NIU_HASH_KEY` | a new random value |
| `ACEV_PRIVATE_KEY` | a new Ed25519 key (command in `apps/api/src/lib/recordSigning.ts`) |
| `MOCK_PAYMENTS_CONFIRM_MS` | `4000` |
| `WEBSITES_PORT` | `3000` (the port the container listens on) |

A random value: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
Use new values, not the ones in your laptop's `.env`. Apply.

## 5. Connect GitHub to Azure

1. Web app › **Overview** › **Download publish profile** (a small file).
2. GitHub › the `novi-app` repository › **Settings › Secrets and variables › Actions**:
   - **Secrets** › New: `AZURE_WEBAPP_PUBLISH_PROFILE` = the whole content of that file.
   - **Variables** › New: `AZURE_WEBAPP_NAME` = your web app's name.
3. GitHub › **Actions** › "Deploy to Azure" › **Run workflow** (or push to `main`).

The workflow builds the image (several minutes the first time), pushes it to
GHCR and points the web app at it. On start, the container applies the
database migrations, then starts the API.

## 6. Check

- `https://<name>.azurewebsites.net/health` answers `{"status":"ok","database":"ok"}`.
- `https://<name>.azurewebsites.net/console/` shows the console login.
- Logs: web app › **Monitoring › Log stream** (mock SMS codes appear here
  while SMS is still a mock).
- Phone: `EXPO_PUBLIC_API_URL=https://<name>.azurewebsites.net` in
  `apps/mobile/.env`, then `npx expo start -c`.

## Costs

The Basic B1 plan and the B1ms database are paid services that the student
credit covers. Watch **Cost Management** in the portal, and stop or delete
the resource group when the study is over.
