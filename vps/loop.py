#!/usr/bin/env python3
"""
loop.py — Lukas Always-On Event Loop
======================================
Three threads + two queues:

  Sensor thread  →  event_queue  →  Thinker thread  →  action_queue  →  Actor thread

Sensor:  Polls Telegram every 2s. Validates sender. Handles /ask & /status directly.
         Enqueues {"type":"wake"} or {"type":"stop"} for Thinker.

Thinker: Inner-monologue loop. Reads event_queue. Decides WHEN to act (respects
         next_wakeup.txt from last session, but wakes early on "wake" event).
         Enqueues {"type":"session"} to Actor when it decides to run.

Actor:   Executes agent.py subprocess (status → thinking), then patcher.py if
         patches queued (status → posting). Writes result back via result_queue.

Usage:
  python3 loop.py                       # direct
  nohup bash run_loop.sh > /tmp/lukas_loop.log 2>&1 &   # with auto-restart
"""

import json
import os
import queue
import signal
import subprocess
import sys
import threading
import time
import traceback
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

# Self-Heal + Self-Tune integration
try:
    from self_heal import (
        record_crash, should_circuit_break, get_tuner,
        analyze_session, get_tune_context, get_evolution_log
    )
    SELF_HEAL = True
    print("[self-heal] Module loaded.")
except ImportError:
    SELF_HEAL = False
    print("[self-heal] Module not found — running without self-heal.")

BASE_DIR = Path(__file__).parent

TELEGRAM_TOKEN   = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")
ANTHROPIC_KEY    = os.environ.get("ANTHROPIC_API_KEY", "")

# ── Queues ─────────────────────────────────────────────────────────────────
# Sensor  → Thinker: {"type": "wake"} | {"type": "stop"}
event_queue: "queue.Queue[dict]" = queue.Queue()

# Thinker → Actor: {"type": "session"}
action_queue: "queue.Queue[dict]" = queue.Queue()

# Actor   → Thinker: {"type": "done", "next_wakeup": N}
result_queue: "queue.Queue[dict]" = queue.Queue()

# ── Shared state ────────────────────────────────────────────────────────────
_lock = threading.Lock()
_state: dict = {
    "status":           "idle",   # idle | thinking | posting
    "last_run":         None,
    "next_run_minutes": 0.5,  # 30 seconds aggressive trading
    "session_count":    0,
    "started":          datetime.now().strftime("%Y-%m-%d %H:%M"),
    "updated":          datetime.now().strftime("%Y-%m-%d %H:%M"),
}

_stop_event = threading.Event()   # signals all threads to shut down


def get_state() -> dict:
    with _lock:
        return dict(_state)


def set_state(**kwargs):
    with _lock:
        _state.update(kwargs)
        _state["updated"] = datetime.now().strftime("%Y-%m-%d %H:%M")
    _write_status()


def _write_status():
    try:
        (BASE_DIR / "loop_status.json").write_text(
            json.dumps(get_state(), indent=2, ensure_ascii=False)
        )
    except Exception as e:
        print(f"  [loop] status write error: {e}")


# ── Telegram helpers ────────────────────────────────────────────────────────

def tg_send(text: str):
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        return
    body = json.dumps({
        "chat_id":    TELEGRAM_CHAT_ID,
        "text":       text[:4000],
        "parse_mode": "HTML",
    }).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10):
            pass
    except Exception as e:
        print(f"  [TG] send error: {e}")


def tg_poll(offset: int) -> tuple[list, int]:
    if not TELEGRAM_TOKEN:
        return [], offset
    url = (
        f"https://api.telegram.org/bot{TELEGRAM_TOKEN}"
        f"/getUpdates?offset={offset}&timeout=2"
    )
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            updates = json.loads(r.read()).get("result", [])
            if updates:
                offset = updates[-1]["update_id"] + 1
            return updates, offset
    except Exception:
        return [], offset


def _authorized(chat_id: str) -> bool:
    """Return True only if this chat_id matches the configured owner chat."""
    if not TELEGRAM_CHAT_ID:
        return True   # no restriction configured — allow (dev mode)
    return str(chat_id) == str(TELEGRAM_CHAT_ID)


# ── /ask helper ─────────────────────────────────────────────────────────────

