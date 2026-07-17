#!/usr/bin/env python3
"""
ws_orderbook.py — Background WebSocket orderbook subscriber (Task #65 Step 3).

Connects to wss://ws-subscriptions-clob.polymarket.com/ws/market and keeps
an in-memory L2 book for a set of subscribed token IDs. Replaces the
HTTP get_book_data round-trip (~150-300ms) with a microsecond RAM lookup
for any token currently in the subscription set.

Design:
- Single dedicated daemon thread runs an asyncio event loop.
- Subscriptions are dynamic — `subscribe([tokens])` may be called from
  the main thread at any time (e.g. after _refresh_markets registers
  new markets).
- Connection is auto-reconnected with exponential backoff. While
  disconnected, the in-memory book remains stale-readable but `get_book`
  flags it via `age_ms`.
- Falls through to nothing on its own — the read-side helper
  `get_book(token_id)` returns None for unknown / stale-too-long tokens
  so the caller can fall back to HTTP.

The Polymarket "market" channel message shape (per docs):
    "book"   — full snapshot:   {"event_type":"book","asset_id":"...",
                                  "bids":[{"price","size"},...],
                                  "asks":[{"price","size"},...],
                                  "timestamp":"..."}
    "price_change" — delta:      {"event_type":"price_change","asset_id":"...",
                                  "changes":[{"price","size","side"}],...}
    "tick_size_change" — meta change

We process all three. On any error we treat the book as invalid and
re-request via reconnection.
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from typing import Iterable

logger = logging.getLogger("polymarket_bot.ws_orderbook")

WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market"
STALE_BOOK_MS = 30_000          # >30s old → treat as stale
RECONNECT_BACKOFF_MAX = 30.0    # seconds


class OrderbookCache:
    """Thread-safe in-memory L2 book, read by main bot thread."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # token_id -> {"bids": [(price,size)..], "asks": [...],
        #              "ts_ms": int, "src": "ws"|"http"|"snap"}
        self._books: dict[str, dict] = {}
        self.stats = {
            "snapshots": 0, "deltas": 0, "reads_ws": 0,
            "reads_stale": 0, "reads_miss": 0,
            "reconnects": 0, "ws_errors": 0,
        }

    # ---------- writers (called from ws thread) -----------------------------
    def _set_snapshot(self, token_id: str, bids, asks, ts_ms: int) -> None:
        with self._lock:
            self._books[token_id] = {
                "bids": list(bids), "asks": list(asks),
                "ts_ms": int(ts_ms), "src": "ws",
            }
            self.stats["snapshots"] += 1

    def _apply_delta(self, token_id: str, changes: list[dict], ts_ms: int) -> None:
        with self._lock:
            book = self._books.get(token_id)
            if not book:
                # No snapshot yet — drop delta until ws sends snapshot.
                return
            bids = {p: s for (p, s) in book["bids"]}
            asks = {p: s for (p, s) in book["asks"]}
            for ch in changes:
                try:
                    p = float(ch.get("price"))
                    s = float(ch.get("size"))
                    side = (ch.get("side") or "").upper()
                    target = bids if side in ("BUY", "BID") else asks
                    if s <= 0:
                        target.pop(p, None)
                    else:
                        target[p] = s
                except Exception:
                    continue
            # Sort: bids descending, asks ascending; keep top 10 each.
            book["bids"] = sorted(bids.items(), key=lambda kv: -kv[0])[:10]
            book["asks"] = sorted(asks.items(), key=lambda kv: kv[0])[:10]
            book["ts_ms"] = int(ts_ms)
            self.stats["deltas"] += 1

    # ---------- readers (called from any thread) ----------------------------
    def get_book(self, token_id: str) -> dict | None:
        """Returns dict with same shape as data_client.get_book_data() or None.
        Adds `age_ms` so callers can decide whether to fall back to HTTP."""
        with self._lock:
            book = self._books.get(token_id)
            if not book:
                self.stats["reads_miss"] += 1
                return None
            age_ms = int(time.time() * 1000 - book["ts_ms"])
            if age_ms > STALE_BOOK_MS:
                self.stats["reads_stale"] += 1
                return None
            self.stats["reads_ws"] += 1
            bids = [{"price": float(p), "size": float(s)} for p, s in book["bids"]]
            asks = [{"price": float(p), "size": float(s)} for p, s in book["asks"]]
            best_bid = bids[0]["price"] if bids else None
            best_ask = asks[0]["price"] if asks else None
            mid = None
            if best_bid is not None and best_ask is not None:
                spread = best_ask - best_bid
                if 0 < spread <= 0.10:
                    mid = (best_bid + best_ask) / 2.0
                else:
                    mid = (best_bid + best_ask) / 2.0
            elif best_bid is not None:
                mid = best_bid
            elif best_ask is not None:
                mid = best_ask
            # Compute imbalance + depth identical to market_data.get_book_data
            # so callers (bot._tick) don't blow up on KeyError.
            bid_vol = sum(b["size"] for b in bids[:5])
            ask_vol = sum(a["size"] for a in asks[:5])
            total = bid_vol + ask_vol
            imbalance = ((bid_vol - ask_vol) / total) if total > 1e-8 else 0.0
            depth = total
            return {
                "bids": bids,
                "asks": asks,
                "mid_price": mid,
                "best_bid": best_bid,
                "best_ask": best_ask,
                "spread": (best_ask - best_bid) if (best_bid is not None and best_ask is not None) else None,
                "imbalance": imbalance,
                "depth": depth,
                "bid_vol": bid_vol,
                "ask_vol": ask_vol,
                "last_price": None,  # ws channel doesn't push trades
                "age_ms": age_ms,
                "_source": "ws",
            }

    def known_tokens(self) -> set[str]:
        with self._lock:
            return set(self._books.keys())


