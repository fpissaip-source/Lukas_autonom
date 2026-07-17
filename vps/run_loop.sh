#!/bin/bash
# run_loop.sh — Lukas always-on auto-restart wrapper
# Usage: nohup bash /home/user/Agent-spy/run_loop.sh > /tmp/lukas_loop.log 2>&1 &

# Resolve script directory so this works from any working directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

while true; do
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting loop.py..."
    python3 loop.py
    EXIT_CODE=$?

    # Exit code 0 means /stop was called intentionally → do NOT restart
    if [ $EXIT_CODE -eq 0 ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] loop.py stopped cleanly (exit 0). Exiting."
        break
    fi

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] loop.py crashed (exit $EXIT_CODE). Restarting in 15s..."
    sleep 15
done
