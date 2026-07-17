#!/usr/bin/env python3
"""
latency.py — Latency telemetry for the Polymarket bot (Task #65, Step 6).

Measures the end-to-end timing of every order placement so we can verify
the sub-400ms target. Each call records four timestamps:

    t_signal     — moment the bot decided to place this order
    t_signed     — moment the order args were built (post-meta-fetch)
    t_submitted  — moment we hit the CLOB POST endpoint
    t_acked      — moment the CLOB response came back (success or error)

Stored in a 100-entry ringbuffer at <bot>/latency.json so the dashboard can
render a histogram. Each call also logs a single one-line summary
"[LATENCY] signal->submit=Xms total=Yms order=ABC123" so it can be grepped
out of bot.log without parsing JSON.

Module is intentionally minimal and side-effect-free at import.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

logger = logging.getLogger("polymarket_bot.latency")

BOT_DIR = Path(__file__).resolve().parent.parent
LATENCY_FILE = BOT_DIR / "latency.json"
LATENCY_RING_MAX = 100

_lock = threading.Lock()


def _read() -> list[dict]:
    if not LATENCY_FILE.exists():
        return []
    try:
        data = json.loads(LATENCY_FILE.read_text())
        if isinstance(data, list):
            return data
    except Exception:
        pass
    return []


def _write(rows: list[dict]) -> None:
    try:
        if len(rows) > LATENCY_RING_MAX:
            rows = rows[-LATENCY_RING_MAX:]
        LATENCY_FILE.write_text(json.dumps(rows))
    except Exception as e:
        logger.debug(f"latency: could not write {LATENCY_FILE}: {e}")


def record(
    *,
    t_signal: float,
    t_signed: float,
    t_submitted: float,
    t_acked: float,
    order_id: str | None,
    token_id: str = "",
    side: str = "",
    price: float = 0.0,
    size: float = 0.0,
    success: bool = True,
    error: str | None = None,
    meta_cache_hit: bool | None = None,
) -> None:
    """Persist a latency sample. Safe to call from any thread; never raises."""
    try:
        signal_to_submit_ms = round((t_submitted - t_signal) * 1000.0, 1)
        sign_ms = round((t_signed - t_signal) * 1000.0, 1)
        submit_to_ack_ms = round((t_acked - t_submitted) * 1000.0, 1)
        total_ms = round((t_acked - t_signal) * 1000.0, 1)

        # Single-line, grep-friendly summary.
        try:
            short_oid = (order_id or "")[:10]
            cache_tag = ""
            if meta_cache_hit is True:
                cache_tag = " meta=cached"
            elif meta_cache_hit is False:
                cache_tag = " meta=fetched"
            ok_tag = "" if success else " STATUS=ERR"
            logger.info(
                f"[LATENCY] signal->submit={signal_to_submit_ms}ms "
                f"sign={sign_ms}ms submit->ack={submit_to_ack_ms}ms "
                f"total={total_ms}ms order={short_oid}{cache_tag}{ok_tag}"
            )
        except Exception:
            pass

        row = {
            "ts": int(t_signal),
            "iso_ts_signal": t_signal,
            "signal_to_submit_ms": signal_to_submit_ms,
            "sign_ms": sign_ms,
            "submit_to_ack_ms": submit_to_ack_ms,
            "total_ms": total_ms,
            "order_id": (order_id or "")[:20],
            "token_id": (token_id or "")[:20],
            "side": (side or "")[:6],
            "price": round(float(price or 0), 4),
            "size": round(float(size or 0), 2),
            "success": bool(success),
            "error": (str(error) if error else None),
            "meta_cache_hit": meta_cache_hit,
        }
        with _lock:
            rows = _read()
            rows.append(row)
            _write(rows)
    except Exception as e:
        try:
            logger.debug(f"latency.record swallowed: {e}")
        except Exception:
            pass


@contextmanager
def measure(*, token_id: str = "", side: str = "",
            price: float = 0.0, size: float = 0.0) -> Iterator[dict]:
    """
    Context manager that captures t_signal at __enter__, exposes a mutable
    dict the caller can stamp with t_signed/t_submitted/t_acked/order_id,
    and emits a record at __exit__. Safer than manual timestamping.

    Usage:
        with latency.measure(token_id=tid, side="BUY",
                             price=p, size=s) as L:
            L["t_signed"] = time.perf_counter()
            ...
            L["t_submitted"] = time.perf_counter()
            resp = client.post(...)
            L["t_acked"] = time.perf_counter()
            L["order_id"] = resp.id
    """
    state: dict = {
        "t_signal": time.perf_counter(),
        "t_signed": None,
        "t_submitted": None,
        "t_acked": None,
        "order_id": None,
        "success": True,
        "error": None,
        "meta_cache_hit": None,
    }
    try:
        yield state
    except Exception as e:
        state["success"] = False
        state["error"] = str(e)[:200]
        if state["t_acked"] is None:
            state["t_acked"] = time.perf_counter()
        raise
    finally:
        try:
            now = time.perf_counter()
            t_signed = state["t_signed"] or now
            t_submitted = state["t_submitted"] or t_signed
            t_acked = state["t_acked"] or t_submitted
            record(
                t_signal=state["t_signal"],
                t_signed=t_signed,
                t_submitted=t_submitted,
                t_acked=t_acked,
                order_id=state["order_id"],
                token_id=token_id,
                side=side,
                price=price,
                size=size,
                success=state["success"],
                error=state["error"],
                meta_cache_hit=state["meta_cache_hit"],
            )
        except Exception:
            pass


def histogram(rows: list[dict] | None = None) -> dict:
    """Return p50/p90/p99/min/max + bucket counts for total_ms.
    Call without args to read the current ringbuffer."""
    if rows is None:
        rows = _read()
    samples = [float(r.get("total_ms", 0)) for r in rows
               if isinstance(r, dict) and r.get("total_ms") is not None]
    if not samples:
        return {"count": 0}
    samples.sort()

    def _pct(p: float) -> float:
        idx = max(0, min(len(samples) - 1, int(round((p / 100.0) * (len(samples) - 1)))))
        return round(samples[idx], 1)

    buckets = {"<200ms": 0, "200-400ms": 0, "400-800ms": 0,
               "800-1500ms": 0, ">=1500ms": 0}
    for s in samples:
        if s < 200:
            buckets["<200ms"] += 1
        elif s < 400:
            buckets["200-400ms"] += 1
        elif s < 800:
            buckets["400-800ms"] += 1
        elif s < 1500:
            buckets["800-1500ms"] += 1
        else:
            buckets[">=1500ms"] += 1
    successes = sum(1 for r in rows if r.get("success"))
    return {
        "count": len(samples),
        "min_ms": round(samples[0], 1),
        "p50_ms": _pct(50),
        "p90_ms": _pct(90),
        "p99_ms": _pct(99),
        "max_ms": round(samples[-1], 1),
        "buckets": buckets,
        "success_rate": round(successes / len(rows), 3) if rows else 0.0,
        "under_400ms_ratio": round(
            (buckets["<200ms"] + buckets["200-400ms"]) / len(samples), 3
        ),
    }
