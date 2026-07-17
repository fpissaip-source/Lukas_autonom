#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
PIDFILE="$DIR/bot.pid"

echo "=== Polymarket Bot Stopper ==="

if [ -f "$PIDFILE" ]; then
    PID=$(cat "$PIDFILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "Stopping bot (PID $PID)..."
        kill "$PID"
        sleep 2
        if kill -0 "$PID" 2>/dev/null; then
            echo "Force killing..."
            kill -9 "$PID"
        fi
        echo "Bot stopped."
    else
        echo "Bot process not running (stale PID file)."
    fi
    rm -f "$PIDFILE"
else
    echo "No PID file found."
fi

pkill -f "python3.*Polymarket_bot.*main\.py" 2>/dev/null
echo "Done."
