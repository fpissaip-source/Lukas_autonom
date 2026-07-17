#!/bin/bash
# install_services.sh — Create all 10 LUKAS systemd service files
# Run on the VPS as root.

set -e

# Ensure PostgreSQL starts automatically after every reboot
echo "Enabling postgresql to start on boot..."
systemctl enable postgresql
echo "postgresql auto-start: enabled"

create_service() {
  local name="$1"
  local desc="$2"
  local workdir="$3"
  local cmd="$4"
  local logfile="$5"

  cat > "/etc/systemd/system/${name}.service" << EOF
[Unit]
Description=${desc}
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=${workdir}
EnvironmentFile=/root/Agent-spy/.env
ExecStart=/usr/bin/python3 -u ${cmd}
Restart=on-failure
RestartSec=30
StandardOutput=append:${logfile}
StandardError=append:${logfile}

[Install]
WantedBy=multi-user.target
EOF
  echo "Created: ${name}.service"
}

create_service "lukas-bot" \
  "LUKAS Polymarket Trading Bot" \
  "/root/Agent-spy/Polymarket_bot" \
  "bot/main.py --live" \
  "/root/Agent-spy/bot.log"

create_service "lukas-brain" \
  "LUKAS Brain Central Intelligence" \
  "/root/Agent-spy" \
  "lukas_brain.py" \
  "/root/Agent-spy/brain.log"

create_service "lukas-btc-trader" \
  "LUKAS BTC 15min Autonomous Trader" \
  "/root/Agent-spy" \
  "btc_15m_trader.py" \
  "/root/Agent-spy/btc_trader.log"

create_service "lukas-btc-paper-trader" \
  "LUKAS BTC 5min Paper Trader" \
  "/root/Agent-spy" \
  "btc_15m_paper_trader.py" \
  "/root/Agent-spy/btc_paper.log"

create_service "lukas-telegram" \
  "LUKAS Telegram Bot Control" \
  "/root/Agent-spy" \
  "telegram_bot.py" \
  "/root/Agent-spy/telegram.log"

create_service "lukas-reddit-watcher" \
  "LUKAS Reddit Polymarket Signal Watcher" \
  "/root/Agent-spy" \
  "reddit_polymarket_watcher.py" \
  "/root/Agent-spy/reddit_watcher.log"

create_service "lukas-bug-reasoner" \
  "LUKAS Autonomous Bug Reasoner" \
  "/root/Agent-spy" \
  "bug_reasoner.py" \
  "/root/Agent-spy/bug_reasoner.log"

create_service "lukas-loss-reasoner" \
  "LUKAS Loss Reasoner Autonomous Diagnosis" \
  "/root/Agent-spy" \
  "loss_reasoner.py" \
  "/root/Agent-spy/loss_reasoner.log"

create_service "lukas-manual-sell-watcher" \
  "LUKAS Manual Sell Position Watcher" \
  "/root/Agent-spy" \
  "manual_sell_watcher.py" \
  "/root/Agent-spy/manual_sell.log"

create_service "lukas-self-heal" \
  "LUKAS Self-Heal Circuit Breaker Supervisor" \
  "/root/Agent-spy" \
  "self_heal_daemon.py" \
  "/root/Agent-spy/self_heal.log"

systemctl daemon-reload
echo ""
echo "All 10 service files installed and daemon reloaded."
ls /etc/systemd/system/lukas-*.service
