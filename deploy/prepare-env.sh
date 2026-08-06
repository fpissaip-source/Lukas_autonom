#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_FILE="${1:-/root/lukas.env}"
TARGET_FILE="${2:-.env}"

if [[ ! -f "$SOURCE_FILE" ]]; then
  echo "ENV-Quelldatei nicht gefunden: $SOURCE_FILE" >&2
  exit 1
fi

umask 077
TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT

# Railway-Systemvariablen sind auf dem VPS nicht sinnvoll. Echte App-Variablen
# werden unveraendert uebernommen, ohne ihre Werte im Terminal anzuzeigen.
awk 'NF > 0 && $0 !~ /^RAILWAY_/ { print }' "$SOURCE_FILE" > "$TMP_FILE"

add_default() {
  local key="$1"
  local value="$2"

  if ! grep -q "^${key}=" "$TMP_FILE"; then
    printf '%s=%s\n' "$key" "$value" >> "$TMP_FILE"
  fi
}

add_default NODE_ENV production
add_default PORT 5000
add_default LUKAS_DOMAIN :80
add_default LUKAS_ALLOWED_ORIGINS ""
add_default LUKAS_PUBLIC_ORIGINS "*"
add_default LUKAS_RATE_LIMIT_PER_MINUTE 180
add_default LUKAS_PUBLIC_RATE_LIMIT_PER_MINUTE 60
add_default LUKAS_EXPENSIVE_RATE_LIMIT_PER_MINUTE 20
add_default LUKAS_JSON_BODY_LIMIT 2mb
add_default LUKAS_FORM_BODY_LIMIT 256kb
add_default LUKAS_EXECUTION_BACKEND host
add_default LUKAS_HOST_EXECUTOR_ENABLED true

if ! grep -Eq '^LUKAS_API_TOKEN=.+$' "$TMP_FILE"; then
  echo "LUKAS_API_TOKEN fehlt oder ist leer. Deployment wird aus Sicherheitsgruenden abgebrochen." >&2
  exit 1
fi

mv "$TMP_FILE" "$TARGET_FILE"
trap - EXIT
chmod 600 "$TARGET_FILE"

echo "ENV-Datei vorbereitet: $TARGET_FILE"
echo "Enthaltene Variablennamen:"
cut -d= -f1 "$TARGET_FILE"
