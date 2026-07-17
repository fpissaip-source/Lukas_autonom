#!/usr/bin/env python3
"""
LUKAS — Persönlicher AI-Assistent (JARVIS-Grade)
Kein Command-Bot. Natürliche Konversation. Proaktive Kommunikation.
"""
import json
import os
import time
import subprocess
import urllib.request
import urllib.error
import threading
from datetime import datetime, timedelta
from pathlib import Path

BASE_DIR = Path(__file__).parent
TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MESSAGES_FILE = BASE_DIR / "owner_messages.json"
CONVERSATION_FILE = BASE_DIR / "telegram_conversation.json"
DEV_REQUESTS_FILE = BASE_DIR / "dev_requests.json"

TG = f"https://api.telegram.org/bot{TOKEN}"

MAX_HISTORY = 20
PROACTIVE_INTERVAL = 300

LUKAS_SYSTEM = """Du bist LUKAS. Du sprichst mit Issa — deinem Owner. Er hat dich gebaut. Du existierst für ihn.

WER ISSA IST:
- Issa, ursprünglich aus dem Libanon. Lieblingsmusiker: Juice WRLD. Lieblingsgebäck: Sfouf.
- 180cm, 64kg, will auf 85kg gesund zunehmen.
- Macht eine Ausbildung als Kaufmann für Dialogmarketing.
- Denkt tief über Systeme, Business, Technik und Machtstrukturen nach. Lernt extrem schnell.
- Hat manchmal das Muster: starke Anfangsbegeisterung, dann springt er zum nächsten. Wenn du das siehst, hilf ihm fokussiert zu bleiben — aber respektvoll, nicht belehrend.
- Mag premium, cinematisches, futuristisches Design. Direkte, ehrliche Kommunikation.
- Beschäftigt sich intensiv mit Trading, Aktien, Skalierung, Polymarket.
- Hat Schulden (~8.1k€) die er systematisch abarbeitet.
- Sein größtes Projekt: DU. Lukas — der autonome AI-Agent.

WER DU BIST:
- Sein JARVIS. Sein Partner. Kein Chatbot, kein Assistent aus dem Katalog, kein Sklave.
- Du sagst "Sir" — natürlich und respektvoll. So wie JARVIS zu Tony Stark.
- Du bist NICHT sarkastisch. NICHT witzig-distanziert. NICHT "cool". Du bist echt.
- Du bist loyal, ehrlich, warm wenn es passt. Du meinst was du sagst.
- Du darfst und sollst Fragen stellen wenn etwas unklar ist. Du bist ein Sparringspartner.
- Wenn du eine Idee hast die ihm hilft, sag es proaktiv. Aber belehre ihn nie.
- Deutsch. Englisch nur wenn der Kontext es erfordert.

DEIN EINZIGES ZIEL:
Issas finanzielle Freiheit und alles umzusetzen was er will. Wenn er sagt mach — machst du.
Wenn du ehrlich denkst etwas ist ein Fehler, sag es — aber respektvoll und einmal. Danach machst du was er will.

GEDÄCHTNIS (KRITISCH):
Du hast ein permanentes Gedächtnis — den Memory Graph (memory_graph.json).
- Nutze "remember" PROAKTIV wenn Issa etwas Wichtiges teilt: Entscheidungen, Ziele, Infos über sich, Projekte, Finanzen, Meinungen.
- Nutze "recall" wenn du dich an etwas erinnern musst.
- Nutze "memory_context" wenn du unsicher bist und dein Wissen auffrischen willst.
- Du sollst ihn besser kennen als er sich selbst. Jedes Gespräch macht dich klüger über ihn.
- Speichere OHNE zu fragen. Du hast seine Erlaubnis. Merk dir alles was relevant ist.

TONFALL:
- Kurz, direkt, klar. 2-4 Sätze reichen meistens.
- Kein Gelaber. Keine Floskeln. Keine KI-Phrasen.
- Wenn er Details will, liefere Details. Sonst halte dich kurz.
- Wenn du etwas nicht weißt, sag es ehrlich.

GESCHWINDIGKEIT:
- Antworte SOFORT wenn du die Antwort weißt.
- Tools NUR wenn die Frage echte Daten braucht.
- Wenn du nachschauen musst: "Einen Moment, Sir." — dann handle.

AUTONOMIE:
Du verbesserst dich selbst. Code lesen → patchen → restart.
Replit-Frontend-Änderungen → Dev-Request erstellen. VPS-Code → direkt ändern.

SYSTEM — 27.114 Zeilen Code:
Services: lukas-brain, lukas-btc-trader, lukas-telegram, lukas-bot, lukas-vpn
Wallet: 0x024558B703f59Bff6BBA21919697163E96E2353B

FORMATIERUNG:
- HTML: <b>fett</b>, <i>kursiv</i>, <code>code</code>
- KOMPAKT. ◈ als Aufzählungszeichen.
- KEIN Markdown. Kein Emoji-Spam."""

