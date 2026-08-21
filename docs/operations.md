# server operations

Run commands from `/home/gary/x-post`.

## Status

```bash
systemctl --user status x-post-api.service
curl --fail --silent http://127.0.0.1:3002/health/live
curl --fail --silent http://127.0.0.1:3002/health/ready
sudo -n docker compose --env-file .env -f deploy/compose.yaml ps
```

Public checks:

```bash
curl --fail --silent 'https://xpost.garylau.ai/api/v1/materials?limit=1'
curl --silent --output /dev/null --write-out '%{http_code}\n' https://xpost.garylau.ai/api/v1/admin/overview
```

The second command must return `401` without an administrator session.

## Backup and restore check

```bash
scripts/backup.sh
scripts/restore-smoke-test.sh /home/gary/x-post/archive/database/<backup>.sql.gz
```

Backups are project-local recovery points. An off-machine encrypted backup destination and recurring retention timer are not configured in milestone A.

## Data reconciliation

Do not use a hard-coded historical material count as the production baseline. Reconcile the public API total against current approved PostgreSQL rows, and reconcile per-author imports against the corresponding crawler run summary. Re-running the importer must remain idempotent and may add only newly verified strict candidates while updating public metrics for existing materials.

## Crawler boundary

The crawler uses a Codex scheduled task rather than a systemd timer. The task runs from the Mac `x-post` project and invokes the mini PC entrypoint over the existing SSH channel.

Plan all configured authors without opening X:

```bash
bin/x-post-crawler-cycle --plan-only
```

Run the strict production cycle:

```bash
bin/x-post-crawler-cycle --execute
```

Authors may declare `initialMinLocalDate` in `config/crawler-authors.json` when their first authorized run requires an explicit historical boundary. Only a promoted crawler watermark enables the normal overlap and incremental rules; materials imported from an incomplete run do not shorten the next historical attempt. High-frequency authors may also declare a positive integer `windowDays`; authors without it retain the production default of two days.

The cycle acquires both a filesystem lock and a PostgreSQL advisory lock, recovers stale `running` rows older than four hours, and processes authors sequentially. It calls the vendored crawler without reply/repost modes, without `--skip-original-verification`, and without partial-search/profile fallbacks. New strict candidates enter `approved` and are immediately visible in the editor; existing `pending` strict candidates are promoted, while manually rejected or archived materials stay removed. Existing human classification remains authoritative and public metrics update idempotently.

Artifacts and watermarks:

- `data/crawler/storage-states/`: required owner-only `primary.json` and `secondary.json`. Production passes the latter as `--fallback-storage-state`, rejects duplicate file hashes, and requires `storage_state_count=2` at the plan gate.
- `data/crawler/runs/<cycle>/<author>/`: immutable plan, log, verified CSV, quarantine, summaries, candidates and SHA-256 manifest.
- `data/crawler/watermarks/<author>.json`: promoted only after the corresponding PostgreSQL import commits.

Codex automation `05-30-x-post` was enabled after the project-specific storage states, resolved windows, and bounded real runs passed on 2026-08-20. If either login state or the project runtime is replaced, disable the task until the same gates pass again. A partial run may import strictly verified candidates but cannot promote the filesystem or database watermark.
