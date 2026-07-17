#!/usr/bin/env python3
"""
patch_bot_reality.py — wires Polymarket bot reality awareness (Task #64)

Edits /root/Agent-spy/Polymarket_bot/bot/trading/bot.py in place to:

  1. Import the new `trading.reality` module (right next to other trading imports).
  2. Initialize `self._last_reality_sync = 0.0` in __init__.
  3. Run `reality.tick(self)` once per 60s from the top of `_tick()`.
  4. Append a `record_event(...)` call at every force-close log site:
       - `[FORCE_PURGE]` at ~line 913
       - the unified `[{reason}]` log at ~line 1046 (covers STOP_LOSS,
         CATASTROPHIC_SL, TAKE_PROFIT, MAX_HOLD, PRE_EXPIRY)
       - `Accepting full loss of $X` at ~line 1142

Idempotent: every patch checks for a marker comment before applying. Re-running
the script is a safe no-op. A timestamped backup is created on first run.
"""
from __future__ import annotations

import re
import shutil
import sys
import time
from pathlib import Path

BOT_FILE = Path("/root/Agent-spy/Polymarket_bot/bot/trading/bot.py")
MARKER_IMPORT     = "# REALITY_TASK_64: import"
MARKER_INIT       = "# REALITY_TASK_64: init"
MARKER_TICK       = "# REALITY_TASK_64: tick"
MARKER_FORCE_PURGE = "# REALITY_TASK_64: force_purge"
MARKER_REASON     = "# REALITY_TASK_64: reason_event"
MARKER_FULL_LOSS  = "# REALITY_TASK_64: full_loss"


def _backup(path: Path) -> Path:
    bak = path.with_suffix(path.suffix + f".bak.reality_{int(time.time())}")
    shutil.copy2(path, bak)
    return bak


