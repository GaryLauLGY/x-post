#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  prepare_runtime.sh [--runtime-dir DIR] [--skip-browser-install]

Options:
  --runtime-dir DIR          Default: <项目>/workspace/gary-x-post-crawler/runtime
  --skip-browser-install     Install the Playwright package but not Chromium
  -h, --help                 Show this help
USAGE
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUNTIME_DIR="$PROJECT_ROOT/workspace/gary-x-post-crawler/runtime"
SKIP_BROWSER_INSTALL="0"
PLAYWRIGHT_VERSION="${X_CRAWLER_PLAYWRIGHT_VERSION:-1.61.1}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --runtime-dir) RUNTIME_DIR="$2"; shift 2 ;;
    --skip-browser-install) SKIP_BROWSER_INSTALL="1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if ! command -v npm >/dev/null 2>&1 && ! command -v pnpm >/dev/null 2>&1; then
  echo "npm or pnpm is required" >&2
  exit 1
fi

PACKAGE_MANAGER="npm"
if command -v pnpm >/dev/null 2>&1 && npm help install 2>&1 | grep -q "Usage: pnpm install"; then
  PACKAGE_MANAGER="pnpm"
fi

mkdir -p "$RUNTIME_DIR"
if [[ ! -f "$RUNTIME_DIR/package.json" ]]; then
  printf '{"name":"gary-x-post-crawler-runtime","private":true,"version":"1.0.0"}\n' > "$RUNTIME_DIR/package.json"
fi

if [[ ! -d "$RUNTIME_DIR/node_modules/playwright" ]]; then
  (
    cd "$RUNTIME_DIR"
    if [[ "$PACKAGE_MANAGER" == "pnpm" ]]; then
      pnpm add "playwright@$PLAYWRIGHT_VERSION"
    else
      npm install "playwright@$PLAYWRIGHT_VERSION" --no-audit --no-fund
    fi
  )
fi

if [[ "$SKIP_BROWSER_INSTALL" != "1" ]]; then
  (
    cd "$RUNTIME_DIR"
    if [[ "$PACKAGE_MANAGER" == "pnpm" ]]; then
      pnpm exec playwright install chromium
    else
      npx playwright install chromium
    fi
  )
fi

printf 'runtime_ready=%s package_manager=%s\n' "$RUNTIME_DIR" "$PACKAGE_MANAGER"
