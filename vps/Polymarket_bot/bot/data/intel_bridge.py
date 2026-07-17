"""
Intel-Bridge for the Polymarket bot.

Cross-references each event-market evaluation against two intel sources that
the rest of the Lukas system has been quietly accumulating:

  • reddit_signals     — written by lukas-reddit-watcher (Gemini-analysed posts
                         from r/polymarket_bets, last 48h, is_signal=true,
                         confidence >= 0.5)
  • moltbook_posts     — written by the Lukas observer agent (last 48h)

For every market the bot considers, this module returns a ``MarketIntel``
summary describing how many signals reference the market, whether they align
with the trade direction the bot is leaning toward, and an optional confidence
adjustment.  By default the adjustment is logged but NOT applied: enable it via
``REDDIT_SIGNAL_BOOST_ENABLED=1``.

Every check is logged to ``bot_intel_log`` for later analysis (alignment vs.
realised PnL).  The schema is created lazily on first import.
"""
from __future__ import annotations

import os
import re
import json
import time
import logging
import threading
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── config ───────────────────────────────────────────────────────────────
INTEL_LOOKBACK_HOURS    = int(os.environ.get("INTEL_LOOKBACK_HOURS",   "48"))
INTEL_REDDIT_MIN_CONF   = float(os.environ.get("INTEL_REDDIT_MIN_CONF","0.50"))
INTEL_BOOST_ENABLED     = os.environ.get("REDDIT_SIGNAL_BOOST_ENABLED","").lower() in ("1","true","yes")
INTEL_MAX_BOOST         = float(os.environ.get("INTEL_MAX_BOOST",      "0.03"))  # ±3% q-shift
INTEL_MIN_WORD_OVERLAP  = int(os.environ.get("INTEL_MIN_WORD_OVERLAP", "2"))
INTEL_STOPWORDS = set("""
the a an of to in on for by from with about as at this that these those is are was were be been being
do does did has have had will would shall should can could may might must not no yes and or but if then
how what when where who why which whose whom polymarket market bet bets prediction predictions price
trader traders trading bot bots account accounts user users post posts thread threads sub r reddit com
www https http
""".split())

# ── connection (lazy, thread-safe singleton) ─────────────────────────────
_conn = None
_conn_lock = threading.Lock()

def _get_conn():
    """Return a live psycopg2 connection (autocommit, lazy, reconnecting)."""
    global _conn
    with _conn_lock:
        try:
            if _conn is not None and not _conn.closed:
                # cheap ping
                with _conn.cursor() as c:
                    c.execute("SELECT 1")
                return _conn
        except Exception:
            try: _conn.close()
            except Exception: pass
            _conn = None
        import psycopg2
        dsn = os.environ.get("DATABASE_URL", "")
        if not dsn:
            raise RuntimeError("DATABASE_URL not set — cannot use intel_bridge")
        _conn = psycopg2.connect(dsn)
        _conn.autocommit = True
        return _conn

# ── schema (idempotent) ──────────────────────────────────────────────────
_schema_initialised = False

