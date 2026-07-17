#!/usr/bin/env python3
"""
_speedup.py — Wires Task #65 components (latency telemetry, CLOB-meta cache,
ws orderbook subscriber) into the existing synchronous bot via runtime
monkey-patching, so we don't have to surgically rewrite hot-path methods
in bot.py / order_executor.py / market_data.py.

This module is intentionally additive and idempotent: it can be imported
multiple times and only patches each target once. If any individual hook
fails to apply (because upstream code has moved), the bot keeps running
with the original behaviour and a single warning is logged.

Public API:
    install()                — apply all monkeypatches (idempotent).
    init_for_bot(bot)        — start the ws subscriber thread, pre-warm
                               meta cache for already-registered markets.
    on_markets_refreshed(bot) — re-subscribe ws + pre-warm new markets.
"""
from __future__ import annotations

import logging
import time

from . import latency, clob_meta_cache

logger = logging.getLogger("polymarket_bot.speedup")

_INSTALLED = False
_BOT_REF = None


# ---------------------------------------------------------------------------
# Monkey-patches
# ---------------------------------------------------------------------------

def _patch_order_executor() -> None:
    """Wrap OrderExecutor.place_order with latency timing + meta-cache hit
    detection, and wrap _fetch_tick_size / _fetch_neg_risk to consult the
    process-wide cache first."""
    from .order_executor import OrderExecutor

    if getattr(OrderExecutor, "_speedup_v1", False):
        return

    orig_fetch_tick = OrderExecutor._fetch_tick_size
    orig_fetch_neg = OrderExecutor._fetch_neg_risk
    orig_place = OrderExecutor.place_order

    def fetch_tick_size(self, token_id: str) -> str:  # type: ignore[override]
        cached = clob_meta_cache.get(token_id)
        if cached is not None:
            return cached[0]
        val = orig_fetch_tick(self, token_id)
        try:
            # Only commit to the SHARED cache when BOTH halves are known.
            # Never synthesize neg_risk=False — that would short-circuit the
            # next fetch_neg_risk call with a fabricated value and could
            # produce invalid orders on neg-risk markets.
            nr = self._neg_risk_cache.get(token_id) if hasattr(self, "_neg_risk_cache") else None
            if nr is not None:
                clob_meta_cache.set_(token_id, val, bool(nr))
        except Exception:
            pass
        return val

    def fetch_neg_risk(self, token_id: str) -> bool:  # type: ignore[override]
        cached = clob_meta_cache.get(token_id)
        if cached is not None:
            return cached[1]
        val = orig_fetch_neg(self, token_id)
        try:
            # Commit to shared cache only if tick_size is also already known.
            # Executor stores tick under `_tick_cache` (NOT `_tick_size_cache`).
            ts = self._tick_cache.get(token_id) if hasattr(self, "_tick_cache") else None
            if ts is not None:
                clob_meta_cache.set_(token_id, str(ts), bool(val))
        except Exception:
            pass
        return val

    def place_order(self, token_id, side, price, size, *args, **kwargs):  # type: ignore[override]
        meta_hit = clob_meta_cache.get(token_id) is not None
        with latency.measure(token_id=token_id, side=side, price=price, size=size) as L:
            L["meta_cache_hit"] = meta_hit
            L["t_signed"] = time.perf_counter()       # best-effort midpoint
            L["t_submitted"] = time.perf_counter()
            try:
                order_id = orig_place(self, token_id, side, price, size, *args, **kwargs)
            finally:
                L["t_acked"] = time.perf_counter()
            L["order_id"] = order_id
            if order_id is None:
                L["success"] = False
            return order_id

    OrderExecutor._fetch_tick_size = fetch_tick_size
    OrderExecutor._fetch_neg_risk = fetch_neg_risk
    OrderExecutor.place_order = place_order
    OrderExecutor._speedup_v1 = True
    logger.info("[SPEEDUP] OrderExecutor patched: latency timing + meta-cache read-through")


