#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
BACKUP="${1:-}"
if [[ -z "$BACKUP" || ! -f "$BACKUP" ]]; then
  echo "usage: $0 /absolute/path/to/xpost-backup.sql.gz" >&2
  exit 2
fi

case "$(realpath "$BACKUP")" in
  "$PROJECT_ROOT"/archive/*) ;;
  *) echo "backup must be inside $PROJECT_ROOT/archive" >&2; exit 2 ;;
esac

CONTAINER="x-post-restore-smoke-$$"
cleanup() {
  sudo -n docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

sudo -n docker run -d --rm --name "$CONTAINER" \
  --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,size=1g \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16.10-alpine >/dev/null

for _ in $(seq 1 40); do
  if sudo -n docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
sudo -n docker exec "$CONTAINER" pg_isready -U postgres >/dev/null
sudo -n docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -c "CREATE ROLE xpost LOGIN" >/dev/null
sudo -n docker exec "$CONTAINER" createdb -U postgres -O xpost xpost
gzip -cd "$BACKUP" | sudo -n docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U xpost -d xpost >/dev/null

MATERIALS="$(sudo -n docker exec "$CONTAINER" psql -At -U xpost -d xpost -c "SELECT count(*) FROM materials")"
METRICS="$(sudo -n docker exec "$CONTAINER" psql -At -U xpost -d xpost -c "SELECT count(*) FROM material_metrics")"
printf '{"status":"ok","materials":%s,"metrics":%s}\n' "$MATERIALS" "$METRICS"