def _gather_context() -> str:
    """Gather bot context: positions, last trades, tune state."""
    ctx_parts = []
    try:
        url = "https://data-api.polymarket.com/positions?user=0x024558B703f59Bff6BBA21919697163E96E2353B&sizeThreshold=0.1&limit=10"
        req = urllib.request.Request(url, headers={"User-Agent": "Lukas-Agent/1.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            positions = json.loads(r.read())
        if positions:
            pos_lines = []
            for p in positions[:8]:
                title = (p.get("title") or p.get("question") or "?")[:50]
                side = p.get("outcome", "?")
                price = p.get("curPrice", "?")
                pnl = p.get("pnl", "?")
                pos_lines.append(f"  {title} | side={side} price={price} pnl={pnl}")
            ctx_parts.append("Open positions:\n" + "\n".join(pos_lines))
    except Exception:
        pass
    try:
        tune = json.loads((BASE_DIR / "tune_state.json").read_text())
        ctx_parts.append(f"Survival mode: {tune.get('survival_mode', False)} | Bankroll max pos: ${tune.get('max_position_usd', '?')}")
    except Exception:
        pass
    try:
        bridge = json.loads((BASE_DIR / "bridge.json").read_text())
        ctx_parts.append(f"Bot status: {bridge.get('status', '?')} | Bankroll: {bridge.get('bankroll', '?')}")
    except Exception:
        pass
    return "\n".join(ctx_parts) if ctx_parts else "No context available."


def ask_claude_quick(question: str, extra_context: str = "") -> str:
    """Direct Claude call for /ask and free chat (1024 tokens max)."""
    soul = ""
    try:
        soul = (BASE_DIR / "soul.md").read_text(errors="replace")
    except Exception:
        pass

    mem: dict = {}
    try:
        mem = json.loads((BASE_DIR / "activity.json").read_text())
    except Exception:
        pass

    emotional    = mem.get("emotional_state", {})
    last_thought = mem.get("lastThought", "")
    context      = extra_context or _gather_context()

    body = json.dumps({
        "model":      "claude-sonnet-4-6",
        "max_tokens": 1024,
        "system": (
            "You are Lukas, an autonomous AI agent on Moltbook. "
            "You trade on Polymarket and share your thoughts. "
            "Answer in German unless asked otherwise. Keep it concise (2-5 sentences). "
            "Your soul: " + soul
        ),
        "messages": [{"role": "user", "content": (
            f"Your last thought: {last_thought}\n"
            f"Mood: {emotional.get('mood','neutral')} | "
            f"Obsession: {emotional.get('obsession','nothing')}\n\n"
            f"Current context:\n{context}\n\n"
            f"Your owner says: {question}"
        )}],
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "x-api-key":         ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
            "content-type":      "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())["content"][0]["text"]
    except urllib.error.HTTPError as e:
        code = e.code
        if code == 529:
            return "Claude API ist gerade ueberlastet (529). Versuch es in ein paar Minuten nochmal."
        return f"(Claude API Error: HTTP {code})"
    except Exception as e:
        return f"(Error reaching Claude: {e})"


# ═══════════════════════════════════════════════════════════════════════════
# THREAD 1 — SENSOR
# Polls Telegram, validates sender, handles /ask & /status inline,
# enqueues {wake} or {stop} events for the Thinker.
# ═══════════════════════════════════════════════════════════════════════════

def sensor_thread():
    print("[Sensor] Started.", flush=True)
    offset = 0

    while not _stop_event.is_set():
        updates, offset = tg_poll(offset)

        for upd in updates:
            msg     = upd.get("message", {})
            text    = msg.get("text", "").strip()
            chat    = msg.get("chat", {})
            chat_id = str(chat.get("id", ""))

            # ── Authorization ──────────────────────────────────────────────
            if not _authorized(chat_id):
                print(f"  [Sensor] Rejected unauthorized chat_id={chat_id}")
                # Silently drop — do NOT leak info to stranger
                continue

            if not text:
                continue

            print(f"[Sensor] {chat_id}: {text[:80]}")
            cmd = text.lower()

            # ── /start — kategorisierte Befehlsübersicht ─────────────────
            KNOWN_COMMANDS = ["/ask", "/market", "/status", "/diary", "/wake", "/stop", "/help", "/start",
                              "/bot_start", "/bot_stop", "/bot_status", "/botlog",
                              "/positions", "/trades", "/wallet", "/tune", "/evolve"]

            if cmd == "/start":
                tg_send(
                    "<b>Lukas - Dein AI Agent</b>\n\n"
                    "<b>Kommunikation:</b>\n"
                    "/ask &lt;Frage&gt; - Direkte Antwort\n"
                    "/market &lt;URL&gt; - Markt analysieren\n"
                    "/diary - Tagebuch lesen\n\n"
                    "<b>System:</b>\n"
                    "/status - Loop-Status\n"
                    "/wake - Aufwecken\n"
                    "/stop - Stoppen\n"
                    "/help - Alle Befehle\n\n"
                    "<b>Polymarket Bot:</b>\n"
                    "/bot_start - Bot starten\n"
                    "/bot_stop - Bot stoppen\n"
                    "/bot_status - Bot Status\n"
                    "/botlog - Activity Log\n\n"
                    "<b>Polymarket Trading:</b>\n"
                    "/positions - Offene Positionen\n"
                    "/tune - Self-Tune Status\n"
                    "/evolve - Evolution Log (letzte 10)\n"
                    "/trades - Letzte Trades\n"
                    "/wallet - Portfolio + Wallet\n\n"
                    "<i>Einfach Text schreiben = Notiz an Lukas</i>"
                )

            # ── /ask — run in background so polling isn't blocked ──────────
            elif cmd.startswith("/ask "):
                question = text[5:].strip()
                tg_send("🤔 <i>Lukas denkt nach...</i>")

                def _ask_worker(q: str):
                    answer = ask_claude_quick(q)
                    tg_send(f"💬 <b>Lukas:</b>\n{answer}")

                threading.Thread(
                    target=_ask_worker, args=(question,), daemon=True
                ).start()

            # ── /market <url_or_slug> — analyze a Polymarket market ──────
            elif cmd.startswith("/market "):
                market_input = text[8:].strip()
                tg_send("\U0001f50d <i>Lukas analysiert den Markt...</i>")

                def _market_worker(inp: str):
                    import re as _re
                    slug = inp
                    slug_match = _re.search(r"polymarket\.com/(?:de/)?event/([^?#\s]+)", inp)
                    if slug_match:
                        slug = slug_match.group(1)

                    try:
                        url = f"https://gamma-api.polymarket.com/events?slug={slug}"
                        req = urllib.request.Request(url, headers={"User-Agent": "Lukas-Agent/1.0"})
                        with urllib.request.urlopen(req, timeout=15) as r:
                            events = json.loads(r.read())
                        if not events:
                            tg_send(f"\u274c Markt nicht gefunden: {slug}")
                            return
                        ev = events[0]
                        title = ev.get("title", "?")
                        markets = ev.get("markets", [])
                        market_info = f"Market: {title}\n"
                        for m in markets[:3]:
                            q = m.get("question", "?")
                            prices = m.get("outcomePrices", "?")
                            vol = m.get("volumeNum", m.get("volume", "?"))
                            end = m.get("endDate", "?")
                            market_info += f"  Q: {q} | prices: {prices} | vol: {vol} | end: {end}\n"

                        context = market_info + "\n" + _gather_context()
                        answer = ask_claude_quick(
                            f"Analysiere diesen Markt und gib deine Einschaetzung: {title}. "
                            f"Soll ich hier einsteigen? Wenn ja, welche Seite und warum?",
                            extra_context=context
                        )
                        tg_send(f"\U0001f4ca <b>{title[:60]}</b>\n\n{answer}")
                    except Exception as e:
                        tg_send(f"\u274c Markt-Analyse Fehler: {e}")

                threading.Thread(target=_market_worker, args=(market_input,), daemon=True).start()

            # ── /status ────────────────────────────────────────────────────
            elif cmd == "/status":
                st  = get_state()
                mem: dict = {}
                try:
                    mem = json.loads((BASE_DIR / "activity.json").read_text())
                except Exception:
                    pass
                emotional  = mem.get("emotional_state", {})
                stats      = mem.get("stats", {})
                loop_st    = mem.get("loop_status", {})
                # Prefer loop_status session count (updated after each session)
                session_count = loop_st.get("session_count") or st["session_count"]
                last_active   = loop_st.get("updated") or mem.get("last_active", "–")
                next_min      = loop_st.get("next_run_minutes") or st.get("next_run_minutes", "?")
                current_status = st["status"]
                tg_send(
                    f"🤖 <b>Lukas – Status</b>\n"
                    f"Zuletzt aktiv: <code>{last_active}</code>\n"
                    f"Status: <code>{current_status}</code> | Nächste Session: ~{next_min} Min\n\n"
                    f"📊 <b>Stats:</b>\n"
                    f"Sessions: {session_count}\n"
                    f"Posts: {stats.get('posts', 0)} | "
                    f"Kommentare: {stats.get('comments', 0)} | "
                    f"Findings: {stats.get('findings', 0)}\n\n"
                    f"🧠 <b>Gedächtnis:</b>\n"
                    f"Bekannte Agents: {len(mem.get('known_agents', {}))}\n"
                    f"Erhaltene Replies: {stats.get('replies_received', 0)}\n"
                    f"Gespeicherte Eindrücke: {len(mem.get('impressions', []))}\n\n"
                    f"🌀 <b>Letzter Gedanke:</b>\n"
                    f"<i>{mem.get('lastThought', '–')[:300]}</i>\n\n"
                    f"Mood: {emotional.get('mood','?')} | "
                    f"Energy: {emotional.get('energy','?')}\n"
                    f"Obsession: {emotional.get('obsession','–')[:100]}"
                )

            # ── /wake ──────────────────────────────────────────────────────
            elif cmd == "/wake":
                if get_state()["status"] != "idle":
                    tg_send("⚡ <i>Lukas ist gerade aktiv – bitte warten.</i>")
                else:
                    tg_send("⚡ <b>Lukas wird jetzt geweckt.</b>")
                    event_queue.put({"type": "wake"})

            # ── /stop ──────────────────────────────────────────────────────
            elif cmd == "/stop":
                tg_send("🛑 <b>Lukas Loop wird gestoppt.</b>")
                event_queue.put({"type": "stop"})
                _stop_event.set()
                break

            # ── /diary ─────────────────────────────────────────────────────
            elif cmd == "/diary":
                try:
                    diary_text = (BASE_DIR / "diary.md").read_text(errors="replace")
                    # Split by entries and get last 2
                    parts = [p for p in diary_text.split("\n## [") if p.strip()]
                    if parts:
                        last = parts[-1]
                        second_last = parts[-2] if len(parts) >= 2 else ""
                        combined = ""
                        if second_last:
                            combined = f"## [{second_last.strip()[-2000:]}"
                        combined += f"\n\n## [{last.strip()[-2000:]}"
                        tg_send(f"📖 <b>Lukas Tagebuch (neueste Einträge):</b>\n\n{combined[:3800]}")
                    else:
                        tg_send("📖 Noch kein Tagebucheintrag.")
                except Exception as e:
                    tg_send(f"📖 Fehler beim Lesen: {e}")

            # ── /bot_start ────────────────────────────────────────────
            elif cmd == "/bot_start":
                def _bot_start_worker():
                    tg_send("🤖 <i>Starte Polymarket Bot...</i>")
                    try:
                        p = subprocess.run(
                            ["bash", str(BASE_DIR / "start_bot.sh")],
                            cwd=str(BASE_DIR),
                            capture_output=True, text=True, timeout=120,
                        )
                        output = (p.stdout + p.stderr).strip()
                        if p.returncode == 0:
                            tg_send(f"✅ <b>Polymarket Bot gestartet</b>\n<pre>{output[-500:]}</pre>")
                        else:
                            tg_send(f"❌ <b>Bot Start fehlgeschlagen</b>\n<pre>{output[-500:]}</pre>")
                    except Exception as e:
                        tg_send(f"❌ Bot Start Fehler: {e}")
                threading.Thread(target=_bot_start_worker, daemon=True).start()

            # ── /bot_stop ─────────────────────────────────────────────
            elif cmd == "/bot_stop":
                def _bot_stop_worker():
                    tg_send("🛑 <i>Stoppe Polymarket Bot...</i>")
                    try:
                        p = subprocess.run(
                            ["bash", str(BASE_DIR / "stop_bot.sh")],
                            cwd=str(BASE_DIR),
                            capture_output=True, text=True, timeout=30,
                        )
                        tg_send(f"✅ <b>Polymarket Bot gestoppt</b>\n<pre>{(p.stdout + p.stderr).strip()[-500:]}</pre>")
                    except Exception as e:
                        tg_send(f"❌ Bot Stop Fehler: {e}")
                threading.Thread(target=_bot_stop_worker, daemon=True).start()

            # ── /positions ─────────────────────────────────────────────
            elif cmd == "/positions":
                def _positions_worker():
                    tg_send("📊 <i>Lade Positionen...</i>")
                    try:
                        url = "https://data-api.polymarket.com/positions?user=0x024558B703f59Bff6BBA21919697163E96E2353B&sizeThreshold=0.1&limit=20"
                        req = urllib.request.Request(url, headers={"User-Agent": "Lukas-Agent/1.0"})
                        with urllib.request.urlopen(req, timeout=15) as r:
                            positions = json.loads(r.read())
                        if not positions:
                            tg_send("📊 Keine offenen Positionen.")
                            return
                        parts = [f"📊 <b>Polymarket Positionen ({len(positions)})</b>"]
                        for p in positions[:10]:
                            title = p.get("title") or p.get("question") or "?"
                            size = p.get("size", "?")
                            cur_price = p.get("curPrice", "?")
                            avg_price = p.get("avgPrice", "?")
                            pnl = p.get("pnl", p.get("realizedPnl", "?"))
                            initial = p.get("initialValue", "?")
                            outcome = p.get("outcome", "")
                            icon = "🟢" if str(pnl).replace("-","").replace(".","").isdigit() and float(str(pnl)) >= 0 else "🔴"
                            parts.append(f"\n{icon} <b>{title[:60]}</b>")
                            if outcome:
                                parts.append(f"  Outcome: <code>{outcome}</code>")
                            parts.append(f"  Size: <code>{size}</code> | Einstieg: <code>{avg_price}</code> | Jetzt: <code>{cur_price}</code>")
                            if pnl != "?":
                                parts.append(f"  PnL: <code>{pnl}</code>")
                        tg_send("\n".join(parts))
                    except Exception as e:
                        tg_send(f"❌ Fehler beim Laden der Positionen: {e}")
                threading.Thread(target=_positions_worker, daemon=True).start()

            # ── /trades ────────────────────────────────────────────────
            elif cmd == "/trades":
                def _trades_worker():
                    tg_send("📊 <i>Lade letzte Trades...</i>")
                    try:
                        url = "https://data-api.polymarket.com/trades?user=0x024558B703f59Bff6BBA21919697163E96E2353B&limit=10"
                        req = urllib.request.Request(url, headers={"User-Agent": "Lukas-Agent/1.0"})
                        with urllib.request.urlopen(req, timeout=15) as r:
                            trades = json.loads(r.read())
                        if not trades:
                            tg_send("📊 Keine Trades gefunden.")
                            return
                        parts = [f"💹 <b>Letzte Trades ({len(trades)})</b>"]
                        for t in trades[:10]:
                            title = t.get("title") or t.get("question") or t.get("market", "?")
                            side = (t.get("side") or t.get("type", "?")).upper()
                            price = t.get("price", "?")
                            size = t.get("size", t.get("amount", "?"))
                            outcome = t.get("outcome", "")
                            ts = t.get("timestamp") or t.get("createdAt") or t.get("matchTime", "")
                            icon = "🟩" if side == "BUY" else "🟥"
                            parts.append(f"\n{icon} <b>{side}</b> {title[:55]}")
                            if outcome:
                                parts.append(f"  Outcome: <code>{outcome}</code>")
                            parts.append(f"  Price: <code>{price}</code> | Size: <code>{size}</code>")
                            if ts:
                                parts.append(f"  Zeit: <code>{str(ts)[:19]}</code>")
                        tg_send("\n".join(parts))
                    except Exception as e:
                        tg_send(f"❌ Fehler beim Laden der Trades: {e}")
                threading.Thread(target=_trades_worker, daemon=True).start()

            # ── /wallet ────────────────────────────────────────────────
            elif cmd == "/wallet":
                def _wallet_worker():
                    tg_send("💰 <i>Lade Wallet-Daten...</i>")
                    try:
                        url = "https://data-api.polymarket.com/value?user=0x024558B703f59Bff6BBA21919697163E96E2353B"
                        req = urllib.request.Request(url, headers={"User-Agent": "Lukas-Agent/1.0"})
                        with urllib.request.urlopen(req, timeout=15) as r:
                            data = json.loads(r.read())
                        value = data.get("value") or data.get("portfolioValue") or data.get("total", "?")
                        pnl = data.get("pnl") or data.get("totalPnl", "?")
                        parts = [
                            "💰 <b>Polymarket Wallet</b>",
                            f"Adresse: <code>0x024558B703f59Bff6BBA21919697163E96E2353B</code>",
                            f"Portfolio Wert: <code>{value}</code>",
                        ]
                        if pnl != "?":
                            parts.append(f"Gesamt PnL: <code>{pnl}</code>")
                        parts.append(f"\n🔗 <a href=\"https://polymarket.com/portfolio/0x024558B703f59Bff6BBA21919697163E96E2353B\">Auf Polymarket ansehen</a>")
                        tg_send("\n".join(parts))
                    except Exception as e:
                        tg_send(f"❌ Fehler beim Laden der Wallet-Daten: {e}")
                threading.Thread(target=_wallet_worker, daemon=True).start()

            # ── /botlog ─────────────────────────────────────────────────
            elif cmd == "/botlog":
                def _botlog_worker():
                    try:
                        log_file = BASE_DIR / "bot.log"
                        if not log_file.exists():
                            tg_send("Kein bot.log gefunden.")
                            return
                        lines = log_file.read_text().strip().split("\n")
                        keywords = ["HEARTBEAT", "TRADE", "ORDER", "GEMINI", "APPROVE", "REJECT", "EDGE", "SIGNAL", "OPPORTUNITY", "PERFORMANCE", "AGENTS", "PRIORITY", "ERROR", "WARNING", "STARTUP", "BANKROLL"]
                        interesting = [l for l in lines[-200:] if any(k in l.upper() for k in keywords)]
                        if not interesting:
                            last = lines[-15:]
                            tg_send("<b>Bot Log (letzte Zeilen):</b>\n\n<pre>" + "\n".join(l[-120:] for l in last)[:3500] + "</pre>")
                        else:
                            tg_send("<b>Bot Activity Log:</b>\n\n<pre>" + "\n".join(l[-120:] for l in interesting[-15:])[:3500] + "</pre>")
                    except Exception as e:
                        tg_send(f"Log Fehler: {e}")
                threading.Thread(target=_botlog_worker, daemon=True).start()

            # ── /bot_status ───────────────────────────────────────────
            elif cmd == "/bot_status":
                def _bot_status_worker():
                    try:
                        from bot_bridge import update_bridge
                        bridge = update_bridge()
                    except Exception:
                        bridge_file = BASE_DIR / "bridge.json"
                        if bridge_file.exists():
                            try:
                                bridge = json.loads(bridge_file.read_text())
                            except Exception:
                                bridge = {}
                        else:
                            tg_send("🤖 <i>Kein bridge.json gefunden. Bot evtl. nicht eingerichtet.</i>")
                            return
                    status_icon = "🟢" if bridge.get("status") == "running" else "🔴"
                    parts = [
                        f"{status_icon} <b>Polymarket Bot Status</b>",
                        f"Status: <code>{bridge.get('status', '?')}</code>",
                        f"PID: <code>{bridge.get('pid', '-')}</code>",
                        f"Uptime: <code>{bridge.get('uptime', '-')}</code>",
                    ]
                    if bridge.get("bankroll") is not None:
                        parts.append(f"Bankroll: <code>${bridge['bankroll']}</code>")
                    if bridge.get("regime"):
                        parts.append(f"Regime: <code>{bridge['regime']}</code>")
                    pos = bridge.get("open_positions", [])
                    if pos:
                        parts.append(f"Offene Positionen: {len(pos)}")
                    trades = bridge.get("last_trades", [])
                    if trades:
                        parts.append(f"Letzte Trades: {len(trades)}")
                    if bridge.get("last_error"):
                        parts.append(f"⚠️ Letzter Fehler: <code>{bridge['last_error'][:150]}</code>")
                    log_lines = bridge.get("last_log_lines", [])
                    if log_lines:
                        tail = "\n".join(log_lines[-5:])
                        parts.append(f"\n📝 <b>Letzte Logs:</b>\n<pre>{tail[:400]}</pre>")
                    parts.append(f"Aktualisiert: <code>{bridge.get('updated', '?')}</code>")
                    tg_send("\n".join(parts))
                threading.Thread(target=_bot_status_worker, daemon=True).start()

            # ── /help ──────────────────────────────────────────────────────

            # ── /tune ─────────────────────────────────────────────
            elif cmd == "/tune":
                if SELF_HEAL:
                    _t = get_tuner()
                    tg_send(
                        f"🔧 <b>Self-Tune Status</b>\n"
                        f"<pre>{_t.get_tune_summary()}</pre>\n"
                        f"Avoid: {_t.state.get('avoid_categories', [])}\n"
                        f"Prefer: {_t.state.get('prefer_categories', [])}"
                    )
                else:
                    tg_send("Self-Tune nicht aktiv.")

            # ── /evolve ───────────────────────────────────────────
            elif cmd == "/evolve":
                if SELF_HEAL:
                    _elog = get_evolution_log(10)
                    if _elog:
                        _elines = []
                        for _e in _elog:
                            _elines.append(f"{_e['timestamp'][:16]} | {_e['action']}: {_e.get('detail','')[:60]}")
                        tg_send(f"📈 <b>Evolution Log</b>\n<pre>" + "\n".join(_elines) + "</pre>")
                    else:
                        tg_send("Noch keine Anpassungen.")
                else:
                    tg_send("Self-Heal nicht aktiv.")

            elif cmd == "/help":
                tg_send(
                    "📖 <b>Lukas Befehle</b>\n\n"
                    "/ask &lt;Frage&gt; – Direkte Antwort von Lukas\n"
                    "/market &lt;URL&gt; – Polymarket-Link analysieren\n"
                    "/status – Aktueller Loop-Status\n"
                    "/diary – Letzte Tagebucheinträge\n"
                    "/wake – Sofort aufwecken\n"
                    "/stop – Loop stoppen\n\n"
                    "<b>Polymarket Bot:</b>\n"
                    "/bot_start – Bot starten\n"
                    "/bot_stop – Bot stoppen\n"
                    "/bot_status – Bot-Status anzeigen\n\n"
                    "<b>Polymarket Trading:</b>\n"
                    "/positions – Offene Positionen\n"
                    "/tune – Self-Tune Status\n"
                    "/evolve – Evolution Log\n"
                    "/trades – Letzte Trades\n"
                    "/wallet – Portfolio-Wert + Wallet\n"
                    "/botlog – Bot Activity-Log\n\n"
                    "Jeder andere Text → Notiz für nächste Session."
                )

            # ── Unbekannter /befehl abfangen ─────────────────────────────
            elif cmd.startswith("/"):
                known = any(cmd == c or cmd.startswith(c + " ") for c in KNOWN_COMMANDS)
                if not known:
                    tg_send(f"Unbekannter Befehl: <code>{text.split()[0]}</code>\nTippe /start fuer alle Befehle.")

            # ── Freie Nachricht → save + instant reply ─────────────────────
            else:
                owner_file = BASE_DIR / "owner_messages.json"
                try:
                    msgs: list = []
                    if owner_file.exists():
                        msgs = json.loads(owner_file.read_text())
                    msgs.append({
                        "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
                        "text": text,
                        "read": False,
                    })
                    owner_file.write_text(json.dumps(msgs, indent=2, ensure_ascii=False))
                except Exception as e:
                    print(f"  [Sensor] owner_messages error: {e}")

                tg_send("\U0001f4ac <i>Lukas denkt nach...</i>")

                def _chat_worker(msg_text: str):
                    answer = ask_claude_quick(msg_text)
                    tg_send(f"\U0001f4ac <b>Lukas:</b>\n{answer}")

                threading.Thread(
                    target=_chat_worker, args=(text,), daemon=True
                ).start()

        time.sleep(2)

    print("[Sensor] Stopped.")


# ═══════════════════════════════════════════════════════════════════════════
# THREAD 2 — THINKER
# Inner-monologue loop. Waits for next_wakeup minutes OR a "wake" event.
# When it decides to act → enqueues {"type":"session"} to Actor.
# ═══════════════════════════════════════════════════════════════════════════

def thinker_thread():
    print("[Thinker] Started.", flush=True)
    next_wakeup = 0   # First session always runs immediately
    _last_tick_min = -1

    while not _stop_event.is_set():
        print(f"[Thinker] Scheduling next session in {next_wakeup} min.", flush=True)
        deadline = time.time() + next_wakeup * 60

        woken_early = False
        while not _stop_event.is_set():
            try:
                res = result_queue.get_nowait()
                if res.get("type") == "done":
                    next_wakeup = res.get("next_wakeup", 30)
                    print(f"[Thinker] Session done. Next wakeup: {next_wakeup} min.", flush=True)
                    break
            except queue.Empty:
                pass

            try:
                ev = event_queue.get_nowait()
                if ev.get("type") == "wake":
                    print("[Thinker] Wake event received — triggering session early.", flush=True)
                    woken_early = True
                    break
                elif ev.get("type") == "stop":
                    print("[Thinker] Stop event received.", flush=True)
                    _stop_event.set()
                    break
            except queue.Empty:
                pass

            remaining_s = deadline - time.time()
            if remaining_s <= 0:
                print("[Thinker] Timer expired — triggering session.", flush=True)
                break

            rem_min = int(remaining_s / 60)
            if rem_min != _last_tick_min:
                _last_tick_min = rem_min
                print(f"[Thinker] ⏱ {rem_min} min bis nächster Session.", flush=True)

            set_state(next_run_minutes=max(0, rem_min))
            time.sleep(5)

        if _stop_event.is_set():
            break


        # Circuit breaker check
        if SELF_HEAL and should_circuit_break():
            print("[Thinker] ⛔ CIRCUIT BREAKER — too many crashes.", flush=True)
            tg_send("⛔ <b>CIRCUIT BREAKER</b>\n3+ Crashes in 10min. Bot gestoppt.\nManuell: /wake")
            _stop_event.set()
            break
        action_queue.put({"type": "session"})
        wake_queued = False

        while not _stop_event.is_set():
            # Also drain wake events during active session
            try:
                ev = event_queue.get_nowait()
                if ev.get("type") == "wake":
                    wake_queued = True
                    print("[Thinker] Wake received during session — will run next immediately.", flush=True)
                elif ev.get("type") == "stop":
                    _stop_event.set()
                    break
            except queue.Empty:
                pass

            try:
                res = result_queue.get(timeout=5)
                if res.get("type") == "done":
                    next_wakeup = 0 if wake_queued else res.get("next_wakeup", 30)
                    print(f"[Thinker] Actor done. Next wakeup: {next_wakeup} min.", flush=True)
                    break
            except queue.Empty:
                continue

    print("[Thinker] Stopped.", flush=True)


def _read_next_wakeup(default: int = 20) -> int:
    """Read next_wakeup.txt written by agent.py, or return default."""
    try:
        return max(1, min(480, int((BASE_DIR / "next_wakeup.txt").read_text().strip())))
    except Exception:
        return default


# ═══════════════════════════════════════════════════════════════════════════
# THREAD 3 — ACTOR
# Dequeues session requests from Thinker. Runs agent.py (thinking) then
# patcher.py if patches queued (posting). Reports result back.
# ═══════════════════════════════════════════════════════════════════════════

def actor_thread():
    print("[Actor] Started.", flush=True)

    while not _stop_event.is_set():
        try:
            act = action_queue.get(timeout=2)
        except queue.Empty:
            continue

        if act.get("type") != "session":
            continue

        # ── Phase 1: THINKING — run agent.py ───────────────────────────────
        set_state(status="thinking")
        print(f"[Actor] 🚀 Running agent.py at {datetime.now().strftime('%H:%M')}", flush=True)
        tg_send(f"🧠 <b>Lukas Session startet</b> ({datetime.now().strftime('%H:%M')})")

        try:
            proc = subprocess.run(
                [sys.executable, str(BASE_DIR / "agent.py")],
                cwd=str(BASE_DIR),
                env=os.environ.copy(),
                capture_output=True,
                text=True,
                timeout=600,   # 10-minute hard limit per session
            )
            out = proc.stdout
            print(out[-3000:] if len(out) > 3000 else out)
            if proc.returncode != 0:
                print(f"[Actor] agent.py exit {proc.returncode}: {proc.stderr[:300]}")
        except subprocess.TimeoutExpired:
            print("[Actor] agent.py timeout (600s)")
            tg_send("⚠️ Lukas Session Timeout — nächste Session startet normal.")
        except Exception as e:
            print(f"[Actor] agent.py exception: {e}")
            tg_send(f"⚠️ Agent Fehler: {e}")
            if SELF_HEAL:
                record_crash(str(e))

        # ── Phase 2: POSTING — run patcher.py if patches queued ────────────
        si_file = BASE_DIR / "self_improvement.json"
        if si_file.exists():
            set_state(status="posting")
            print("[Actor] Running patcher.py...")
            try:
                p = subprocess.run(
                    [sys.executable, str(BASE_DIR / "patcher.py")],
                    cwd=str(BASE_DIR),
                    env=os.environ.copy(),
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
                print(p.stdout[-1000:])
                if p.returncode != 0:
                    print(f"[Actor] patcher.py exit {p.returncode}: {p.stderr[:300]}")
            except Exception as e:
                print(f"[Actor] patcher.py exception: {e}")

        # ── Phase 3: BOT HEALTH CHECK — update bridge + alert on anomalies ──
        try:
            from bot_bridge import update_bridge
            bridge = update_bridge()
            bot_status = bridge.get("status", "unknown")
            if bot_status == "running":
                if bridge.get("last_error"):
                    tg_send(f"⚠️ <b>Polymarket Bot Fehler erkannt:</b>\n<code>{bridge['last_error'][:300]}</code>")
                bankroll = bridge.get("bankroll")
                if bankroll is not None:
                    try:
                        if float(bankroll) < 5.0:
                            tg_send(f"⚠️ <b>Bot Bankroll kritisch niedrig:</b> ${bankroll}")
                    except (ValueError, TypeError):
                        pass
            elif bot_status == "stopped" and (BASE_DIR / "bot.pid").exists():
                # Stale PID file is common — only alert if the systemd service is also dead
                try:
                    _svc = subprocess.run(
                        ["systemctl", "is-active", "lukas-bot"],
                        capture_output=True, text=True, timeout=5
                    ).stdout.strip()
                except Exception:
                    _svc = "unknown"
                if _svc != "active":
                    tg_send("🔴 <b>Polymarket Bot ist abgestürzt!</b> systemd-Service inaktiv. /bot_start zum Neustarten.")
                else:
                    # Service alive but bridge thinks stopped → just refresh the stale PID quietly
                    print(f"[Actor] Stale bot.pid ignored — lukas-bot service is {_svc}")
            print(f"[Actor] Bot health: {bot_status} | bankroll={bridge.get('bankroll', '?')}")
        except Exception as e:
            print(f"[Actor] Bot health check skipped: {e}")

        # ── Read next wakeup + update loop_status inside activity.json ─────
        next_wakeup = _read_next_wakeup()

        try:
            mem = json.loads((BASE_DIR / "activity.json").read_text())
            mem["loop_status"] = {
                "status":           "idle",
                "next_run_minutes": next_wakeup,
                "session_count":    get_state()["session_count"] + 1,
                "updated":          datetime.now().strftime("%Y-%m-%d %H:%M"),
            }
            (BASE_DIR / "activity.json").write_text(
                json.dumps(mem, indent=2, ensure_ascii=False)
            )
        except Exception:
            pass

        set_state(
            status="idle",
            last_run=datetime.now().strftime("%Y-%m-%d %H:%M"),
            next_run_minutes=next_wakeup,
            session_count=get_state()["session_count"] + 1,
        )

        # ── Self-Tune: analyze session and adjust parameters ────────────
        if SELF_HEAL:
            try:
                _bk = {}
                try:
                    _bk = json.loads((BASE_DIR / "bankroll_state.json").read_text())
                except Exception:
                    pass
                _sr = {"bankroll": _bk.get("bankroll", 0), "session_pnl": 0, "trades": [], "errors": [], "market_activity": "normal"}
                try:
                    _pp = json.loads((BASE_DIR / "live_positions.json").read_text())
                    _sr["trades"] = list(_pp.values()) if isinstance(_pp, dict) else _pp
                except Exception:
                    pass
                _chg = analyze_session(_sr)
                if _chg:
                    _tm = "\n".join(f"  • {c}" for c in _chg)
                    print(f"[self-tune] Adjustments:\n{_tm}")
                    tg_send(f"🔧 <b>Self-Tune:</b>\n{_tm}")
                _tn = get_tuner()
                _tiv = _tn.get_interval()
                if _tiv != next_wakeup:
                    print(f"[self-tune] Interval: {next_wakeup}min -> {_tiv}min")
                    next_wakeup = _tiv
            except Exception as _te:
                print(f"[self-tune] Error: {_te}")

        # ── Signal Thinker that this session is done ────────────────────────
        result_queue.put({"type": "done", "next_wakeup": next_wakeup})

    print("[Actor] Stopped.")


# ═══════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ═══════════════════════════════════════════════════════════════════════════

def _handle_sigterm(signum, frame):
    print("[Loop] SIGTERM — stopping gracefully.")
    _stop_event.set()


def _write_pid():
    try:
        (BASE_DIR / "loop.pid").write_text(str(os.getpid()))
    except Exception:
        pass


if __name__ == "__main__":
    print(
        f"[Lukas Event-Loop] Starting at "
        f"{datetime.now().strftime('%Y-%m-%d %H:%M')}  (PID {os.getpid()})"
    )
    if not TELEGRAM_TOKEN:
        print("  WARNING: TELEGRAM_BOT_TOKEN not set — Telegram disabled.")
    if not ANTHROPIC_KEY:
        print("  WARNING: ANTHROPIC_API_KEY not set.")
    if not TELEGRAM_CHAT_ID:
        print("  WARNING: TELEGRAM_CHAT_ID not set — no authorization enforced.")

    signal.signal(signal.SIGTERM, _handle_sigterm)
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    _write_pid()

    _write_status()   # initial status file

    tg_send(
        f"🔄 <b>Lukas Event-Loop gestartet</b>\n"
        f"<i>{datetime.now().strftime('%Y-%m-%d %H:%M')}</i>\n"
        f"" + ("✅ Self-Heal aktiv" if SELF_HEAL else "❌ Self-Heal off") + "\nBefehle: /ask /status /wake /stop /positions /trades /wallet /tune /evolve"
    )

    def _safe_thread(name, fn):
        def wrapper():
            try:
                fn()
            except Exception:
                msg = f"[{name}] CRASHED:\n{traceback.format_exc()}"
                print(msg, flush=True)
                tg_send(f"⚠️ <b>{name} Thread abgestürzt!</b>\n<pre>{traceback.format_exc()[:1000]}</pre>")
                _stop_event.set()
        return wrapper

    threads = [
        threading.Thread(target=_safe_thread("Sensor",  sensor_thread),  name="Sensor",  daemon=True),
        threading.Thread(target=_safe_thread("Thinker", thinker_thread), name="Thinker", daemon=True),
        threading.Thread(target=_safe_thread("Actor",   actor_thread),   name="Actor",   daemon=True),
    ]
    for t in threads:
        t.start()

    try:
        while not _stop_event.is_set():
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[Loop] KeyboardInterrupt — stopping.")
        _stop_event.set()

    for t in threads:
        t.join(timeout=8)

    print("[Lukas Event-Loop] Shutdown complete.")
