#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
BOT_DIR="$DIR/Polymarket_bot"
PIDFILE="$DIR/bot.pid"
LOGFILE="$DIR/bot.log"
REPO="https://github.com/fpissaip-source/Polymarket_bot.git"
BRANCH="claude/add-image-DPsfj"

echo "=== Polymarket Bot Starter ==="

if [ -f "$PIDFILE" ]; then
    OLD_PID=$(cat "$PIDFILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "Stopping old bot (PID $OLD_PID)..."
        kill "$OLD_PID"
        sleep 2
        kill -0 "$OLD_PID" 2>/dev/null && kill -9 "$OLD_PID"
    fi
    rm -f "$PIDFILE"
fi

pkill -f "python3.*Polymarket_bot.*main\.py" 2>/dev/null
sleep 1

if [ ! -d "$BOT_DIR" ]; then
    echo "Cloning Polymarket_bot repo..."
    git clone -b "$BRANCH" "$REPO" "$BOT_DIR"
    if [ $? -ne 0 ]; then
        echo "ERROR: git clone failed"
        exit 1
    fi
else
    echo "Updating Polymarket_bot repo..."
    cd "$BOT_DIR"
    git stash 2>/dev/null
    git pull origin "$BRANCH" 2>/dev/null
    cd "$DIR"
fi

if [ -f "$BOT_DIR/requirements.txt" ]; then
    echo "Installing Python dependencies..."
    pip3 install -q -r "$BOT_DIR/requirements.txt" 2>/dev/null
fi

set -a
source "$DIR/.env"
set +a

echo "Starting Polymarket Bot..."
export PYTHONUNBUFFERED=1
nohup python3 -u "$BOT_DIR/bot/main.py" --live >> "$LOGFILE" 2>&1 &
NEW_PID=$!
disown $NEW_PID
echo "$NEW_PID" > "$PIDFILE"

sleep 2
if kill -0 "$NEW_PID" 2>/dev/null; then
    echo "Polymarket Bot running! PID=$NEW_PID"
    echo "Log: tail -f $LOGFILE"
else
    echo "ERROR: Bot process died immediately. Check $LOGFILE"
    rm -f "$PIDFILE"
    exit 1
fi
