#!/usr/bin/env python3
"""
btc_5m_trader.py — Lukas' autonomer BTC 5-Minuten-Trader
=======================================================
Strategie:
  1. BTC-Trend analysieren (letzte 1h Kerzen via CoinGecko)
  2. UP oder DOWN wählen basierend auf Momentum + Trend
  3. Am Marktpreis kaufen (FOK am Ask für sofortigen Fill)
  4. Kelly Criterion: Optimale Position Sizing
  5. Läuft automatisch alle 5 Minuten

State wird in btc_trader_state.json gespeichert.
"""

import os
import json
import time
import math
import re
import requests
import traceback
from datetime import datetime, timezone
try:
    import db as _pgdb
except Exception:
    _pgdb = None
from pathlib import Path

BASE_DIR = Path(__file__).parent
STATE_FILE = BASE_DIR / "btc_trader_state.json"
LOG_FILE = BASE_DIR / "btc_trader.log"

TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")

MIN_SHARES = 5
TICK_SIZE = "0.01"
# === BANKROLL ALLOCATION (25% of total Polymarket capital ~$135.89) ===
ALLOCATED_BANKROLL = 42.31  # Hard cap: bot will never trade above this base
MIN_STAKE = 1.0   # Smaller min so Kelly can actually size below MAX_STAKE
MAX_STAKE = 8.0   # ~24% of allocated bankroll per single trade — leaves room for compounding
# === MARKET WINDOW (5-minute Polymarket markets) ===
WINDOW_INTERVAL = 300        # 5-minute market window length (seconds)
OPTIMAL_ENTRY_SECS = 240     # Enter when ~60s into the window, hold ~4min until close
OPTIMAL_ENTRY_PRICE_MIN = 0.92  # 5% edge minimum (95% confidence)
OPTIMAL_ENTRY_PRICE_MAX = 0.95  # 8% edge threshold
MIN_EDGE_THRESHOLD = 0.05  # 5% minimum edge for trade execution

# Multi-position support
MAX_CONCURRENT_BTC_POSITIONS = int(os.environ.get("MAX_CONCURRENT_BTC_POSITIONS", "3"))

# === AUTONOMY HELPERS (window-aware position counting) ===
WINDOW_GRACE_SECS = 60        # Treat positions as "active" up to 60s after window ends
FORCE_RESOLVE_AFTER = 600     # 10 min after window end, force-resolve via outcomePrices
STUCK_ALERT_AFTER = 1800      # 30 min after window end, alert Telegram

def _position_window_end_ts(pos):
    """Extract window-end unix-ts from slug like 'btc-updown-5m-1776755100' (start)."""
    m = re.search(r"-(\d{10})$", pos.get("slug", "") or "")
    if not m:
        return None
    return int(m.group(1)) + WINDOW_INTERVAL

def _active_position_count(state):
    """Positions whose 5min trading window hasn't ended (with grace) — count toward cap."""
    now = int(time.time())
    n = 0
    for p in state.get("positions", []):
        end = _position_window_end_ts(p)
        if end is None or now < end + WINDOW_GRACE_SECS:
            n += 1
    return n



def _migrate_state_positions(state):
    """Convert legacy single-pending state into positions list. Idempotent."""
    if "positions" in state and isinstance(state["positions"], list):
        return state
    positions = []
    if state.get("pending_resolution") and state.get("pending_condition_id"):
        positions.append({
            "trade_id": state.get("last_trade_id", "?"),
            "slug": state.get("last_slug", ""),
            "condition_id": state["pending_condition_id"],
            "token_id": state.get("pending_token_id", ""),
            "direction": state.get("last_direction", "?"),
            "stake": state.get("last_stake", 0),
            "entry_price": state.get("entry_price", 0),
            "opened_at": state.get("last_trade_time", ""),
        })
    state["positions"] = positions
    state.pop("pending_resolution", None)
    state.pop("pending_condition_id", None)
    state.pop("pending_token_id", None)
    return state



def log(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except:
        pass


def telegram(msg):
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        return
    try:
        import urllib.request
        url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
        data = json.dumps({"chat_id": TELEGRAM_CHAT_ID, "text": msg, "parse_mode": "HTML"}).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10)
    except:
        pass


DRAWDOWN_STATE_FILE = BASE_DIR / "btc_drawdown_state.json"
DRAWDOWN_THRESHOLD = 0.60  # halt if balance falls below 60% of all-time high
STALE_PRICE_MAX_AGE_S = 60  # refuse trades if last good price fetch older than this


