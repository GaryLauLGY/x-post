# Public repository boundary

Updated: 2026-08-22

This repository may be public. Source code for the frontend, Worker, API, database schema/migrations, crawler pipeline, tests, and non-secret deployment templates may be published.

The following are runtime data and must never be committed or uploaded:

- PostgreSQL data directories, dumps, logical exports, and restore artifacts.
- Project `data/` and `archive/` trees.
- Crawler storage states, cookies, run artifacts, quarantines, and watermarks.
- Real `.env` files, tokens, credentials, administrator password material, and private configuration values.
- Generated exports, logs, caches, build output, and dependency directories.

The checked-in `app/data/*.json` files are historical public bootstrap content derived from public X posts and public profile metadata. They are not PostgreSQL exports, authentication records, cookies, or private crawler state. Production data remains authoritative in PostgreSQL and is loaded through the API.

Before every public push:

1. Confirm `git ls-files data archive` returns no runtime files.
2. Inspect staged paths explicitly; never stage the whole worktree blindly.
3. Scan the staged diff and repository history for credential markers and database exports.
4. Verify `.env*` remains ignored except the placeholder-only `.env.example`.
5. Confirm no crawler storage-state, backup, or run-artifact path is tracked.

Making the repository public does not authorize publishing mini PC data, secrets, operational logs, or backup contents.
