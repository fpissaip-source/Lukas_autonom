#!/usr/bin/env python3
"""chainlink_eval.py — Beweise-nach-48h für die Chainlink-Umstellung.

Beantwortet: Tradet der BTC-Trader mit Chainlink als Preisquelle MESSBAR
besser als vorher mit Binance? Joint chainlink_comparison.jsonl mit der
trades-Tabelle, splittet PRE/POST switch, rechnet Win-Rate, PnL,
Z-Test auf WR-Differenz, und Bucket-Analyse nach |diff_bps|.

Pure read-only. Schreibt:
  - /root/Agent-spy/chainlink_eval_latest.json   (machine-readable)
  - /root/Agent-spy/chainlink_eval.log           (run history)
  - Telegram message (wenn TELEGRAM_BOT_TOKEN + CHAT_ID gesetzt)
"""
import json, os, sys, math, urllib.request, urllib.parse
from datetime import datetime, timezone, timedelta
from pathlib import Path

import psycopg2

JSONL_PATH = Path("/root/Agent-spy/chainlink_comparison.jsonl")
SWITCH_TS = datetime(2026, 4, 21, 10, 27, 0, tzinfo=timezone.utc)  # erstes Chainlink-trade_open
EVAL_LATEST = Path("/root/Agent-spy/chainlink_eval_latest.json")
EVAL_LOG = Path("/root/Agent-spy/chainlink_eval.log")

# Akzeptanz-Gates fuer "bewiesen besser":
GATE_HOURS = 48
GATE_MIN_POST_TRADES = 50         # statistisch sinnvolle Stichprobe
GATE_MIN_WR_DELTA_PP = 3.0        # mindestens +3pp Verbesserung
GATE_Z_THRESHOLD = 1.64           # einseitig 95% Konfidenz


def load_jsonl():
    out = []
    if not JSONL_PATH.exists():
        return out
    for line in JSONL_PATH.read_text().splitlines():
        try:
            out.append(json.loads(line))
        except Exception:
            pass
    return out


def two_proportion_z(p1, n1, p2, n2):
    """Standard-Z-Test fuer Differenz zweier Anteile (p1 - p2)."""
    if n1 < 5 or n2 < 5:
        return 0.0
    p_pool = (p1 * n1 + p2 * n2) / (n1 + n2)
    se = math.sqrt(p_pool * (1 - p_pool) * (1 / n1 + 1 / n2))
    if se <= 0:
        return 0.0
    return (p1 - p2) / se


def fmt_phase_stats(c):
    if c["closed"] == 0:
        return f"  closed=0 (alle Trades noch open)"
    wr = 100.0 * c["wins"] / c["closed"]
    return (
        f"  trades={c['total']} closed={c['closed']} | "
        f"{c['wins']}W/{c['losses']}L | WR={wr:.1f}% | "
        f"PnL=${c['pnl']:.2f} | avg=${c['avg_pnl']:.4f}/trade"
    )


