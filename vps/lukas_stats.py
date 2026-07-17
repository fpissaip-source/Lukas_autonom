#!/usr/bin/env python3
"""lukas_stats.py — Quick Postgres dashboard for Lukas. Run via CLI or import."""
import sys
sys.path.insert(0, '/root/Agent-spy')
from db import query, is_healthy

def main():
    if not is_healthy():
        print("DB unreachable — check DATABASE_URL"); return 1
    print("="*60)
    print("LUKAS POSTGRES SNAPSHOT")
    print("="*60)
    print("\nWIN RATES BY BOT:")
    for r in query("SELECT * FROM v_bot_winrate"):
        print(f"  {r['bot']:12s}  {r['wins']:4d}W / {r['total']:4d}T  "
              f"= {r['win_rate_pct']:>5}%  PnL ${r['total_pnl']:>+8}")
    print("\nLATEST BANKROLL:")
    for r in query("SELECT * FROM v_bankroll_latest"):
        print(f"  {r['bot']:12s}  bal=${r['balance']}  pnl=${r['pnl']}  open={r['open_pos']}  @ {r['recorded_at']:%Y-%m-%d %H:%M}")
    print("\nBTC DAILY PNL (last 7d):")
    for r in query("SELECT * FROM v_btc_daily_pnl LIMIT 7"):
        print(f"  {r['day']:%Y-%m-%d}  {r['trades']:3d} trades  {r['wins']:3d}W  PnL ${r['pnl']:>+7}  vol ${r['volume']}")
    print("\nLAST 5 TRADES:")
    for r in query("SELECT * FROM v_recent_trades LIMIT 5"):
        q = (r['market_question'] or '')[:40]
        print(f"  #{r['id']} {r['bot']:11s} {(r['side'] or '?'):<5} {r['status']:<6} stake=${r['stake']} pnl=${r['pnl']}  {q}")
    return 0

if __name__ == '__main__':
    sys.exit(main())