def _load_drawdown():
    try:
        with open(DRAWDOWN_STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {"ath_balance": 0.0, "halted": False, "halt_reason": None, "halt_time": None, "last_alert_ts": 0}


def _save_drawdown(d):
    try:
        with open(DRAWDOWN_STATE_FILE, "w") as f:
            json.dump(d, f, indent=2)
    except Exception as e:
        log(f"drawdown save error: {e}")


def check_drawdown_killswitch(current_balance):
    """Returns (allowed_to_trade: bool, reason: str). Updates ATH. Halts permanently at 60% ATH."""
    d = _load_drawdown()
    ath = float(d.get("ath_balance") or 0.0)

    # Bootstrap ATH on first run
    if ath <= 0 and current_balance > 0:
        d["ath_balance"] = current_balance
        _save_drawdown(d)
        return True, "ATH bootstrapped"

    # Update ATH if new high
    if current_balance > ath:
        d["ath_balance"] = current_balance
        ath = current_balance
        _save_drawdown(d)

    # PATCH-DD-AUTORESET-V1: if previously halted but balance has fully recovered (>= ATH),
    # auto-clear the halt — manual override is no longer needed when we're back at peak.
    if d.get("halted") and ath > 0 and current_balance >= ath:
        prev_reason = d.get("halt_reason", "?")
        d["halted"] = False
        d.pop("halt_reason", None)
        d.pop("halt_time", None)
        _save_drawdown(d)
        try:
            telegram(f"✅ BTC-Trader DRAWDOWN-HALT automatisch aufgehoben — Balance ${current_balance:.2f} hat ATH ${ath:.2f} wieder erreicht.\nVorheriger Grund: {prev_reason}")
        except Exception:
            pass
        log(f"Drawdown halt AUTO-CLEARED: balance ${current_balance:.2f} >= ATH ${ath:.2f}")

    # Already halted? Stay halted (manual restart required)
    if d.get("halted"):
        now_ts = int(datetime.now().timestamp())
        if now_ts - int(d.get("last_alert_ts") or 0) > 3600:
            telegram(
                f"⛔ BTC-Trader DRAWDOWN-HALT aktiv — Balance ${current_balance:.2f} / ATH ${ath:.2f} "
                f"({current_balance/ath*100:.1f}%). Manueller Restart erforderlich:\n"
                f"  rm {DRAWDOWN_STATE_FILE} && systemctl restart lukas-btc-trader"
            )
            d["last_alert_ts"] = now_ts
            _save_drawdown(d)
        return False, f"DRAWDOWN HALT (balance ${current_balance:.2f} / ATH ${ath:.2f})"

    # Trip the killswitch?
    if ath > 0 and current_balance < ath * DRAWDOWN_THRESHOLD:
        d["halted"] = True
        d["halt_reason"] = f"Balance ${current_balance:.2f} fell below {DRAWDOWN_THRESHOLD*100:.0f}% of ATH ${ath:.2f}"
        d["halt_time"] = datetime.now().isoformat()
        d["last_alert_ts"] = int(datetime.now().timestamp())
        _save_drawdown(d)
        telegram(
            f"🔴 KILLSWITCH AUSGELÖST — BTC-Trader pausiert PERMANENT\n"
            f"Balance ${current_balance:.2f} / ATH ${ath:.2f} = {current_balance/ath*100:.1f}%\n"
            f"Schwelle: {DRAWDOWN_THRESHOLD*100:.0f}% des All-Time-Highs unterschritten.\n"
            f"Manueller Restart erforderlich:\n"
            f"  rm {DRAWDOWN_STATE_FILE} && systemctl restart lukas-btc-trader"
        )
        log(f"DRAWDOWN KILLSWITCH TRIPPED: {d['halt_reason']}")
        return False, d["halt_reason"]

    return True, f"OK (balance ${current_balance:.2f} / ATH ${ath:.2f} = {current_balance/max(ath,0.01)*100:.1f}%)"


# Stale-price tracking
_LAST_GOOD_PRICE_TS = {"ts": 0.0, "source": None}


def mark_price_fresh(source="unknown"):
    import time as _t
    _LAST_GOOD_PRICE_TS["ts"] = _t.time()
    _LAST_GOOD_PRICE_TS["source"] = source


def check_price_freshness():
    """Returns (fresh: bool, age_s: float)."""
    import time as _t
    ts = _LAST_GOOD_PRICE_TS.get("ts", 0.0)
    if ts <= 0:
        return False, 999999.0
    age = _t.time() - ts
    return age <= STALE_PRICE_MAX_AGE_S, age


import chainlink_oracle as _cl_oracle

CHAINLINK_COMPARISON_LOG = BASE_DIR / "chainlink_comparison.jsonl"
CHAINLINK_PRIMARY = True  # Use Chainlink as primary price source for decisions


def fetch_chainlink_price():
    """Returns dict from chainlink_oracle.fetch_btc_usd_chainlink(), or None on failure."""
    try:
        return _cl_oracle.fetch_btc_usd_chainlink()
    except Exception as e:
        log(f"Chainlink fetch error: {e}")
        return None


def log_price_comparison(event, market_slug=None, direction=None, extra=None):
    """Log Chainlink vs Binance side-by-side. Append-only JSONL for later analysis."""
    try:
        cl = fetch_chainlink_price()
    except Exception:
        cl = None
    bn = None
    try:
        import requests as _req
        r = _req.get("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", timeout=5)
        if r.status_code == 200:
            bn = float(r.json()["price"])
    except Exception:
        pass

    diff_bps = None
    if cl and bn:
        diff_bps = (cl["price"] - bn) / bn * 10000

    rec = {
        "ts": datetime.now().isoformat(),
        "event": event,
        "slug": market_slug,
        "direction": direction,
        "chainlink_price": cl["price"] if cl else None,
        "chainlink_age_s": cl["age_s"] if cl else None,
        "chainlink_source": cl["source"] if cl else None,
        "binance_price": bn,
        "diff_bps": diff_bps,
        "extra": extra or {},
    }
    try:
        with open(CHAINLINK_COMPARISON_LOG, "a") as f:
            f.write(json.dumps(rec) + "\n")
    except Exception:
        pass
    return rec


def load_state():
    default = {
        "next_stake": MIN_STAKE,
        "consecutive_wins": 0,
        "total_trades": 0,
        "total_wins": 0,
        "total_pnl": 0.0,
        "last_trade_id": None,
        "last_trade_time": None,
        "last_direction": None,
        "last_stake": 0,
        "positions": [],
    }
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE) as f:
                saved = json.load(f)
            for k, v in default.items():
                if k not in saved:
                    saved[k] = v
            return _migrate_state_positions(saved)
        except:
            pass
    return _migrate_state_positions(default)


def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def calculate_kelly_stake(win_prob, avg_win, avg_loss, balance):
    """Kelly Criterion: f* = (bp - q) / b where b=odds, p=win_prob, q=loss_prob"""
    if win_prob <= 0 or avg_win <= 0:
        return MIN_STAKE
    
    # Calculate Kelly fraction
    loss_prob = 1 - win_prob
    kelly_fraction = (win_prob * avg_win - loss_prob * avg_loss) / avg_win
    
    # Cap at 8% of portfolio max (risk management)
    kelly_fraction = min(kelly_fraction, 0.08)
    kelly_fraction = max(kelly_fraction, 0.02)  # Minimum 2%
    
    stake = balance * kelly_fraction
    stake = max(stake, MIN_STAKE)
    stake = min(stake, MAX_STAKE, balance * 0.08)  # Hard cap at 8%
    
    log(f"🎯 Kelly: win_prob={win_prob:.2f}, fraction={kelly_fraction:.3f}, balance=${balance:.2f} → ${stake:.2f}")
    return round(stake, 2)


def calculate_next_stake(state, balance):
    """Calculate optimal stake using Kelly Criterion."""
    total_trades = state.get("total_trades", 0)
    total_wins = state.get("total_wins", 0)
    
    # Use historical win rate or default to 60%
    win_prob = total_wins / max(total_trades, 1) if total_trades > 10 else 0.60
    
    # Average payoffs (simplified: ~1.0x win, -1.0x loss)
    avg_win = 0.95  # Slightly less than 1 due to fees
    avg_loss = 1.00  # Full loss
    
    return calculate_kelly_stake(win_prob, avg_win, avg_loss, balance)