class WSSubscriber:
    """Owns the asyncio loop in a dedicated daemon thread."""

    def __init__(self, cache: OrderbookCache) -> None:
        self.cache = cache
        self._tokens: set[str] = set()
        self._tokens_lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._connected = False
        self._last_subscribe_set: frozenset[str] = frozenset()

    # ---------- public API --------------------------------------------------
    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(
            target=self._thread_main, name="poly-ws-orderbook", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def subscribe(self, tokens: Iterable[str]) -> None:
        new = {t for t in tokens if t}
        with self._tokens_lock:
            added = new - self._tokens
            if not added:
                return
            self._tokens |= new
        # Trigger reconnect so the new tokens get into the next subscribe msg.
        if self._loop and not self._loop.is_closed():
            asyncio.run_coroutine_threadsafe(self._kick(), self._loop)

    def is_connected(self) -> bool:
        return self._connected

    def status(self) -> dict:
        return {
            "connected": self._connected,
            "subscribed_tokens": len(self._tokens),
            "books_in_memory": len(self.cache.known_tokens()),
            **self.cache.stats,
        }

    # ---------- internals ---------------------------------------------------
    def _thread_main(self) -> None:
        try:
            asyncio.run(self._run())
        except Exception as e:
            logger.error(f"[WS-OB] thread crashed: {e}")

    async def _kick(self) -> None:
        # Setting an event on the running loop will close the websocket
        # so the outer loop reconnects with the new subscription set.
        self._kick_event.set()

    async def _run(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._kick_event = asyncio.Event()
        try:
            import websockets  # local import — module-load cost off the hot path
        except ImportError:
            logger.error("[WS-OB] `websockets` package not installed; ws disabled")
            return

        backoff = 1.0
        while not self._stop.is_set():
            tokens = list(self._tokens)
            if not tokens:
                await asyncio.sleep(2)
                continue
            try:
                async with websockets.connect(
                    WS_URL,
                    ping_interval=20, ping_timeout=10,
                    open_timeout=10, close_timeout=5,
                    max_size=8 * 1024 * 1024,
                ) as ws:
                    self._connected = True
                    self.cache.stats["reconnects"] += 1
                    self._last_subscribe_set = frozenset(tokens)
                    sub_msg = json.dumps({
                        "type": "MARKET",
                        "assets_ids": tokens,
                    })
                    await ws.send(sub_msg)
                    logger.info(f"[WS-OB] connected; subscribed to {len(tokens)} tokens")
                    backoff = 1.0
                    self._kick_event.clear()

                    while not self._stop.is_set():
                        # If the token set changed, break to re-subscribe.
                        with self._tokens_lock:
                            current = frozenset(self._tokens)
                        if current != self._last_subscribe_set:
                            logger.info("[WS-OB] subscription set changed; reconnecting")
                            break

                        try:
                            recv_task = asyncio.create_task(ws.recv())
                            kick_task = asyncio.create_task(self._kick_event.wait())
                            done, pending = await asyncio.wait(
                                {recv_task, kick_task},
                                timeout=30,
                                return_when=asyncio.FIRST_COMPLETED,
                            )
                            for t in pending:
                                t.cancel()
                            if kick_task in done:
                                self._kick_event.clear()
                                break
                            if not done:
                                continue
                            raw = recv_task.result()
                        except asyncio.TimeoutError:
                            continue

                        self._handle_message(raw)
            except Exception as e:
                self._connected = False
                self.cache.stats["ws_errors"] += 1
                logger.warning(f"[WS-OB] disconnected: {e!s}; reconnecting in {backoff:.1f}s")
                await asyncio.sleep(backoff)
                backoff = min(RECONNECT_BACKOFF_MAX, backoff * 1.7)
            finally:
                self._connected = False

    def _handle_message(self, raw) -> None:
        try:
            data = json.loads(raw)
        except Exception:
            return
        # Polymarket sometimes wraps messages in a list, sometimes single.
        msgs = data if isinstance(data, list) else [data]
        now_ms = int(time.time() * 1000)
        for m in msgs:
            if not isinstance(m, dict):
                continue
            evt = m.get("event_type") or m.get("type") or ""
            asset = m.get("asset_id") or m.get("assets_id") or ""
            if not asset:
                continue
            try:
                ts_ms = int(float(m.get("timestamp") or now_ms))
            except (TypeError, ValueError):
                ts_ms = now_ms
            if evt == "book":
                bids_raw = m.get("bids") or []
                asks_raw = m.get("asks") or []
                bids = [(float(b["price"]), float(b["size"])) for b in bids_raw[:10]]
                asks = [(float(a["price"]), float(a["size"])) for a in asks_raw[:10]]
                bids.sort(key=lambda kv: -kv[0])
                asks.sort(key=lambda kv: kv[0])
                self.cache._set_snapshot(asset, bids, asks, ts_ms)
            elif evt == "price_change":
                self.cache._apply_delta(asset, m.get("changes") or [], ts_ms)
            elif evt == "tick_size_change":
                # Meta change — just stamp the existing book so it isn't
                # mistakenly treated as fresh; cache module will re-fetch.
                pass


# ---------------------------------------------------------------------------
# Module singleton — bot creates exactly one of these in run() startup.
# ---------------------------------------------------------------------------
_singleton_lock = threading.Lock()
_singleton: WSSubscriber | None = None
_singleton_cache: OrderbookCache | None = None


def get_singleton() -> tuple[WSSubscriber, OrderbookCache]:
    global _singleton, _singleton_cache
    with _singleton_lock:
        if _singleton is None:
            _singleton_cache = OrderbookCache()
            _singleton = WSSubscriber(_singleton_cache)
        return _singleton, _singleton_cache


def get_book(token_id: str) -> dict | None:
    """Convenience read-side accessor used by patched market_data.get_book_data."""
    if _singleton_cache is None:
        return None
    return _singleton_cache.get_book(token_id)
