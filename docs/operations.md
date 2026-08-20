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

The approved material baseline is 329: `rwayne=145`, `ai_xiaomu=61`, `dashen_wang=106`, `AI_jacksaku=17`. Re-running the importer must keep 329 material rows and one metric snapshot per material for the fixed source commit timestamp.

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

The cycle acquires both a filesystem lock and a PostgreSQL advisory lock, recovers stale `running` rows older than four hours, and processes authors sequentially. It calls the vendored crawler without reply/repost modes, without `--skip-original-verification`, and without partial-search/profile fallbacks. New strict candidates enter `pending`; existing materials retain review state and human classification while metrics update idempotently.

Artifacts and watermarks:

- `data/crawler/storage-states/`: owner-only project login state.
- `data/crawler/runs/<cycle>/<author>/`: immutable plan, log, verified CSV, quarantine, summaries, candidates and SHA-256 manifest.
- `data/crawler/watermarks/<author>.json`: promoted only after the corresponding PostgreSQL import commits.

Keep the Codex task disabled until the user has placed a project-specific storage state, approved the resolved windows, and one bounded real run has passed. A partial run may import strictly verified candidates but cannot promote the filesystem or database watermark.