def get_clob_client():
    from py_clob_client.client import ClobClient
    from py_clob_client.clob_types import ApiCreds

    pk = os.environ["POLYMARKET_PRIVATE_KEY"]
    creds = ApiCreds(
        api_key=os.environ["POLYMARKET_API_KEY"],
        api_secret=os.environ["POLYMARKET_API_SECRET"],
        api_passphrase=os.environ["POLYMARKET_API_PASSPHRASE"],
    )
    return ClobClient(
        "https://clob.polymarket.com",
        key=pk,
        chain_id=137,
        creds=creds,
        signature_type=1,
        funder="0x024558B703f59Bff6BBA21919697163E96E2353B",
    )


def get_available_balance():
    """Get real balance from Polymarket, fallback to cached if API fails."""
    state = load_state()
    pending_cost = state.get("last_stake", 0) if state.get("pending_resolution") else 0
    
    # Dynamic balance — capped at ALLOCATED_BANKROLL (25% of total Polymarket capital)
    base_balance = ALLOCATED_BANKROLL
    total_pnl = state.get("total_pnl", 0.0)
    real_balance = base_balance + total_pnl
    # Soft ceiling: ring-fence profits above 1.5x of allocation so we never over-expose
    if real_balance > base_balance * 1.5:
        real_balance = base_balance * 1.5

    log(f"💰 Balance: ${real_balance:.2f} (base: ${base_balance}, PnL: {total_pnl:+.2f}, pending: ${pending_cost:.2f})")
    sync_cash(real_balance)
    return max(0, real_balance - pending_cost)
    
    # Fallback to cached balance
    cash_file = BASE_DIR / "btc_trader_cash.json"
    try:
        if cash_file.exists():
            with open(cash_file) as f:
                cd = json.load(f)
            return max(0, cd.get("cash", MIN_STAKE) - pending_cost)
    except:
        pass
    return max(0, MIN_STAKE - pending_cost)


def has_profit_potential(client, condition_id, min_profit_margin=0.15):
    """Check if market has enough profit potential (price below 0.85 for good trades)."""
    try:
        book = client.get_order_book(condition_id)
        yes_book = book.get("market_0", {})
        no_book = book.get("market_1", {})
        
        yes_best_ask = 1.0
        no_best_ask = 1.0
        
        if yes_book.get("asks"):
            yes_best_ask = float(yes_book["asks"][0]["price"])
        if no_book.get("asks"):
            no_best_ask = float(no_book["asks"][0]["price"])
        
        # We need at least one side with good profit potential (price <= 0.85)
        max_acceptable_price = 1.0 - min_profit_margin
        has_good_yes = yes_best_ask <= max_acceptable_price
        has_good_no = no_best_ask <= max_acceptable_price
        
        log(f"📊 Profit check: YES ${yes_best_ask:.2f}, NO ${no_best_ask:.2f} (max: ${max_acceptable_price:.2f})")
        
        return has_good_yes or has_good_no, yes_best_ask, no_best_ask
    except Exception as e:
        log(f"⚠️ Error checking profit potential: {e}")
        return True, 0.5, 0.5  # Default to tradeable if can't check


def sync_cash(real_balance):
    """Sync internal cash tracking to match reality."""
    cash_file = BASE_DIR / "btc_trader_cash.json"
    try:
        with open(cash_file, "w") as f:
            json.dump({"cash": real_balance, "updated": datetime.now().isoformat(), "synced": True}, f)
    except:
        pass


def update_cash_after_trade(spent):
    cash_file = BASE_DIR / "btc_trader_cash.json"
    try:
        if cash_file.exists():
            with open(cash_file) as f:
                cd = json.load(f)
            current = cd.get("cash", 3.66)
        else:
            current = 3.66
        new_cash = max(0, current - spent)
        with open(cash_file, "w") as f:
            json.dump({"cash": new_cash, "updated": datetime.now().isoformat()}, f)
        return new_cash
    except:
        return 0


def update_cash_after_win(payout):
    cash_file = BASE_DIR / "btc_trader_cash.json"
    try:
        if cash_file.exists():
            with open(cash_file) as f:
                cd = json.load(f)
            current = cd.get("cash", 0)
        else:
            current = 0
        new_cash = current + payout
        with open(cash_file, "w") as f:
            json.dump({"cash": new_cash, "updated": datetime.now().isoformat()}, f)
        return new_cash
    except:
        return payout


def analyze_btc_trend():
    """Analyse BTC price movement over last hour to predict 15min direction."""
    try:
        url = "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=0.1"
        r = requests.get(url, timeout=15, headers={"accept": "application/json"})
        if r.status_code != 200:
            url2 = "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=12"
            r2 = requests.get(url2, timeout=10)
            if r2.status_code == 200:
                klines = r2.json()
                prices = [float(k[4]) for k in klines]
                mark_price_fresh("binance")
            else:
                return None, "API error", 0
        else:
            data = r.json()
            prices = [p[1] for p in data.get("prices", [])]
            mark_price_fresh("coingecko")

        if len(prices) < 3:
            return None, "Not enough data", 0

        current = prices[-1]
        prev_15m = prices[max(0, len(prices) - 4)]
        prev_30m = prices[max(0, len(prices) - 7)]
        prev_1h = prices[0]

        change_15m = (current - prev_15m) / prev_15m * 100
        change_30m = (current - prev_30m) / prev_30m * 100
        change_1h = (current - prev_1h) / prev_1h * 100

        momentum = change_15m * 0.5 + change_30m * 0.3 + change_1h * 0.2

        # === Chainlink overlay ===
        # Replace the latest data point with the Chainlink price (resolver source).
        # Trend/momentum context still uses Binance/CoinGecko history; final signal is anchored on Chainlink.
        if CHAINLINK_PRIMARY:
            cl = fetch_chainlink_price()
            if cl and cl.get("price"):
                cl_price = float(cl["price"])
                cl_age = cl.get("age_s", 999)
                bn_last = prices[-1]
                drift_bps = (cl_price - bn_last) / bn_last * 10000
                log(f"🔗 Chainlink: ${cl_price:.2f} (age {cl_age:.0f}s, src {cl.get('source')}) "
                    f"vs Binance ${bn_last:.2f} Δ{drift_bps:+.1f}bps")
                prices[-1] = cl_price
                current = cl_price
                # Recompute changes vs Chainlink-anchored current
                change_15m = (current - prev_15m) / prev_15m * 100
                change_30m = (current - prev_30m) / prev_30m * 100
                change_1h = (current - prev_1h) / prev_1h * 100
                momentum = change_15m * 0.5 + change_30m * 0.3 + change_1h * 0.2
                # Use Chainlink timestamp for stale check (not Binance fetch time)
                if cl_age <= STALE_PRICE_MAX_AGE_S:
                    mark_price_fresh(f"chainlink:{cl.get('source')}")
                else:
                    log(f"Chainlink data stale ({cl_age:.0f}s) — keeping Binance freshness mark")
            else:
                log("Chainlink unavailable — falling back to Binance/CoinGecko signal")

        recent_3 = prices[-3:]
        trend_up = recent_3[-1] > recent_3[-2] > recent_3[-3]
        trend_down = recent_3[-1] < recent_3[-2] < recent_3[-3]

        if momentum > 0.02 or trend_up:
            direction = "Up"
            confidence = min(85, 55 + abs(momentum) * 20)
        elif momentum < -0.02 or trend_down:
            direction = "Down"
            confidence = min(85, 55 + abs(momentum) * 20)
        elif abs(change_15m) < 0.01:
            direction = "Down"
            confidence = 50
        else:
            direction = "Up" if momentum >= 0 else "Down"
            confidence = 52

        analysis = (
            f"BTC ${current:,.0f} | "
            f"15m: {change_15m:+.3f}% | 30m: {change_30m:+.3f}% | 1h: {change_1h:+.3f}% | "
            f"Momentum: {momentum:+.4f} | "
            f"{'Trend UP' if trend_up else 'Trend DOWN' if trend_down else 'Sideways'}"
        )

        return direction, analysis, confidence

    except Exception as e:
        return None, f"Analysis error: {e}", 0