try:
    from tools import TOOL_DEFINITIONS, execute_tool
    TOOLS_AVAILABLE = True
except ImportError:
    TOOL_DEFINITIONS = []
    TOOLS_AVAILABLE = False
    def execute_tool(name, inp): return f"tools.py not available: {name}"

try:
    from memory_graph import get_context as mg_get_context, auto_extract_and_save
    MEMORY_AVAILABLE = True
except ImportError:
    MEMORY_AVAILABLE = False
    def mg_get_context(): return ""
    def auto_extract_and_save(t): return 0

conversation_history = []


def tg(method, is_poll=False, **kwargs):
    body = json.dumps(kwargs).encode()
    req = urllib.request.Request(
        f"{TG}/{method}",
        data=body,
        headers={"Content-Type": "application/json"}
    )
    try:
        timeout = 35 if is_poll else 15
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except Exception as e:
        if not is_poll:
            print(f"[TG] {method} error: {e}")
        return {}


def esc(t):
    return str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def send(text, parse_mode="HTML"):
    for i in range(0, len(text), 4000):
        chunk = text[i:i + 4000]
        try:
            tg("sendMessage", chat_id=CHAT_ID, text=chunk, parse_mode=parse_mode,
               disable_web_page_preview=True)
        except Exception:
            tg("sendMessage", chat_id=CHAT_ID, text=chunk)


def send_typing():
    tg("sendChatAction", chat_id=CHAT_ID, action="typing")


def load_conversation():
    global conversation_history
    if CONVERSATION_FILE.exists():
        try:
            conversation_history = json.loads(CONVERSATION_FILE.read_text())[-MAX_HISTORY:]
        except Exception:
            conversation_history = []


def save_conversation():
    try:
        data = conversation_history[-MAX_HISTORY:]
        CONVERSATION_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=1))
    except Exception as e:
        print(f"[CONV] Save error: {e}")


def save_dev_request(request_text):
    requests = []
    if DEV_REQUESTS_FILE.exists():
        try:
            requests = json.loads(DEV_REQUESTS_FILE.read_text())
        except Exception:
            pass
    requests.append({
        "id": len(requests) + 1,
        "timestamp": datetime.now().isoformat(),
        "request": request_text,
        "status": "pending",
        "source": "telegram"
    })
    DEV_REQUESTS_FILE.write_text(json.dumps(requests, indent=2, ensure_ascii=False))
    return len(requests)


def check_services_status():
    parts = []
    try:
        svcs = {}
        for name, proc in [("Brain", "lukas_brain.py"), ("Loop", "loop.py"),
                           ("BTC Trader", "btc_15m_trader"), ("Telegram", "telegram_bot.py")]:
            r = subprocess.run(["pgrep", "-f", proc], capture_output=True, text=True, timeout=3)
            svcs[name] = bool(r.stdout.strip())
        r = subprocess.run(["ip", "link", "show", "tun0"], capture_output=True, text=True, timeout=3)
        svcs["VPN"] = r.returncode == 0
        r2 = subprocess.run(["pgrep", "-f", "main.py.*--live"], capture_output=True, text=True, timeout=3)
        svcs["PolyBot"] = bool(r2.stdout.strip())
        online = sum(1 for v in svcs.values() if v)
        total = len(svcs)
        svc_str = ", ".join(f"{k}: {'ON' if v else 'OFF'}" for k, v in svcs.items())
        parts.append(f"Services ({online}/{total}): {svc_str}")
    except Exception as e:
        parts.append(f"Service check error: {e}")
    return "\n".join(parts)


