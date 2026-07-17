#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Starting All Systems ==="
echo ""

echo "--- Starting Lukas Agent ---"
bash "$DIR/start_lukas.sh"
echo ""

sleep 2

echo "--- Starting Polymarket Bot ---"
bash "$DIR/start_bot.sh"
echo ""

echo "=== All systems started ==="
echo "Lukas log: tail -f $DIR/lukas.log"
echo "Bot log:   tail -f $DIR/bot.log"
