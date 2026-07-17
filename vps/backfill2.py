"""backfill2.py — Import Polymarket trades + fix posts."""
import json, sys, hashlib
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, '/root/Agent-spy')
from db import insert_trade, close_trade_by_slug, insert_post, _exec, query

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

# Reset polymarket trades + posts only
_exec("DELETE FROM trades WHERE bot='polymarket'")
_exec("TRUNCATE moltbook_posts RESTART IDENTITY")

# ── Polymarket trades ────────────────────────────────────────────────
poly_file = BASE / 'Polymarket_bot' / 'bot' / 'trades.json'
real, dry = 0, 0
if poly_file.exists():
    data = json.load(open(poly_file))
    for t in data:
        try:
            tid_str = str(t.get('id', ''))
            is_dry  = tid_str.startswith('dry_')
            if is_dry:
                dry += 1
                continue
            slug = t.get('marketId') or t.get('market')
            opened = parse_dt(t.get('timestamp'))
            db_id = insert_trade(
                bot='polymarket',
                market_slug=slug,
                market_question=t.get('question') or t.get('q_text'),
                side=t.get('side'),
                shares=t.get('size'),
                entry_price=t.get('price'),
                stake=(float(t.get('size',0)) * float(t.get('price',0))) if t.get('size') and t.get('price') else None,
                status='open',
                opened_at=opened, raw=t)
            status = (t.get('status') or '').upper()
            pnl = t.get('pnl')
            if status in ('WIN','LOSS','CLOSED','RESOLVED') or (pnl is not None and pnl != 0):
                resolved_status = 'win' if (pnl or 0) > 0 else ('loss' if (pnl or 0) < 0 else 'closed')
                close_trade_by_slug('polymarket', slug,
                                    status=resolved_status, pnl=pnl,
                                    raw_update={'backfilled': True, 'orig_status': status})
            real += 1
        except Exception as e:
            print(f"  poly skipped: {e}")
print(f"Polymarket: {real} real trades imported, {dry} dry_run skipped")

# ── Moltbook posts (use stable hash as fallback id) ─────────────────
act = BASE / 'activity.json'
n = 0
if act.exists():
    a = json.load(open(act))
    for p in (a.get('own_posts') or []):
        try:
            raw_id = p.get('post_id') or p.get('id') or p.get('url')
            if not raw_id:
                key = (p.get('title','') + (p.get('date') or '') + (p.get('submolt') or ''))
                raw_id = 'gen_' + hashlib.sha1(key.encode()).hexdigest()[:16]
            insert_post(post_id=str(raw_id),
                        title=p.get('title'),
                        body=p.get('content') or p.get('body'),
                        submolt=p.get('submolt'),
                        score=p.get('score'),
                        raw=p)
            n += 1
        except Exception as e:
            print(f"  post skipped: {e}")
print(f"Posts: {n} imported")

# ── BTC seed: write the aggregate stats as bot_state row ────────────
btc_state_f = BASE / 'btc_trader_state.json'
if btc_state_f.exists():
    s = json.load(open(btc_state_f))
    from db import set_state
    set_state('btc_5m', 'aggregate_lifetime', {
        'total_trades': s.get('total_trades'),
        'total_wins': s.get('total_wins'),
        'total_pnl': s.get('total_pnl'),
        'note': 'pre-pg lifetime stats from JSON state',
    })
    print(f"BTC aggregate seeded: {s.get('total_wins')}/{s.get('total_trades')} W, ${s.get('total_pnl'):.2f} PnL")

print("\n=== FINAL STATE ===")
for r in query("""SELECT 'trades:'        AS k, COUNT(*)::text AS v FROM trades
                  UNION ALL SELECT 'btc trades:',    COUNT(*)::text FROM trades WHERE bot='btc_5m'
                  UNION ALL SELECT 'poly trades:',   COUNT(*)::text FROM trades WHERE bot='polymarket'
                  UNION ALL SELECT 'bankroll:',      COUNT(*)::text FROM bankroll_history
                  UNION ALL SELECT 'posts:',         COUNT(*)::text FROM moltbook_posts"""):
    print(f"  {r['k']:18s} {r['v']}")
print()
for r in query("SELECT * FROM v_bot_winrate"):
    print(f"  WR {r['bot']:11s} {r['wins']}/{r['total']} = {r['win_rate_pct']}%  PnL ${r['total_pnl']}")
