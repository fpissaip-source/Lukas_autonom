#!/usr/bin/env python3
"""
reality.py — Bot Reality Awareness (Task #64)
=============================================

Bridges what the bot KNOWS internally (kelly.bankroll, _live_positions) with
what is actually true on-chain (USDC balance) and what just HAPPENED to it
(force-closes, catastrophic stop-losses, accepted full losses).

Three jobs:

  1. record_event(kind, market_id, details)
       Append a JSON entry to a ringbuffer at <bot_dir>/events.json (max 200
       entries). Called from inside bot.py at every STOP_LOSS, CATASTROPHIC_SL,
       FORCE_PURGE and "Accepting full loss" callsite. Dashboard renders the
       last 20 as a timeline.

  2. tick(bot_self)
       Run every 60s from the main _tick() loop. Pulls on-chain USDC balance,
       compares to kelly.bankroll, computes total cost-basis and current
       market value of all open positions, writes a single
       <bot_dir>/reality.json snapshot the dashboard reads. Also computes
       realized PnL over last 24h from trades.json, and runs loss-alert
       watchdog (-$10/1h or $20 frozen ⇒ Telegram).

  3. _send_telegram(msg)
       Lazy reuse of TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID env vars (same as
       agent.py / uma_watcher.py). All failures swallowed — telemetry must
       never block trading.

This module is intentionally side-effect-free at import time so it can be
hot-loaded into the running bot without touching trading logic.
"""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# bot/trading/reality.py  →  parent.parent = bot/
BOT_DIR = Path(__file__).resolve().parent.parent
EVENTS_FILE = BOT_DIR / "events.json"
REALITY_FILE = BOT_DIR / "reality.json"
HISTORY_FILE = BOT_DIR / "reality_history.json"
TRADES_FILE = BOT_DIR / "trades.json"
BANKROLL_STATE_FILE = BOT_DIR / "bankroll_state.json"

EVENTS_RING_MAX = 200
HISTORY_RING_MAX = 60                  # 60 snapshots × 60s = 1h timeline
DRAWDOWN_ALERT_USD = 10.0              # bankroll-series alert threshold (1h)
REALITY_SYNC_INTERVAL_SECS = 60
DRIFT_WARN_USD = 2.0
# Bankroll reconciliation tolerance: smaller drifts are noise (rounding,
# pending order escrow). Anything bigger gets actively reconciled down.
RECONCILE_TOLERANCE_USD = 0.50
LOSS_ALERT_WINDOW_SECS = 3600          # 1h
LOSS_ALERT_THRESHOLD_USD = 10.0
FROZEN_ALERT_THRESHOLD_USD = 20.0
LOSS_ALERT_COOLDOWN_SECS = 1800        # 30 min between same-kind alerts

# Module-level state for alert cooldown so we don't spam Telegram.
_last_alert_ts: dict[str, float] = {}


# ---------------------------------------------------------------------------
# Telegram
# ---------------------------------------------------------------------------

