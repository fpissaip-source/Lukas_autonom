#!/usr/bin/env python3
"""
Manual-Sell Watcher
===================
Detects positions that the bot opened but the user (or external resolution)
closed outside the bot, by diffing on-chain wallet positions vs the open
rows in the trades table.

Match key:
  trade.market_slug = "evt_<first8hex>"  (bot uses truncated condition id)
  position.conditionId starts with "0x<first8hex>"
  trade.side ("YES"/"NO") == position.outcome ("Yes"/"No"), case-insensitive

When a Postgres "open" row has no matching on-chain position (or size has
dropped to zero), it is closed in-place:
  - status   -> "manual_close"
  - exit_price <- best-effort (recent on-chain SELL avg, or position curPrice)
  - pnl     <- best-effort from Polymarket trade history
  - raw.closed_by = "manual"
"""
import os, sys, json, time, traceback
from pathlib import Path
from datetime import datetime, timezone
from decimal import Decimal

import psycopg2
import psycopg2.extras
import requests

ROOT = Path("/root/Agent-spy")
sys.path.insert(0, str(ROOT))
try:
    from tools import send_telegram_alert
except Exception:
    def send_telegram_alert(msg):
        print("[telegram-stub]", msg[:200])

LOG_FILE = ROOT / "manual_sell_watcher.log"
DSN = os.environ.get("DATABASE_URL", "")
WALLET = (os.environ.get("POLYMARKET_WALLET")
          or os.environ.get("WALLET_ADDRESS")
          or os.environ.get("PROXY_ADDRESS") or "").lower()

POLL_INTERVAL_SEC = 60
SIZE_GONE_THRESHOLD = 0.5
NOTIFY_COOLDOWN_SEC = 300

def log(msg):
    line = f"[{datetime.now(timezone.utc).isoformat()}] {msg}"
    print(line, flush=True)
    with LOG_FILE.open("a") as f:
        f.write(line + "\n")

def db():
    return psycopg2.connect(DSN, connect_timeout=10)

