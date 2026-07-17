#!/bin/bash
# status.sh — Check live status of all LUKAS services on the VPS
# Usage: bash status.sh [VPS_IP] [PASSWORD]

VPS_IP="${1:-46.101.98.45}"
VPS_PASS="${2:-}"

if [ -z "$VPS_PASS" ]; then
  echo "Usage: $0 <VPS_IP> <ROOT_PASSWORD>"
  exit 1
fi

echo "=== LUKAS Service Status on $VPS_IP ==="
sshpass -p "$VPS_PASS" ssh -o StrictHostKeyChecking=no root@$VPS_IP 'bash -s' << 'SSHEOF'
echo ""
echo "SERVICE STATUS:"
for svc in lukas-bot lukas-brain lukas-telegram lukas-btc-trader lukas-btc-paper-trader \
           lukas-reddit-watcher lukas-bug-reasoner lukas-loss-reasoner lukas-manual-sell-watcher lukas-self-heal; do
  status=$(systemctl is-active $svc 2>/dev/null || echo "not-found")
  printf "  %-30s %s\n" "$svc" "$status"
done

echo ""
echo "RECENT BOT LOG (last 10 lines):"
tail -10 /root/Agent-spy/bot.log 2>/dev/null || echo "  (no log yet)"

echo ""
echo "RECENT TELEGRAM LOG (last 5 lines):"
tail -5 /root/Agent-spy/telegram.log 2>/dev/null || echo "  (no log yet)"

echo ""
echo "BTC TRADER LOG (last 5 lines):"
tail -5 /root/Agent-spy/btc_trader.log 2>/dev/null || echo "  (no log yet)"
SSHEOF
