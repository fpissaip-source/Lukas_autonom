#!/bin/bash
source ~/.bashrc
cd /home/user/Agent-spy

# Secrets kommen aus /root/Agent-spy/.env (niemals hier hartkodieren!)
set -a; [ -f .env ] && . ./.env; set +a
: "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN fehlt (.env)}"
: "${TELEGRAM_CHAT_ID:?TELEGRAM_CHAT_ID fehlt (.env)}"

# Protect diary and memory from git overwrites
git config merge.ours.driver true 2>/dev/null || true

echo "=== LUKAS STARTET ==="

while true; do
    echo "=== LUKAS AKTIV: $(date) ==="
    python3 agent.py

    # Apply any self-improvement patches Lukas wrote
    python3 patcher.py

    # Auto-sync memories to git
    git add diary.md activity.json core_beliefs.md patches.md 2>/dev/null
    git commit -m "sync: session $(date +%Y-%m-%d-%H%M)" 2>/dev/null || true
    git push origin HEAD:claude/bot-communication-system-eriiT 2>/dev/null || true

    # Dynamic sleep – Lukas decides how long he sleeps
    SLEEP_MIN=30
    if [ -f next_wakeup.txt ]; then
        SLEEP_MIN=$(cat next_wakeup.txt)
    fi
    SLEEP_SEC=$((SLEEP_MIN * 60))
    echo "=== Lukas schläft ${SLEEP_MIN} Min ==="
    # Small delay before clearing wake signal, so rapid /wake commands aren't lost
    sleep 2
    rm -f wake.txt
    ELAPSED=0
    while [ $ELAPSED -lt $SLEEP_SEC ]; do
        sleep 5
        ELAPSED=$((ELAPSED + 5))
        if [ -f wake.txt ]; then
            echo "=== WAKE-UP SIGNAL empfangen – Lukas erwacht früh ==="
            rm -f wake.txt
            break
        fi
    done
done
