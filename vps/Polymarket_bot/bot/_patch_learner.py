#!/usr/bin/env python3
"""
Idempotent patcher: wires TradeLearner into bot.py.

Three minimal edits:
  1. Add `from learning.trade_learner import TradeLearner` near other imports.
  2. In Bot.__init__, instantiate `self._learner = TradeLearner(...); self._learner.start()`
     and attach Gemini once event_sentiment is up.
  3. Replace the GEMINI_MIN_CONFIDENCE comparison with the adaptive value.

Re-running is safe: each edit checks for a sentinel marker.
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

BOT = Path("/root/Agent-spy/Polymarket_bot/bot/trading/bot.py")

if not BOT.exists():
    print(f"FAIL: {BOT} not found")
    sys.exit(2)

src = BOT.read_text()
orig = src
edits: list[str] = []

# --- 1. Import ----------------------------------------------------------
if "from learning.trade_learner import TradeLearner" not in src:
    # Insert after the first block of "from data..." or "from trading..." imports
    m = re.search(r"^(from data\.[^\n]+\n)", src, flags=re.MULTILINE)
    if not m:
        m = re.search(r"^(from trading\.[^\n]+\n)", src, flags=re.MULTILINE)
    if not m:
        print("FAIL: could not find anchor for import")
        sys.exit(3)
    inject = "from learning.trade_learner import TradeLearner  # adaptive feedback\n"
    src = src[: m.start()] + inject + src[m.start():]
    edits.append("import added")

# --- 2. Instantiate + start in __init__ ---------------------------------
if "self._learner = TradeLearner" not in src:
    # Anchor: right after self.event_sentiment is built (it has a Gemini client we can borrow)
    m = re.search(
        r"(self\.event_sentiment\s*=\s*EventSentimentAnalyzer\(\)[^\n]*\n)",
        src,
    )
    if not m:
        print("FAIL: could not find self.event_sentiment = EventSentimentAnalyzer() anchor")
        sys.exit(4)
    inject = (
        "        # --- adaptive feedback loop (post-mortem + dynamic min_conf) ---\n"
        "        try:\n"
        "            self._learner = TradeLearner()\n"
        "            if getattr(self.event_sentiment, '_enabled', False):\n"
        "                self._learner.attach_gemini(\n"
        "                    getattr(self.event_sentiment, '_client', None),\n"
        "                    getattr(self.event_sentiment, '_model', None),\n"
        "                )\n"
        "            self._learner.start()\n"
        "        except Exception as _e:\n"
        "            import logging as _lg\n"
        "            _lg.getLogger(__name__).warning(f'[LEARNER] init failed: {_e}')\n"
        "            self._learner = None\n"
    )
    src = src[: m.end()] + inject + src[m.end():]
    edits.append("learner instantiated")

# --- 3. Replace GEMINI_MIN_CONFIDENCE check -----------------------------
# Only the gate check; leave the log-line constant alone for clarity.
sentinel = "# adaptive_min_conf"
if sentinel not in src:
    # Replace the precise comparison line. Whitespace-tolerant match.
    pat = re.compile(
        r"(if\s+gemini_conf\s*<\s*)GEMINI_MIN_CONFIDENCE(\s*:)"
    )
    new_src, n = pat.subn(
        r"\1(self._learner.adaptive_min_conf(GEMINI_MIN_CONFIDENCE) "
        r"if getattr(self, '_learner', None) else GEMINI_MIN_CONFIDENCE)\2  "
        + sentinel,
        src,
        count=1,
    )
    if n == 0:
        print("FAIL: could not find gemini_conf < GEMINI_MIN_CONFIDENCE comparison")
        sys.exit(5)
    src = new_src
    edits.append(f"adaptive conf gate wired ({n} replacement)")

if src == orig:
    print("OK: bot.py already patched, no changes")
    sys.exit(0)

# Backup once
backup = BOT.with_suffix(".py.pre_learner.bak")
if not backup.exists():
    backup.write_text(orig)
    print(f"backup → {backup}")

BOT.write_text(src)
print("PATCHED:", " | ".join(edits))
