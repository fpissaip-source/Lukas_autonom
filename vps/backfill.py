"""backfill.py — One-shot import of historical JSON data into Postgres."""
import json, os, sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, '/root/Agent-spy')
from db import insert_trade, close_trade_by_slug, record_bankroll, insert_post, _exec, query

BASE = Path('/root/Agent-spy')

def parse_dt(v):
    if not v: return None
    try:
        if isinstance(v, (int, float)):
            return datetime.fromtimestamp(v, tz=timezone.utc)
        s = str(v).replace('Z', '+00:00')
        return datetime.fromisoformat(s)
    except Exception:
        return None

# ── Wipe existing (idempotent re-runs) ────────────────────────────────
print("Truncating tables for clean backfill...")
_exec("TRUNCATE trades, bankroll_history, moltbook_posts RESTART IDENTITY")

# ── BTC trader trades.json ────────────────────────────────────────────
btc_trades = BASE / 'trades.json'
btc_count = 0
if btc_trades.exists():
    data = json.loads(btc_trades.read_text())
    rows = data if isinstance(data, list) else data.get('trades', [])
    for t in rows:
        try:
            slug    = t.get('slug') or t.get('market_slug')
            side    = t.get('side') or t.get('direction')
            stake   = t.get('stake') or t.get('cost') or t.get('amount')
            entry   = t.get('entry_price') or t.get('price')
            shares  = t.get('shares')
            opened  = parse_dt(t.get('opened_at') or t.get('timestamp') or t.get('time'))
            tid = insert_trade(
                bot='btc_5m', market_slug=slug,
                market_question=t.get('question') or 'BTC Up/Down',
                side=side, shares=shares, entry_price=entry, stake=stake,
                status='open', opened_at=opened, raw=t)
            # If it has resolved info → close it
            if t.get('status') in ('win', 'loss', 'closed') or t.get('pnl') is not None:
                close_trade_by_slug('btc_5m', slug,
                    status=t.get('status', 'closed'),
                    exit_price=t.get('exit_price'),
                    payout=t.get('payout'),
                    pnl=t.get('pnl'),
                    raw_update={'backfilled': True})
            btc_count += 1
        except Exception as e:
            print(f"  skipped: {e}")
print(f"BTC trades imported: {btc_count}")

# ── Polymarket trades (from Polymarket_bot/state) ─────────────────────
poly_state = BASE / 'Polymarket_bot' / 'state'
poly_count = 0
if poly_state.exists():
    for p in poly_state.glob('trades*.json'):
        try:
            data = json.loads(p.read_text())
            rows = data if isinstance(data, list) else data.get('trades', [])
            for t in rows:
                slug = t.get('slug') or t.get('market_slug')
                tid = insert_trade(
                    bot='polymarket', market_slug=slug,
                    market_question=t.get('question'),
                    side=t.get('side'), shares=t.get('shares'),
                    entry_price=t.get('price'), stake=t.get('cost'),
                    status='open',
                    opened_at=parse_dt(t.get('timestamp')), raw=t)
                if t.get('pnl') is not None or t.get('status') in ('win','loss','closed'):
                    close_trade_by_slug('polymarket', slug,
                        status=t.get('status','closed'),
                        pnl=t.get('pnl'), raw_update={'backfilled': True})
                poly_count += 1
        except Exception as e:
            print(f"  poly skipped {p.name}: {e}")
print(f"Polymarket trades imported: {poly_count}")

# ── Bankroll snapshot (current state) ─────────────────────────────────
btc_state = BASE / 'btc_trader_state.json'
if btc_state.exists():
    s = json.loads(btc_state.read_text())
    record_bankroll(
        bot='btc_5m',
        balance=s.get('current_balance', s.get('balance', 0)),
        base=s.get('base_balance', s.get('starting_balance')),
        pnl=s.get('total_pnl'),
        open_pos=len(s.get('open_positions') or []),
        note='backfill snapshot')
    print("BTC bankroll snapshot recorded")

# Polymarket bridge state for bankroll
bridge = BASE / 'bridge.json'
if bridge.exists():
    b = json.loads(bridge.read_text())
    if b.get('bankroll') is not None:
        record_bankroll(bot='polymarket',
                        balance=b.get('bankroll'),
                        note='backfill bridge snapshot')
        print("Polymarket bankroll snapshot recorded")

# ── Moltbook posts (from activity.json own_posts) ────────────────────
act = BASE / 'activity.json'
post_count = 0
if act.exists():
    a = json.loads(act.read_text())
    posts = a.get('own_posts') or []
    for p in posts:
        try:
            insert_post(post_id=str(p.get('id') or p.get('url', '')),
                        title=p.get('title'), body=p.get('body'),
                        submolt=p.get('submolt'), score=p.get('score'),
                        raw=p)
            post_count += 1
        except Exception as e:
            print(f"  post skipped: {e}")
print(f"Moltbook posts imported: {post_count}")

# ── Summary ───────────────────────────────────────────────────────────
print("\n=== POSTGRES STATE ===")
for r in query("""SELECT 'trades:'        AS k, COUNT(*)::text AS v FROM trades
                  UNION ALL SELECT 'bankroll:',      COUNT(*)::text FROM bankroll_history
                  UNION ALL SELECT 'sessions:',      COUNT(*)::text FROM sessions
                  UNION ALL SELECT 'observations:',  COUNT(*)::text FROM moltbook_observations
                  UNION ALL SELECT 'posts:',         COUNT(*)::text FROM moltbook_posts"""):
    print(f"  {r['k']:15s} {r['v']}")

print("\n=== WIN RATES ===")
for r in query("SELECT * FROM v_bot_winrate"):
    print(f"  {r}")