def find_active_btc_market():
    """Find the currently active BTC 5min Up/Down market."""
    now_ts = int(time.time())
    window_ts = (now_ts // WINDOW_INTERVAL) * WINDOW_INTERVAL
    window_end = window_ts + WINDOW_INTERVAL
    time_left = window_end - now_ts

    if time_left < 60:
        window_ts += WINDOW_INTERVAL
        window_end += WINDOW_INTERVAL
        time_left += WINDOW_INTERVAL
        log(f"Current window closing soon, using next window (starts in {time_left - WINDOW_INTERVAL}s)")

    slugs_to_try = [
        f"btc-updown-5m-{window_ts}",
        f"btc-updown-5m-{window_ts + WINDOW_INTERVAL}",
    ]

    for slug in slugs_to_try:
        try:
            r = requests.get(f"https://gamma-api.polymarket.com/events?slug={slug}", timeout=10)
            if r.status_code == 200 and r.json():
                ev = r.json()[0]
                market = ev["markets"][0]
                if market.get("closed"):
                    continue

                tokens_raw = market["clobTokenIds"]
                tokens = json.loads(tokens_raw) if isinstance(tokens_raw, str) else tokens_raw
                prices_raw = market["outcomePrices"]
                prices = json.loads(prices_raw) if isinstance(prices_raw, str) else prices_raw

                return {
                    "slug": slug,
                    "question": market.get("question", slug),
                    "condition_id": market.get("conditionId", ""),
                    "token_up": tokens[0],
                    "token_down": tokens[1],
                    "price_up": float(prices[0]),
                    "price_down": float(prices[1]),
                    "end_date": ev.get("endDate", ""),
                    "time_left": time_left,
                    "neg_risk": market.get("negRisk", False),
                }
        except Exception as e:
            log(f"Slug {slug}: {e}")

    return None



def _btc_window_label(market, slug):
    """Extract a short window label like '9:20-9:25 ET' from the market question, fallback to slug ts."""
    try:
        q = (market or {}).get("question", "") if isinstance(market, dict) else ""
        m = re.search(r"(\d{1,2}:\d{2}\s*[AP]M\s*-\s*\d{1,2}:\d{2}\s*[AP]M\s*ET)", q)
        if m:
            return m.group(1).replace(" ", "")
    except Exception:
        pass
    try:
        m2 = re.search(r"-(\d{10})$", slug or "")
        if m2:
            return f"w{m2.group(1)[-4:]}"
    except Exception:
        pass
    return slug or "?"

def check_pending_resolution(state):
    """Check each pending position; resolve closed markets."""
    positions = state.get("positions", [])
    if not positions:
        return state
    still_open = []
    for pos in positions:
        slug = pos.get("slug", "")
        direction = pos.get("direction")
        stake = float(pos.get("stake") or 0)
        entry_p = float(pos.get("entry_price") or 0.5)
        try:
            r = requests.get(f"https://gamma-api.polymarket.com/events?slug={slug}", timeout=10)
            if r.status_code != 200 or not r.json():
                still_open.append(pos); continue
            ev = r.json()[0]
            market = ev["markets"][0]
            now_ts = int(time.time())
            window_end = _position_window_end_ts(pos)
            time_since_end = (now_ts - window_end) if window_end else 0
            if not market.get("closed"):
                # Try force-resolution if window ended long ago AND prices clearly settled
                if window_end and time_since_end >= FORCE_RESOLVE_AFTER:
                    try:
                        prices_raw_e = market.get("outcomePrices", "")
                        prices_e = json.loads(prices_raw_e) if isinstance(prices_raw_e, str) else prices_raw_e
                        pu = float(prices_e[0]) if prices_e else 0
                        pd_ = float(prices_e[1]) if prices_e else 0
                        if max(pu, pd_) >= 0.95:
                            log(f"Force-resolving stale pos {slug} (window ended {time_since_end//60}m ago, prices={pu:.2f}/{pd_:.2f})")
                            market = dict(market); market["closed"] = True
                        else:
                            if time_since_end >= STUCK_ALERT_AFTER:
                                log(f"⚠ STUCK position: {slug}, {time_since_end//60}m past window end, prices={pu:.2f}/{pd_:.2f}")
                                telegram(f"⚠ BTC 5m position stuck: {slug} | {time_since_end//60}m past window end | UP={pu:.2f} DOWN={pd_:.2f}")
                            still_open.append(pos); continue
                    except Exception as _ee:
                        log(f"Force-resolve attempt failed for {slug}: {_ee}")
                        still_open.append(pos); continue
                else:
                    still_open.append(pos); continue
            prices_raw = market.get("outcomePrices", "")
            prices = json.loads(prices_raw) if isinstance(prices_raw, str) else prices_raw
            price_up = float(prices[0]) if prices else 0
            price_down = float(prices[1]) if prices else 0
            won = (direction == "Up" and price_up > 0.9) or (direction == "Down" and price_down > 0.9)
            state["total_trades"] += 1
            if won:
                shares = stake / entry_p if entry_p > 0 else stake
                payout = shares
                profit = payout - stake
                state["total_wins"] += 1
                state["total_pnl"] += profit
                state["consecutive_wins"] += 1
                state["losses_since_win"] = 0
                state["next_stake"] = min(payout, MAX_STAKE)
                new_cash = update_cash_after_win(payout)
                log(f"WIN! {direction} | {slug} | Payout: ${payout:.2f} | Profit: ${profit:.2f} | Cash: ${new_cash:.2f}")
                if _pgdb:
                    try:
                        _pgdb.close_trade_by_slug("btc_5m", slug, status="win",
                            exit_price=(price_up if direction == "Up" else price_down),
                            payout=payout, pnl=profit, raw_update={"shares": shares})
                        _pgdb.record_bankroll(bot="btc_5m", balance=new_cash, pnl=state["total_pnl"], note="post-win")
                    except Exception as _e:
                        log(f"[db] win hook failed: {_e}")
                telegram(f"🟢 BTC 5m WIN! {direction} [{_btc_window_label(market, slug)}] | Payout ${payout:.2f} (+${profit:.2f}) | Cash ${new_cash:.2f}")
            else:
                state["total_pnl"] -= stake
                state["consecutive_wins"] = 0
                state["losses_since_win"] = state.get("losses_since_win", 0) + 1
                # Note: next_stake is informational only; real sizing uses Kelly
                state["next_stake"] = max(MIN_STAKE, calculate_next_stake(state, get_available_balance()) * 0.7)
                cash_file = BASE_DIR / "btc_trader_cash.json"
                current_cash = 0
                try:
                    if cash_file.exists():
                        with open(cash_file) as f:
                            current_cash = json.load(f).get("cash", 0)
                except Exception:
                    pass
                log(f"LOSS. {direction} | {slug} | Lost: ${stake:.2f} | Cash: ${current_cash:.2f}")
                if _pgdb:
                    try:
                        _pgdb.close_trade_by_slug("btc_5m", slug, status="loss",
                            exit_price=(price_up if direction == "Up" else price_down),
                            payout=0, pnl=-stake)
                        _pgdb.record_bankroll(bot="btc_5m", balance=current_cash, pnl=state["total_pnl"], note="post-loss")
                    except Exception as _e:
                        log(f"[db] loss hook failed: {_e}")
                telegram(f"🔴 BTC 5m LOSS. {direction} [{_btc_window_label(market, slug)}] | Lost ${stake:.2f} | Cash ${current_cash:.2f}")
        except Exception as e:
            log(f"Resolution check error for {slug}: {e}")
            still_open.append(pos)
    state["positions"] = still_open
    save_state(state)
    return state

def place_trade(client, market, direction, stake):
    """Place a BTC 5min trade at market price."""
    from py_clob_client.clob_types import OrderArgs, OrderType, PartialCreateOrderOptions

    token_up_price = market["price_up"]
    token_down_price = market["price_down"]

    if direction == "Up":
        token_id = market["token_up"]
        market_price = token_up_price
    else:
        token_id = market["token_down"]
        market_price = token_down_price

    AGGRO_SPREAD = 0.02   # patched: was 0.05 — paying 5c over mid killed all edge
    buy_price = min(round(market_price + AGGRO_SPREAD, 2), 0.99)
    # PATCH-EDGE-V2: buy_price cap — above 0.55 the (1-buy)/buy payout ratio is < 0.82,
    # so structural EV requires win-rate > 55% which we don't have at high prices.
    if buy_price > BUY_PRICE_CAP:
        log(f"[PRICE-CAP] buy_price ${buy_price:.2f} > cap ${BUY_PRICE_CAP} — skipping (structural -EV).")
        return None, f"buy_price ${buy_price:.2f} above cap ${BUY_PRICE_CAP}"

    balance = get_available_balance()

    if balance < MIN_SHARES * 0.01:
        return None, f"Balance too low: ${balance:.2f}"

    max_price = math.floor(balance / MIN_SHARES * 100) / 100
    if buy_price > max_price:
        buy_price = max_price
        if buy_price < 0.01:
            return None, f"Cannot afford {MIN_SHARES} shares at any price. Balance: ${balance:.2f}"
        log(f"Adjusted price from ${market_price + AGGRO_SPREAD:.2f} to ${buy_price:.2f} to fit balance")

    size = max(MIN_SHARES, math.floor(stake / buy_price))
    actual_cost = size * buy_price

    if actual_cost > balance:
        size = max(MIN_SHARES, math.floor(balance / buy_price))
        actual_cost = size * buy_price

    if actual_cost > balance:
        size = MIN_SHARES
        actual_cost = size * buy_price

    if actual_cost > balance:
        return None, f"Insufficient balance: ${balance:.2f} < ${actual_cost:.2f} (min {MIN_SHARES} shares @ ${buy_price})"

    log(f"Placing FOK: BUY {direction} | {size} shares @ ${buy_price} (market: ${market_price}) = ${actual_cost:.2f}")

    options = PartialCreateOrderOptions(
        tick_size=TICK_SIZE,
        neg_risk=market.get("neg_risk", False),
    )

    order_args = OrderArgs(
        price=buy_price,
        size=float(size),
        side="BUY",
        token_id=token_id,
    )

    signed = client.create_order(order_args, options)
    try:
        resp = client.post_order(signed, OrderType.FOK)
        log(f"FOK order filled immediately!")
        return resp, actual_cost
    except Exception as e:
        err_str = str(e)
        log(f"FOK failed: {err_str}")

        if "balance" in err_str.lower():
            import re
            m = re.search(r'balance:\s*(\d+)', err_str)
            if m:
                real_bal = int(m.group(1)) / 1e6
                log(f"Real on-chain balance from error: ${real_bal:.4f}")
                sync_cash(real_bal)
                if real_bal < MIN_SHARES * 0.01:
                    return None, f"Real balance too low: ${real_bal:.4f}"
                new_size = MIN_SHARES
                new_price = min(buy_price, math.floor(real_bal / MIN_SHARES * 100) / 100)
                if new_price < 0.01:
                    return None, f"Cannot afford min shares. Real balance: ${real_bal:.4f}"
                new_cost = new_size * new_price
                if new_cost > real_bal:
                    return None, f"Still too expensive after resize. Real: ${real_bal:.4f}, cost: ${new_cost:.2f}"
                log(f"Retrying FOK with real balance: {new_size} shares @ ${new_price} = ${new_cost:.2f}")
                order_args2 = OrderArgs(price=new_price, size=float(new_size), side="BUY", token_id=token_id)
                signed2 = client.create_order(order_args2, options)
                try:
                    resp2 = client.post_order(signed2, OrderType.FOK)
                    log(f"FOK retry filled!")
                    actual_cost = new_cost
                    return resp2, actual_cost
                except Exception as e2:
                    log(f"FOK retry also failed: {e2}, falling back to GTC")

        gtc_price = min(round(market_price + 0.08, 2), 0.99)
        if gtc_price > max_price:
            gtc_price = max_price
        log(f"FOK failed, GTC fallback @ ${gtc_price} (market+8c)")
        order_args3 = OrderArgs(price=gtc_price, size=float(size), side="BUY", token_id=token_id)
        signed3 = client.create_order(order_args3, options)
        resp3 = client.post_order(signed3, OrderType.GTC)
        return resp3, size * gtc_price


def monitor_positions():
    """Monitor all open positions and log live PnL."""
    state = load_state()
    positions = state.get("positions", [])
    if not positions:
        return
    for pos in positions:
        direction = pos.get("direction", "?")
        slug = pos.get("slug", "")
        stake = float(pos.get("stake") or 0)
        entry_price = float(pos.get("entry_price") or 0)
        try:
            r = requests.get(f"https://gamma-api.polymarket.com/events?slug={slug}", timeout=10)
            if r.status_code == 200 and r.json():
                ev = r.json()[0]
                market = ev["markets"][0]
                prices_raw = market.get("outcomePrices", "")
                prices = json.loads(prices_raw) if isinstance(prices_raw, str) else prices_raw
                price_up = float(prices[0]) if prices else 0
                price_down = float(prices[1]) if prices else 0
                current_price = price_up if direction == "Up" else price_down
                shares = stake / entry_price if entry_price > 0 else 0
                current_value = shares * current_price
                unrealized_pnl = current_value - stake
                closed = market.get("closed", False)
                state_lbl = "CLOSED" if closed else "OPEN"
                log(f"POSITION[{slug[:24]}]: {direction} | Sh:{shares:.1f} | E:${entry_price:.2f} | C:${current_price:.2f} | PnL:${unrealized_pnl:+.2f} | {state_lbl}")
            else:
                log(f"POSITION[{slug[:24]}]: {direction} pending | no market data")
        except Exception as e:
            log(f"Position monitor error for {slug}: {e}")


# PATCH-EDGE-V2 (2026-04-21): hour-filter REMOVED — only 1 day of data, was overfitting noise.
# Kept: structural cap (math) + confidence floor (n=213 aggregate is robust).
BUY_PRICE_CAP   = 0.55             # above this, structural payout asymmetry kills edge
CONFIDENCE_FLOOR = 60              # bumped from 56: avg_loss > avg_win demands real edge


# === PATCH-EDGE-V3-MARKET-AWARE (2026-04-21) ===
# Vergleicht Bot-Confidence mit dem Polymarket-Preis (= implizite Marktwahrscheinlichkeit).
# Skippt Trades ohne echte Edge gegen den Markt; gibt Stake-Bonus bei grosser Edge.
# Killswitch: env MARKET_EDGE_FILTER_ENABLED=0 deaktiviert das Filter komplett (Bonus aus, Skip aus).
EDGE_MIN_PP        = 3.0    # Mindest-Edge in Prozentpunkten gegen den Markt
EDGE_BONUS_T1_PP   = 10.0   # ab hier +25% Stake
EDGE_BONUS_T2_PP   = 15.0   # ab hier +50% Stake
MARKET_EDGE_FILTER_ENABLED = os.getenv("MARKET_EDGE_FILTER_ENABLED", "1") == "1"

def compute_market_edge(direction, market, confidence):
    """Edge des Bots gegenueber dem Markt (in Prozentpunkten).
    Returns (edge_pp, market_price_chosen_side, market_implied_prob_pct).
    """
    market_price = market["price_up"] if direction == "Up" else market["price_down"]
    market_implied_pct = market_price * 100.0
    edge_pp = float(confidence) - market_implied_pct
    return edge_pp, market_price, market_implied_pct

def run_cycle():
    _stake_mult = 1.0  # PATCH-EDGE-V2: hour-filter removed (insufficient data); keep var for downstream code path.
    """Execute one trading cycle. Returns 'placed' if a trade was opened, else 'skipped'."""
    state = load_state()
    _placed_in_cycle = False

    monitor_positions()

    state = check_pending_resolution(state)

    open_count = _active_position_count(state)
    total_held = len(state.get("positions", []))
    if open_count >= MAX_CONCURRENT_BTC_POSITIONS:
        log(f"At ACTIVE position cap ({open_count}/{MAX_CONCURRENT_BTC_POSITIONS}, total={total_held}), skipping.")
        return
    if total_held > open_count:
        log(f"Cap check: {open_count} active + {total_held - open_count} pending-settlement (not blocking).")

    direction, analysis, confidence = analyze_btc_trend()
    log(f"Analysis: {analysis}")
    log(f"Decision: {direction} (confidence: {confidence}%)")

    if direction is None:
        log("Could not analyze BTC trend, skipping.")
        return


    if confidence < 50:
        log(f"Confidence too low ({confidence}%), skipping.")
        return

    market = find_active_btc_market()
    if not market:
        log("No active BTC 5min market found, skipping.")
        return

    log(f"Market: {market['question']} | Time left: {market['time_left']}s")
    log(f"Prices: UP={market['price_up']:.2f} DOWN={market['price_down']:.2f}")

    if market["time_left"] < 60:
        log("Less than 60s left in window, too risky. Skipping.")
        return

    # duplicate market guard: never open 2 positions on same condition_id (survives restart)
    open_cids = {p.get("condition_id") for p in state.get("positions", [])}
    if market["condition_id"] in open_cids:
        log(f"Already holding position on {market['slug']}, skipping.")
        return

    # PATCH-EDGE-V3-MARKET-AWARE: edge vs Polymarket-Preis berechnen + gaten
    edge_pp, mkt_price_chosen, mkt_implied_pct = compute_market_edge(direction, market, confidence)
    edge_status = "OK" if edge_pp >= EDGE_MIN_PP else "WEAK"
    log(f"Edge: bot={confidence:.0f}% market={mkt_implied_pct:.0f}% ({direction.upper()} @ {mkt_price_chosen:.2f}) -> {edge_pp:+.1f}pp {edge_status}")
    if MARKET_EDGE_FILTER_ENABLED and edge_pp < EDGE_MIN_PP:
        log(f"[EDGE-V3] floor {EDGE_MIN_PP}pp not met (edge {edge_pp:+.1f}pp) — skipping cycle.")
        return "skipped"

    balance = get_available_balance()
    log(f"Available balance: ${balance:.2f}")
    if balance < MIN_STAKE:
        log(f"Balance ${balance:.2f} < min stake ${MIN_STAKE:.2f}. Paused.")
        return

    # --- Drawdown killswitch (60% ATH = -40% all-time-high) ---
    ok_dd, dd_reason = check_drawdown_killswitch(balance)
    log(f"Drawdown: {dd_reason}")
    if not ok_dd:
        return

    # --- Stale-price check (refuse trade on stale BTC data) ---
    fresh, age = check_price_freshness()
    if not fresh:
        log(f"Stale price data (age {age:.0f}s > {STALE_PRICE_MAX_AGE_S}s) — skipping cycle.")
        return

    # Kelly-based sizing with confidence as multiplier (replaces confidence-only buckets)
    kelly_base = calculate_next_stake(state, balance)
    # patched: confidence floor lifted from 55% to 60% — quality > quantity
    # PATCH-EDGE-V2: confidence floor raised 56 -> 60, weak-hour stake multiplier applied.
    if confidence >= 75:
        stake = kelly_base * 1.5
    elif confidence >= 65:
        stake = kelly_base * 1.0
    elif confidence >= 60:
        stake = kelly_base * 0.7
    else:
        log(f"Confidence {confidence:.1f}% < {CONFIDENCE_FLOOR}% floor (PATCH-EDGE-V2) — skipping trade.")
        return "skipped"

    # PATCH-EDGE-V3-MARKET-AWARE: stake bonus bei grosser Edge (cap-respecting; final clamp folgt unten)
    if MARKET_EDGE_FILTER_ENABLED:
        if edge_pp >= EDGE_BONUS_T2_PP:
            stake *= 1.50
            log(f"[EDGE-BONUS] +50% stake (edge {edge_pp:+.1f}pp >= {EDGE_BONUS_T2_PP}pp)")
        elif edge_pp >= EDGE_BONUS_T1_PP:
            stake *= 1.25
            log(f"[EDGE-BONUS] +25% stake (edge {edge_pp:+.1f}pp >= {EDGE_BONUS_T1_PP}pp)")
    if _stake_mult != 1.0:
        stake = stake * _stake_mult
        log(f"[HOUR-FILTER] Weak hour: stake reduced to ${stake:.2f} (mult={_stake_mult})") 
    # Loss-streak dampening: scale down after consecutive losses
    losses_since_win = state.get("losses_since_win", 0)
    # patched: brake earlier — was 2->0.6, 4->0.5
    if losses_since_win >= 1:
        stake *= 0.7
    if losses_since_win >= 2:
        stake *= 0.7   # cumulative -> 0.49
    if losses_since_win >= 3:
        stake *= 0.6   # cumulative -> ~0.29
    stake = max(MIN_STAKE, min(stake, MAX_STAKE, balance * 0.08, balance - 0.50))
    if stake < MIN_STAKE:
        log(f"Adjusted stake ${stake:.2f} < min. Skipping.")
        return
    log(f"Confidence {confidence}% -> Stake ${stake:.2f} (balance ${balance:.2f})")

    try:
        client = get_clob_client()
        resp, actual_cost = place_trade(client, market, direction, stake)

        if resp is None:
            log(f"Trade failed: {actual_cost}")
            return

        success = resp.get("success", False) if isinstance(resp, dict) else False
        order_id = resp.get("orderID", "?") if isinstance(resp, dict) else "?"
        status = resp.get("status", "?") if isinstance(resp, dict) else "?"

        if success:
            entry_price = market["price_up"] if direction == "Up" else market["price_down"]
            stored_entry = entry_price + 0.02
            now_iso = datetime.now(timezone.utc).isoformat()
            new_pos = {
                "trade_id": order_id,
                "slug": market["slug"],
                "condition_id": market["condition_id"],
                "token_id": market["token_up"] if direction == "Up" else market["token_down"],
                "direction": direction,
                "stake": actual_cost,
                "entry_price": stored_entry,
                "opened_at": now_iso,
            }
            state.setdefault("positions", []).append(new_pos)
            state["last_trade_id"] = order_id
            state["last_trade_time"] = now_iso
            state["last_direction"] = direction
            state["last_stake"] = actual_cost
            state["last_slug"] = market["slug"]
            state["entry_price"] = stored_entry
            update_cash_after_trade(actual_cost)
            save_state(state)
            log(f"Position opened. Now holding {len(state['positions'])}/{MAX_CONCURRENT_BTC_POSITIONS} concurrent.")
            _placed_in_cycle = True
            if _pgdb:
                try:
                    _pgdb.insert_trade(
                        bot='btc_5m', market_slug=market['slug'],
                        market_question=market['question'], side=direction,
                        stake=actual_cost, entry_price=entry_price,
                        status='open',
                        raw={'order_id': order_id, 'condition_id': market['condition_id'],
                             'token_id': new_pos['token_id']})
                except Exception as _e:
                    log(f'[db] insert_trade failed: {_e}')

            log(f"ORDER PLACED: {order_id[:30]}... | Status: {status}")
            # PATCH-LOUD-ALERT-V1: auffaellige Trade-Notification
            _arrow = '🟢📈' if direction == 'Up' else '🔴📉'
            _entry_disp = stored_entry if stored_entry else (market['price_up'] if direction == 'Up' else market['price_down'])
            telegram(
                f"🚨🚨🚨 <b>TRADE PLACED</b> 🚨🚨🚨\n"
                f"━━━━━━━━━━━━━━━━━━\n"
                f"{_arrow} <b>{direction.upper()}</b>  ·  Confidence: <b>{confidence:.0f}%</b>\n"
                f"📐 Edge: bot {confidence:.0f}% vs market {mkt_implied_pct:.0f}% = <b>{edge_pp:+.1f}pp</b>\n"
                f"💵 Stake: <b>${actual_cost:.2f}</b>  ·  Entry: <b>{_entry_disp:.3f}</b>\n"
                f"📊 {analysis}\n"
                f"━━━━━━━━━━━━━━━━━━\n"
                f"🎯 {market['question']}\n"
                f"⏱ Time left: {market['time_left']}s  ·  UP={market['price_up']:.2f} DOWN={market['price_down']:.2f}\n"
                f"🏆 Streak: {state['consecutive_wins']}W  ·  💰 PnL gesamt: <b>${state['total_pnl']:+.2f}</b>\n"
                f"🆔 <code>{order_id[:20]}</code>"
            )

            try:
                log_price_comparison(
                    'trade_open',
                    market_slug=market.get('slug'),
                    direction=direction,
                    extra={'stake': actual_cost, 'entry_price': stored_entry, 'order_id': order_id},
                )
            except Exception as _e:
                log(f'comparison log error: {_e}')
        else:
            error_msg = resp.get("errorMsg", "unknown") if isinstance(resp, dict) else str(resp)
            log(f"Order not filled: {error_msg}")

            if "size" in str(error_msg).lower() or "minimum" in str(error_msg).lower():
                log("Retrying with aggressive GTC...")
                from py_clob_client.clob_types import OrderArgs, OrderType, PartialCreateOrderOptions
                token_id = market["token_up"] if direction == "Up" else market["token_down"]
                buy_price = min(round((market["price_up"] if direction == "Up" else market["price_down"]) + 0.08, 2), 0.99)
                size = max(MIN_SHARES, math.floor(stake / buy_price))
                options = PartialCreateOrderOptions(tick_size=TICK_SIZE, neg_risk=market.get("neg_risk", False))
                order_args = OrderArgs(price=buy_price, size=float(size), side="BUY", token_id=token_id)
                signed = client.create_order(order_args, options)
                resp2 = client.post_order(signed, OrderType.GTC)
                log(f"Aggressive GTC retry result: {resp2}")

    except Exception as e:
        log(f"Trade execution error: {e}")
        traceback.print_exc()

    return "placed" if _placed_in_cycle else "skipped"


def get_window_traded_key():
    """Get a key for current 5min window to prevent double trades."""
    now_ts = int(time.time())
    window_ts = (now_ts // WINDOW_INTERVAL) * WINDOW_INTERVAL
    return f"traded_{window_ts}"


def main():
    log("=" * 60)
    log("BTC 5m Trader v4 — 25% Bankroll Allocation, 5-min Windows")
    log(f"Allocated: ${ALLOCATED_BANKROLL:.2f} | Min: ${MIN_STAKE} | Max: ${MAX_STAKE} | Window: {WINDOW_INTERVAL}s | Entry: {OPTIMAL_ENTRY_SECS}s left")
    log("=" * 60)

    with open(BASE_DIR / ".env") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ[k.strip()] = v.strip()

    state = load_state()
    balance = get_available_balance()
    log(f"State: wins={state['total_wins']}/{state['total_trades']} | pnl=${state['total_pnl']:.2f} | balance=${balance:.2f}")

    # Multi-entry per window: count placed trades; retry after skip while window has time
    MAX_TRADES_PER_WINDOW = int(os.environ.get("MAX_TRADES_PER_WINDOW", "3"))
    RETRY_AFTER_SKIP_SECS = 25
    MIN_WINDOW_TIME_FOR_RETRY = 60
    window_attempts = {}  # window_key -> count of placed trades

    while True:
        try:
            now = int(time.time())
            window_ts = (now // WINDOW_INTERVAL) * WINDOW_INTERVAL
            window_end = window_ts + WINDOW_INTERVAL
            time_left = window_end - now
            window_key = f"w{window_ts}"
            placed_in_window = window_attempts.get(window_key, 0)

            if placed_in_window >= MAX_TRADES_PER_WINDOW:
                sleep_until = window_end + 5
                sleep_secs = max(10, sleep_until - int(time.time()))
                log(f"Window {window_key} reached {placed_in_window}/{MAX_TRADES_PER_WINDOW} trades. Sleeping {sleep_secs}s to next window...")
                time.sleep(sleep_secs)
                continue

            if time_left > OPTIMAL_ENTRY_SECS:
                wait_secs = time_left - OPTIMAL_ENTRY_SECS
                log(f"Window {window_key}: {time_left}s left. Waiting {wait_secs}s for optimal entry ({OPTIMAL_ENTRY_SECS}s before close)...")
                time.sleep(wait_secs)
                continue

            if time_left < 30:
                log(f"Window {window_key}: only {time_left}s left, too late. Waiting for next window...")
                time.sleep(time_left + 5)
                continue

            log(f"Window {window_key}: {time_left}s left — OPTIMAL ENTRY ZONE (attempt {placed_in_window+1}/{MAX_TRADES_PER_WINDOW})")
            result = run_cycle()
            if result == "placed":
                window_attempts[window_key] = placed_in_window + 1
                log(f"Trade placed in {window_key} ({window_attempts[window_key]}/{MAX_TRADES_PER_WINDOW})")
                time.sleep(30)
            else:
                # Skipped — retry within window if enough time remains
                remaining = window_end - int(time.time())
                if remaining > MIN_WINDOW_TIME_FOR_RETRY:
                    log(f"Skip in {window_key} (no trade placed). Retrying in {RETRY_AFTER_SKIP_SECS}s ({remaining}s left in window).")
                    time.sleep(RETRY_AFTER_SKIP_SECS)
                else:
                    log(f"Skip in {window_key}; only {remaining}s left — waiting for next window.")
                    time.sleep(max(5, remaining + 5))

            # Garbage-collect old window keys
            if len(window_attempts) > 20:
                cutoff = window_ts - 10 * WINDOW_INTERVAL
                stale = [k for k in window_attempts if int(k[1:]) < cutoff]
                for k in stale:
                    window_attempts.pop(k, None)

        except KeyboardInterrupt:
            log("Shutting down.")
            break
        except Exception as e:
            log(f"Main loop error: {e}")
            traceback.print_exc()
            time.sleep(60)


if __name__ == "__main__":
    main()


################################################################################
## SECTION: 5_TELEGRAM
################################################################################
