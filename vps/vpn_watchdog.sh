#!/bin/bash
# LUKAS VPN Watchdog — alerts via Telegram if NordVPN drops or leaves Switzerland
set -u
STATE_FILE="/var/lib/lukas_vpn_watchdog.state"
COOLDOWN=600  # 10 min between repeat alerts

# Load env (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)
if [ -f /root/Agent-spy/.env ]; then
  set -a; . /root/Agent-spy/.env; set +a
fi

export HOME="${HOME:-/root}"
STATUS=$(nordvpn status 2>&1 || echo "ERROR")
# Skip on transient CLI errors (e.g. "$HOME is not defined", empty output) — do NOT false-alert
if echo "$STATUS" | grep -qE '\$HOME is not defined|connect to the daemon|Whoops!|^ERROR$' || [ -z "$STATUS" ]; then
  logger -t lukas-vpn-watchdog "transient CLI error, skipping: $(echo \"$STATUS\" | head -1)"
  exit 0
fi
CONNECTED=0
COUNTRY=""
if echo "$STATUS" | grep -qE 'Status:\s*Connected'; then CONNECTED=1; fi
COUNTRY=$(echo "$STATUS" | grep -iE '^\s*Country' | head -1 | sed -E 's/.*:\s*//' | tr -d '\r')

ALERT=""
if [ "$CONNECTED" -eq 0 ]; then
  ALERT="🔴 LUKAS VPN DOWN — NordVPN disconnected on VPS! BTC trader will geoblock. Status: $(echo "$STATUS" | head -3 | tr '\n' ' ')"
elif ! echo "$COUNTRY" | grep -qiE '^Switzerland'; then
  ALERT="⚠️ LUKAS VPN drift — connected but country=${COUNTRY:-unknown} (expected Switzerland). Polymarket may geoblock."
fi

if [ -n "$ALERT" ]; then
  NOW=$(date +%s)
  LAST=0
  [ -f "$STATE_FILE" ] && LAST=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
  DIFF=$((NOW - LAST))
  if [ "$DIFF" -ge "$COOLDOWN" ]; then
    if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
      curl -sS --max-time 10 -X POST \
        "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -d "chat_id=${TELEGRAM_CHAT_ID}" \
        --data-urlencode "text=${ALERT}" >/dev/null
      echo "$NOW" > "$STATE_FILE"
      logger -t lukas-vpn-watchdog "ALERT sent: $ALERT"
    fi
  fi
else
  # Recovery message if previously alerted
  if [ -f "$STATE_FILE" ]; then
    if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
      curl -sS --max-time 10 -X POST \
        "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -d "chat_id=${TELEGRAM_CHAT_ID}" \
        --data-urlencode "text=✅ LUKAS VPN recovered — connected to ${COUNTRY}." >/dev/null
    fi
    rm -f "$STATE_FILE"
    logger -t lukas-vpn-watchdog "Recovery: $COUNTRY"
  fi
fi
