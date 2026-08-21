# x-post server project rules

## Scope

- The project root is `/home/gary/x-post`; persistent data is `data/` and recoverable project backups are `archive/`.
- Production frontend is the project-owned `x-post` Cloudflare Worker in Gary's account at `https://xpost.garylau.ai`. It keeps `/api/*` same-origin and proxies those requests to the Tunnel origin declared in `PROJECT.md`. OpenAI Sites is retired and must not be restored or republished except as an explicitly authorized emergency rollback.
- Frontend source changes, builds, Cloudflare Worker deployment, and hostname cutover are performed from `/Users/garylau/Work/x-post` on the Mac. The mini PC remains the PostgreSQL/API/crawler origin and is used only for scoped SSH preflight, deployment, and verification of those server components.
- Do not add another public domain, DNS route, Tunnel route, TLS certificate, firewall rule, or public listener unless `PROJECT.md` declares it and the user authorizes the external change.

## Runtime and data

- Reuse the managed shared Node entry at `/home/gary/.local/bin/node`; dependencies remain project-local.
- PostgreSQL is the only project container in milestone A. It must bind to `127.0.0.1:54329`; the API must bind to `127.0.0.1:3002`.
- `.env` is owner-only and ignored by Git. Never print its values. `data/crawler/storage-states/` must be `700`, with files `600`.
- Administrator passwords are set through the project bootstrap command over stdin, stored only as PostgreSQL scrypt hashes, and never placed in `.env`, Git, command arguments, logs, or chat.
- Database, media, crawler state, exports, and backups remain outside the Git checkout's source directories and are never included in build contexts.

## X crawler

- Only the reviewed `gary-x-post-crawler` may collect X data. Do not replace it with visible timeline sampling, manual browsing, or a permissive scraper.
- A real X run requires explicit handles, time windows, and authorization for this project's storage state. Never copy Cookie/storage state from another project implicitly.
- Import only `verified_original` pure-text records with no reply, repost, quote, media, or URL and impressions strictly greater than the author's threshold.
- `coverage_complete=false`, a partial search error, or profile fallback always blocks watermark advancement.

## Changes and verification

- Preserve user data and unrelated worktree changes. Migration and imports must be idempotent.
- Before schema changes, create a database backup. Prefer forward-compatible migrations; do not use destructive down migrations as automatic rollback.
- Deployment completion requires health checks, row/media reconciliation, backup restore smoke testing, and a recorded source SHA/image digest. A running container alone is not completion.
- Frontend releases must be rollback-safe: verify the Worker build and temporary hostname before changing the custom domain, then verify the public homepage, API, admin authentication boundary, media, PNG export, and the previously blocked mini PC exit. Never recreate an OpenAI Sites attachment as a routine deployment step.
