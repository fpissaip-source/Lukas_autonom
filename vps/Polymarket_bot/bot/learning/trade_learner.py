"""
Trade Learner — adaptive feedback loop for the Polymarket Gemini bot.

Two responsibilities:

  1. Adaptive thresholds.  Reads recent CLOSED trades from the shared `trades`
     table and computes win-rate + loss-streak.  Exposes `adaptive_min_conf()`
     which raises the Gemini confidence floor when the bot is bleeding.

       win_rate  ≥ 0.55  →  no change
       win_rate  < 0.50  →  +0.03
       win_rate  < 0.40  →  +0.07
       loss_streak ≥ 4   →  +0.05
       loss_streak ≥ 6   →  +0.10
     (additive, capped at +0.15)

  2. Gemini post-mortem.  Once every POSTMORTEM_INTERVAL closes (or 30 min,
     whichever comes first), packages the most recent N closed trades into a
     prompt and asks Gemini for systematic-bias diagnosis + concrete tuning
     suggestions.  The verdict is appended to gemini_postmortems.json so it
     can be surfaced on the dashboard.

The class runs a single daemon thread; everything is best-effort and never
raises into the trading loop.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Any

try:
    import psycopg2
    import psycopg2.extras
except Exception:  # pragma: no cover
    psycopg2 = None

logger = logging.getLogger("polymarket_bot.learner")

POSTMORTEM_INTERVAL = 5             # min closed trades since last post-mortem
POSTMORTEM_MIN_AGE_S = 30 * 60      # at most one Gemini post-mortem per 30 min
RECENT_LIMIT = 20                   # window for win-rate / streak
POSTMORTEM_SAMPLE = 15              # trades fed to Gemini per post-mortem
ADAPTIVE_REFRESH_S = 60             # how often the background loop polls DB
MAX_CONF_BUMP = 0.15

# Output file lives next to gemini_decisions.json
_HERE = Path(__file__).resolve().parent
POSTMORTEM_FILE = _HERE.parent / "gemini_postmortems.json"
ADAPTIVE_STATE_FILE = _HERE.parent / "adaptive_state.json"
POSTMORTEM_KEEP = 40


@dataclass
class TradeOutcome:
    id: int
    market: str
    side: str
    entry: float
    exit: float | None
    pnl: float
    status: str           # win | loss | manual_close
    closed_at: str

    @property
    def is_win(self) -> bool:
        return self.status == "win"

    @property
    def is_loss(self) -> bool:
        return self.status == "loss"


@dataclass
class AdaptiveState:
    win_rate: float = 0.0
    loss_streak: int = 0
    sample: int = 0
    min_conf_bump: float = 0.0
    reason: str = "no data"
    updated_at: float = 0.0
    closes_total: int = 0
    closes_since_postmortem: int = 0
    last_postmortem_ts: float = 0.0


class TradeLearner:
    """Background DB poller + Gemini post-mortem scheduler."""

    def __init__(self, dsn: str | None = None,
                 gemini_client: Any = None, gemini_model: str | None = None):
        self._dsn = dsn or os.environ.get("DATABASE_URL", "")
        self._gemini_client = gemini_client
        self._gemini_model = gemini_model
        self._lock = threading.Lock()
        self._state = AdaptiveState()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        # Bootstrap closes_total from disk so we don't fire post-mortem on every restart
        prev = self._load_persisted_state()
        if prev:
            self._state.closes_total = prev.get("closes_total", 0)
            self._state.last_postmortem_ts = prev.get("last_postmortem_ts", 0.0)

    # --- public API -------------------------------------------------------

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        if not self._dsn:
            logger.warning("[LEARNER] DATABASE_URL not set — adaptive loop disabled")
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._loop, name="trade-learner", daemon=True
        )
        self._thread.start()
        logger.info("[LEARNER] background loop started")

    def stop(self):
        self._stop.set()

    def attach_gemini(self, client: Any, model: str):
        """Late-binding hook: bot can pass its initialized Gemini client."""
        with self._lock:
            self._gemini_client = client
            self._gemini_model = model

    def adaptive_min_conf(self, base: float) -> float:
        """Returns base GEMINI_MIN_CONFIDENCE plus the adaptive bump."""
        with self._lock:
            return min(0.99, base + self._state.min_conf_bump)

    def get_state(self) -> dict[str, Any]:
        with self._lock:
            return asdict(self._state)

    # --- internals --------------------------------------------------------

    def _loop(self):
        # tiny delay so the main bot finishes booting first
        time.sleep(5)
        while not self._stop.is_set():
            try:
                self._refresh()
            except Exception as e:
                logger.warning(f"[LEARNER] refresh failed: {e}")
            self._stop.wait(ADAPTIVE_REFRESH_S)

    def _refresh(self):
        outcomes = self._fetch_recent(RECENT_LIMIT)
        prev_total = self._state.closes_total
        # closes_total = total resolved (win+loss) ever seen
        closes_total = self._fetch_resolved_count()
        new_closes = max(0, closes_total - prev_total)

        # --- compute adaptive bump ---
        resolved = [o for o in outcomes if o.is_win or o.is_loss]
        wins = sum(1 for o in resolved if o.is_win)
        losses = sum(1 for o in resolved if o.is_loss)
        sample = len(resolved)
        wr = (wins / sample) if sample else 0.0
        # loss streak = leading losses in chronologically-newest-first list
        streak = 0
        for o in resolved:
            if o.is_loss:
                streak += 1
            else:
                break

        bump = 0.0
        reasons = []
        if sample >= 5:
            if wr < 0.40:
                bump += 0.07; reasons.append(f"WR={wr:.0%}<40%")
            elif wr < 0.50:
                bump += 0.03; reasons.append(f"WR={wr:.0%}<50%")
            if streak >= 6:
                bump += 0.10; reasons.append(f"streak={streak}≥6")
            elif streak >= 4:
                bump += 0.05; reasons.append(f"streak={streak}≥4")
        bump = min(bump, MAX_CONF_BUMP)
        reason = " + ".join(reasons) if reasons else "healthy"

        with self._lock:
            self._state.win_rate = wr
            self._state.loss_streak = streak
            self._state.sample = sample
            self._state.min_conf_bump = bump
            self._state.reason = reason
            self._state.updated_at = time.time()
            self._state.closes_total = closes_total
            self._state.closes_since_postmortem += new_closes

        # persist for restart resilience
        try:
            ADAPTIVE_STATE_FILE.write_text(json.dumps(self.get_state(), indent=2))
        except Exception:
            pass

        if bump > 0:
            logger.info(
                f"[LEARNER] adaptive_bump=+{bump:.2f} ({reason}) "
                f"WR={wr:.0%} streak={streak} sample={sample}"
            )

        # --- post-mortem cadence ---
        now = time.time()
        cooled = (now - self._state.last_postmortem_ts) >= POSTMORTEM_MIN_AGE_S
        enough_closes = self._state.closes_since_postmortem >= POSTMORTEM_INTERVAL
        if cooled and enough_closes and self._gemini_client and outcomes:
            try:
                verdict = self._gemini_post_mortem(outcomes[:POSTMORTEM_SAMPLE])
                if verdict:
                    self._append_postmortem(verdict)
                    with self._lock:
                        self._state.closes_since_postmortem = 0
                        self._state.last_postmortem_ts = now
            except Exception as e:
                logger.warning(f"[LEARNER] post-mortem failed: {e}")

    def _fetch_recent(self, n: int) -> list[TradeOutcome]:
        if psycopg2 is None or not self._dsn:
            return []
        try:
            with psycopg2.connect(self._dsn, connect_timeout=5) as c:
                with c.cursor() as cur:
                    cur.execute(
                        """
                        SELECT id, market_question, side,
                               entry_price, exit_price, pnl,
                               status, closed_at
                        FROM trades
                        WHERE bot = 'polymarket'
                          AND status IN ('win', 'loss')
                          AND closed_at IS NOT NULL
                        ORDER BY closed_at DESC
                        LIMIT %s
                        """,
                        (n,),
                    )
                    rows = cur.fetchall()
        except Exception as e:
            logger.warning(f"[LEARNER] fetch failed: {e}")
            return []
        out = []
        for r in rows:
            try:
                out.append(TradeOutcome(
                    id=r[0],
                    market=(r[1] or "?")[:120],
                    side=r[2] or "?",
                    entry=float(r[3]) if r[3] is not None else 0.0,
                    exit=float(r[4]) if r[4] is not None else None,
                    pnl=float(r[5]) if r[5] is not None else 0.0,
                    status=r[6] or "?",
                    closed_at=r[7].isoformat() if r[7] else "",
                ))
            except Exception:
                continue
        return out

    def _fetch_resolved_count(self) -> int:
        if psycopg2 is None or not self._dsn:
            return 0
        try:
            with psycopg2.connect(self._dsn, connect_timeout=5) as c:
                with c.cursor() as cur:
                    cur.execute(
                        "SELECT count(*) FROM trades "
                        "WHERE bot='polymarket' AND status IN ('win','loss')"
                    )
                    return int(cur.fetchone()[0])
        except Exception:
            return 0

    # --- Gemini post-mortem -----------------------------------------------

    def _gemini_post_mortem(self, outcomes: list[TradeOutcome]) -> dict | None:
        client = self._gemini_client
        model = self._gemini_model
        if not client or not model:
            return None

        wins = [o for o in outcomes if o.is_win]
        losses = [o for o in outcomes if o.is_loss]
        wr = len(wins) / len(outcomes) if outcomes else 0.0
        net = sum(o.pnl for o in outcomes)

        lines = []
        for o in outcomes:
            tag = "WIN " if o.is_win else "LOSS"
            exit_s = f"{o.exit:.3f}" if o.exit is not None else "—"
            lines.append(
                f"  [{tag}] {o.side} @ {o.entry:.3f} → {exit_s}  "
                f"pnl={o.pnl:+.2f}  | {o.market}"
            )
        trades_block = "\n".join(lines)

        prompt = f"""You are reviewing closed trades from a Polymarket bot whose
