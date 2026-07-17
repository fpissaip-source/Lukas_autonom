#!/usr/bin/env python3
"""
Lukas Loss Reasoner
===================
Watches the trades table for the polymarket bot. When loss conditions
exceed configured thresholds, it:
  1. Gathers diagnostic context (recent trades, config, gemini calls, errors)
  2. Asks Claude (sonnet-4-6) to diagnose root cause + propose concrete patches
  3. Applies the patches autonomously (sed-style find/replace with syntax check + backup)
  4. Restarts lukas-bot
  5. Sends Telegram alert with summary

Cooldown: at most one reasoning round per hour (state in /root/Agent-spy/loss_reasoner_state.json)
"""
import os, sys, json, time, traceback, subprocess, shlex, ast
from pathlib import Path
from datetime import datetime, timedelta, timezone

import psycopg2
import psycopg2.extras
import requests

ROOT = Path("/root/Agent-spy")
sys.path.insert(0, str(ROOT))
from tools import send_telegram_alert  # uses TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
from agent import ask_claude            # uses ANTHROPIC_API_KEY

LOG_FILE = ROOT / "loss_reasoner.log"
STATE_FILE = ROOT / "loss_reasoner_state.json"
HISTORY_FILE = ROOT / "loss_reasoning_history.jsonl"
BOT_LOG = ROOT / "Polymarket_bot/bot/bot.log"
DSN = os.environ.get("DATABASE_URL", "")

# Patchable config files (whitelist for safety)
PATCHABLE_FILES = {
    "config": "/root/Agent-spy/Polymarket_bot/bot/config.py",
}

AUTO_PATCH_ENABLED = False  # SAFETY: Reasoner runs read-only — diagnoses + alerts but does NOT touch config.py
POLL_INTERVAL_SEC = 60
COOLDOWN_SEC = 3600           # min seconds between reasoning rounds
MIN_TRADES_FOR_REASON = 8     # need at least N closed trades to reason
LOSS_RATE_TRIGGER = 0.55      # >55% losses in window
CONSECUTIVE_LOSSES_TRIGGER = 4  # 4+ in a row
DRAWDOWN_TRIGGER = 0.15       # 15% from peak bankroll

def log(msg: str):
    line = f"[{datetime.now(timezone.utc).isoformat()}] {msg}"
    print(line, flush=True)
    with LOG_FILE.open("a") as f:
        f.write(line + "\n")

def load_state() -> dict:
    if STATE_FILE.exists():
        try: return json.loads(STATE_FILE.read_text())
        except Exception: pass
    return {"last_reasoning_at": 0, "last_processed_trade_id": 0, "rounds": 0}

def save_state(s: dict):
    STATE_FILE.write_text(json.dumps(s, indent=2))

def db_query(sql: str, params: tuple = ()):
    with psycopg2.connect(DSN, connect_timeout=10) as c:
        with c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return cur.fetchall()

def fetch_recent_closed(limit: int = 20):
    # Exclude phantom/seeded trades:
    #  - closed_at NULL or before opened_at (impossible — backfill artifact)
    #  - bulk-imports where many trades share an opened_at within 1 second window
    return db_query("""
        WITH same_second AS (
            SELECT date_trunc('second', opened_at) AS sec, COUNT(*) AS n
            FROM trades WHERE bot=%s GROUP BY sec
        )
        SELECT t.id, t.market_slug, t.market_question, t.side, t.shares,
               t.entry_price, t.exit_price, t.stake, t.payout, t.pnl, t.status,
               t.opened_at, t.closed_at, t.raw
        FROM trades t
        LEFT JOIN same_second s ON s.sec = date_trunc('second', t.opened_at)
        WHERE t.bot=%s AND t.status IN (%s,%s)
          AND t.closed_at IS NOT NULL
          AND t.closed_at >= t.opened_at
          AND COALESCE(s.n,1) < 5
        ORDER BY t.closed_at DESC LIMIT %s
    """, ("polymarket", "polymarket", "win", "loss", limit))

def fetch_bankroll_history():
    rows = db_query("""
        SELECT MAX(bankroll) AS peak, MIN(bankroll) AS trough,
               (SELECT bankroll FROM bankroll_history ORDER BY ts DESC LIMIT 1) AS current
        FROM bankroll_history WHERE bot=%s
    """, ("polymarket",))
    return rows[0] if rows else {"peak": None, "trough": None, "current": None}

