# Performance and compatibility scripts

Used for the results in [docs/testing.md](../../docs/testing.md). Run them against a **test** database only: `seed.mjs` creates 12 members and a running group.

1. Start the API with a test database and visible pilot codes: `PILOT_SHOW_CODES=true PORT=3100 npm start` in `apps/api`.
2. `npm install --no-save autocannon playwright` here (not added to the project's dependencies).
3. `node seed.mjs > seed.json` creates the data through the real API.
4. `node load.mjs` runs 15 seconds per endpoint at 50 then 100 users and writes `results.json`.
5. Log in to the console at `http://localhost:3100/console/`, copy `novi-console-token` from the browser's session storage, then `STAFF_TOKEN=… node browsers.cjs` checks six pages at five screen sizes and saves screenshots in `shots/`.

Set `API` to test another address (default `http://localhost:3100`).
