#!/usr/bin/env python3
"""
patch_bot_speed.py — idempotent in-place patcher that wires the Task #65
speedup module into the live VPS bot.

Run on VPS:
    python3 patch_bot_speed.py

Adds three minimal hooks to /root/Agent-spy/Polymarket_bot/bot/trading/bot.py:
    1. import bot.trading._speedup at module top
    2. _speedup.init_for_bot(self) at the end of Bot.__init__
    3. _speedup.on_markets_refreshed(self) at the end of _refresh_markets

All patches are gated by sentinel strings so re-running is safe.
"""
from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

BOT_PY = Path("/root/Agent-spy/Polymarket_bot/bot/trading/bot.py")

SENTINEL_IMPORT = "# PATCH-65-SPEEDUP-IMPORT-V1"
SENTINEL_INIT = "# PATCH-65-SPEEDUP-INIT-V1"
SENTINEL_REFRESH = "# PATCH-65-SPEEDUP-REFRESH-V1"


def patch() -> int:
    if not BOT_PY.exists():
        print(f"FATAL: {BOT_PY} not found")
        return 2
    src = BOT_PY.read_text()
    orig = src
    changes: list[str] = []

    # ---------- 1) module-top import ---------------------------------------
    if SENTINEL_IMPORT not in src:
        # Insert after the existing reality import (line ~55-ish in current file).
        # Fall back to "from . import reality" or to the first 'from .' import.
        # Match the actual import style used in this bot.py (no `bot.` prefix).
        anchors = [
            ("from trading import reality", "from trading import _speedup as _speedup"),
            ("from bot.trading import reality", "from bot.trading import _speedup as _speedup"),
            ("from . import reality", "from . import _speedup as _speedup"),
        ]
        inserted = False
        for needle, new_import in anchors:
            if needle in src:
                src = src.replace(
                    needle,
                    needle + f"\n{new_import}  {SENTINEL_IMPORT}",
                    1,
                )
                inserted = True
                break
        if not inserted:
            print("WARN: no reality-import anchor found; refusing to fall back to class-position insertion")
        if inserted:
            changes.append("import")
        else:
            print("WARN: could not insert speedup import")

    # ---------- 2) startup hook in run() -----------------------------------
    if SENTINEL_INIT not in src:
        # Hook at the start of Bot.run() — markets are populated in
        # __init__ via _refresh_markets, so init_for_bot can already enumerate
        # them. Find:   def run(self):\n        ...
        m = re.search(r"^(    def run\(self.*?:\n)", src, flags=re.M)
        if m:
            insert_at = m.end()
            hook = (
                "        try:\n"
                "            _speedup.init_for_bot(self)\n"
                f"        except Exception as _e:  {SENTINEL_INIT}\n"
                "            import logging as _l; _l.getLogger(__name__).warning(f\"[SPEEDUP] init failed: {_e}\")\n"
            )
            src = src[:insert_at] + hook + src[insert_at:]
            changes.append("run-init")
        else:
            print("WARN: could not locate `def run(self):` for startup hook")

    # ---------- 3) refresh hook --------------------------------------------
    if SENTINEL_REFRESH not in src:
        # Find `def _refresh_markets(self, now: float):` body. We append the
        # hook by replacing the next blank line that ends the method, but
        # safer: insert immediately after the def-line's first executable
        # statement using a targeted regex on the def itself, then append at
        # the end of the method body.  Simplest reliable approach: insert at
        # the START of _refresh_markets so even partial refreshes get hooked.
        m = re.search(r"^(    def _refresh_markets\(self.*?:\n)", src, flags=re.M)
        if m:
            insert_at = m.end()
            hook = (
                "        try:\n"
                "            _speedup.on_markets_refreshed(self)\n"
                f"        except Exception:  {SENTINEL_REFRESH}\n"
                "            pass\n"
            )
            # We want this AT THE END of the method, not the start, so the
            # newly registered markets are available. Find the next line
            # at indent <= 4 spaces (next def or class) and insert before it.
            tail_match = re.search(
                r"\n(    def |class |\Z)",
                src[insert_at:],
            )
            if tail_match:
                end_pos = insert_at + tail_match.start() + 1  # keep the newline
                src = src[:end_pos] + hook + src[end_pos:]
                changes.append("refresh-end")
            else:
                src = src[:insert_at] + hook + src[insert_at:]
                changes.append("refresh-start")
        else:
            print("WARN: could not locate `def _refresh_markets(`")

    if src == orig:
        print("Already patched. Nothing to do.")
        return 0

    backup = BOT_PY.with_suffix(".py.bak-task65-speed")
    if not backup.exists():
        shutil.copy2(BOT_PY, backup)
        print(f"Backed up original to {backup}")
    BOT_PY.write_text(src)
    print(f"Patched bot.py. Applied: {', '.join(changes)}")
    return 0


if __name__ == "__main__":
    sys.exit(patch())
