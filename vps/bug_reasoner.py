#!/usr/bin/env python3
"""
Lukas Bug-Reasoner — autonomous code/log scanner.

Sibling of loss_reasoner. Runs every SCAN_INTERVAL_S (default 30min), tails all
bot logs, detects errors (Tracebacks, ERROR, CRITICAL, silence), asks Claude to
diagnose + propose patches.

SAFETY MODEL:
  - Patches to PROTECTED_FILES (trading bots) are NEVER auto-applied — proposed only.
  - Other patches are auto-applied if Claude marks them auto_apply_safe=true,
    file passes ast.parse after change, with backup. Otherwise: proposed.
  - Proposals stored in bug_findings.jsonl, accept via Telegram /apply <fid>.
"""
import os, sys, json, re, time, hashlib, shutil, subprocess, ast, traceback
from pathlib import Path
from datetime import datetime

sys.path.insert(0, "/root/Agent-spy")
from agent import ask_claude  # type: ignore

BASE = Path("/root/Agent-spy")
STATE = BASE / "bug_reasoner_state.json"
FINDINGS = BASE / "bug_findings.jsonl"
LOG = BASE / "bug_reasoner.log"

SCAN_INTERVAL_S = int(os.environ.get("BUG_SCAN_INTERVAL_S", 30 * 60))
WINDOW_S = int(os.environ.get("BUG_SCAN_WINDOW_S", 30 * 60))

LOG_TARGETS = {
    "btc-trader":    BASE / "btc_trader.log",
    "btc-paper":     BASE / "btc_paper_trader.log",
    "polymarket":    BASE / "Polymarket_bot/bot/bot.log",
    "brain":         BASE / "lukas_brain.log",
    "loss-reasoner": BASE / "loss_reasoner.log",
    "manual-sell":   BASE / "manual_sell_watcher.log",
    "reddit-watch":  BASE / "reddit_watcher.log",
    "self-heal":     BASE / "self_heal.log",
    "telegram":      BASE / "telegram_bot.log",
}

# Critical financial files — NEVER auto-patch these
PROTECTED_PATTERNS = [
    re.compile(r"btc_15m_trader\.py$"),
    re.compile(r"btc_15m_paper_trader\.py$"),
    re.compile(r"Polymarket_bot/bot/"),
]

CRITICAL_PATTERNS = [
    re.compile(r"Traceback \(most recent call last\):"),
    re.compile(r"\bCRITICAL\b"),
    re.compile(r"\bFATAL\b"),
]
HIGH_PATTERNS = [
    re.compile(r"\bERROR\b"),
    re.compile(r"Exception(?!al)"),
    re.compile(r"Connection refused"),
    re.compile(r"HTTP 5\d\d"),
]
IGNORE_PATTERNS = [
    re.compile(r"DRAWDOWN HALT"),
    re.compile(r"Skip in w\d+"),
    re.compile(r"errorMsg.*FOK"),
    re.compile(r"Order not filled"),
    re.compile(r"\[VOL-FILTER\]"),
    re.compile(r"\[SPREAD-FILTER\]"),
    re.compile(r"Loss-Streak"),
    re.compile(r"comparison log error"),
]


def log(msg):
    ts = datetime.now().isoformat(timespec="seconds")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    try:
        with LOG.open("a") as f:
            f.write(line + "\n")
    except Exception:
        pass


def telegram(msg):
    import urllib.request, urllib.parse
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat = os.environ.get("TELEGRAM_CHAT_ID", "")
    if not token or not chat:
        log("telegram: no token/chat configured")
        return False
    try:
        data = urllib.parse.urlencode({
            "chat_id": chat, "text": msg, "parse_mode": "HTML",
            "disable_web_page_preview": "true",
        }).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage", data=data)
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status == 200
    except Exception as e:
        log(f"telegram err: {e}")
        return False


