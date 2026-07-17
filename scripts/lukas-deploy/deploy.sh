#!/bin/bash
# LUKAS VPS Deployment Script
# Deploys all 99 LUKAS files from the code archive to a VPS
# and sets up all 10 systemd services.
#
# Usage: bash deploy.sh <VPS_IP> <ROOT_PASSWORD>
# Example: bash deploy.sh 46.101.98.45 mypassword
#
# Required env vars (set before running, or edit below):
#   GEMINI_API_KEY
#   TELEGRAM_BOT_TOKEN
#   TELEGRAM_CHAT_ID
#   POLYMARKET_PRIVATE_KEY
#   VPS_DB_PASSWORD  — Replit secret; injected into DATABASE_URL and used to
#                      rotate the Postgres 'lukas' user password on the VPS

set -euo pipefail

VPS_IP="${1:-46.101.98.45}"
VPS_PASS="${2:-}"
# Quelle der Wahrheit: die 99 Dateien liegen versioniert im Repo unter vps/
SRC_DIR="vps"

if [ -z "$VPS_PASS" ]; then
  echo "Usage: $0 <VPS_IP> <ROOT_PASSWORD>"
  exit 1
fi

if [ -z "${VPS_DB_PASSWORD:-}" ]; then
  echo "ERROR: VPS_DB_PASSWORD environment variable is not set."
  echo "Set it as a Replit secret before running this script."
  exit 1
fi

if ! command -v sshpass &>/dev/null; then
  echo "Installing sshpass..."
  apt-get install -y sshpass 2>/dev/null || true
fi

SSH="sshpass -p '$VPS_PASS' ssh -o StrictHostKeyChecking=no root@$VPS_IP"

echo "=== Step 1+2: Transfer vps/ to VPS (/root/Agent-spy) ==="
if [ ! -d "$SRC_DIR" ]; then
  echo "ERROR: $SRC_DIR/ nicht gefunden — vom Repo-Root ausführen."
  exit 1
fi
tar czf /tmp/lukas_all.tar.gz -C "$SRC_DIR" .
sshpass -p "$VPS_PASS" scp -o StrictHostKeyChecking=no /tmp/lukas_all.tar.gz root@$VPS_IP:/tmp/
sshpass -p "$VPS_PASS" ssh -o StrictHostKeyChecking=no root@$VPS_IP 'mkdir -p /root/Agent-spy && cd /root/Agent-spy && tar xzf /tmp/lukas_all.tar.gz'
echo "Transferred $(sshpass -p "$VPS_PASS" ssh -o StrictHostKeyChecking=no root@$VPS_IP 'find /root/Agent-spy -type f | wc -l') files"

echo "=== Step 3: Install Python dependencies ==="
sshpass -p "$VPS_PASS" ssh -o StrictHostKeyChecking=no root@$VPS_IP \
  'apt-get install -y python3-pip 2>/dev/null | tail -2 && \
   pip3 install python-dotenv aiohttp requests psycopg2-binary google-generativeai \
   praw "python-telegram-bot>=20" web3 eth-account py-clob-client \
   chromadb sentence-transformers --break-system-packages --ignore-installed 2>&1 | tail -5'

echo "=== Step 4: Rotate Postgres password and write .env file ==="
sshpass -p "$VPS_PASS" ssh -o StrictHostKeyChecking=no root@$VPS_IP \
  "sudo -u postgres psql -c \"ALTER USER lukas PASSWORD '$VPS_DB_PASSWORD';\""
echo "Postgres user 'lukas' password rotated."

sshpass -p "$VPS_PASS" ssh -o StrictHostKeyChecking=no root@$VPS_IP "cat > /root/Agent-spy/.env << ENVEOF
GEMINI_API_KEY=${GEMINI_API_KEY:-}
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID:-}
POLYMARKET_PRIVATE_KEY=${POLYMARKET_PRIVATE_KEY:-}
ANTHROPIC_API_KEY=
DATABASE_URL=postgresql://lukas:${VPS_DB_PASSWORD}@localhost:5432/lukas_db
ENVEOF"
echo ".env written with DATABASE_URL using VPS_DB_PASSWORD secret."

echo "=== Step 5: Generate Polymarket API credentials ==="
sshpass -p "$VPS_PASS" ssh -o StrictHostKeyChecking=no root@$VPS_IP \
  'cd /root/Agent-spy/Polymarket_bot/bot && python3 setup_api_keys.py'

echo "=== Step 6: Copy .env to bot directory ==="
sshpass -p "$VPS_PASS" ssh -o StrictHostKeyChecking=no root@$VPS_IP \
  'cp /root/Agent-spy/.env /root/Agent-spy/Polymarket_bot/bot/.env'

echo "=== Step 7: Install systemd services ==="
sshpass -p "$VPS_PASS" scp -o StrictHostKeyChecking=no \
  scripts/lukas-deploy/install_services.sh root@$VPS_IP:/tmp/install_services.sh
sshpass -p "$VPS_PASS" ssh -o StrictHostKeyChecking=no root@$VPS_IP \
  'bash /tmp/install_services.sh'

echo "=== Step 7b: Deploy DB-backed dashboard (v3) ==="
sshpass -p "$VPS_PASS" scp -o StrictHostKeyChecking=no \
  scripts/lukas-deploy/dashboard_server_db.py \
  root@$VPS_IP:/root/Agent-spy/Polymarket_bot/bot/dashboard/server.py
echo "Dashboard server.py updated to v3 (Postgres-backed)"

echo "=== Step 8: Start all services ==="
sshpass -p "$VPS_PASS" ssh -o StrictHostKeyChecking=no root@$VPS_IP 'bash -s' << 'SSHEOF'
for svc in lukas-telegram lukas-brain lukas-reddit-watcher lukas-bug-reasoner \
           lukas-btc-trader lukas-btc-paper-trader lukas-bot; do
  systemctl enable "$svc" 2>/dev/null
  systemctl start "$svc"
  sleep 1
  echo "$svc: $(systemctl is-active $svc)"
done
SSHEOF

echo ""
echo "=== LUKAS Deployment Complete ==="
echo "VPS: $VPS_IP"
echo "Services: 7 active"
echo "Dashboard: http://$VPS_IP:5002 (open firewall first: ufw allow 5002)"
