# Deploying Novi on Render

Novi's server (the API, which also serves the MFI console at `/console`) runs
on Render from the `Dockerfile` at the root of the repository, with a Render
PostgreSQL database. `render.yaml` describes both (D58, D60). The phone app is
not deployed here: it runs in Expo Go (and later as an installed build) and
talks to the server's public address.

## One-time set-up

1. Create an account at render.com (signing in with GitHub is fine) and let it
   see the `estheredi0406/novi-app` repository.
2. **New › Blueprint**, pick the repository. Render reads `render.yaml` and
   proposes a PostgreSQL database (`novi-db`) and a web service (`novi-api`),
   both on the smallest paid plans in Frankfurt (about 14.50 USD a month
   together, with 5 GB of database storage; check Render's pricing page).
3. It asks for `ACEV_PRIVATE_KEY`: paste a new key made with the command in
   `apps/api/src/lib/recordSigning.ts`. Render generates `JWT_SECRET` and
   `NIU_HASH_KEY` itself and fills in `DATABASE_URL` from the database.
4. **Apply**. The first build takes several minutes.
5. Open `https://<service>.onrender.com/health`: it should answer
   `{"status":"ok","database":"ok"}`.

Each start applies new database migrations first (`prisma migrate deploy`).
Secrets are typed in Render, never committed, and are new values, not the
ones on the laptop.

## After set-up

- Every push to `main` builds and deploys again.
- The phone app: set `EXPO_PUBLIC_API_URL=https://<service>.onrender.com` in
  `apps/mobile/.env` and restart Expo with `npx expo start -c`.
- The console: `https://<service>.onrender.com/console/`. Create the MFI's
  first administrator, once, from the service's **Shell** tab in Render:
  `npm run staff:create -- FUCEC manager@example.org "Full Name" ADMIN`
  (run from the `apps/api` folder the shell opens in). She then adds the
  other officers on the console's **Équipe** page (D81); nobody needs the
  shell again.
- Logs, including mock SMS codes while SMS is still a mock: the service's
  **Logs** tab.
- Costs: set a spending notification in Render's billing settings, and delete
  the service and database when the study ends.

## Still mock online (D3)

SMS, the ANID identity check, the MFI and payments use their mock providers
until real providers are connected. Codes sent "by SMS" appear in the logs.