def is_protected(file_path: str) -> bool:
    return any(p.search(file_path) for p in PROTECTED_PATTERNS)


def tail_recent(path: Path, since_ts: float) -> list:
    if not path.exists():
        return []
    try:
        size = path.stat().st_size
        with path.open("rb") as f:
            f.seek(max(0, size - 300_000))
            data = f.read()
        text = data.decode("utf-8", errors="replace")
        lines = text.split("\n")
        ts_re = re.compile(r"\[(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})")
        recent = []
        for ln in lines:
            m = ts_re.search(ln)
            if not m:
                continue
            try:
                t = datetime.fromisoformat(m.group(1).replace(" ", "T")).timestamp()
                if t >= since_ts:
                    recent.append(ln)
            except Exception:
                pass
        if not recent:
            recent = [l for l in lines[-150:] if l.strip()]
        return recent
    except Exception as e:
        log(f"tail err {path}: {e}")
        return []


def scan_log(name: str, lines: list) -> list:
    findings = []
    i = 0
    while i < len(lines):
        ln = lines[i]
        if any(p.search(ln) for p in IGNORE_PATTERNS):
            i += 1
            continue
        if "Traceback (most recent call last):" in ln:
            tb = []
            j = i
            while j < min(i + 40, len(lines)):
                tb.append(lines[j])
                j += 1
                if j > i + 1 and re.match(r"^\w*(Error|Exception):", lines[j-1] or ""):
                    break
            findings.append({
                "severity": "CRITICAL", "type": "traceback",
                "snippet": "\n".join(tb),
                "summary": (tb[-1] if tb else "Traceback")[:200],
            })
            i = j
            continue
        if any(p.search(ln) for p in CRITICAL_PATTERNS):
            findings.append({"severity": "CRITICAL", "type": "critical_log",
                             "snippet": ln, "summary": ln[:200]})
            i += 1
            continue
        for p in HIGH_PATTERNS:
            if p.search(ln):
                findings.append({"severity": "HIGH", "type": "error_log",
                                 "snippet": ln, "summary": ln[:200]})
                break
        i += 1
    seen, uniq = set(), []
    for f in findings:
        key = re.sub(r"[\d:]", "", f["summary"])[:80]
        if key in seen:
            continue
        seen.add(key)
        uniq.append(f)
    return uniq[:5]


def is_silent(name: str, path: Path):
    if name not in ("btc-trader", "btc-paper", "polymarket", "brain"):
        return None
    if not path.exists():
        return None
    age = time.time() - path.stat().st_mtime
    if age > WINDOW_S:
        return {
            "severity": "CRITICAL", "type": "silence",
            "snippet": f"No log activity for {age/60:.0f} min "
                       f"(file mtime {datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec='seconds')})",
            "summary": f"{name} silent {age/60:.0f}min",
        }
    return None


def make_finding_id(service, finding):
    key = f"{service}|{re.sub(r'[0-9]', '', finding['summary'])[:120]}"
    return hashlib.sha256(key.encode()).hexdigest()[:8]