def _send_telegram(msg: str) -> None:
    """Fire-and-forget Telegram message. Silent on any failure."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "")
    if not token or not chat_id:
        return
    try:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        body = json.dumps({
            "chat_id": chat_id,
            "text": msg,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }).encode()
        req = urllib.request.Request(
            url, data=body, headers={"Content-Type": "application/json"}
        )
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Event ringbuffer
# ---------------------------------------------------------------------------

def _read_events() -> list[dict]:
    if not EVENTS_FILE.exists():
        return []
    try:
        data = json.loads(EVENTS_FILE.read_text())
        if isinstance(data, list):
            return data
    except Exception:
        pass
    return []


def _write_events(events: list[dict]) -> None:
    try:
        if len(events) > EVENTS_RING_MAX:
            events = events[-EVENTS_RING_MAX:]
        EVENTS_FILE.write_text(json.dumps(events, indent=2))
    except Exception as e:
        logger.warning(f"reality: could not write events.json: {e}")


def _read_history() -> list[dict]:
    if not HISTORY_FILE.exists():
        return []
    try:
        data = json.loads(HISTORY_FILE.read_text())
        if isinstance(data, list):
            return data
    except Exception:
        pass
    return []


def _write_history(history: list[dict]) -> None:
    try:
        if len(history) > HISTORY_RING_MAX:
            history = history[-HISTORY_RING_MAX:]
        HISTORY_FILE.write_text(json.dumps(history))
    except Exception as e:
        logger.debug(f"reality: could not write history: {e}")


def record_event(kind: str, market_id: str = "", details: dict | None = None) -> None:
    """
    Append a force-close / loss event to the ringbuffer.

    kind: "STOP_LOSS" | "CATASTROPHIC_SL" | "FORCE_PURGE" |
          "ACCEPT_FULL_LOSS" | "TAKE_PROFIT" | "MAX_HOLD" | "PRE_EXPIRY" | ...
    market_id: short market identifier for grouping
    details: free-form context (entry/exit price, pnl_usd, reason text, ...)
    """
    try:
        events = _read_events()
        entry = {
            "ts": int(time.time()),
            "iso": datetime.now(timezone.utc).isoformat(),
            "kind": str(kind or "UNKNOWN").upper(),
            "market_id": str(market_id or "")[:80],
            "details": details or {},
        }
        events.append(entry)
        _write_events(events)
    except Exception as e:
        # Never let telemetry break the trade path.
        try:
            logger.warning(f"reality.record_event swallowed: {e}")
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Realized PnL (last 24h) from trades.json
# ---------------------------------------------------------------------------

def _read_trades() -> list[dict]:
    if not TRADES_FILE.exists():
        return []
    try:
        data = json.loads(TRADES_FILE.read_text())
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for k in ("trades", "recent", "history"):
                v = data.get(k)
                if isinstance(v, list):
                    return v
    except Exception:
        pass
    return []


def _realized_pnl_window(trades: list[dict], window_secs: int) -> tuple[float, int]:
    """Sum PnL of resolved trades within the last `window_secs`. Returns
    (pnl_usd, count). Robust to several trades.json schemas."""
    cutoff = time.time() - window_secs
    pnl = 0.0
    count = 0
    for t in trades:
        if not isinstance(t, dict):
            continue
        ts = t.get("close_ts") or t.get("closed_at") or t.get("exit_ts") or t.get("ts")
        if isinstance(ts, str):
            try:
                ts = datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
            except Exception:
                ts = None
        if ts is None or float(ts) < cutoff:
            continue
        p = t.get("pnl_usd")
        if p is None:
            p = t.get("pnl")
        if p is None:
            continue
        try:
            pnl += float(p)
            count += 1
        except (TypeError, ValueError):
            continue
    return round(pnl, 2), count


# ---------------------------------------------------------------------------
# Position snapshotting
# ---------------------------------------------------------------------------

def _live_mid_price(bot, token_id: str, cache: dict) -> float | None:
    """Fetch live CLOB mid price for a token, with per-tick caching so we
    never re-query the same token twice in one snapshot."""
    if not token_id:
        return None
    if token_id in cache:
        return cache[token_id]
    price: float | None = None
    dc = getattr(bot, "data_client", None)
    if dc is not None:
        try:
            data = dc.get_book_data(token_id)
            if isinstance(data, dict):
                v = data.get("mid_price") or data.get("last_price")
                if v is None:
                    bids = data.get("bids") or []
                    asks = data.get("asks") or []
                    bb = float(bids[0]["price"]) if bids else None
                    ba = float(asks[0]["price"]) if asks else None
                    if bb is not None and ba is not None:
                        v = (bb + ba) / 2
                    elif bb is not None:
                        v = bb
                    elif ba is not None:
                        v = ba
                if v is not None:
                    price = float(v)
        except Exception as e:
            logger.debug(f"reality: get_book_data({token_id[:16]}) failed: {e}")
    cache[token_id] = price
    return price


def _snapshot_positions(bot) -> tuple[list[dict], float, float, int]:
    """Walk bot._live_positions (the in-memory truth) and produce a
    dashboard-friendly list plus (total_cost_basis, total_current_value,
    n_live_marked). Each position's current_price is fetched LIVE from CLOB
    via bot.data_client.get_book_data(token_id) so open_positions_value
    reflects actual market reality, not stale entry prices."""
    out: list[dict] = []
    total_cost = 0.0
    total_value = 0.0
    n_live_marked = 0
    positions = getattr(bot, "_live_positions", None) or {}
    if not isinstance(positions, dict):
        return out, 0.0, 0.0, 0

    price_cache: dict[str, float | None] = {}
    now = time.time()

    for order_id, pos in positions.items():
        if not isinstance(pos, dict):
            continue
        try:
            entry_price = float(pos.get("entry_price") or 0.0)
            entry_size = float(pos.get("entry_size") or pos.get("size") or 0.0)
            shares = float(pos.get("shares") or 0.0)
            if shares <= 0 and entry_price > 0:
                shares = entry_size / entry_price

            # ── LIVE price fetch (the whole point) ──────────────────────────
            token_id = str(pos.get("token_id") or "")
            live_mid = _live_mid_price(bot, token_id, price_cache)
            if live_mid is not None:
                current_price = live_mid
                price_source = "clob"
                n_live_marked += 1
                # Stash the live mark on the position so the rest of the bot
                # can read it too (and so it survives across ticks).
                pos["last_mark_price"] = round(live_mid, 6)
                pos["last_mark_ts"] = int(now)
            else:
                # Fallback: previously stamped mark, then entry. Tag stale.
                current_price = float(
                    pos.get("last_mark_price") or pos.get("current_price") or entry_price
                )
                price_source = "stale" if pos.get("last_mark_price") else "entry"

            current_value = shares * current_price
            total_cost += entry_size
            total_value += current_value

            opened_ts = (pos.get("entry_time") or pos.get("opened_ts")
                         or pos.get("opened_at"))

            out.append({
                "order_id": str(order_id)[:16],
                "market_id": str(pos.get("market_id") or "")[:80],
                "token_id": token_id[:16],
                "side": pos.get("side") or "BUY",
                "entry_price": round(entry_price, 4),
                "current_price": round(current_price, 4),
                "price_source": price_source,
                "last_mark_ts": pos.get("last_mark_ts"),
                "shares": round(shares, 2),
                "cost_basis": round(entry_size, 2),
                "current_value": round(current_value, 2),
                "unrealized_pnl": round(current_value - entry_size, 2),
                "buy_filled": bool(pos.get("buy_filled", True)),
                "opened_ts": opened_ts,
            })
        except Exception:
            continue
    return out, round(total_cost, 2), round(total_value, 2), n_live_marked


# ---------------------------------------------------------------------------
# On-chain sync
# ---------------------------------------------------------------------------

def _fetch_on_chain_balance() -> float:
    """Reuse the bot's own balance helper. Returns 0.0 on any failure."""
    try:
        from trading.order_executor import fetch_live_balance_usd
        v = fetch_live_balance_usd()
        return float(v or 0.0)
    except Exception as e:
        logger.debug(f"reality: fetch_live_balance_usd failed: {e}")
        return 0.0


