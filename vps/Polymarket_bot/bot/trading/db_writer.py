"""
Postgres dual-write for Polymarket trades.
Writes go to the shared `trades` table (same one BTC bot uses) with bot="polymarket".
Failures are logged but never raise — trading must not block on DB.
"""
import os
import json
import logging
import threading
import psycopg2
import psycopg2.extras

logger = logging.getLogger("polymarket_bot.db")
_LOCK = threading.Lock()
_DSN = os.environ.get("DATABASE_URL", "")

def _conn():
    if not _DSN:
        return None
    try:
        return psycopg2.connect(_DSN, connect_timeout=5)
    except Exception as e:
        logger.warning(f"[DB] connect failed: {e}")
        return None

def record_open(market_id: str, market_question: str, side: str,
                size_usd: float, price: float, order_id: str,
                token_id: str = "", tick_size: str = "0.01",
                neg_risk: bool = False, end_time: float = 0.0):
    """Insert a new open trade row. Idempotent on order_id (raw->order_id)."""
    if not order_id:
        return
    shares = (size_usd / price) if price > 0 else 0
    raw = json.dumps({
        "order_id": order_id,
        "token_id": token_id,
        "tick_size": tick_size,
        "neg_risk": neg_risk,
        "end_time": end_time,
    })
    with _LOCK:
        c = _conn()
        if not c:
            return
        try:
            with c, c.cursor() as cur:
                # de-dup: skip if order_id already in raw->>order_id
                cur.execute(
                    "SELECT id FROM trades WHERE raw->>%s = %s LIMIT 1",
                    ("order_id", order_id),
                )
                if cur.fetchone():
                    return
                cur.execute(
                    """
                    INSERT INTO trades
                      (bot, market_slug, market_question, side, shares,
                       entry_price, stake, status, raw)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    """,
                    ("polymarket", market_id, market_question or market_id,
                     side, shares, price, size_usd, "open", raw),
                )
            logger.info(f"[DB] trade INSERT polymarket {market_id} {side} ${size_usd:.2f} @ {price:.4f}")
        except Exception as e:
            logger.warning(f"[DB] insert failed: {e}")
        finally:
            try: c.close()
            except: pass

def record_close(order_id: str, exit_price: float, payout_usd: float,
                 pnl_usd: float, status: str = "win"):
    """Update an open trade row: set exit_price, payout, pnl, status, closed_at."""
    if not order_id:
        return
    with _LOCK:
        c = _conn()
        if not c:
            return
        try:
            with c, c.cursor() as cur:
                cur.execute(
                    """
                    UPDATE trades SET
                      exit_price = %s, payout = %s, pnl = %s,
                      status = %s, closed_at = now()
                    WHERE raw->>%s = %s AND status = %s
                    """,
                    (exit_price, payout_usd, pnl_usd, status,
                     "order_id", order_id, "open"),
                )
                rows = cur.rowcount
            if rows:
                logger.info(f"[DB] trade UPDATE polymarket close {order_id[:14]}.. pnl=${pnl_usd:+.4f} status={status}")
        except Exception as e:
            logger.warning(f"[DB] update failed: {e}")
        finally:
            try: c.close()
            except: pass
