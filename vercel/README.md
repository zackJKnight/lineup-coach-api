# Lineup Coach cloud backup

Production API: https://lineup-coach-api.vercel.app

Vercel project: lineup-coach-api under zacks-projects-d0c08d39. Neon database: lineup-coach-db (free_v3, iad1). The API is deployed independently from this directory; the frontend continues to use Sites hosting.

## Development and deployment

Run `npm ci` in this directory, then `vercel link --project lineup-coach-api --scope zacks-projects-d0c08d39` and `vercel env pull`. Credentials must remain in ignored local environment files. Initialize a fresh database with `node --env-file=.env.local --import tsx migrate.ts`. Run `npm run check` and `node --env-file=.env.local --import tsx --test test.ts`, then `vercel deploy --prod`. In a proxy-controlled Node 24 environment, add `--use-env-proxy` to Node commands.

## Contract and security

GET/POST collection and GET/PUT/DELETE record routes preserve the old collections and client-generated IDs. POST is idempotent by owner, collection and ID; PUT returns 404 for missing records. Arbitrary additive JSON fields are retained. `/health` checks database readiness.

The client generates a private 256-bit random capability per device, kept in IndexedDB. Only the approved API receives its Bearer header. The server scopes every operation using its SHA-256 hash. Knowing a record ID alone grants no access. The capability grants read/write access to that device's backup and must be protected like a password. No credentials are embedded in source or browser bundles. JSON downloads include the capability for manual recovery.

Browser CORS is restricted to the existing Lineup Coach Site. Database rows are private to each capability; CORS itself is not authorization. Request bodies are limited to 256 KiB. Account sign-in, capability revocation, quotas, automatic restore and multi-device conflict resolution are not implemented. This is device-scoped cloud backup, not account-based multi-device sync.

## Verification

The integration test covers persistent CRUD, duplicate upload retries, isolation, body validation and CORS, cleaning up synthetic data. From the frontend root, `node --import tsx scripts/cloud-smoke.ts` tests a generated game through the real outbox against production and deletes its synthetic records. Frontend `npm run verify` checks the build, generator, IndexedDB, sync queue and service-worker logic. Browser offline restart has not been verified.

The retired Deno backend and its historical data were not migrated. Lineup generation remains on-device in the MVP; the old token/OAuth demo endpoints and server-side generator are intentionally not carried forward.