# ---------------------------------------------------------------------------
# Loss-alert watchdog
# ---------------------------------------------------------------------------

def _alert_cooldown_ok(key: str) -> bool:
    now = time.time()
    last = _last_alert_ts.get(key, 0.0)
    if now - last < LOSS_ALERT_COOLDOWN_SECS:
        return False
    _last_alert_ts[key] = now
    return True


def _loss_window_from_events(events: list[dict], window_secs: int) -> tuple[float, int]:
    """Sum reported pnl_usd from force-close events in the last window."""
    cutoff = time.time() - window_secs
    loss = 0.0
    count = 0
    bad_kinds = {"STOP_LOSS", "CATASTROPHIC_SL", "FORCE_PURGE", "ACCEPT_FULL_LOSS"}
    for e in events:
        if not isinstance(e, dict):
            continue
        if e.get("kind") not in bad_kinds:
            continue
        if int(e.get("ts") or 0) < cutoff:
            continue
        details = e.get("details") or {}
        p = details.get("pnl_usd")
        if p is None:
            # Approximate: full loss of cost basis if no pnl reported.
            cb = details.get("cost_basis") or details.get("entry_size") or 0
            try:
                p = -float(cb)
            except (TypeError, ValueError):
                p = 0.0
        try:
            loss += float(p)
            count += 1
        except (TypeError, ValueError):
            continue
    return round(loss, 2), count