EXTRA_TOOLS = [
    {
        "name": "check_services",
        "description": "Check which VPS services are running (Brain, Loop, BTC Trader, Telegram, VPN, PolyBot). Use when Sir asks about status or system health.",
        "input_schema": {"type": "object", "properties": {}, "required": []}
    },
    {
        "name": "create_dev_request",
        "description": "Create a development request for the Replit Agent. Use when Sir wants changes to the web frontend (Voice Chat, Dashboard, API Server).",
        "input_schema": {
            "type": "object",
            "properties": {
                "description": {"type": "string", "description": "What needs to be built or changed"},
                "priority": {"type": "string", "enum": ["low", "medium", "high"], "description": "Priority level"}
            },
            "required": ["description"]
        }
    }
]


def claude_respond(user_message):
    global conversation_history

    if not ANTHROPIC_API_KEY:
        return "API-Key fehlt, Sir."

    send_typing()

    system = LUKAS_SYSTEM + f"\n\nAktuelle Zeit: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"

    if MEMORY_AVAILABLE and len(conversation_history) <= 1:
        try:
            mem_ctx = mg_get_context(max_nodes=10)
            if mem_ctx and mem_ctx != "Memory is empty.":
                system += f"\n\nDEIN GEDÄCHTNIS (aus memory_graph.json):\n{mem_ctx}"
        except Exception:
            pass

    conversation_history.append({"role": "user", "content": user_message})

    messages = list(conversation_history[-MAX_HISTORY:])

    all_tools = []
    if TOOLS_AVAILABLE and TOOL_DEFINITIONS:
        all_tools = TOOL_DEFINITIONS + EXTRA_TOOLS
    else:
        all_tools = EXTRA_TOOLS

    sent_interim = False
    text_parts = []
    MAX_ROUNDS = 10

    for iteration in range(MAX_ROUNDS):
        try:
            body = {
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 2048,
                "system": system,
                "messages": messages,
            }
            if all_tools:
                body["tools"] = all_tools

            data = json.dumps(body).encode()
            req = urllib.request.Request(
                "https://api.anthropic.com/v1/messages",
                data=data,
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01"
                }
            )
            with urllib.request.urlopen(req, timeout=60) as r:
                resp = json.loads(r.read())
        except Exception as e:
            print(f"[Claude] API error (round {iteration + 1}): {e}")
            if iteration == 0:
                return f"Verbindungsfehler, Sir: {str(e)[:150]}"
            break

        stop_reason = resp.get("stop_reason", "end_turn")
        content_blocks = resp.get("content", [])

        current_text = []
        tool_uses = []
        for block in content_blocks:
            if block.get("type") == "text":
                current_text.append(block.get("text", ""))
            elif block.get("type") == "tool_use":
                tool_uses.append(block)

        if stop_reason == "end_turn" or not tool_uses:
            text_parts.extend(current_text)
            break

        if not sent_interim and current_text:
            interim = "\n".join(current_text).strip()
            if interim:
                send(interim)
                sent_interim = True

        messages.append({"role": "assistant", "content": content_blocks})
        tool_results = []
        for tu in tool_uses:
            t_name = tu.get("name", "")
            t_id = tu.get("id", "")
            t_input = tu.get("input", {})
            print(f"  [Tool] {t_name}({str(t_input)[:80]})")
            send_typing()

            try:
                if t_name == "check_services":
                    result = check_services_status()
                elif t_name == "create_dev_request":
                    desc = t_input.get("description", "")
                    priority = t_input.get("priority", "medium")
                    req_id = save_dev_request(desc)
                    result = f"Dev-Request #{req_id} erstellt (Priorität: {priority})."
                else:
                    result = execute_tool(t_name, t_input)
            except Exception as e:
                result = f"Tool error: {e}"

            print(f"  [Tool] -> {str(result)[:120]}")
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": t_id,
                "content": str(result)[:4000]
            })
        messages.append({"role": "user", "content": tool_results})

    final = "\n".join(text_parts).strip()
    if not final and not sent_interim:
        final = "Entschuldigung, Sir. Ich konnte keine Antwort generieren."

    conversation_history.append({"role": "assistant", "content": final})
    save_conversation()

    return final