def ask_claude_for_patch(service, finding):
    snippet = finding["snippet"]
    code_context = ""
    file_match = re.search(r'(/root/Agent-spy/[\w/.\-]+\.py)', snippet)
    if file_match:
        target_file = file_match.group(1)
        try:
            target_path = Path(target_file)
            if target_path.exists():
                code = target_path.read_text()
                code_lines = code.split("\n")
                line_match = re.search(r'line (\d+)', snippet)
                if line_match:
                    ln = int(line_match.group(1))
                    s, e = max(0, ln - 25), min(len(code_lines), ln + 25)
                    code_context = (f"\n=== {target_file} lines {s+1}-{e} ===\n"
                                    + "\n".join(f"{i+1}: {code_lines[i]}"
                                                for i in range(s, e)))
                else:
                    code_context = f"\n=== {target_file} (excerpt) ===\n{code[:6000]}"
        except Exception as e:
            log(f"code read err: {e}")

    system = """You are a Python bug-fixing assistant for a trading bot system.
You diagnose runtime errors and propose minimal, surgical patches.

Output STRICT JSON only, no prose, no markdown fence:
{
  "diagnosis": "1-3 sentence root cause",
  "severity": "CRITICAL|HIGH|MEDIUM|LOW",
  "auto_apply_safe": true|false,
  "patches": [
    {"file": "/abs/path.py", "find": "exact unique text", "replace": "new text", "reason": "why"}
  ]
}

Rules:
- "auto_apply_safe": true ONLY for purely defensive patches (try/except wrap, null check, retry, log-format fix). NEVER for logic changes or trading-constant changes.
- "find" must be UNIQUE in file: include 5+ surrounding lines of context.
- If insufficient context to fix safely: return empty patches array, just diagnose."""

    user = (f"Service: {service}\nSeverity: {finding['severity']}\n"
            f"Type: {finding['type']}\n\n=== Log ===\n{snippet[:2500]}\n{code_context}")

    try:
        raw = ask_claude(system, user)
    except Exception as e:
        return {"diagnosis": f"CLAUDE_ERR: {e}", "patches": [],
                "auto_apply_safe": False, "severity": finding['severity']}
    text = raw if isinstance(raw, str) else str(raw)
    m = re.search(r'\{.*\}', text, re.DOTALL)
    if not m:
        return {"diagnosis": "PARSE_FAIL: no JSON in response", "patches": [],
                "auto_apply_safe": False, "raw": text[:500],
                "severity": finding['severity']}
    try:
        parsed = json.loads(m.group(0))
        parsed.setdefault("patches", [])
        parsed.setdefault("auto_apply_safe", False)
        parsed.setdefault("severity", finding['severity'])
        return parsed
    except Exception as e:
        return {"diagnosis": f"PARSE_FAIL: {e}", "patches": [],
                "auto_apply_safe": False, "raw": text[:500],
                "severity": finding['severity']}


def apply_patch(patch: dict) -> dict:
    file = patch.get("file", "")
    find = patch.get("find", "")
    replace = patch.get("replace", "")
    if not file or not find or replace is None:
        return {"applied": False, "reason": "patch fields missing"}
    if is_protected(file):
        return {"applied": False, "reason": "PROTECTED file (financial)"}
    p = Path(file)
    if not p.exists():
        return {"applied": False, "reason": "file not found"}
    src = p.read_text()
    cnt = src.count(find)
    if cnt == 0:
        return {"applied": False, "reason": "find-string not in file"}
    if cnt > 1:
        return {"applied": False, "reason": f"find-string matches {cnt}x (not unique)"}
    new_src = src.replace(find, replace, 1)
    try:
        ast.parse(new_src)
    except SyntaxError as e:
        return {"applied": False, "reason": f"syntax error after patch: {e}"}
    bak = f"{file}.bak.bugreasoner_{int(time.time())}"
    shutil.copy2(file, bak)
    p.write_text(new_src)
    return {"applied": True, "backup": bak}


