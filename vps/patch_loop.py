#!/usr/bin/env python3
"""Patches loop.py to integrate self_heal.py"""
import re

with open("/root/Agent-spy/loop.py", "r") as f:
    content = f.read()

changes = 0

# 1. Add import after "from pathlib import Path"
if "from self_heal import" not in content:
    old = "from pathlib import Path"
    new = """from pathlib import Path

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
    print("[self-heal] Module not found — running without self-heal.")"""
    content = content.replace(old, new, 1)
    changes += 1
    print("  [1] Added self_heal import")

# 2. Add crash tracking to agent.py timeout/exception handlers
if "record_crash" not in content:
    old = '''except subprocess.TimeoutExpired:
            print("[Actor] agent.py timeout (600s)")
            tg_send("⚠️ Lukas Session Timeout — nächste Session startet normal.")
        except Exception as e:
            print(f"[Actor] agent.py exception: {e}")
            tg_send(f"⚠️ Agent Fehler: {e}")'''

    new = '''except subprocess.TimeoutExpired:
            print("[Actor] agent.py timeout (600s)")
            tg_send("⚠️ Lukas Session Timeout — nächste Session startet normal.")
            if SELF_HEAL:
                record_crash("agent.py timeout (600s)")
        except Exception as e:
            print(f"[Actor] agent.py exception: {e}")
            tg_send(f"⚠️ Agent Fehler: {e}")
            if SELF_HEAL:
                record_crash(str(e))'''

    if old in content:
        content = content.replace(old, new, 1)
        changes += 1
        print("  [2] Added crash tracking to actor")
    else:
        print("  [2] WARNING: Could not find actor timeout pattern")

# 3. Add self-tune analysis before result_queue.put
if "analyze_session" not in content:
    old = '''        # ── Signal Thinker that this session is done ────────────────────────
        result_queue.put({"type": "done", "next_wakeup": next_wakeup})'''

    new = '''        # ── Self-Tune: analyze session and adjust parameters ────────────
        if SELF_HEAL:
            try:
                _bankroll_data = {}
                try:
                    _bankroll_data = json.loads((BASE_DIR / "bankroll_state.json").read_text())
                except Exception:
                    pass
                _session_result = {
                    "bankroll": _bankroll_data.get("bankroll", 0),
                    "session_pnl": 0,
                    "trades": [],
                    "errors": [],
                    "market_activity": "normal",
                }
                try:
                    _pos = json.loads((BASE_DIR / "live_positions.json").read_text())
                    _session_result["trades"] = list(_pos.values()) if isinstance(_pos, dict) else _pos
                except Exception:
                    pass
                _changes = analyze_session(_session_result)
                if _changes:
                    _tune_msg = "\\n".join(f"  \\u2022 {c}" for c in _changes)
                    print(f"[self-tune] Adjustments:\\n{_tune_msg}")
                    tg_send(f"\\U0001f527 <b>Self-Tune Anpassungen:</b>\\n{_tune_msg}")
                _tuner = get_tuner()
                _tuned_iv = _tuner.get_interval()
                if _tuned_iv != next_wakeup:
                    print(f"[self-tune] Overriding interval: {next_wakeup}min -> {_tuned_iv}min")
                    next_wakeup = _tuned_iv
            except Exception as _e:
                print(f"[self-tune] Error: {_e}")

        # ── Signal Thinker that this session is done ────────────────────────
        result_queue.put({"type": "done", "next_wakeup": next_wakeup})'''

    if old in content:
        content = content.replace(old, new, 1)
        changes += 1
        print("  [3] Added self-tune analysis after session")
    else:
        print("  [3] WARNING: Could not find result_queue pattern")

# 4. Add circuit breaker check in thinker_thread
if "should_circuit_break" not in content:
    old = '''        print(f"[Thinker] → Queueing session.", flush=True)
        action_queue.put({"type": "session"})'''

    new = '''        # Circuit breaker check
        if SELF_HEAL and should_circuit_break():
            print("[Thinker] ⛔ CIRCUIT BREAKER — too many crashes. Stopping.", flush=True)
            tg_send("⛔ <b>CIRCUIT BREAKER AKTIV</b>\\n3+ Crashes in 10 Minuten. Bot gestoppt.\\nPrüfe Logs und starte manuell mit /wake")
            _stop_event.set()
            break

        print(f"[Thinker] → Queueing session.", flush=True)
        action_queue.put({"type": "session"})'''

    if old in content:
        content = content.replace(old, new, 1)
        changes += 1
        print("  [4] Added circuit breaker to thinker")
    else:
        print("  [4] WARNING: Could not find thinker queueing pattern")