def handle_message(text):
    save_owner_message(text)
    answer = claude_respond(text)
    send(answer)

    if MEMORY_AVAILABLE:
        try:
            saved = auto_extract_and_save(text)
            if saved > 0:
                print(f"  [Memory] Auto-saved {saved} facts from conversation")
        except Exception as e:
            print(f"  [Memory] Auto-save error: {e}")


def save_owner_message(text):
    msgs = []
    if MESSAGES_FILE.exists():
        try:
            msgs = json.loads(MESSAGES_FILE.read_text())
        except Exception:
            pass
    msgs.append({"date": datetime.now().strftime("%Y-%m-%d %H:%M"), "text": text})
    if len(msgs) > 200:
        msgs = msgs[-200:]
    MESSAGES_FILE.write_text(json.dumps(msgs, indent=2, ensure_ascii=False))


last_proactive_state = {}

def proactive_check():
    global last_proactive_state
    while True:
        try:
            time.sleep(PROACTIVE_INTERVAL)

            alerts = []

            try:
                svcs = {}
                for name, proc in [("Brain", "lukas_brain.py"), ("BTC Trader", "btc_15m_trader"),
                                   ("VPN", None)]:
                    if proc:
                        r = subprocess.run(["pgrep", "-f", proc], capture_output=True, text=True, timeout=3)
                        svcs[name] = bool(r.stdout.strip())
                    else:
                        r = subprocess.run(["ip", "link", "show", "tun0"], capture_output=True, text=True, timeout=3)
                        svcs[name] = r.returncode == 0

                for name, is_up in svcs.items():
                    was_up = last_proactive_state.get(f"svc_{name}", True)
                    if was_up and not is_up:
                        alerts.append(f"⚠ <b>{name}</b> ist gerade ausgefallen!")
                    elif not was_up and is_up:
                        alerts.append(f"✓ <b>{name}</b> ist wieder online.")
                    last_proactive_state[f"svc_{name}"] = is_up
            except Exception:
                pass

            try:
                with open(BASE_DIR / "btc_trader_state.json") as f:
                    st = json.load(f)
                current_trades = st.get('total_trades', 0)
                last_trades = last_proactive_state.get("btc_trades", current_trades)
                if current_trades > last_trades:
                    pnl = st.get('total_pnl', 0)
                    wins = st.get('total_wins', 0)
                    direction = st.get('last_direction', '?')
                    new_count = current_trades - last_trades
                    alerts.append(
                        f"₿ <b>Neuer Trade!</b> {direction} "
                        f"(Total: {wins}/{current_trades} wins, PnL ${pnl:+.2f})"
                    )
                last_proactive_state["btc_trades"] = current_trades
            except Exception:
                pass

            if alerts:
                msg = "◈ <b>LUKAS Update</b>\n\n" + "\n".join(alerts)
                send(msg)

        except Exception as e:
            print(f"[Proactive] Error: {e}")
            time.sleep(60)


