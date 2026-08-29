#!/usr/bin/env bash
# Ein Befehl: Datenbank hoch, Schema hinein, Bündel bauen, messen, aufräumen.
#
# Das Aufräumen steht in einem trap — bricht der Lauf mitten drin ab, bleibt
# sonst ein Postgres-Prozess und ein Datenverzeichnis zurück.
set -euo pipefail
HIER="$(cd "$(dirname "$0")" && pwd)"
API="$HIER/../.."
cd "$API"

trap '"$HIER/stop-postgres.sh" >/dev/null 2>&1 || true' EXIT

echo "→ Postgres starten"
URL="$("$HIER/start-postgres.sh")"
export BENCH_DATABASE_URL="$URL"

echo "→ Schema einspielen"
DATABASE_URL="$URL" npx drizzle-kit push --config ../../lib/db/drizzle.config.ts --force >/dev/null

echo "→ Bündel bauen"
npx esbuild src/lib/netzschutz.ts --bundle --format=esm --platform=node --external:undici --outfile=dist/netzschutz-bench.mjs --log-level=error
npx esbuild src/lib/lauf-sperre.ts --bundle --format=esm --platform=node --external:pg --external:pino --outfile=dist/lauf-sperre-bench.mjs --log-level=error
npx esbuild src/lib/memory-retrieval.ts --bundle --format=esm --platform=node --external:pg --external:pino --external:undici --outfile=dist/memory-bench.mjs --log-level=error
npx esbuild src/lib/browser-operator-script.ts --bundle --format=esm --platform=node --outfile=dist/browser-script-bench.mjs --log-level=error

echo "→ messen"
PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}" node "$HIER/runner.mjs"