def patch(text: str) -> tuple[str, list[str]]:
    notes: list[str] = []

    # --- 1. Import --------------------------------------------------------
    if MARKER_IMPORT not in text:
        # Insert right after the existing "from trading import db_writer" line.
        pattern = r"(from trading import db_writer\n)"
        repl = r"\1from trading import reality  " + MARKER_IMPORT + "\n"
        new, n = re.subn(pattern, repl, text, count=1)
        if n == 0:
            notes.append("WARN: could not find 'from trading import db_writer' — skipping import patch")
        else:
            text = new
            notes.append("OK: import inserted")
    else:
        notes.append("SKIP: import marker already present")

    # --- 2. __init__ field -----------------------------------------------
    if MARKER_INIT not in text:
        pattern = r"(\n        self\._last_allowance_refresh = 0\.0\n)"
        repl = r"\1        self._last_reality_sync = 0.0  " + MARKER_INIT + "\n"
        new, n = re.subn(pattern, repl, text, count=1)
        if n == 0:
            notes.append("WARN: could not find _last_allowance_refresh init — skipping init patch")
        else:
            text = new
            notes.append("OK: __init__ field inserted")
    else:
        notes.append("SKIP: init marker already present")

    # --- 3. _tick() periodic call ----------------------------------------
    if MARKER_TICK not in text:
        # Insert immediately after `self._tick_count += 1` so it runs early
        # but after basic bookkeeping. Wrap in try/except — telemetry must
        # never break the trade loop.
        pattern = r"(\n        self\._tick_count \+= 1\n)"
        block = (
            "        try:\n"
            "            if now - self._last_reality_sync >= 60:\n"
            "                self._last_reality_sync = now\n"
            "                reality.tick(self)\n"
            "        except Exception as _re:\n"
            "            logger.debug(f\"reality.tick swallowed: {_re}\")\n"
        )
        repl = r"\1" + block + "        " + MARKER_TICK + "\n"
        new, n = re.subn(pattern, repl, text, count=1)
        if n == 0:
            notes.append("WARN: could not find _tick_count increment — skipping tick patch")
        else:
            text = new
            notes.append("OK: _tick() periodic call inserted")
    else:
        notes.append("SKIP: tick marker already present")

    # --- 4a. FORCE_PURGE event log (~line 913) ---------------------------
    if MARKER_FORCE_PURGE not in text:
        # The exact f-string we hook on (single occurrence in file).
        pattern = r'(logger\.warning\(\s*\n\s+f"\[FORCE_PURGE\] \{market_id\} order=\{order_id\[:8\]\} — "\s*\n\s+f"book data error \(\{e\}\), "\s*\n\s+f"\{\'unknown expiry\' if end_time == 0 else f\'\{time_to_expiry:\.0f\}s left\'\}, "\s*\n\s+f"releasing \$\{entry_size:\.2f\}"\s*\n\s+\)\n)'
        block = (
            "                    try:\n"
            "                        reality.record_event(\"FORCE_PURGE\", market_id, {\n"
            "                            \"order_id\": order_id[:12],\n"
            "                            \"reason\": f\"book_data_error:{e}\",\n"
            "                            \"cost_basis\": float(entry_size),\n"
            "                            \"pnl_usd\": -float(entry_size),\n"
            "                            \"time_to_expiry_secs\": float(time_to_expiry) if end_time else None,\n"
            "                        })\n"
            "                    except Exception:\n"
            "                        pass\n"
            "                    " + MARKER_FORCE_PURGE + "\n"
        )
        new, n = re.subn(pattern, r"\1" + block, text, count=1)
        if n == 0:
            notes.append("WARN: could not match FORCE_PURGE log site — skipping")
        else:
            text = new
            notes.append("OK: FORCE_PURGE event hook inserted")
    else:
        notes.append("SKIP: force_purge marker already present")

    # --- 4b. Unified reason log (~line 1046) -----------------------------
    if MARKER_REASON not in text:
        # The block looks like:
        #   if reason:
        #       logger.info(
        #           f"[{reason}] {market_id} order={order_id[:8]} "
        #           f"entry={entry_price:.4f} now={current_price:.4f} pnl={pnl_ratio:+.1%} "
        #           f"| {shares:.2f} shares | value=${current_value:.2f}"
        #       )
        pattern = r'(if reason:\n\s+logger\.info\(\s*\n\s+f"\[\{reason\}\] \{market_id\} order=\{order_id\[:8\]\} "\s*\n\s+f"entry=\{entry_price:\.4f\} now=\{current_price:\.4f\} pnl=\{pnl_ratio:\+\.1%\} "\s*\n\s+f"\| \{shares:\.2f\} shares \| value=\$\{current_value:\.2f\}"\s*\n\s+\)\n)'
        block = (
            "                try:\n"
            "                    _kind = (reason.split(\"(\")[0] or \"UNKNOWN\").strip()\n"
            "                    reality.record_event(_kind, market_id, {\n"
            "                        \"order_id\": order_id[:12],\n"
            "                        \"reason\": reason,\n"
            "                        \"entry_price\": float(entry_price),\n"
            "                        \"exit_price\": float(current_price),\n"
            "                        \"pnl_ratio\": float(pnl_ratio),\n"
            "                        \"pnl_usd\": float(current_value - entry_size),\n"
            "                        \"shares\": float(shares),\n"
            "                        \"cost_basis\": float(entry_size),\n"
            "                        \"current_value\": float(current_value),\n"
            "                    })\n"
            "                except Exception:\n"
            "                    pass\n"
            "                " + MARKER_REASON + "\n"
        )
        new, n = re.subn(pattern, r"\1" + block, text, count=1)
        if n == 0:
            notes.append("WARN: could not match unified reason log — skipping")
        else:
            text = new
            notes.append("OK: reason event hook inserted")
    else:
        notes.append("SKIP: reason marker already present")

    # --- 4c. Accepting full loss (~line 1142) ----------------------------
    if MARKER_FULL_LOSS not in text:
        # The f-string contains "Accepting full loss of $". Grep showed it ends
        # with `.")\n`. We anchor on that distinctive phrase.
        pattern = r'(f"\(no liquidity, expired as loser\)\. Accepting full loss of \$\{entry_size:\.2f\}\."\s*\n\s+\)\n)'
        block = (
            "                    try:\n"
            "                        reality.record_event(\"ACCEPT_FULL_LOSS\", market_id, {\n"
            "                            \"order_id\": order_id[:12],\n"
            "                            \"reason\": \"no_liquidity_expired_loser\",\n"
            "                            \"cost_basis\": float(entry_size),\n"
            "                            \"pnl_usd\": -float(entry_size),\n"
            "                        })\n"
            "                    except Exception:\n"
            "                        pass\n"
            "                    " + MARKER_FULL_LOSS + "\n"
        )
        new, n = re.subn(pattern, r"\1" + block, text, count=1)
        if n == 0:
            notes.append("WARN: could not match 'Accepting full loss' log — skipping")
        else:
            text = new
            notes.append("OK: ACCEPT_FULL_LOSS event hook inserted")
    else:
        notes.append("SKIP: full_loss marker already present")

    return text, notes


def main() -> int:
    if not BOT_FILE.exists():
        print(f"ERROR: {BOT_FILE} not found")
        return 1

    original = BOT_FILE.read_text()
    patched, notes = patch(original)

    print("=== patch report ===")
    for n in notes:
        print(" ", n)

    if patched == original:
        print("=== no changes — already fully patched ===")
        return 0

    bak = _backup(BOT_FILE)
    print(f"=== backup: {bak} ===")

    BOT_FILE.write_text(patched)
    print(f"=== wrote {BOT_FILE} ({len(patched)} bytes) ===")

    # Compile-check so we never deploy syntactically broken bot.py
    import py_compile
    try:
        py_compile.compile(str(BOT_FILE), doraise=True)
        print("=== syntax OK ===")
    except py_compile.PyCompileError as e:
        print(f"!!! SYNTAX ERROR — rolling back !!!\n{e}")
        shutil.copy2(bak, BOT_FILE)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
