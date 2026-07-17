#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Stopping All Systems ==="
echo ""

echo "--- Stopping Polymarket Bot ---"
bash "$DIR/stop_bot.sh"
echo ""

echo "--- Stopping Lukas Agent ---"
PIDFILE="$DIR/loop.pid"
if [ -f "$PIDFILE" ]; then
    PID=$(cat "$PIDFILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "Stopping Lukas (PID $PID)..."
        kill "$PID"
        sleep 2
        kill -0 "$PID" 2>/dev/null && kill -9 "$PID"
        echo "Lukas stopped."
    else
        echo "Lukas process not running (stale PID file)."
    fi
    rm -f "$PIDFILE"
else
    echo "No Lukas PID file found."
fi
pkill -f "python3.*loop\.py" 2>/dev/null
echo ""

echo "=== All systems stopped ==="
