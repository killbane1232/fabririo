#!/usr/bin/env bash
set -euo pipefail
fabririo_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$fabririo_dir"
if command -v go >/dev/null 2>&1; then
  fabririo_go="$(command -v go)"
elif [[ -x /usr/local/go/bin/go ]]; then
  fabririo_go=/usr/local/go/bin/go
else
  printf 'Для запуска нужен Go 1.25 или новее: https://go.dev/dl/\n' >&2
  exit 1
fi
export GOCACHE="${GOCACHE:-${TMPDIR:-/tmp}/fabririo-go-cache}"
exec "$fabririo_go" run ./cmd/fabririo "$@"