def _patch_market_data() -> None:
    """Make data_client.get_book_data consult the WS orderbook cache first."""
    market_data = ws_orderbook = None
    # Try absolute import first (matches the bot's actual import style with
    # bot/ on sys.path, e.g. `from data import market_data`), then fall back
    # to relative.
    try:
        from data import market_data as md  # type: ignore[import-not-found]
        from data import ws_orderbook as wob  # type: ignore[import-not-found]
        market_data, ws_orderbook = md, wob
    except Exception:
        try:
            from data import market_data as md  # type: ignore[no-redef]
            from data import ws_orderbook as wob  # type: ignore[no-redef]
            market_data, ws_orderbook = md, wob
        except Exception as e:
            logger.warning(f"[SPEEDUP] could not import market_data/ws_orderbook: {e}")
            return

    # Find the right class — naming convention varies, accept any class
    # that defines get_book_data.
    target_cls = None
    for name in dir(market_data):
        obj = getattr(market_data, name)
        if isinstance(obj, type) and "get_book_data" in obj.__dict__:
            target_cls = obj
            break
    if target_cls is None:
        logger.warning("[SPEEDUP] could not locate market_data class with get_book_data")
        return

    if getattr(target_cls, "_speedup_v1", False):
        return

    orig_get_book = target_cls.get_book_data

    def get_book_data(self, token_id: str, *args, **kwargs):  # type: ignore[override]
        cached = ws_orderbook.get_book(token_id)
        if cached is not None:
            # Passthrough format: market_data.get_book_data() callers expect a dict
            # with bids/asks/mid_price/best_bid/best_ask/spread.  ws_orderbook
            # already produces that shape with `_source: "ws"` for visibility.
            return cached
        return orig_get_book(self, token_id, *args, **kwargs)

    target_cls.get_book_data = get_book_data
    target_cls._speedup_v1 = True
    logger.info(f"[SPEEDUP] {target_cls.__name__}.get_book_data patched: ws-cache read-through")


def install() -> None:
    """Apply all monkeypatches. Idempotent — safe to call any time."""
    global _INSTALLED
    if _INSTALLED:
        return
    try:
        _patch_order_executor()
    except Exception as e:
        logger.warning(f"[SPEEDUP] order_executor patch failed: {e}")
    try:
        _patch_market_data()
    except Exception as e:
        logger.warning(f"[SPEEDUP] market_data patch failed: {e}")
    _INSTALLED = True


# ---------------------------------------------------------------------------
# Bot lifecycle hooks
# ---------------------------------------------------------------------------

def _collect_token_ids(bot) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    markets = getattr(bot, "_markets", {}) or {}
    for m in markets.values():
        for attr in ("token_id_yes", "token_id_no"):
            tid = getattr(m, attr, None)
            if tid and tid not in seen:
                seen.add(tid)
                out.append(tid)
    return out


def init_for_bot(bot) -> None:
    """Start ws subscriber, pre-warm meta cache. Call once at bot startup."""
    global _BOT_REF
    _BOT_REF = bot
    install()

    # Pre-warm CLOB meta for whatever markets are already registered.
    try:
        client = getattr(bot, "executor", None) and getattr(bot.executor, "client", None)
        token_ids = _collect_token_ids(bot)
        if client and token_ids:
            n = clob_meta_cache.prewarm(client, token_ids)
            logger.info(f"[SPEEDUP] meta pre-warm: {n} new entries "
                        f"(requested {len(token_ids)})")
    except Exception as e:
        logger.warning(f"[SPEEDUP] meta pre-warm failed: {e}")

    # Start the websocket orderbook subscriber daemon thread.
    try:
        from data import ws_orderbook
        sub, _cache = ws_orderbook.get_singleton()
        token_ids = _collect_token_ids(bot)
        if token_ids:
            sub.subscribe(token_ids)
        sub.start()
        logger.info(f"[SPEEDUP] ws orderbook subscriber started "
                    f"(initial subs: {len(token_ids)})")
    except Exception as e:
        logger.warning(f"[SPEEDUP] ws subscriber start failed: {e}")


def on_markets_refreshed(bot) -> None:
    """Bot calls this at the end of _refresh_markets so new tokens get warmed
    in cache + subscribed on the websocket."""
    if not _INSTALLED:
        install()
    try:
        client = getattr(bot, "executor", None) and getattr(bot.executor, "client", None)
        token_ids = _collect_token_ids(bot)
        if client and token_ids:
            clob_meta_cache.prewarm(client, token_ids)
        from data import ws_orderbook
        sub, _cache = ws_orderbook.get_singleton()
        if token_ids:
            sub.subscribe(token_ids)
    except Exception as e:
        logger.debug(f"[SPEEDUP] on_markets_refreshed swallowed: {e}")


def status() -> dict:
    """Snapshot for the dashboard."""
    out = {
        "installed": _INSTALLED,
        "latency": latency.histogram(),
        "meta_cache": clob_meta_cache.stats(),
    }
    try:
        from data import ws_orderbook
        sub, _cache = ws_orderbook.get_singleton()
        out["ws_orderbook"] = sub.status()
    except Exception as e:
        out["ws_orderbook"] = {"error": str(e)}
    return out
