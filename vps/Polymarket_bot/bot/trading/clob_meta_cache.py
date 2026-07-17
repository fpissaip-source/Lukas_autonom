#!/usr/bin/env python3
"""
clob_meta_cache.py — process-wide cache for per-token CLOB metadata
(tick_size + neg_risk + last refresh ts), Task #65 Step 2.

Why: order_executor.place_order() calls _fetch_tick_size() and
_fetch_neg_risk() on every order. Even with the existing per-instance
dict cache, a brand-new market round-trips twice to CLOB on first order
(80-200ms each). With this module the bot can pre-warm meta the moment
a market is registered (in `_refresh_markets`) so the order path always
hits a cache.

Behaviour:
- `get(token_id)` returns (tick_size_str, neg_risk_bool, age_secs) or
  None on miss.
- `prewarm(client, token_ids)` fetches missing entries in parallel via
  a small thread pool and caches them (idempotent).
- `set(token_id, tick_size, neg_risk)` for callers that already know
  the values (e.g. _refresh_markets).
- TTL defaults to 6h — Polymarket meta is effectively static per market
  but markets do get re-indexed occasionally.
- Persisted to bot/clob_meta_cache.json so we keep the warm cache
  across bot restarts.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Iterable

logger = logging.getLogger("polymarket_bot.clob_meta")

BOT_DIR = Path(__file__).resolve().parent.parent
CACHE_FILE = BOT_DIR / "clob_meta_cache.json"
TTL_SECS = 6 * 3600
PREWARM_WORKERS = 8

_lock = threading.Lock()
_mem: dict[str, dict] = {}     # token_id -> {tick_size, neg_risk, ts}
_loaded = False
_stats = {"hits": 0, "misses": 0, "fetches": 0, "errors": 0}


def _load() -> None:
    global _loaded
    if _loaded:
        return
    if CACHE_FILE.exists():
        try:
            data = json.loads(CACHE_FILE.read_text())
            if isinstance(data, dict):
                for k, v in data.items():
                    if isinstance(v, dict):
                        _mem[str(k)] = v
            logger.info(f"[CLOB-META-CACHE] loaded {len(_mem)} entries from disk")
        except Exception as e:
            logger.warning(f"[CLOB-META-CACHE] load failed: {e}")
    _loaded = True


def _persist() -> None:
    try:
        CACHE_FILE.write_text(json.dumps(_mem))
    except Exception as e:
        logger.debug(f"[CLOB-META-CACHE] persist failed: {e}")


def get(token_id: str) -> tuple[str, bool, float] | None:
    """Return (tick_size, neg_risk, age_secs) for a fresh entry, else None."""
    if not token_id:
        return None
    with _lock:
        _load()
        e = _mem.get(token_id)
        if not e:
            _stats["misses"] += 1
            return None
        age = time.time() - float(e.get("ts", 0))
        if age > TTL_SECS:
            _stats["misses"] += 1
            return None
        _stats["hits"] += 1
        return str(e.get("tick_size", "0.01")), bool(e.get("neg_risk", False)), age


def set_(token_id: str, tick_size: str, neg_risk: bool) -> None:
    """Manually populate a cache entry (e.g. after a successful order)."""
    if not token_id:
        return
    with _lock:
        _load()
        _mem[token_id] = {
            "tick_size": str(tick_size),
            "neg_risk": bool(neg_risk),
            "ts": time.time(),
        }
        _persist()


def fetch_one(client, token_id: str) -> tuple[str, bool] | None:
    """Synchronous fetch via the supplied py-clob-client. Cached on success."""
    if not token_id:
        return None
    try:
        # 0.01 default per Polymarket docs; tick_size endpoint returns string.
        tick_size = str(client.get_tick_size(token_id) or "0.01")
        neg_risk = bool(client.get_neg_risk(token_id))
        with _lock:
            _stats["fetches"] += 1
            _mem[token_id] = {
                "tick_size": tick_size,
                "neg_risk": neg_risk,
                "ts": time.time(),
            }
            _persist()
        return tick_size, neg_risk
    except Exception as e:
        with _lock:
            _stats["errors"] += 1
        logger.debug(f"[CLOB-META-CACHE] fetch failed for {token_id[:16]}: {e}")
        return None


def prewarm(client, token_ids: Iterable[str], force: bool = False) -> int:
    """Fetch any missing entries in parallel. Returns # newly fetched."""
    _load()
    todo: list[str] = []
    seen: set[str] = set()
    for tid in token_ids:
        if not tid or tid in seen:
            continue
        seen.add(tid)
        if force or get(tid) is None:
            todo.append(tid)
    if not todo:
        return 0
    fetched = 0
    with ThreadPoolExecutor(max_workers=PREWARM_WORKERS,
                            thread_name_prefix="clob-meta-prewarm") as pool:
        futures = {pool.submit(fetch_one, client, tid): tid for tid in todo}
        for fut in as_completed(futures):
            try:
                if fut.result() is not None:
                    fetched += 1
            except Exception:
                pass
    if fetched:
        logger.info(f"[CLOB-META-CACHE] pre-warmed {fetched}/{len(todo)} entries "
                    f"(total cached: {len(_mem)})")
    return fetched


def stats() -> dict:
    with _lock:
        return {
            "size": len(_mem),
            "hits": _stats["hits"],
            "misses": _stats["misses"],
            "fetches": _stats["fetches"],
            "errors": _stats["errors"],
            "hit_rate": round(
                _stats["hits"] / max(1, _stats["hits"] + _stats["misses"]), 3
            ),
        }