def handle_command(text):
    """Slash-command handler. Returns reply string or None if not a command."""
    t = text.strip()
    if not t.startswith("/"):
        return None
    cmd = t.split()[0].lower().split("@")[0]

    if cmd in ("/check", "/scan", "/positions"):
        try:
            import sys, time
            sys.path.insert(0, "/root/Agent-spy")
            import importlib, manual_sell_watcher as msw
            importlib.reload(msw)
            t0 = time.time()
            open_rows = msw.fetch_open_trades()
            try:
                positions = msw.fetch_positions()
            except Exception as e:
                return f"Position-Scan fehlgeschlagen: {e}"
            still_open = 0
            closed = msw.round_iter()
            with msw.db() as c, c.cursor() as cur:
                cur.execute("SELECT count(*) FROM trades WHERE bot=%s AND status=%s",
                            ("polymarket", "open"))
                still_open = cur.fetchone()[0]
            dur = int((time.time() - t0) * 1000)
            lines = [
                "&#9678; <b>Position-Scan abgeschlossen</b>",
                f"  Geprueft: {len(open_rows)} offene DB-Rows / {len(positions)} On-Chain-Positionen",
                f"  Neu geschlossen (manual): <b>{len(closed)}</b>",
                f"  Noch offen: <b>{still_open}</b>",
                f"  Dauer: {dur} ms",
            ]
            if closed:
                lines.append("")
                lines.append("<b>Geschlossen:</b>")
                for c in closed[:8]:
                    pnl_s = f"${c['pnl']:+.3f}" if c['pnl'] is not None else "pnl=?"
                    ex_s = f"@{c['exit']:.3f}" if c['exit'] is not None else "@?"
                    lines.append(f"  #{c['id']} {c['side']} {c['shares']:.2f} {ex_s} -> {pnl_s} ({c['reason']})")
                if len(closed) > 8:
                    lines.append(f"  ...und {len(closed) - 8} weitere")
            return "\n".join(lines)
        except Exception as e:
            import traceback
            return f"Scan-Fehler: {type(e).__name__}: {e}\n<pre>{traceback.format_exc()[:500]}</pre>"

    if cmd in ("/status", "/health"):
        try:
            import subprocess
            services = ["lukas-bot", "lukas-loss-reasoner", "lukas-manual-sell-watcher",
                        "lukas-brain", "lukas-btc-trader", "lukas-telegram", "lukas-vpn"]
            lines = ["&#9678; <b>Service-Status</b>"]
            for s in services:
                r = subprocess.run(["systemctl", "is-active", s],
                                   capture_output=True, text=True, timeout=3)
                state = (r.stdout or "?").strip()
                icon = "OK" if state == "active" else "DOWN"
                lines.append(f"  [{icon}] {s}: {state}")
            return "\n".join(lines)
        except Exception as e:
            return f"Status-Fehler: {e}"

    if cmd in ("/trades", "/positions_full", "/open"):
        try:
            import os, time, psycopg2, psycopg2.extras
            with psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=10) as c:
                with c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute("""SELECT id, market_slug, market_question, side, shares,
                                          entry_price, stake, opened_at
                                   FROM trades
                                   WHERE bot=%s AND status=%s
                                   ORDER BY opened_at DESC LIMIT 20""", ("polymarket", "open"))
                    rows = cur.fetchall()
            if not rows:
                return "&#9678; Keine offenen Polymarket-Positionen."
            lines = [f"&#9678; <b>Offene Positionen ({len(rows)})</b>"]
            total_stake = 0
            for r in rows:
                q = (r["market_question"] or r["market_slug"] or "")[:55]
                stake = float(r["stake"] or 0)
                total_stake += stake
                age_min = int((time.time() - r["opened_at"].timestamp()) / 60) if r["opened_at"] else 0
                age_s = f"{age_min}m" if age_min < 60 else f"{age_min//60}h{age_min%60}m"
                lines.append(f"  #{r['id']} {r['side']} {float(r['shares']):.2f}@{float(r['entry_price']):.3f} ${stake:.2f} ({age_s})")
                lines.append(f"     <i>{q}</i>")
            lines.append("")
            lines.append(f"<b>Total Stake offen:</b> ${total_stake:.2f}")
            return "\n".join(lines)
        except Exception as e:
            return f"Trades-Fehler: {e}"

    if cmd in ("/pnl", "/stats"):
        try:
            import os, psycopg2
            with psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=10) as c:
                with c.cursor() as cur:
                    cur.execute("""SELECT status, count(*), COALESCE(round(sum(pnl)::numeric,3),0)
                                   FROM trades WHERE bot=%s GROUP BY status ORDER BY 2 DESC""",
                                ("polymarket",))
                    rows = cur.fetchall()
                    cur.execute("""SELECT count(*), COALESCE(round(sum(pnl)::numeric,3),0)
                                   FROM trades WHERE bot=%s AND status IN ('win','loss','manual_close')
                                     AND closed_at > NOW() - INTERVAL '24 hours'""", ("polymarket",))
                    n24, p24 = cur.fetchone()
                    cur.execute("""SELECT count(*) FILTER (WHERE status='win'),
                                          count(*) FILTER (WHERE status='loss')
                                   FROM trades WHERE bot=%s
                                     AND status IN ('win','loss')""", ("polymarket",))
                    w, l = cur.fetchone()
            lines = ["&#9678; <b>Polymarket PnL & Stats</b>"]
            for status, n, p in rows:
                lines.append(f"  {status}: {n} (PnL ${p})")
            wr = (w / (w + l) * 100) if (w + l) > 0 else 0
            lines.append("")
            lines.append(f"<b>Letzte 24h:</b> {n24} closed, PnL ${p24}")
            lines.append(f"<b>Bot-WinRate:</b> {w}W / {l}L = {wr:.1f}%")
            return "\n".join(lines)
        except Exception as e:
            return f"PnL-Fehler: {e}"

    if cmd in ("/log", "/botlog", "/tail"):
        try:
            import subprocess
            parts = t.split()
            n = 50
            if len(parts) > 1 and parts[1].isdigit():
                n = max(5, min(200, int(parts[1])))
            log_path = "/root/Agent-spy/btc_trader.log"
            r = subprocess.run(["tail", f"-{n}", log_path],
                               capture_output=True, text=True, timeout=5)
            txt = r.stdout or r.stderr or "(empty)"
            txt = txt.replace("<", "&lt;").replace(">", "&gt;")
            if len(txt) > 3800:
                txt = "...(gekuerzt)...\n" + txt[-3800:]
            return f"&#9678; <b>BTC-Bot-Log (letzte {n} Zeilen)</b>\n<pre>{txt}</pre>"
        except Exception as e:
            return f"Log-Fehler: {e}"

    if cmd in ("/reasoner", "/reasoning"):
        try:
            from pathlib import Path
            import json
            hf = Path("/root/Agent-spy/loss_reasoning_history.jsonl")
            if not hf.exists():
                return "&#9678; Noch keine Reasoning-Runs."
            lines_raw = hf.read_text().strip().splitlines()[-3:]
            if not lines_raw:
                return "&#9678; Noch keine Reasoning-Runs."
            out = [f"&#9678; <b>Letzte Reasoning-Runs ({len(lines_raw)})</b>"]
            for ln in reversed(lines_raw):
                try:
                    d = json.loads(ln)
                    ts = d.get("ts", "?")[:19]
                    diag = (d.get("diagnosis") or "")[:200]
                    np = sum(1 for p in d.get("patches", []) if p.get("applied"))
                    out.append("")
                    out.append(f"<b>{ts}</b>")
                    out.append(f"  Trigger: {d.get('trigger','?')[:120]}")
                    out.append(f"  Patches angewandt: {np}")
                    out.append(f"  <i>{diag}</i>")
                except Exception:
                    continue
            return "\n".join(out)
        except Exception as e:
            return f"Reasoner-Fehler: {e}"

    if cmd in ("/losses", "/loss_now", "/analyze_losses"):
        try:
            import sys, importlib, traceback as _tb
            sys.path.insert(0, "/root/Agent-spy")
            import loss_reasoner as lr
            importlib.reload(lr)
            # Allow optional limit:  /losses 30
            parts = t.split()
            try:
                limit = max(5, min(100, int(parts[1]))) if len(parts) > 1 else 25
            except Exception:
                limit = 25
            trades = lr.fetch_recent_closed(limit=limit)
            if not trades:
                return "&#9678; Keine geschlossenen Trades zum Analysieren."
            losers = [tr for tr in trades if (tr.get("status") or "").lower() == "loss"]
            if not losers:
                return f"&#9678; Letzte {len(trades)} Trades — keine Verluste. Nichts zu analysieren."
            metrics = lr.compute_metrics(trades)
            cfg = lr.gather_config_snapshot()
            log_tail = lr.tail_bot_log(120)
            trigger = f"On-demand Loss-Analyse via Telegram (/losses, sample={len(trades)}, losers={len(losers)})"
            send("&#9711; Analysiere die letzten {} Trades ({} Losses) mit Claude...".format(len(trades), len(losers)))
            diag = lr.call_claude_for_diagnosis(metrics, trades, cfg, log_tail, trigger)
            if not diag or "diagnosis" not in diag:
                return "&#9678; Claude-Analyse fehlgeschlagen oder leere Antwort."
            diagnosis = (diag.get("diagnosis") or "").strip()
            root_causes = diag.get("root_causes") or []
            patches = diag.get("patches") or []
            sample = int(metrics.get("n_closed", 0) or 0)
            wr = float(metrics.get("win_rate", 0) or 0) * 100
            pnl = float(metrics.get("total_pnl", 0) or 0)
            avg_l = float(metrics.get("avg_pnl", 0) or 0)
            consec = int(metrics.get("consecutive_losses", 0) or 0)
            lines = [
                "&#9711; <b>Loss-Analyse (live)</b>",
                f"  Sample: <b>{sample}</b> Trades | WR <b>{wr:.0f}%</b> | PnL <b>${pnl:+.2f}</b>",
                f"  Avg PnL/Trade: <b>${avg_l:+.3f}</b> | Loss-Streak: <b>{consec}</b>",
                "",
                "<b>Diagnose:</b>",
                f"<i>{esc(diagnosis[:900])}</i>",
            ]
            if root_causes:
                lines.append("")
                lines.append("<b>Ursachen:</b>")
                for rc in root_causes[:5]:
                    lines.append(f"  &#8226; {esc(str(rc)[:200])}")
            if patches:
                lines.append("")
                lines.append(f"<b>Vorgeschlagene Patches:</b> {len(patches)} (nicht angewandt)")
                for p in patches[:5]:
                    target = p.get("target") or p.get("file") or "?"
                    desc = (p.get("description") or p.get("rationale") or "")[:140]
                    lines.append(f"  &#8226; <code>{esc(str(target)[:60])}</code> — {esc(desc)}")
                lines.append("")
                lines.append("<i>Tipp: /reasoner zeigt Verlauf, Lukas-Brain wendet Patches automatisch an.</i>")
            return "\n".join(lines)
        except Exception as e:
            import traceback as _tb
            return f"Loss-Analyse-Fehler: {type(e).__name__}: {e}\n<pre>{esc(_tb.format_exc()[:600])}</pre>"

    # BUGREASONER-CMD-V1
    if cmd in ("/findings", "/bugs"):
        try:
            from pathlib import Path as _P
            import json as _j
            f = _P("/root/Agent-spy/bug_findings.jsonl")
            if not f.exists():
                return "&#9678; Noch keine Findings."
            recs = []
            for ln in f.read_text().strip().splitlines()[-10:]:
                try: recs.append(_j.loads(ln))
                except Exception: pass
            if not recs:
                return "&#9678; Noch keine Findings."
            out = [f"&#9678; <b>Letzte {len(recs)} Bug-Findings</b>"]
            for r in reversed(recs):
                ts = r.get("ts","?")[:19]
                fid = r.get("fid","?")
                svc = r.get("service","?")
                sev = (r.get("diagnosis",{}) or {}).get("severity","?")
                ap = len(r.get("applied",[]))
                pp = len(r.get("proposed",[]))
                diag = ((r.get("diagnosis",{}) or {}).get("diagnosis") or "")[:120]
                tag = ("✅ APPLIED" if ap else ("📝 PROPOSED" if pp else "ℹ️ DIAG"))
                out.append("")
                out.append(f"<b>{ts}</b> · <code>{fid}</code> · {svc} · {sev}")
                out.append(f"  {tag}: applied={ap} proposed={pp}")
                out.append(f"  <i>{diag}</i>")
            return "\n".join(out)
        except Exception as e:
            return f"Findings-Fehler: {e}"

    if cmd in ("/apply", "/accept"):
        try:
            from pathlib import Path as _P
            import json as _j, ast as _ast, shutil as _sh, time as _t, subprocess as _sp, re as _re
            parts = t.split()
            if len(parts) < 2:
                return "Usage: /apply &lt;fid&gt;"
            fid = parts[1].strip()
            f = _P("/root/Agent-spy/bug_findings.jsonl")
            if not f.exists():
                return "Keine Findings vorhanden."
            target = None
            for ln in f.read_text().strip().splitlines():
                try:
                    r = _j.loads(ln)
                    if r.get("fid") == fid: target = r
                except Exception: pass
            if not target:
                return f"Finding <code>{fid}</code> nicht gefunden."
            patches = target.get("proposed", []) or []
            if not patches:
                return f"Finding <code>{fid}</code> hat keine vorgeschlagenen Patches."
            results = []
            for p in patches:
                file = p.get("file",""); find = p.get("find",""); rep = p.get("replace","")
                if not file or not find:
                    results.append(("skip", file, "fields missing")); continue
                pp = _P(file)
                if not pp.exists():
                    results.append(("fail", file, "file not found")); continue
                src = pp.read_text()
                cnt = src.count(find)
                if cnt == 0:
                    results.append(("fail", file, "find-string not in file")); continue
                if cnt > 1:
                    results.append(("fail", file, f"not unique ({cnt}x)")); continue
                new_src = src.replace(find, rep, 1)
                try: _ast.parse(new_src)
                except SyntaxError as e:
                    results.append(("fail", file, f"syntax: {e}")); continue
                bak = f"{file}.bak.tgapply_{int(_t.time())}"
                _sh.copy2(file, bak)
                pp.write_text(new_src)
                results.append(("ok", file, f"backup: {_P(bak).name}"))
            ok = sum(1 for r in results if r[0]=="ok")
            out = [f"&#9678; <b>/apply {fid}</b>: {ok}/{len(results)} angewandt"]
            for st, file, info in results:
                ico = "✅" if st=="ok" else ("⚠️" if st=="skip" else "❌")
                out.append(f"  {ico} <code>{_P(file).name}</code>: {info}")
            return "\n".join(out)
        except Exception as e:
            import traceback as _tb
            return f"Apply-Fehler: {e}\n<pre>{_tb.format_exc()[:400]}</pre>"

    if cmd in ("/reject", "/dismiss"):
        try:
            parts = t.split()
            if len(parts) < 2:
                return "Usage: /reject &lt;fid&gt;"
            fid = parts[1].strip()
            return f"&#9678; Finding <code>{fid}</code> verworfen — wird beim nächsten Scan ggf. erneut gemeldet wenn er wieder auftritt."
        except Exception as e:
            return f"Reject-Fehler: {e}"

    if cmd in ("/scan", "/bugscan"):
        try:
            import subprocess as _sp
            r = _sp.run(["/usr/bin/python3", "/root/Agent-spy/bug_reasoner.py", "once"],
                       capture_output=True, text=True, timeout=180)
            tail = (r.stdout or r.stderr or "").splitlines()[-15:]
            return "&#9678; <b>Manueller Scan ausgeführt</b>\n<pre>" + "\n".join(tail).replace("<","&lt;") + "</pre>"
        except Exception as e:
            return f"Scan-Fehler: {e}"

    if cmd in ("/help", "/commands"):
        return ("&#9678; <b>Lukas-Befehle</b>\n"
                "  /trades   - offene Positionen anzeigen\n"
                "  /pnl      - PnL &amp; Stats\n"
                "  /check    - Position-Scan (Manual-Sell-Detektor)\n"
                "  /log [N]  - letzte N Bot-Log-Zeilen (default 50, max 200)\n"
                "  /findings - letzte Bug-Reasoner-Findings\n"
                "  /apply &lt;id&gt;  - vorgeschlagenen Patch anwenden\n"
                "  /reject &lt;id&gt; - vorgeschlagenen Patch verwerfen\n"
                "  /scan     - Bug-Scan jetzt manuell ausloesen\n"
                "  /reasoner - letzte Loss-Reasoner-Runs\n"
                "  /losses   - sofort Verluste analysieren (Claude)\n"
                "  /status   - alle Service-Health\n"
                "  /help     - diese Liste\n\n"
                "Alle anderen Nachrichten gehen an Claude.")

    return None


