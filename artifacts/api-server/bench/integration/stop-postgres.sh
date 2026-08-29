#!/usr/bin/env bash
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DIR=${BENCH_PGDIR:-/tmp/lukas-bench-pg}
export PATH="$PATH:$PGBIN"
if [ -d "$DIR/data" ]; then
  if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
    su postgres -c "PATH=$PATH pg_ctl -D $DIR/data stop -m immediate" >/dev/null 2>&1 || true
  else
    pg_ctl -D "$DIR/data" stop -m immediate >/dev/null 2>&1 || true
  fi
fi
rm -rf "$DIR"