def _check_loss_alerts(snapshot: dict, events: list[dict]) -> list[str]:
    """Return list of alert texts that were just sent (used in reality.json)."""
    sent: list[str] = []

    loss_1h, n_1h = _loss_window_from_events(events, LOSS_ALERT_WINDOW_SECS)
    if loss_1h <= -LOSS_ALERT_THRESHOLD_USD and _alert_cooldown_ok("loss_1h"):
        msg = (
            f"⚠️ <b>Polymarket-Bot Verlust-Alarm</b>\n"
            f"-${abs(loss_1h):.2f} in der letzten Stunde durch {n_1h} Force-Close(s).\n"
            f"On-Chain Balance: ${snapshot.get('on_chain_balance', 0):.2f}"
        )
        _send_telegram(msg)
        sent.append(msg)

    frozen_value = float(snapshot.get("open_positions_value", 0) or 0)
    n_open = int(snapshot.get("open_positions_count", 0) or 0)
    # Bankroll-series alert: 1h drawdown of total equity (bankroll + open value).
    # This catches slow bleed that isn't captured by event-derived loss.
    history = _read_history()
    if len(history) >= 2:
        cur_equity = float(snapshot.get("internal_bankroll", 0)) + float(
            snapshot.get("open_positions_value", 0))
        cutoff = time.time() - LOSS_ALERT_WINDOW_SECS
        # Use the OLDEST snapshot still inside the window as 1h baseline.
        baseline = None
        for h in history:
            if int(h.get("ts", 0)) >= cutoff:
                baseline = h
                break
        if baseline:
            base_equity = float(baseline.get("internal_bankroll", 0)) + float(
                baseline.get("open_positions_value", 0))
            drawdown = round(cur_equity - base_equity, 2)
            if drawdown <= -DRAWDOWN_ALERT_USD and _alert_cooldown_ok("drawdown_1h"):
                msg = (
                    f"📉 <b>Polymarket-Bot 1h Drawdown</b>\n"
                    f"Total Equity gefallen um ${abs(drawdown):.2f} in der letzten Stunde "
                    f"(${base_equity:.2f} → ${cur_equity:.2f})."
                )
                _send_telegram(msg)
                sent.append(msg)

    if (frozen_value >= FROZEN_ALERT_THRESHOLD_USD
            and n_open >= 1
            and _alert_cooldown_ok("frozen")):
        # Per Task #64 spec: alert immediately at threshold; age is informational.
        avg_age = _avg_position_age_secs(snapshot.get("positions", []))
        age_hint = f" (Ø Alter {avg_age/3600:.1f}h)" if avg_age > 0 else ""
        msg = (
            f"❄️ <b>Polymarket-Bot Liquiditäts-Alarm</b>\n"
            f"${frozen_value:.2f} festgefroren in {n_open} Position(en){age_hint}."
        )
        _send_telegram(msg)
        sent.append(msg)
    return sent


def _avg_position_age_secs(positions: list[dict]) -> float:
    now = time.time()
    ages: list[float] = []
    for p in positions or []:
        ts = p.get("opened_ts")
        if isinstance(ts, str):
            try:
                ts = datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
            except Exception:
                ts = None
        if ts is None:
            continue
        try:
            ages.append(now - float(ts))
        except (TypeError, ValueError):
            continue
    return sum(ages) / len(ages) if ages else 0.0


# ---------------------------------------------------------------------------
# Main entry: tick()
# ---------------------------------------------------------------------------