def evaluate():
    db_url = os.environ["DATABASE_URL"]
    now = datetime.now(timezone.utc)
    hours_since_switch = (now - SWITCH_TS).total_seconds() / 3600.0

    # 1) Phase-Aggregat aus DB
    with psycopg2.connect(db_url, connect_timeout=10) as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT
                 CASE WHEN opened_at < %s THEN 'pre' ELSE 'post' END phase,
                 count(*) total,
                 count(*) FILTER (WHERE pnl IS NOT NULL) closed,
                 count(*) FILTER (WHERE pnl > 0) wins,
                 count(*) FILTER (WHERE pnl < 0) losses,
                 COALESCE(sum(pnl), 0)::float pnl,
                 COALESCE(avg(pnl) FILTER (WHERE pnl IS NOT NULL), 0)::float avg_pnl
               FROM trades WHERE bot='btc_5m' GROUP BY phase""",
            (SWITCH_TS,),
        )
        phase = {row[0]: dict(zip(
            ["phase", "total", "closed", "wins", "losses", "pnl", "avg_pnl"], row
        )) for row in cur.fetchall()}

    pre = phase.get("pre", {"total": 0, "closed": 0, "wins": 0, "losses": 0, "pnl": 0.0, "avg_pnl": 0.0})
    post = phase.get("post", {"total": 0, "closed": 0, "wins": 0, "losses": 0, "pnl": 0.0, "avg_pnl": 0.0})

    pre_wr = (pre["wins"] / pre["closed"]) if pre["closed"] else 0.0
    post_wr = (post["wins"] / post["closed"]) if post["closed"] else 0.0
    z = two_proportion_z(post_wr, post["closed"], pre_wr, pre["closed"])
    wr_delta_pp = (post_wr - pre_wr) * 100.0

    # 2) JSONL-Cross-Check: passt entry_direction zur Chainlink-Indikation?
    events = [e for e in load_jsonl() if e.get("event") == "trade_open"]
    slug_to_jsonl = {e["slug"]: e for e in events}

    # Hole zugehoerige trades aus DB
    diff_bucket = {"low": [], "mid": [], "high": []}  # |diff| <2bps, 2-5bps, >=5bps
    chainlink_agreed_with_outcome = 0
    binance_would_agree_with_outcome = 0
    n_overlap = 0
    if slug_to_jsonl:
        with psycopg2.connect(db_url, connect_timeout=10) as conn, conn.cursor() as cur:
            cur.execute(
                """SELECT market_slug, side, pnl FROM trades
                   WHERE bot='btc_5m' AND market_slug = ANY(%s) AND pnl IS NOT NULL""",
                (list(slug_to_jsonl.keys()),),
            )
            for slug, side, pnl in cur.fetchall():
                e = slug_to_jsonl[slug]
                won = pnl > 0
                d = e.get("diff_bps", 0.0) or 0.0
                ad = abs(d)
                bucket = "low" if ad < 2 else ("mid" if ad < 5 else "high")
                diff_bucket[bucket].append({"slug": slug, "diff_bps": d, "won": won, "pnl": float(pnl)})
                # Chainlink "agreed with outcome" = unsere Side hat gewonnen
                if won:
                    chainlink_agreed_with_outcome += 1
                # Binance haette gleiche/andere Richtung empfohlen?
                # Wenn diff_bps > 0 -> chainlink > binance -> Binance haette eher Down empfohlen wo wir Up sind
                # (vereinfachter Counterfactual: nur informativ, kein harter Beweis)
                cl = e.get("chainlink_price", 0)
                bn = e.get("binance_price", 0)
                if cl and bn:
                    binance_implied_dir = "Up" if bn < cl else "Down"  # heuristik
                    # falls Binance gleiche Richtung empfohlen haette und wir gewonnen -> binance ok
                    if (binance_implied_dir.lower() == (side or "").lower()) == won:
                        binance_would_agree_with_outcome += 1
                n_overlap += 1

    bucket_stats = {}
    for k, lst in diff_bucket.items():
        if not lst:
            bucket_stats[k] = {"n": 0, "wr": 0.0, "pnl": 0.0}
        else:
            wins = sum(1 for x in lst if x["won"])
            bucket_stats[k] = {
                "n": len(lst),
                "wr": 100.0 * wins / len(lst),
                "pnl": sum(x["pnl"] for x in lst),
            }

    # 3) Verdict
    gates = {
        "hours_since_switch": round(hours_since_switch, 2),
        "post_closed_trades": post["closed"],
        "wr_delta_pp": round(wr_delta_pp, 2),
        "z_score": round(z, 2),
        "passed_time": hours_since_switch >= GATE_HOURS,
        "passed_sample": post["closed"] >= GATE_MIN_POST_TRADES,
        "passed_wr_delta": wr_delta_pp >= GATE_MIN_WR_DELTA_PP,
        "passed_significance": z >= GATE_Z_THRESHOLD,
    }
    all_passed = all(v for k, v in gates.items() if k.startswith("passed_"))
    verdict = "BEWIESEN_BESSER" if all_passed else (
        "NOCH_NICHT_GENUG_DATEN" if hours_since_switch < GATE_HOURS or post["closed"] < GATE_MIN_POST_TRADES
        else "NICHT_BEWIESEN"
    )

    eta_to_gate = ""
    if not gates["passed_time"]:
        rem_h = GATE_HOURS - hours_since_switch
        eta = now + timedelta(hours=rem_h)
        eta_to_gate = eta.strftime("%Y-%m-%d %H:%M UTC")

    result = {
        "ts": now.isoformat(),
        "switch_ts": SWITCH_TS.isoformat(),
        "hours_since_switch": round(hours_since_switch, 2),
        "verdict": verdict,
        "gates": gates,
        "eta_to_48h_gate": eta_to_gate,
        "pre": pre, "post": post,
        "wr_pre_pct": round(pre_wr * 100, 2),
        "wr_post_pct": round(post_wr * 100, 2),
        "wr_delta_pp": round(wr_delta_pp, 2),
        "z_score": round(z, 2),
        "jsonl_overlap_n": n_overlap,
        "chainlink_agreed_with_outcome": chainlink_agreed_with_outcome,
        "binance_would_agree_with_outcome": binance_would_agree_with_outcome,
        "diff_bucket_stats": bucket_stats,
    }
    return result


def render_text(r):
    lines = [
        f"=== CHAINLINK-EVAL @ {r['ts'][:16]}Z ===",
        f"Switch: {r['switch_ts'][:16]}Z | seitdem: {r['hours_since_switch']:.1f}h",
        f"Verdikt: {r['verdict']}",
        "",
        "PRE_CHAINLINK (Binance only):",
        fmt_phase_stats(r["pre"]),
        "POST_CHAINLINK:",
        fmt_phase_stats(r["post"]),
        "",
        f"WR-Delta: {r['wr_delta_pp']:+.2f}pp | Z-Score: {r['z_score']}",
        "",
        "Akzeptanz-Gates:",
    ]
    for k, v in r["gates"].items():
        if k.startswith("passed_"):
            sym = "OK" if v else "X "
            lines.append(f"  [{sym}] {k}")
    if r["eta_to_48h_gate"]:
        lines.append(f"  ETA 48h-Gate: {r['eta_to_48h_gate']}")
    lines.append("")
    if r["jsonl_overlap_n"]:
        lines.append(f"JSONL-Overlap: {r['jsonl_overlap_n']} closed trades")
        for b, s in r["diff_bucket_stats"].items():
            if s["n"]:
                lines.append(f"  |diff_bps|.{b}: n={s['n']} WR={s['wr']:.1f}% PnL=${s['pnl']:.2f}")
    return "\n".join(lines)


def telegram_push(text):
    tok = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat = os.environ.get("TELEGRAM_CHAT_ID", "")
    if not tok or not chat:
        return False
    try:
        url = f"https://api.telegram.org/bot{tok}/sendMessage"
        body = urllib.parse.urlencode({
            "chat_id": chat, "text": text[:4000], "parse_mode": "HTML"
        }).encode()
        req = urllib.request.Request(url, data=body)
        urllib.request.urlopen(req, timeout=10).read()
        return True
    except Exception as e:
        print(f"telegram failed: {e}", file=sys.stderr)
        return False


def main():
    r = evaluate()
    EVAL_LATEST.write_text(json.dumps(r, indent=2, default=str))
    text = render_text(r)
    print(text)
    with EVAL_LOG.open("a") as f:
        f.write(f"\n{'='*60}\n{text}\n")
    # Telegram nur bei wesentlichen Ereignissen oder wenn explizit gefordert
    push_always = "--push" in sys.argv
    push_decisive = r["verdict"] in ("BEWIESEN_BESSER", "NICHT_BEWIESEN")
    if push_always or push_decisive:
        ok = telegram_push(f"<b>Chainlink-Eval</b>\n<pre>{text}</pre>")
        if ok:
            print("[telegram] pushed")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        err = f"chainlink_eval CRASH: {e}\n{traceback.format_exc()}"
        print(err, file=sys.stderr)
        with EVAL_LOG.open("a") as f:
            f.write(f"\n{err}\n")
        sys.exit(1)
