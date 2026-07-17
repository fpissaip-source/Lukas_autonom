#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
PIDFILE="$DIR/loop.pid"
LOGFILE="$DIR/lukas.log"

echo "=== Lukas Starter ==="

if [ -f "$PIDFILE" ]; then
    OLD_PID=$(cat "$PIDFILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "Stopping old loop (PID $OLD_PID)..."
        kill "$OLD_PID"
        sleep 2
        kill -0 "$OLD_PID" 2>/dev/null && kill -9 "$OLD_PID"
    fi
    rm -f "$PIDFILE"
fi

pkill -f "python3.*loop\.py" 2>/dev/null
sleep 2

set -a
source "$DIR/.env"
set +a

echo "Starting Lukas loop..."
export PYTHONUNBUFFERED=1
nohup python3 -u "$DIR/loop.py" >> "$LOGFILE" 2>&1 &
NEW_PID=$!
disown $NEW_PID

sleep 1
if kill -0 "$NEW_PID" 2>/dev/null; then
    echo "Lukas running! PID=$NEW_PID"
    echo "Log: tail -f $LOGFILE"
else
    echo "ERROR: Process died immediately. Check $LOGFILE"
fi
