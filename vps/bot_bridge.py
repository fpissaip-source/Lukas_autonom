#!/usr/bin/env python3
"""bot_bridge.py — Consolidates Polymarket Bot state files into bridge.json.

Reads the bot's state files (bankroll_state.json, trades.json, live_positions.json)
from the Polymarket_bot directory and writes a unified bridge.json for Lukas to read.

Can be run standalone or imported:
  python3 bot_bridge.py           # one-shot update
  python3 bot_bridge.py --watch   # continuous updates every 30s
"""

import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent
BOT_DIR = BASE_DIR / "Polymarket_bot"
BRIDGE_FILE = BASE_DIR / "bridge.json"
PID_FILE = BASE_DIR / "bot.pid"


def _read_json(path: Path) -> dict | list | None:
    try:
        if path.exists():
            return json.loads(path.read_text())
    except Exception:
        pass
    return None


def _bot_running() -> tuple[bool, int | None]:
    if PID_FILE.exists():
        try:
            pid = int(PID_FILE.read_text().strip())
            os.kill(pid, 0)
            return True, pid
        except (ValueError, ProcessLookupError, PermissionError):
            pass
    return False, None


def _bot_uptime() -> str | None:
    if PID_FILE.exists():
        try:
            start_time = PID_FILE.stat().st_mtime
            seconds = time.time() - start_time
            hours = int(seconds // 3600)
            minutes = int((seconds % 3600) // 60)
            return f"{hours}h {minutes}m"
        except Exception:
            pass
    return None


def update_bridge() -> dict:
    running, pid = _bot_running()

    bankroll_data = _read_json(BOT_DIR / "bankroll_state.json")
    trades_data = _read_json(BOT_DIR / "trades.json")
    positions_data = _read_json(BOT_DIR / "live_positions.json")

    bot_log = BASE_DIR / "bot.log"
    last_error = None
    last_log_lines = []
    if bot_log.exists():
        try:
            lines = bot_log.read_text().strip().split("\n")
            last_log_lines = lines[-10:]
            for line in reversed(lines[-50:]):
                if "error" in line.lower() or "exception" in line.lower():
                    last_error = line.strip()[:200]
                    break
        except Exception:
            pass

    bankroll = None
    if isinstance(bankroll_data, dict):
        bankroll = bankroll_data.get("bankroll") or bankroll_data.get("total_value") or bankroll_data.get("balance")

    last_trades = []
    if isinstance(trades_data, list):
        last_trades = trades_data[-5:]
    elif isinstance(trades_data, dict):
        last_trades = trades_data.get("trades", trades_data.get("recent", []))[-5:]

    open_positions = []
    if isinstance(positions_data, list):
        open_positions = positions_data
    elif isinstance(positions_data, dict):
        open_positions = positions_data.get("positions", positions_data.get("open", []))

    regime = None
    if isinstance(bankroll_data, dict):
        regime = bankroll_data.get("regime") or bankroll_data.get("market_regime")

    bridge = {
        "status": "running" if running else "stopped",
        "pid": pid,
        "uptime": _bot_uptime(),
        "bankroll": bankroll,
        "last_trades": last_trades,
        "open_positions": open_positions,
        "regime": regime,
        "last_error": last_error,
        "last_log_lines": last_log_lines,
        "updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }

    try:
        BRIDGE_FILE.write_text(json.dumps(bridge, indent=2, ensure_ascii=False))
    except Exception as e:
        print(f"[bridge] Write error: {e}")

    return bridge


if __name__ == "__main__":
    if "--watch" in sys.argv:
        print("[bridge] Watching bot state (Ctrl+C to stop)...")
        while True:
            b = update_bridge()
            print(f"[bridge] {b['updated']} | status={b['status']} | bankroll={b['bankroll']}")
            time.sleep(30)
    else:
        b = update_bridge()
        print(json.dumps(b, indent=2, ensure_ascii=False))