def format_alert(service, finding, diag, applied, proposed, fid):
    sev = diag.get("severity", finding["severity"])
    head = {"CRITICAL": "🚨🚨🚨", "HIGH": "⚠️⚠️", "MEDIUM": "🟡", "LOW": "🔵"}.get(sev, "⚠️")
    out = [
        f"{head} <b>BUG-REASONER {sev}</b> {head}",
        "━━━━━━━━━━━━━━━━━━",
        f"🔧 Service: <b>{service}</b>",
        f"🆔 Finding: <code>{fid}</code>",
        "",
        f"<b>Diagnose:</b> {diag.get('diagnosis','?')[:400]}",
        "",
        "<b>Log:</b>",
        f"<pre>{(finding['snippet'][:600]).replace('<','&lt;').replace('>','&gt;')}</pre>",
    ]
    if applied:
        out += ["", f"✅ <b>{len(applied)} Patch(es) AUTOMATISCH angewandt:</b>"]
        for ap in applied:
            out.append(f"  • <code>{Path(ap['file']).name}</code> — {ap.get('reason','')[:140]}")
    if proposed:
        out += ["", f"📝 <b>{len(proposed)} Patch(es) zur FREIGABE:</b>"]
        for pp in proposed:
            mark = " 🔒" if is_protected(pp.get("file", "")) else ""
            out.append(f"  • <code>{Path(pp.get('file','?')).name}</code>{mark} — {pp.get('reason','')[:140]}")
        out += ["", f"➡️ <code>/apply {fid}</code>  ·  <code>/reject {fid}</code>"]
    if not applied and not proposed:
        out += ["", "ℹ️ Kein Patch generiert (nur Diagnose)."]
    return "\n".join(out)


def process_finding(service, finding, state):
    fid = make_finding_id(service, finding)
    if fid in state.get("seen", {}):
        return None
    log(f"  ! {service} {finding['severity']}: {finding['summary'][:120]}")
    diag = ask_claude_for_patch(service, finding)
    applied, proposed = [], []
    for p in diag.get("patches", []) or []:
        if is_protected(p.get("file", "")):
            proposed.append(p)
            continue
        if diag.get("auto_apply_safe"):
            res = apply_patch(p)
            if res.get("applied"):
                applied.append({**p, "backup": res["backup"]})
                log(f"    ✓ APPLIED to {Path(p['file']).name}")
            else:
                proposed.append({**p, "_autofail": res.get("reason")})
                log(f"    ✗ AUTOAPPLY FAIL: {res.get('reason')}")
        else:
            proposed.append(p)
    record = {
        "fid": fid, "service": service, "finding": finding, "diagnosis": diag,
        "applied": applied, "proposed": proposed,
        "ts": datetime.now().isoformat(),
    }
    with FINDINGS.open("a") as f:
        f.write(json.dumps(record) + "\n")
    state.setdefault("seen", {})[fid] = {
        "first_seen": datetime.now().isoformat(),
        "action": "applied" if applied else ("proposed" if proposed else "diag"),
    }
    telegram(format_alert(service, finding, diag, applied, proposed, fid))
    return record


def load_state():
    if STATE.exists():
        try:
            return json.loads(STATE.read_text())
        except Exception:
            pass
    return {"seen": {}, "last_scan": 0}


def save_state(s):
    cutoff = time.time() - 86400
    s["seen"] = {k: v for k, v in s.get("seen", {}).items()
                 if datetime.fromisoformat(v["first_seen"]).timestamp() > cutoff}
    STATE.write_text(json.dumps(s, indent=2))


def scan_once():
    log("=== SCAN START ===")
    state = load_state()
    since = time.time() - WINDOW_S
    n = 0
    for name, path in LOG_TARGETS.items():
        if not path.exists():
            continue
        sf = is_silent(name, path)
        if sf and process_finding(name, sf, state):
            n += 1
        for f in scan_log(name, tail_recent(path, since)):
            if process_finding(name, f, state):
                n += 1
    state["last_scan"] = time.time()
    save_state(state)
    log(f"=== SCAN END: {n} new findings ===")
    return n


def main():
    log("Bug-Reasoner started")
    try:
        telegram("🤖 <b>Bug-Reasoner online</b>\nScannt alle 30min Logs aller Bots auf Errors.")
    except Exception:
        pass
    while True:
        try:
            scan_once()
        except Exception as e:
            log(f"SCAN FAIL: {e}\n{traceback.format_exc()}")
            try:
                telegram(f"⚠️ Bug-Reasoner Scan-Fehler: <code>{type(e).__name__}: {e}</code>")
            except Exception:
                pass
        time.sleep(SCAN_INTERVAL_S)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "once":
        scan_once()
    else:
        main()