def compute_metrics(trades: list[dict]) -> dict:
    if not trades:
        return {"loss_rate": 0, "consecutive_losses": 0, "total_pnl": 0,
                "n_closed": 0, "avg_pnl": 0, "win_rate": 0}
    losses = sum(1 for t in trades if t["status"] == "loss")
    n = len(trades)
    consec = 0
    for t in trades:  # ordered DESC
        if t["status"] == "loss": consec += 1
        else: break
    total_pnl = sum(float(t["pnl"] or 0) for t in trades)
    return {
        "n_closed": n,
        "loss_rate": losses / n,
        "win_rate": (n - losses) / n,
        "consecutive_losses": consec,
        "total_pnl": round(total_pnl, 4),
        "avg_pnl": round(total_pnl / n, 4),
    }

def should_trigger(metrics: dict, state: dict) -> tuple[bool, str]:
    if time.time() - state.get("last_reasoning_at", 0) < COOLDOWN_SEC:
        return False, f"cooldown ({int(COOLDOWN_SEC - (time.time() - state['last_reasoning_at']))}s left)"
    if metrics['n_closed'] < MIN_TRADES_FOR_REASON:
        return False, f"not enough closed trades ({metrics['n_closed']}/{MIN_TRADES_FOR_REASON})"
    reasons = []
    if metrics['loss_rate'] >= LOSS_RATE_TRIGGER:
        reasons.append(f"loss_rate={metrics['loss_rate']:.0%}>={LOSS_RATE_TRIGGER:.0%}")
    if metrics['consecutive_losses'] >= CONSECUTIVE_LOSSES_TRIGGER:
        reasons.append(f"consecutive_losses={metrics['consecutive_losses']}>={CONSECUTIVE_LOSSES_TRIGGER}")
    if metrics['total_pnl'] < 0 and metrics['loss_rate'] >= 0.5:
        reasons.append(f"net_loss={metrics['total_pnl']:.2f} with loss_rate={metrics['loss_rate']:.0%}")
    if reasons:
        return True, " | ".join(reasons)
    return False, "no trigger"

def gather_config_snapshot() -> dict:
    """Return tunable config values currently in config.py."""
    cfg_file = Path(PATCHABLE_FILES["config"])
    src = cfg_file.read_text()
    keys = ["MIN_EDGE_MAKER", "MIN_EDGE_TAKER", "GEMINI_MIN_CONFIDENCE",
            "AI_GATE_CONFIDENCE_THRESHOLD", "KELLY_FRACTION", "KELLY_MAX_FRACTION",
            "MIN_BET_SIZE", "MAX_OPEN_TRADES", "TP_RATIO", "SL_RATIO",
            "SL_RATIO_CATASTROPHIC", "MAX_TOTAL_EXPOSURE_PCT"]
    snap = {}
    for k in keys:
        for line in src.splitlines():
            if line.lstrip().startswith(k):
                snap[k] = line.strip()
                break
    return snap

