#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
BACKUP_ROOT="${XPOST_BACKUP_ROOT:-$PROJECT_ROOT/archive/database}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$BACKUP_ROOT/xpost-$STAMP.sql.gz"

mkdir -p "$BACKUP_ROOT"
umask 077
sudo -n docker compose --env-file "$PROJECT_ROOT/.env" -f "$PROJECT_ROOT/deploy/compose.yaml" \
  exec -T postgres pg_dump --no-owner --no-privileges -U xpost -d xpost | gzip -9 > "$TARGET"
sha256sum "$TARGET" > "$TARGET.sha256"

printf '{"status":"ok","backup":"%s","sha256_file":"%s"}\n' "$TARGET" "$TARGET.sha256"
