#!/usr/bin/env python3
"""Compare LIVE vs PAPER BTC bot performance.

Usage:
  python3 paper_vs_live.py            # since paper trader started
  python3 paper_vs_live.py --hours 24 # last 24h only
  python3 paper_vs_live.py --since "2026-04-21 16:25"
"""
import argparse, os, sys
from datetime import datetime, timezone, timedelta
import psycopg2
from psycopg2.extras import RealDictCursor

DB_URL = os.environ.get("DATABASE_URL")
if not DB_URL:
    print("ERROR: DATABASE_URL not set"); sys.exit(1)

PAPER_START_FILE = "/root/Agent-spy/btc_paper_state.json"

def paper_start_time():
    """True start = first paper trade in DB. Fallback: log mtime."""
    try:
        c = psycopg2.connect(DB_URL); cur = c.cursor()
        cur.execute("SELECT MIN(opened_at) FROM trades WHERE bot=%s", ("btc_5m_paper",))
        row = cur.fetchone(); cur.close(); c.close()
        if row and row[0]:
            return row[0].astimezone(timezone.utc)
    except Exception:
        pass
    try:
        return datetime.fromtimestamp(os.path.getmtime("/root/Agent-spy/btc_paper_trader.log"), tz=timezone.utc)
    except Exception:
        return None

def fetch_stats(cur, bot, since):
    cur.execute("""
        SELECT
            COUNT(*) FILTER (WHERE status IN ('win','loss','closed')) AS n_closed,
            COUNT(*) FILTER (WHERE status = 'win')  AS wins,
            COUNT(*) FILTER (WHERE status = 'loss') AS losses,
            COUNT(*) FILTER (WHERE status = 'open') AS open_positions,
            COALESCE(SUM(pnl) FILTER (WHERE status IN ('win','loss','closed')), 0)::float AS total_pnl,
            COALESCE(SUM(stake) FILTER (WHERE status IN ('win','loss','closed')), 0)::float AS total_stake,
            COALESCE(AVG(pnl) FILTER (WHERE status = 'win'), 0)::float  AS avg_win,
            COALESCE(AVG(pnl) FILTER (WHERE status = 'loss'), 0)::float AS avg_loss,
            MIN(opened_at) AS first_trade,
            MAX(closed_at) AS last_close
        FROM trades
        WHERE bot = %s AND opened_at >= %s
    """, (bot, since))
    return cur.fetchone()

def fmt_row(label, s):
    n = s["n_closed"] or 0
    wins = s["wins"] or 0
    wr = 100 * wins / n if n else 0
    pnl = s["total_pnl"] or 0
    stake = s["total_stake"] or 0
    roi = 100 * pnl / stake if stake else 0
    open_p = s["open_positions"] or 0
    avg_w = s["avg_win"] or 0
    avg_l = s["avg_loss"] or 0
    return (
        f"  {label:<8} | closed={n:>3} | wins={wins:>2} ({wr:>5.1f}%) | "
        f"PnL=${pnl:+8.2f} | ROI={roi:+6.2f}% | avgW=${avg_w:+5.2f} avgL=${avg_l:+5.2f} | open={open_p}"
    )

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=float, help="Look at last N hours")
    ap.add_argument("--since", help="ISO timestamp")
    ap.add_argument("--all", action="store_true", help="All-time (ignore paper start)")
    args = ap.parse_args()

    if args.since:
        since = datetime.fromisoformat(args.since).replace(tzinfo=timezone.utc)
    elif args.hours:
        since = datetime.now(timezone.utc) - timedelta(hours=args.hours)
    elif args.all:
        since = datetime(2000, 1, 1, tzinfo=timezone.utc)
    else:
        since = paper_start_time() or (datetime.now(timezone.utc) - timedelta(hours=24))

    elapsed_h = (datetime.now(timezone.utc) - since).total_seconds() / 3600

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor(cursor_factory=RealDictCursor)

    live  = fetch_stats(cur, "btc_5m",       since)
    paper = fetch_stats(cur, "btc_5m_paper", since)

    print()
    print("=" * 78)
    print(f"  BTC 5m: LIVE vs PAPER  |  since {since:%Y-%m-%d %H:%M UTC}  ({elapsed_h:.1f}h)")
    print("=" * 78)
    print(fmt_row("LIVE",  live))
    print(fmt_row("PAPER", paper))
    print("-" * 78)

    delta_pnl = (paper["total_pnl"] or 0) - (live["total_pnl"] or 0)
    delta_n   = (paper["n_closed"] or 0) - (live["n_closed"] or 0)
    winner    = "PAPER" if delta_pnl > 0 else "LIVE" if delta_pnl < 0 else "TIE"
    print(f"  Δ PnL: PAPER − LIVE = ${delta_pnl:+.2f}   |   Δ closed trades: {delta_n:+d}   →   winner: {winner}")
    print("=" * 78)
    print()
    cur.close(); conn.close()

if __name__ == "__main__":
    main()