def tail_bot_log(n: int = 200) -> str:
    if not BOT_LOG.exists(): return ""
    try:
        with BOT_LOG.open("rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - 60_000))
            data = f.read().decode("utf-8", errors="replace")
        lines = data.splitlines()[-n:]
        return "\n".join(lines)
    except Exception as e:
        return f"(log read failed: {e})"

def build_reasoning_prompt(metrics: dict, trades: list[dict], cfg: dict, log_tail: str, trigger_reason: str) -> tuple[str,str]:
    system = """You are Lukas, an autonomous trading agent reasoning about losses on a Polymarket prediction-market bot.

You will receive: loss metrics, recent closed trades, current tunable config, and a tail of the bot log.

Your job:
1. Diagnose the most likely root causes (be specific — name the parameter or code path)
2. Propose 1 to 4 concrete config patches that will reduce loss rate
3. Return STRICT JSON only. No prose outside the JSON.

JSON schema:
{
  "diagnosis": "1-3 sentence summary of what is going wrong",
  "root_causes": ["cause 1", "cause 2", ...],
  "patches": [
    {
      "file": "config",                     // must be exactly "config" (whitelist)
      "find": "EXACT_LINE_FROM_CONFIG",     // copy verbatim from the cfg snapshot
      "replace": "EXACT_REPLACEMENT_LINE",  // valid python assignment, same variable name
      "reason": "why this patch helps"
    }
  ],
  "expected_improvement": "what should change in next 20 trades"
}

Rules:
- Patches must change ONLY values, never variable names or types.
- Keep changes conservative: tighten thresholds, reduce exposure, raise gates.
- If unsure, return an empty patches array (we will just log diagnosis).
- Prefer raising MIN_EDGE_MAKER, GEMINI_MIN_CONFIDENCE, AI_GATE_CONFIDENCE_THRESHOLD,
  or lowering KELLY_FRACTION / KELLY_MAX_FRACTION / MAX_OPEN_TRADES.
"""
    trades_summary = []
    for t in trades:
        trades_summary.append({
            "id": t["id"], "side": t["side"], "status": t["status"],
            "entry": float(t["entry_price"] or 0),
            "exit": float(t["exit_price"] or 0),
            "stake": float(t["stake"] or 0),
            "pnl": float(t["pnl"] or 0),
            "question": (t["market_question"] or t["market_slug"] or "")[:100],
            "held_minutes": (
                int(((t["closed_at"] - t["opened_at"]).total_seconds() / 60))
                if t["closed_at"] and t["opened_at"] else None
            ),
        })
    user = f"""TRIGGER REASON: {trigger_reason}

LOSS METRICS:
{json.dumps(metrics, indent=2)}

CURRENT CONFIG (tunable values, copy verbatim into "find"):
{json.dumps(cfg, indent=2)}

LAST {len(trades_summary)} CLOSED TRADES (DESC):
{json.dumps(trades_summary, indent=2)}

LAST 200 BOT LOG LINES:
{log_tail[-15000:]}

Return JSON only."""
    return system, user

def call_claude_for_diagnosis(metrics, trades, cfg, log_tail, trigger_reason) -> dict:
    system, user = build_reasoning_prompt(metrics, trades, cfg, log_tail, trigger_reason)
    log(f"[REASON] sending to Claude — system={len(system)}b user={len(user)}b")
    raw = ask_claude(system, user)
    log(f"[REASON] Claude raw response ({len(raw)}b): {raw[:300]!r}...")
    # strip markdown fences if any
    text = raw.strip()
    for fence in ("```json", "```"):
        if text.startswith(fence): text = text[len(fence):].strip()
        if text.endswith("```"): text = text[:-3].strip()
    try:
        return json.loads(text)
    except Exception as e:
        log(f"[REASON] json parse failed: {e} — raw: {text[:500]}")
        # try to extract first {...} block
        import re
        m = re.search(r"\{.*\}", text, re.S)
        if m:
            try: return json.loads(m.group(0))
            except Exception: pass
        return {"diagnosis": "PARSE_FAIL", "root_causes": [], "patches": [], "raw": text[:1000]}

def apply_patches(patches: list[dict]) -> list[dict]:
    """Apply each patch to the whitelisted file with backup + syntax check."""
    results = []
    for p in patches:
        r = {"file": p.get("file"), "applied": False, "error": None,
             "find": p.get("find", "")[:120], "replace": p.get("replace", "")[:120]}
        try:
            f = p.get("file")
            if f not in PATCHABLE_FILES:
                r["error"] = f"file {f!r} not in whitelist"; results.append(r); continue
            path = Path(PATCHABLE_FILES[f])
            src = path.read_text()
            find = p.get("find", ""); repl = p.get("replace", "")
            if not find or not repl:
                r["error"] = "empty find or replace"; results.append(r); continue
            if find not in src:
                # try line-stripped match
                stripped_find = find.strip()
                lines = src.splitlines()
                idx = next((i for i, l in enumerate(lines) if l.strip() == stripped_find), -1)
                if idx < 0:
                    r["error"] = "find string not present in file"; results.append(r); continue
                # preserve original indentation
                lead = lines[idx][:len(lines[idx]) - len(lines[idx].lstrip())]
                lines[idx] = lead + repl.strip()
                new_src = "\n".join(lines) + ("\n" if src.endswith("\n") else "")
            else:
                new_src = src.replace(find, repl, 1)
            # syntax check
            try: ast.parse(new_src)
            except SyntaxError as se:
                r["error"] = f"syntax error after patch: {se}"; results.append(r); continue
            backup = path.with_suffix(path.suffix + f".bak.reasoner.{int(time.time())}")
            backup.write_text(src)
            path.write_text(new_src)
            r["applied"] = True
            r["backup"] = str(backup.name)
            log(f"[PATCH] applied to {f}: {find[:60]} -> {repl[:60]}")
        except Exception as e:
            r["error"] = f"{type(e).__name__}: {e}"
            log(f"[PATCH] failed: {r}")
        results.append(r)
    return results

def restart_bot() -> bool:
    try:
        out = subprocess.run(["systemctl", "restart", "lukas-bot"],
                             capture_output=True, text=True, timeout=30)
        ok = out.returncode == 0
        log(f"[RESTART] lukas-bot rc={out.returncode} stderr={out.stderr.strip()[:200]}")
        return ok
    except Exception as e:
        log(f"[RESTART] failed: {e}"); return False

def notify(metrics, diagnosis, root_causes, patch_results, trigger_reason):
    applied = sum(1 for p in patch_results if p.get("applied"))
    failed = len(patch_results) - applied
    msg_lines = [
        "🧠 *Lukas Loss-Reasoner triggered*",
        f"_Trigger:_ {trigger_reason}",
        f"_Stats:_ {metrics['n_closed']} closed, "
        f"loss-rate {metrics['loss_rate']:.0%}, "
        f"streak {metrics['consecutive_losses']}, "
        f"net_pnl ${metrics['total_pnl']:+.2f}",
        "",
        f"*Diagnosis:* {diagnosis[:300]}",
    ]
    if root_causes:
        msg_lines.append("*Root causes:*")
        for c in root_causes[:4]:
            msg_lines.append(f"  • {c[:150]}")
    msg_lines.append("")
    msg_lines.append(f"*Patches:* {applied} applied, {failed} failed")
    for p in patch_results[:4]:
        flag = "✅" if p.get("applied") else "⚠️"
        line = f"{flag} `{p['find'][:60]}` → `{p['replace'][:60]}`"
        if not p.get("applied"):
            line += f"  ({p.get('error', '?')[:60]})"
        msg_lines.append(line)
    msg = "\n".join(msg_lines)
    try:
        send_telegram_alert(msg)
        log("[NOTIFY] telegram sent")
    except Exception as e:
        log(f"[NOTIFY] telegram failed: {e}")

def history_append(record: dict):
    with HISTORY_FILE.open("a") as f:
        f.write(json.dumps(record, default=str) + "\n")

def reasoning_round(state: dict):
    trades = fetch_recent_closed(20)
    metrics = compute_metrics(trades)
    log(f"[METRICS] {metrics}")

    fire, reason = should_trigger(metrics, state)
    log(f"[TRIGGER] fire={fire} reason={reason}")
    if not fire:
        return

    cfg = gather_config_snapshot()
    log_tail = tail_bot_log(200)

    diagnosis_obj = call_claude_for_diagnosis(metrics, trades, cfg, log_tail, reason)
    diagnosis = diagnosis_obj.get("diagnosis", "")
    root_causes = diagnosis_obj.get("root_causes", []) or []
    patches = diagnosis_obj.get("patches", []) or []
    expected = diagnosis_obj.get("expected_improvement", "")
    log(f"[DIAGNOSIS] {diagnosis[:200]}")

    if AUTO_PATCH_ENABLED:
        patch_results = apply_patches(patches) if patches else []
        bot_restarted = False
        if any(p.get("applied") for p in patch_results):
            bot_restarted = restart_bot()
    else:
        # read-only mode: do not touch config, just record the proposed patches
        patch_results = [dict(p, applied=False, error="AUTO_PATCH_ENABLED=False — read-only") for p in (patches or [])]
        bot_restarted = False
        log(f"[READONLY] would have applied {len(patches or [])} patches but AUTO_PATCH_ENABLED is False")

    notify(metrics, diagnosis, root_causes, patch_results, reason)
    history_append({
        "ts": datetime.now(timezone.utc).isoformat(),
        "trigger": reason, "metrics": metrics,
        "diagnosis": diagnosis, "root_causes": root_causes,
        "expected": expected, "patches": patch_results,
        "bot_restarted": bot_restarted,
    })

    state['last_reasoning_at'] = time.time()
    state["rounds"] = state.get("rounds", 0) + 1
    save_state(state)

def main():
    log("====== Lukas Loss-Reasoner started ======")
    if not DSN:
        log("FATAL: DATABASE_URL missing"); sys.exit(2)
    state = load_state()
    while True:
        try:
            reasoning_round(state)
        except Exception as e:
            log(f"[LOOP] exception: {e}\n{traceback.format_exc()[:1500]}")
        time.sleep(POLL_INTERVAL_SEC)

if __name__ == "__main__":
    main()
