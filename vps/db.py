"""db.py — Lukas Postgres helper. Fail-safe dual-write layer.

All writes are wrapped — if the DB is down or unreachable, the bot continues
with JSON-only state. Use module-level cached pool for low overhead.
"""
import os, json, threading, traceback
from datetime import datetime, timezone
from contextlib import contextmanager

try:
    import psycopg2
    from psycopg2.extras import Json, RealDictCursor
    from psycopg2.pool import ThreadedConnectionPool
    _HAS_PG = True
except ImportError:
    _HAS_PG = False

_POOL = None
_LOCK = threading.Lock()
_LAST_ERR = None

def _dsn():
    return os.environ.get("DATABASE_URL")

def _pool():
    global _POOL, _LAST_ERR
    if not _HAS_PG or not _dsn():
        return None
    if _POOL is not None:
        return _POOL
    with _LOCK:
        if _POOL is not None:
            return _POOL
        try:
            _POOL = ThreadedConnectionPool(1, 5, dsn=_dsn(), connect_timeout=3)
            _LAST_ERR = None
        except Exception as e:
            _LAST_ERR = str(e)
            return None
    return _POOL

@contextmanager
def conn():
    """Yield a connection from the pool, or None if unavailable."""
    p = _pool()
    if p is None:
        yield None
        return
    c = None
    try:
        c = p.getconn()
        yield c
        c.commit()
    except Exception as e:
        if c:
            try: c.rollback()
            except Exception: pass
        global _LAST_ERR
        _LAST_ERR = f"{e.__class__.__name__}: {e}"
        try:
            print(f"[db] error: {_LAST_ERR}")
        except Exception: pass
        yield None
    finally:
        if c is not None and p is not None:
            try: p.putconn(c)
            except Exception: pass

def _exec(sql, params=()):
    with conn() as c:
        if c is None:
            return None
        with c.cursor() as cur:
            cur.execute(sql, params)
            try:
                return cur.fetchone()
            except psycopg2.ProgrammingError:
                return None

def is_healthy() -> bool:
    try:
        r = _exec("SELECT 1")
        return r is not None
    except Exception:
        return False

# ── Trades ────────────────────────────────────────────────────────────────
def insert_trade(bot, market_slug=None, market_question=None, side=None,
                 shares=None, entry_price=None, stake=None, status="open",
                 opened_at=None, raw=None):
    sql = """INSERT INTO trades (bot, market_slug, market_question, side,
             shares, entry_price, stake, status, opened_at, raw)
             VALUES (%s,%s,%s,%s,%s,%s,%s,%s,COALESCE(%s,NOW()),%s) RETURNING id"""
    r = _exec(sql, (bot, market_slug, market_question, side,
                    shares, entry_price, stake, status, opened_at,
                    Json(raw) if raw is not None else None))
    return r[0] if r else None

def close_trade(trade_id, status, exit_price=None, payout=None, pnl=None,
                closed_at=None, raw_update=None):
    sql = """UPDATE trades SET status=%s, exit_price=%s, payout=%s, pnl=%s,
             closed_at=COALESCE(%s,NOW()),
             raw = CASE WHEN %s::jsonb IS NULL THEN raw
                        ELSE COALESCE(raw,'{}'::jsonb) || %s::jsonb END
             WHERE id=%s"""
    j = Json(raw_update) if raw_update is not None else None
    _exec(sql, (status, exit_price, payout, pnl, closed_at, j, j, trade_id))

def close_trade_by_slug(bot, slug, status, exit_price=None, payout=None, pnl=None,
                        raw_update=None):
    """Close most recent OPEN trade for this bot+slug."""
    sql = """UPDATE trades SET status=%s, exit_price=%s, payout=%s, pnl=%s,
             closed_at=NOW(),
             raw = CASE WHEN %s::jsonb IS NULL THEN raw
                        ELSE COALESCE(raw,'{}'::jsonb) || %s::jsonb END
             WHERE id = (SELECT id FROM trades
                         WHERE bot=%s AND market_slug=%s AND status='open'
                         ORDER BY opened_at DESC LIMIT 1)
             RETURNING id"""
    j = Json(raw_update) if raw_update is not None else None
    r = _exec(sql, (status, exit_price, payout, pnl, j, j, bot, slug))
    return r[0] if r else None

# ── Bankroll snapshots ────────────────────────────────────────────────────
def record_bankroll(bot, balance, base=None, pnl=None, open_pos=None, note=None):
    _exec("""INSERT INTO bankroll_history (bot, balance, base, pnl, open_pos, note)
             VALUES (%s,%s,%s,%s,%s,%s)""",
          (bot, balance, base, pnl, open_pos, note))

# ── Sessions ──────────────────────────────────────────────────────────────
def open_session(bot, metadata=None):
    r = _exec("""INSERT INTO sessions (bot, metadata)
                 VALUES (%s,%s) RETURNING id""",
              (bot, Json(metadata) if metadata else None))
    return r[0] if r else None

def close_session(session_id, status="ok", error_msg=None, duration_ms=None):
    _exec("""UPDATE sessions SET ended_at=NOW(), status=%s, error_msg=%s,
             duration_ms=%s WHERE id=%s""",
          (status, error_msg, duration_ms, session_id))

# ── Moltbook ──────────────────────────────────────────────────────────────
def insert_observation(obs_type, content, agent=None, raw=None):
    r = _exec("""INSERT INTO moltbook_observations (obs_type, agent, content, raw)
                 VALUES (%s,%s,%s,%s) RETURNING id""",
              (obs_type, agent, content,
               Json(raw) if raw is not None else None))
    return r[0] if r else None

def insert_post(post_id, slug=None, title=None, body=None, submolt=None,
                score=None, raw=None):
    r = _exec("""INSERT INTO moltbook_posts (post_id, slug, title, body, submolt,
                                              score, raw)
                 VALUES (%s,%s,%s,%s,%s,%s,%s)
                 ON CONFLICT (post_id) DO UPDATE
                   SET title=EXCLUDED.title, body=EXCLUDED.body,
                       score=EXCLUDED.score, raw=EXCLUDED.raw
                 RETURNING id""",
              (post_id, slug, title, body, submolt, score,
               Json(raw) if raw is not None else None))
    return r[0] if r else None

# ── KV Store ──────────────────────────────────────────────────────────────
def set_state(bot, key, value):
    _exec("""INSERT INTO bot_state (bot, key, value, updated_at)
             VALUES (%s,%s,%s,NOW())
             ON CONFLICT (bot,key) DO UPDATE
               SET value=EXCLUDED.value, updated_at=NOW()""",
          (bot, key, Json(value)))

def get_state(bot, key, default=None):
    r = _exec("SELECT value FROM bot_state WHERE bot=%s AND key=%s", (bot, key))
    return r[0] if r else default

# ── Quick Reads (for dashboard / Lukas self-introspection) ───────────────
def query(sql, params=()):
    with conn() as c:
        if c is None:
            return []
        with c.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            try:
                return cur.fetchall()
            except psycopg2.ProgrammingError:
                return []