def _ensure_schema():
    global _schema_initialised
    if _schema_initialised:
        return
    try:
        with _get_conn().cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS bot_intel_log (
                    id              SERIAL PRIMARY KEY,
                    market_id       TEXT NOT NULL,
                    question        TEXT,
                    checked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
                    reddit_count    INT NOT NULL DEFAULT 0,
                    moltbook_count  INT NOT NULL DEFAULT 0,
                    aligned_yes     INT NOT NULL DEFAULT 0,
                    aligned_no      INT NOT NULL DEFAULT 0,
                    insider_count   INT NOT NULL DEFAULT 0,
                    boost_applied   NUMERIC(5,4) NOT NULL DEFAULT 0,
                    boost_recommend NUMERIC(5,4) NOT NULL DEFAULT 0,
                    gemini_q        NUMERIC(5,4),
                    gemini_conf     NUMERIC(5,4),
                    market_p        NUMERIC(5,4),
                    edge_ev         NUMERIC(7,4),
                    matched_signal_ids INT[],
                    matched_post_ids   INT[],
                    notes           TEXT
                )
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_bot_intel_log_time
                    ON bot_intel_log (checked_at DESC)
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_bot_intel_log_market
                    ON bot_intel_log (market_id, checked_at DESC)
            """)
        _schema_initialised = True
    except Exception as e:
        logger.warning(f"[intel_bridge] schema init failed (non-fatal): {e}")

# ── fuzzy matching ───────────────────────────────────────────────────────
def _tokenise(s: str) -> set:
    """Lowercase alphanumeric tokens, length >=4, minus stopwords."""
    if not s:
        return set()
    words = re.findall(r"[a-zA-Z0-9]+", s.lower())
    return {w for w in words if len(w) >= 4 and w not in INTEL_STOPWORDS}

def _overlap(question_tokens: set, candidate_text: str) -> int:
    return len(question_tokens & _tokenise(candidate_text))

# ── data classes ─────────────────────────────────────────────────────────
@dataclass
class MatchedSignal:
    id: int
    title: str
    side_hint: Optional[str]
    confidence: float
    insider_claim: bool
    large_bet: bool
    market_hint: Optional[str]
    permalink: Optional[str]
    overlap: int
    age_hours: float

@dataclass
class MatchedPost:
    id: int
    title: Optional[str]
    submolt: Optional[str]
    score: int
    overlap: int
    age_hours: float

@dataclass
class MarketIntel:
    market_id: str
    question: str
    reddit_signals: List[MatchedSignal] = field(default_factory=list)
    moltbook_posts: List[MatchedPost] = field(default_factory=list)
    aligned_yes: int = 0
    aligned_no: int = 0
    insider_count: int = 0
    boost_recommend: float = 0.0
    boost_applied: float = 0.0
    notes: str = ""

    def has_intel(self) -> bool:
        return bool(self.reddit_signals or self.moltbook_posts)

    def summary_line(self) -> str:
        bits = []
        if self.reddit_signals:
            bits.append(f"reddit={len(self.reddit_signals)}")
        if self.moltbook_posts:
            bits.append(f"moltbook={len(self.moltbook_posts)}")
        if self.insider_count:
            bits.append(f"insider={self.insider_count}")
        if self.aligned_yes or self.aligned_no:
            bits.append(f"aligned[Y/N]={self.aligned_yes}/{self.aligned_no}")
        if self.boost_recommend:
            bits.append(f"boost_rec={self.boost_recommend:+.3f}")
        if self.boost_applied:
            bits.append(f"BOOST_APPLIED={self.boost_applied:+.3f}")
        return " ".join(bits) if bits else "no-intel"

# ── main lookup ──────────────────────────────────────────────────────────
def get_market_intel(market_id: str, question: str, gemini_q: Optional[float] = None) -> MarketIntel:
    """
    Return a MarketIntel summary for the given market.

    ``gemini_q`` (the bot's current YES-probability estimate) is used only to
    compute a boost recommendation: signals aligned with the bot's leaning side
    add positive boost, contradictions add negative boost. The actual boost is
    applied only when REDDIT_SIGNAL_BOOST_ENABLED is set.
    """
    intel = MarketIntel(market_id=market_id, question=question or "")
    if not question:
        return intel

    _ensure_schema()
    qtokens = _tokenise(question)
    if len(qtokens) < INTEL_MIN_WORD_OVERLAP:
        return intel

    try:
        conn = _get_conn()
    except Exception as e:
        logger.warning(f"[intel_bridge] no DB: {e}")
        return intel

    # ── reddit_signals lookup ────────────────────────────────────────────
    try:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT id, title, side_hint, confidence, insider_claim,
                       large_bet_mentioned, market_hint, permalink,
                       EXTRACT(EPOCH FROM (now() - analysed_at))/3600.0 AS age_h,
                       coalesce(body,'') AS body
                FROM reddit_signals
                WHERE is_signal = TRUE
                  AND confidence >= %s
                  AND analysed_at > now() - (interval '1 hour') * %s
                ORDER BY confidence DESC, analysed_at DESC
                LIMIT 50
            """, (INTEL_REDDIT_MIN_CONF, INTEL_LOOKBACK_HOURS))
            for row in cur.fetchall():
                (sid, title, side, conf, insider, big, mhint, link, age_h, body) = row
                hay = " ".join(filter(None, [title, mhint or "", body[:600]]))
                ov = _overlap(qtokens, hay)
                if ov >= INTEL_MIN_WORD_OVERLAP:
                    intel.reddit_signals.append(MatchedSignal(
                        id=sid, title=title or "", side_hint=side,
                        confidence=float(conf or 0), insider_claim=bool(insider),
                        large_bet=bool(big), market_hint=mhint,
                        permalink=link, overlap=ov,
                        age_hours=float(age_h or 0),
                    ))
    except Exception as e:
        logger.warning(f"[intel_bridge] reddit query failed: {e}")

    # ── moltbook_posts lookup ────────────────────────────────────────────
    try:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT id, title, submolt, coalesce(score,0),
                       EXTRACT(EPOCH FROM (now() - created_at))/3600.0 AS age_h,
                       coalesce(body,'') AS body
                FROM moltbook_posts
                WHERE created_at > now() - (interval '1 hour') * %s
                ORDER BY created_at DESC
                LIMIT 100
            """, (INTEL_LOOKBACK_HOURS,))
            for row in cur.fetchall():
                (pid, title, sub, score, age_h, body) = row
                hay = " ".join(filter(None, [title or "", body[:1000]]))
                ov = _overlap(qtokens, hay)
                if ov >= INTEL_MIN_WORD_OVERLAP:
                    intel.moltbook_posts.append(MatchedPost(
                        id=pid, title=title, submolt=sub, score=int(score),
                        overlap=ov, age_hours=float(age_h or 0),
                    ))
    except Exception as e:
        logger.warning(f"[intel_bridge] moltbook query failed: {e}")

    # ── alignment + boost calculation ────────────────────────────────────
    bot_leans_yes = (gemini_q is not None) and (gemini_q > 0.55)
    bot_leans_no  = (gemini_q is not None) and (gemini_q < 0.45)

    boost = 0.0
    for s in intel.reddit_signals:
        if s.insider_claim:
            intel.insider_count += 1
        side = (s.side_hint or "").lower()
        # weight: confidence × insider/big-bet multipliers × overlap-quality
        weight = s.confidence * (1.0 + (0.5 if s.insider_claim else 0) + (0.3 if s.large_bet else 0))
        weight *= min(1.0, s.overlap / 4.0)
        # decay with age
        weight *= max(0.3, 1.0 - s.age_hours / (INTEL_LOOKBACK_HOURS * 1.5))
        if side == "yes":
            intel.aligned_yes += 1
            if bot_leans_yes:   boost += 0.01 * weight
            elif bot_leans_no:  boost -= 0.01 * weight
        elif side == "no":
            intel.aligned_no += 1
            if bot_leans_no:    boost += 0.01 * weight
            elif bot_leans_yes: boost -= 0.01 * weight
        # if no side hint but insider claim, treat as small attention-flag (no direction)
    intel.boost_recommend = max(-INTEL_MAX_BOOST, min(INTEL_MAX_BOOST, boost))
    if INTEL_BOOST_ENABLED:
        intel.boost_applied = intel.boost_recommend
    return intel

# ── log to bot_intel_log ─────────────────────────────────────────────────
def log_intel_check(intel: MarketIntel, gemini_q: Optional[float],
                    gemini_conf: Optional[float], market_p: Optional[float],
                    edge_ev: Optional[float], notes: str = "") -> None:
    if not intel.has_intel():
        return
    try:
        _ensure_schema()
        with _get_conn().cursor() as cur:
            cur.execute("""
                INSERT INTO bot_intel_log
                  (market_id, question, reddit_count, moltbook_count,
                   aligned_yes, aligned_no, insider_count,
                   boost_applied, boost_recommend,
                   gemini_q, gemini_conf, market_p, edge_ev,
                   matched_signal_ids, matched_post_ids, notes)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (
                intel.market_id, intel.question[:500],
                len(intel.reddit_signals), len(intel.moltbook_posts),
                intel.aligned_yes, intel.aligned_no, intel.insider_count,
                float(intel.boost_applied), float(intel.boost_recommend),
                float(gemini_q) if gemini_q is not None else None,
                float(gemini_conf) if gemini_conf is not None else None,
                float(market_p) if market_p is not None else None,
                float(edge_ev) if edge_ev is not None else None,
                [s.id for s in intel.reddit_signals],
                [p.id for p in intel.moltbook_posts],
                notes[:500],
            ))
    except Exception as e:
        logger.warning(f"[intel_bridge] log_intel_check failed: {e}")

# ── mark consumed (called when a trade actually fires) ───────────────────
def mark_signals_consumed(signal_ids: List[int]) -> None:
    if not signal_ids:
        return
    try:
        _ensure_schema()
        with _get_conn().cursor() as cur:
            cur.execute(
                "UPDATE reddit_signals SET consumed_by_bot = TRUE WHERE id = ANY(%s)",
                (list(signal_ids),)
            )
    except Exception as e:
        logger.warning(f"[intel_bridge] mark_consumed failed: {e}")