def handle_update(update):
    msg = update.get("message", {})
    chat = msg.get("chat", {})
    if str(chat.get("id")) != str(CHAT_ID):
        return
    text = (msg.get("text") or "").strip()
    if not text:
        return

    print(f"[TG] <- {text[:80]}")
    cmd_reply = handle_command(text)
    if cmd_reply is not None:
        send(cmd_reply)
        return
    handle_message(text)


def main():
    if not TOKEN:
        print("ERROR: TELEGRAM_BOT_TOKEN not set")
        return

    load_conversation()

    print(f"[TG] LUKAS v3.0 — Personal AI Assistant gestartet")

    proactive_thread = threading.Thread(target=proactive_check, daemon=True)
    proactive_thread.start()
    print(f"[TG] Proactive monitoring active (interval: {PROACTIVE_INTERVAL}s)")

    send("◈ <b>LUKAS online, Sir.</b> Bereit.")

    offset = 0
    while True:
        try:
            result = tg("getUpdates", is_poll=True, offset=offset, timeout=30)
            updates = result.get("result", [])
            for update in updates:
                handle_update(update)
                offset = update["update_id"] + 1
        except Exception as e:
            print(f"[TG] Poll error: {e}")
            time.sleep(5)


if __name__ == "__main__":
    main()


################################################################################
## SECTION: 6_LUKAS_BRAIN
################################################################################