def fetch_open_trades():
    with db() as c, c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""SELECT id, market_slug, market_question, side, shares,
                              entry_price, stake, opened_at, raw
                       FROM trades
                       WHERE bot=%s AND status=%s
                       ORDER BY id ASC""", ("polymarket", "open"))
        return cur.fetchall()

def fetch_positions():
    url = f"https://data-api.polymarket.com/positions?user={WALLET}"
    r = requests.get(url, timeout=15)
    r.raise_for_status()
    j = r.json()
    return j if isinstance(j, list) else []

def fetch_recent_sells_for_market(condition_id_hex, limit=20):
    if not condition_id_hex:
        return []
    try:
        url = f"https://data-api.polymarket.com/trades?maker={WALLET}&limit={limit}"
        r = requests.get(url, timeout=15)
        if r.status_code != 200:
            return []
        j = r.json()
        if not isinstance(j, list):
            return []
        out = []
        cid = condition_id_hex.lower()
        for t in j:
            tcid = (t.get("conditionId") or t.get("market") or "").lower()
            side = (t.get("side") or "").upper()
            if tcid == cid and side == "SELL":
                out.append(t)
        return out
    except Exception as e:
        log(f"[sells_fetch] {condition_id_hex[:12]} failed: {e}")
        return []

def position_match_key(trade):
    slug = trade["market_slug"] or ""
    if slug.startswith("evt_0x"):
        return slug[4:].lower()
    if slug.startswith("evt_"):
        return "0x" + slug[4:].lower()
    return slug.lower()

def find_matching_position(trade, positions):
    prefix = position_match_key(trade)
    side = (trade["side"] or "").upper()
    for p in positions:
        cid = (p.get("conditionId") or "").lower()
        outcome = (p.get("outcome") or "").upper()
        if cid.startswith(prefix) and outcome == side:
            return p
    return None

def estimate_close_pnl_and_price(trade, sell_trades):
    shares = Decimal(str(trade["shares"] or 0))
    entry = Decimal(str(trade["entry_price"] or 0))
    if not sell_trades or shares == 0:
        return None, None
    total_sz = Decimal(0)
    weighted = Decimal(0)
    for t in sell_trades:
        try:
            sz = Decimal(str(t.get("size") or 0))
            px = Decimal(str(t.get("price") or 0))
            if sz <= 0 or px <= 0:
                continue
            take = min(sz, shares - total_sz)
            if take <= 0:
                break
            weighted += px * take
            total_sz += take
        except Exception:
            continue
    if total_sz == 0:
        return None, None
    avg_exit = weighted / total_sz
    pnl = (avg_exit - entry) * shares
    return float(round(avg_exit, 6)), float(round(pnl, 6))

def close_manual(trade, exit_price, pnl, reason):
    payout = (float(exit_price) * float(trade["shares"] or 0)) if exit_price is not None else None
    with db() as c, c.cursor() as cur:
        cur.execute("""UPDATE trades
                         SET status=%s,
                             exit_price=%s,
                             pnl=%s,
                             payout=%s,
                             closed_at=NOW(),
                             raw = COALESCE(raw,'{}'::jsonb) || jsonb_build_object(
                                     'closed_by','manual',
                                     'manual_close_reason',%s::text,
                                     'manual_close_detected_at', to_char(NOW(),'YYYY-MM-DD"T"HH24:MI:SSOF')
                                   )
                       WHERE id=%s AND status='open'""",
                    ("manual_close", exit_price, pnl, payout, reason, trade["id"]))
        c.commit()
        return cur.rowcount

def round_iter():
    open_rows = fetch_open_trades()
    if not open_rows:
        log("[ROUND] no open rows")
        return []
    try:
        positions = fetch_positions()
    except Exception as e:
        log(f"[ROUND] positions API failed: {e}")
        return []
    log(f"[ROUND] open_rows={len(open_rows)} positions={len(positions)}")

    closed = []
    for tr in open_rows:
        pos = find_matching_position(tr, positions)
        rec_shares = float(tr["shares"] or 0)
        if pos is not None:
            sz = float(pos.get("size") or 0)
            if sz >= rec_shares * SIZE_GONE_THRESHOLD:
                continue
            reason = "size_dropped"
            cid_hex = pos.get("conditionId", "")
            cur_px = pos.get("curPrice")
        else:
            reason = "position_gone"
            cid_hex = ""
            cur_px = None

        sells = fetch_recent_sells_for_market(cid_hex) if cid_hex else []
        exit_price, pnl = estimate_close_pnl_and_price(tr, sells)
        if exit_price is None and cur_px is not None:
            exit_price = float(cur_px)
            pnl = (exit_price - float(tr["entry_price"] or 0)) * rec_shares

        rc = close_manual(tr, exit_price, pnl, reason)
        if rc:
            closed.append({
                "id": tr["id"], "slug": tr["market_slug"], "side": tr["side"],
                "shares": rec_shares, "entry": float(tr["entry_price"] or 0),
                "exit": exit_price, "pnl": pnl, "reason": reason,
            })
            log(f"[CLOSE] id={tr['id']} {tr['market_slug']}/{tr['side']} reason={reason} exit={exit_price} pnl={pnl}")
    return closed

LAST_NOTIFY = 0
def maybe_notify(closed):
    global LAST_NOTIFY
    if not closed:
        return
    if time.time() - LAST_NOTIFY < NOTIFY_COOLDOWN_SEC:
        return
    lines = [f"📉 *Manual-Sell Watcher*: {len(closed)} position(s) closed off-bot"]
    for c in closed[:5]:
        pnl_s = f"${c['pnl']:+.3f}" if c['pnl'] is not None else "pnl=?"
        ex_s = f"@{c['exit']:.3f}" if c['exit'] is not None else "@?"
        lines.append(f"• #{c['id']} {c['side']} {c['shares']:.2f} {ex_s} -> {pnl_s} ({c['reason']})")
    if len(closed) > 5:
        lines.append(f"...and {len(closed)-5} more")
    try:
        send_telegram_alert("\n".join(lines))
        log("[NOTIFY] telegram sent")
        LAST_NOTIFY = time.time()
    except Exception as e:
        log(f"[NOTIFY] failed: {e}")

def main():
    log("====== Manual-Sell Watcher started ======")
    if not DSN:
        log("FATAL: DATABASE_URL missing")
        sys.exit(2)
    if not WALLET:
        log("FATAL: wallet address missing")
        sys.exit(2)
    log(f"wallet={WALLET}")
    while True:
        try:
            closed = round_iter()
            maybe_notify(closed)
        except Exception as e:
            log(f"[LOOP] {e}\n{traceback.format_exc()[:1200]}")
        time.sleep(POLL_INTERVAL_SEC)

if __name__ == "__main__":
    main()
