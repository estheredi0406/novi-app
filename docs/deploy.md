# Deploying Novi (Railway)

The server (the API, which also serves the MFI console at `/console`) runs on
Railway from the `Dockerfile` at the root of the repository (D58). The phone
app is not deployed here: it runs in Expo Go (and later as an installed
build) and talks to the server's public address.

## One-time set-up

1. Create an account at railway.com and a new project.
2. Add a **PostgreSQL** database to the project.
3. Add a service from this GitHub repository (`estheredi0406/novi-app`).
   Railway reads `railway.json` and builds with the `Dockerfile`.
4. In the service's **Variables**, add (values typed by you, never committed):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (a reference to the database) |
   | `JWT_SECRET` | a new long random value, not the one on your laptop |
   | `NIU_HASH_KEY` | a new long random value |
   | `ACEV_PRIVATE_KEY` | a new Ed25519 key (command in `apps/api/src/lib/recordSigning.ts`) |
   | `MOCK_PAYMENTS_CONFIRM_MS` | `4000` |

   `PORT` and `NODE_ENV` are set by Railway and the Dockerfile.
   A random value can be made with:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
5. In **Settings › Networking**, generate a public domain.
6. Check `https://<domain>/health` answers `{"status":"ok","database":"ok"}`.

Each start applies new database migrations first (`prisma migrate deploy`).

## After set-up

- Every push to `main` builds and deploys again.
- The phone app: set `EXPO_PUBLIC_API_URL=https://<domain>` in `apps/mobile/.env`
  and restart Expo with `npx expo start -c`.
- The console: `https://<domain>/console/`. Create an officer with
  `npm run staff:create -w @novi/api -- ...` run against the online database
  (Railway's service shell, or locally with the online `DATABASE_URL`).
- Logs (including mock SMS codes while SMS is still a mock) are in the
  service's **Deployments › View logs**.

## Still mock online (D3)

SMS, the ANID identity check, the MFI and payments use their mock providers
until real providers are connected. Codes sent "by SMS" appear in the logs.