probability estimates come from YOU (Gemini).  Find systematic biases and
suggest concrete adjustments.

Recent {len(outcomes)} resolved trades:
- Wins: {len(wins)}   Losses: {len(losses)}   WinRate: {wr:.0%}   Net PnL: ${net:+.2f}

Trade list (newest first):
{trades_block}

Diagnose in JSON only, this exact schema:
{{
  "diagnosis": "one paragraph: what bias do you see? overconfidence, wrong category, side bias, etc.",
  "worst_pattern": "the single most damaging pattern across the losses",
  "suggested_min_conf_bump": 0.0,           // additional GEMINI_MIN_CONFIDENCE bump 0.00–0.15
  "avoid_market_keywords": ["..."],         // keywords in market_question to skip until further notice
  "confidence_in_diagnosis": 0.0            // 0–1 how sure are you
}}

Output ONLY the JSON object, no prose, no markdown fences."""

        try:
            resp = client.models.generate_content(
                model=model,
                contents=prompt,
            )
            text = (resp.text or "").strip()
        except Exception as e:
            logger.warning(f"[LEARNER] Gemini call failed: {e}")
            return None

        # strip ```json fences if Gemini snuck them in
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:].lstrip()
            text = text.rstrip("`").strip()

        try:
            data = json.loads(text)
        except Exception as e:
            logger.warning(f"[LEARNER] post-mortem JSON parse failed: {e} | raw={text[:200]}")
            return None

        record = {
            "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
            "sample_size": len(outcomes),
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": round(wr, 3),
            "net_pnl": round(net, 2),
            "diagnosis": str(data.get("diagnosis", ""))[:1000],
            "worst_pattern": str(data.get("worst_pattern", ""))[:500],
            "suggested_min_conf_bump": float(data.get("suggested_min_conf_bump", 0.0) or 0.0),
            "avoid_market_keywords": [str(k)[:80] for k in (data.get("avoid_market_keywords") or [])][:10],
            "confidence_in_diagnosis": float(data.get("confidence_in_diagnosis", 0.0) or 0.0),
        }
        logger.info(
            f"[LEARNER] post-mortem: WR={wr:.0%} N={len(outcomes)} "
            f"diagnosis={record['diagnosis'][:80]}…"
        )
        return record

    def _append_postmortem(self, record: dict):
        try:
            existing = []
            if POSTMORTEM_FILE.exists():
                try:
                    existing = json.loads(POSTMORTEM_FILE.read_text())
                    if not isinstance(existing, list):
                        existing = []
                except Exception:
                    existing = []
            existing.append(record)
            existing = existing[-POSTMORTEM_KEEP:]
            POSTMORTEM_FILE.write_text(json.dumps(existing, indent=2))
        except Exception as e:
            logger.warning(f"[LEARNER] persist post-mortem failed: {e}")

    def _load_persisted_state(self) -> dict | None:
        try:
            if ADAPTIVE_STATE_FILE.exists():
                return json.loads(ADAPTIVE_STATE_FILE.read_text())
        except Exception:
            pass
        return None
