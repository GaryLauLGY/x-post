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

Do not enable a timer until the user has placed a project-specific storage state, approved explicit handle/date windows, and reviewed plan-only output. Keep partial runs and fallback results, but never advance their watermarks.