def tick(bot) -> None:
    """Called from bot._tick() at most once per REALITY_SYNC_INTERVAL_SECS.
    Side effects:
      - Writes <bot>/reality.json
      - Updates <bot>/bankroll_state.json with drift info
      - Records DRIFT_WARN events when internal vs on-chain >$2
      - Fires Telegram loss-alerts (rate-limited)
    """
    try:
        on_chain = _fetch_on_chain_balance()
        kelly = getattr(bot, "kelly", None)
        internal_before = float(kelly.bankroll) if kelly is not None else 0.0
        drift = round(internal_before - on_chain, 2) if on_chain > 0 else 0.0

        # Bankroll reconciliation (the actual point of this whole module).
        # If we have a real on-chain reading and the drift is meaningful, sync
        # internal bankroll DOWN to on-chain truth. We never inflate bankroll
        # automatically — incoming payouts arrive on chain first, so the
        # internal value should always be <= on_chain in steady state.
        reconciled = False
        reconcile_delta = 0.0
        if (kelly is not None
                and on_chain > 0
                and abs(drift) >= RECONCILE_TOLERANCE_USD):
            try:
                old = float(kelly.bankroll)
                kelly.bankroll = float(on_chain)
                reconcile_delta = round(on_chain - old, 4)
                reconciled = True
                # Persist immediately if the kelly object knows how to.
                save_fn = getattr(kelly, "save", None) or getattr(kelly, "_persist", None)
                if callable(save_fn):
                    try:
                        save_fn()
                    except Exception:
                        pass
                record_event("BANKROLL_RECONCILE", "", {
                    "internal_before": round(old, 4),
                    "on_chain": round(on_chain, 4),
                    "delta_usd": reconcile_delta,
                    "drift_usd": drift,
                })
                logger.info(
                    f"reality: reconciled kelly.bankroll {old:.4f} -> {on_chain:.4f} "
                    f"(delta {reconcile_delta:+.4f}, drift was {drift:+.2f})"
                )
            except Exception as e:
                logger.warning(f"reality: bankroll reconcile failed: {e}")

        # Use post-reconcile bankroll for the dashboard snapshot.
        internal = float(kelly.bankroll) if kelly is not None else internal_before

        positions, cost_basis, current_value, n_live_marked = _snapshot_positions(bot)
        trades = _read_trades()
        pnl_24h, n_24h = _realized_pnl_window(trades, 24 * 3600)
        pnl_1h, n_1h = _realized_pnl_window(trades, 3600)

        events = _read_events()
        recent_events = events[-20:]

        if on_chain > 0 and abs(drift) > DRIFT_WARN_USD:
            # Record once per minute max — record_event is cheap so just append.
            record_event("DRIFT_WARN", "", {
                "internal_bankroll": round(internal, 2),
                "on_chain_balance": round(on_chain, 2),
                "drift_usd": drift,
            })

        snapshot = {
            "ts": int(time.time()),
            "iso": datetime.now(timezone.utc).isoformat(),
            "on_chain_balance": round(on_chain, 2),
            "internal_bankroll": round(internal, 2),
            "drift_usd": drift,
            "drift_warn": abs(drift) > DRIFT_WARN_USD if on_chain > 0 else False,
            "open_positions_count": len(positions),
            "open_positions_cost_basis": cost_basis,
            "open_positions_value": current_value,
            "open_positions_unrealized": round(current_value - cost_basis, 2),
            "open_positions_live_marked": n_live_marked,
            "realized_pnl_24h_usd": pnl_24h,
            "realized_trades_24h": n_24h,
            "realized_pnl_1h_usd": pnl_1h,
            "realized_trades_1h": n_1h,
            "positions": positions[:50],
            "recent_events": list(reversed(recent_events)),
            "event_summary_1h": _event_kind_counts(events, 3600),
            "event_summary_24h": _event_kind_counts(events, 24 * 3600),
            "alerts_sent": [],
        }

        # Loss-alert check (Telegram side-effect)
        try:
            snapshot["alerts_sent"] = _check_loss_alerts(snapshot, events)
        except Exception as e:
            logger.debug(f"reality: loss-alert check failed: {e}")

        # Write the bridge file the dashboard reads.
        try:
            REALITY_FILE.write_text(json.dumps(snapshot, indent=2))
        except Exception as e:
            logger.warning(f"reality: could not write reality.json: {e}")

        # Append a compact slice to the bankroll history ringbuffer for
        # time-series alerts (1h drawdown).
        try:
            history = _read_history()
            history.append({
                "ts": snapshot["ts"],
                "on_chain_balance": snapshot["on_chain_balance"],
                "internal_bankroll": snapshot["internal_bankroll"],
                "open_positions_value": snapshot["open_positions_value"],
                "open_positions_cost_basis": snapshot["open_positions_cost_basis"],
            })
            _write_history(history)
        except Exception as e:
            logger.debug(f"reality: history append failed: {e}")

        # Add drift info to bankroll_state.json so existing watchers see it.
        try:
            existing: dict = {}
            if BANKROLL_STATE_FILE.exists():
                try:
                    existing = json.loads(BANKROLL_STATE_FILE.read_text()) or {}
                    if not isinstance(existing, dict):
                        existing = {}
                except Exception:
                    existing = {}
            existing["bankroll"] = round(internal, 4)
            existing["on_chain_balance"] = round(on_chain, 4)
            existing["drift_usd"] = drift
            existing["last_reality_sync"] = int(time.time())
            BANKROLL_STATE_FILE.write_text(json.dumps(existing))
        except Exception as e:
            logger.debug(f"reality: bankroll_state augment failed: {e}")

    except Exception as e:
        try:
            logger.warning(f"reality.tick swallowed: {e}")
        except Exception:
            pass


def _event_kind_counts(events: list[dict], window_secs: int) -> dict:
    cutoff = time.time() - window_secs
    counts: dict[str, int] = {}
    pnl_total = 0.0
    for e in events:
        if not isinstance(e, dict):
            continue
        if int(e.get("ts") or 0) < cutoff:
            continue
        k = str(e.get("kind") or "UNKNOWN")
        counts[k] = counts.get(k, 0) + 1
        details = e.get("details") or {}
        p = details.get("pnl_usd")
        if p is not None:
            try:
                pnl_total += float(p)
            except (TypeError, ValueError):
                pass
    counts["_pnl_usd"] = round(pnl_total, 2)
    return counts