# 5. Add /tune and /evolve commands to valid_commands list
if '"/tune"' not in content:
    old = '"/positions", "/trades", "/wallet"]'
    new = '"/positions", "/trades", "/wallet", "/tune", "/evolve"]'
    if old in content:
        content = content.replace(old, new)
        changes += 1
        print("  [5] Added /tune and /evolve to valid commands")

# 6. Add /tune and /evolve command handlers in sensor thread
if "cmd == \"/tune\"" not in content:
    # Find the /wallet handler end pattern and add after it
    wallet_pattern = '"/wallet – Wallet Adresse'
    if wallet_pattern not in content:
        # Try alternate patterns
        wallet_pattern = "/wallet"

    # Find the help text and add our commands
    old_help_1 = '"/positions - Offene Positionen\\n"'
    new_help_1 = '"/positions - Offene Positionen\\n"\n                    "/tune - Self-Tune Status\\n"\n                    "/evolve - Evolution Log (letzte 10)\\n"'
    if old_help_1 in content:
        content = content.replace(old_help_1, new_help_1, 1)
        print("  [6a] Added /tune /evolve to help text (1)")

    old_help_2 = '"/positions – Offene Positionen\\n"'
    new_help_2 = '"/positions – Offene Positionen\\n"\n                    "/tune – Self-Tune Status\\n"\n                    "/evolve – Evolution Log\\n"'
    if old_help_2 in content:
        content = content.replace(old_help_2, new_help_2, 1)
        print("  [6b] Added /tune /evolve to help text (2)")

    # Add actual handlers — find the pattern where other elif cmd blocks are
    # Look for the /wallet handler end
    handler_code = '''
            # ── /tune ─────────────────────────────────────────────
            elif cmd == "/tune":
                if SELF_HEAL:
                    _t = get_tuner()
                    tg_send(
                        f"🔧 <b>Self-Tune Status</b>\\n"
                        f"<pre>{_t.get_tune_summary()}</pre>\\n"
                        f"Avoid: {_t.state.get('avoid_categories', [])}\\n"
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
                        tg_send(f"📈 <b>Evolution Log</b>\\n<pre>" + "\\n".join(_elines) + "</pre>")
                    else:
                        tg_send("Noch keine Anpassungen.")
                else:
                    tg_send("Self-Heal nicht aktiv.")
'''

    # Insert before the help handler
    help_marker = '            elif cmd == "/help":'
    if help_marker in content:
        content = content.replace(help_marker, handler_code + "\n" + help_marker, 1)
        changes += 1
        print("  [6c] Added /tune and /evolve command handlers")
    else:
        print("  [6c] WARNING: Could not find /help handler to insert before")

# 7. Add self-tune context to startup message
if "self-heal" not in content.lower() or "Self-Heal" not in content:
    old_startup = '''    tg_send(
        f"🔄 <b>Lukas Event-Loop gestartet</b>\\n"
        f"<i>{datetime.now().strftime('%Y-%m-%d %H:%M')}</i>\\n"
        f"Befehle: /ask /status /wake /stop /positions /trades /wallet /bot_start /bot_stop /bot_status"
    )'''

    new_startup = '''    _sh_status = "✅ Self-Heal aktiv" if SELF_HEAL else "❌ Self-Heal nicht geladen"
    tg_send(
        f"🔄 <b>Lukas Event-Loop gestartet</b>\\n"
        f"<i>{datetime.now().strftime('%Y-%m-%d %H:%M')}</i>\\n"
        f"{_sh_status}\\n"
        f"Befehle: /ask /status /wake /stop /positions /trades /wallet /tune /evolve"
    )'''

    if old_startup in content:
        content = content.replace(old_startup, new_startup, 1)
        changes += 1
        print("  [7] Updated startup message with self-heal status")

with open("/root/Agent-spy/loop.py", "w") as f:
    f.write(content)

print(f"\nDone. {changes} patches applied.")
