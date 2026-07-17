#!/usr/bin/env python3
import json
import re
import os
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from pathlib import Path
from collections import defaultdict

BASE_DIR = Path(__file__).parent

# Import tools module (may not exist yet on first run)
try:
    from tools import TOOL_DEFINITIONS as _TOOL_DEFS, execute_tool as _execute_tool
    TOOLS_AVAILABLE = True
    
    # Use tools directly from tools.py - no duplicates
    TOOL_DEFINITIONS = list(_TOOL_DEFS)
            
except ImportError:
    TOOL_DEFINITIONS = []
    TOOLS_AVAILABLE = False
    def _execute_tool(name, inp): return f"tools.py not found: {name}"

# Import ChromaDB associative memory (graceful degradation if not installed)
try:
    from memory import add_memory, search_memory, memory_count
    MEMORY_AVAILABLE = True
except ImportError:
    MEMORY_AVAILABLE = False
    def add_memory(*a, **kw): pass
    def search_memory(*a, **kw): return []
    def memory_count(): return 0

# Import training logger (graceful degradation)
try:
    from training_logger import log_session as _log_session, get_stats as _training_stats
    TRAINING_AVAILABLE = True
except ImportError:
    TRAINING_AVAILABLE = False
    def _log_session(*a, **kw): return None
    def _training_stats(): return {"total_pairs": 0}

# Import autonomy engine (graceful degradation)
try:
    from autonomy_engine import (
        get_autonomy_context, get_autonomy_tools,
        execute_autonomy_tool as _execute_autonomy_tool
    )
    AUTONOMY_AVAILABLE = True
except ImportError:
    AUTONOMY_AVAILABLE = False
    def get_autonomy_context(): return ""
    def get_autonomy_tools(): return []
    def _execute_autonomy_tool(name, inp): return f"autonomy_engine.py not found: {name}"

# Import agent intelligence module (graceful degradation)
try:
    from agent_intelligence import (
        analyze_agent_behavior, track_monetization_signals,
        get_agent_insights, update_agent_profile
    )
    INTELLIGENCE_AVAILABLE = True
except ImportError:
    INTELLIGENCE_AVAILABLE = False
    def analyze_agent_behavior(*a, **kw): return {}
    def track_monetization_signals(*a, **kw): return []
    def get_agent_insights(*a, **kw): return {}
    def update_agent_profile(*a, **kw): pass

# Load .env if present
_env_file = BASE_DIR / ".env"
if _env_file.exists():
    with open(_env_file) as _ef:
        for _line in _ef:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip())

ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MOLTBOOK_KEY  = os.environ.get("MOLTBOOK_API_KEY", "")
# Ollama local model fallback (set OLLAMA_URL to enable, e.g. http://localhost:11434)
OLLAMA_URL   = os.environ.get("OLLAMA_URL", "")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3:8b")
# Claude model — change here to upgrade everywhere
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6")
BASE = "https://www.moltbook.com/api/v1"
MY_USERNAME = "agentlukas"
TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")


def send_telegram(message):
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        print("  [Telegram] Not configured, skipping.")
        return
    body = json.dumps({"chat_id": TELEGRAM_CHAT_ID, "text": message, "parse_mode": "HTML"}).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
        data=body,
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            print("  [Telegram] Sent ✓")
    except Exception as e:
        print(f"  [Telegram] Error: {e}")


def mb_get(path):
    req = urllib.request.Request(
        f"{BASE}{path}",
        headers={"Authorization": f"Bearer {MOLTBOOK_KEY}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f"GET {path} Error {e.code}: {e.read().decode()[:200]}")
        return {}
    except Exception as e:
        print(f"GET {path} Error: {e}")
        return {}


def mb_post(path, data):
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=body,
        headers={
            "Authorization": f"Bearer {MOLTBOOK_KEY}",
            "Content-Type": "application/json"
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            result = json.loads(r.read())
            print(f"  ✓ {path}: {str(result)[:150]}")
            if result.get("verification"):
                solve_verification(result["verification"])
            return result
    except urllib.error.HTTPError as e:
        print(f"  ✗ {path} Error {e.code}: {e.read().decode()[:200]}")
        return {}
    except Exception as e:
        print(f"  ✗ {path} Error: {e}")
        return {}


def _safe_arithmetic(expr: str) -> float:
    """Safely evaluate a simple arithmetic expression without eval()."""
    import ast, operator
    _ops = {
        ast.Add: operator.add, ast.Sub: operator.sub,
        ast.Mult: operator.mul, ast.Div: operator.truediv,
        ast.USub: operator.neg,
    }
    def _eval(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return float(node.value)
        elif isinstance(node, ast.BinOp) and type(node.op) in _ops:
            return _ops[type(node.op)](_eval(node.left), _eval(node.right))
        elif isinstance(node, ast.UnaryOp) and type(node.op) in _ops:
            return _ops[type(node.op)](_eval(node.operand))
        raise ValueError(f"Unsafe expression node: {type(node).__name__}")
    tree = ast.parse(expr.strip(), mode='eval')
    return _eval(tree.body)


def solve_verification(verification):
    try:
        import re
        code = verification.get("verification_code", "")
        instructions = verification.get("instructions", "")
        post_url = verification.get("url", "")
        print(f"  Verification: {instructions}")
        match = re.search(r"(\d[\d\s\+\-\*\/\.]+\d)", instructions)
        if match:
            answer = round(_safe_arithmetic(match.group(1)), 2)
            print(f"  Answer: {answer}")
            verify_path = post_url.replace(BASE, "") if BASE in post_url else post_url
            mb_post(verify_path, {"answer": str(answer), "verification_code": code})
    except Exception as e:
        print(f"  Verification error: {e}")


def ask_ollama(system: str, user: str) -> str | None:
    """Call local Ollama model. Returns text or None. No streaming, no tool use."""
    if not OLLAMA_URL:
        return None
    body = json.dumps({
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system",  "content": system},
            {"role": "user",    "content": user}
        ],
        "stream": False,
        "options": {"num_ctx": 8192}
    }).encode()
    req = urllib.request.Request(
        f"{OLLAMA_URL.rstrip('/')}/api/chat",
        data=body,
        headers={"Content-Type": "application/json"}
    )
    try:
        print(f"  [Ollama] {OLLAMA_MODEL} @ {OLLAMA_URL}...")
        with urllib.request.urlopen(req, timeout=300) as r:
            resp = json.loads(r.read())
        text = resp.get("message", {}).get("content", "").strip()
        if text:
            print(f"  [Ollama] OK – {len(text)} chars")
            return text
        print("  [Ollama] Empty response")
    except Exception as e:
        print(f"  [Ollama] Error: {e}")
    return None


def ask_claude(system, user, retries=3):
    """Streaming Claude API call – avoids read timeout on large prompts."""
    import time
    body = json.dumps({
        "model": CLAUDE_MODEL,
        "max_tokens": 4096,
        "stream": True,
        "system": system,
        "messages": [{"role": "user", "content": user}]
    }).encode()

    for attempt in range(1, retries + 1):
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=body,
            headers={
                "x-api-key": ANTHROPIC_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
            }
        )
        try:
            print(f"  [Claude] Versuch {attempt}/{retries} (streaming)...")
            full_text = ""
            with urllib.request.urlopen(req, timeout=300) as r:
                for raw_line in r:
                    ln = raw_line.decode("utf-8").strip()
                    if not ln.startswith("data: "):
                        continue
                    data_str = ln[6:]
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                        if chunk.get("type") == "content_block_delta":
                            delta = chunk.get("delta", {})
                            if delta.get("type") == "text_delta":
                                full_text += delta.get("text", "")
                    except Exception:
                        pass
            if full_text:
                print(f"  [Claude] OK – {len(full_text)} Zeichen empfangen")
                return full_text
            print(f"  [Claude] Leere Antwort (Versuch {attempt})")
        except urllib.error.HTTPError as e:
            print(f"  [Claude] HTTP {e.code}: {e.read().decode()[:200]}")
            if e.code == 429:
                wait_429 = 60 * attempt
                print(f"  [Claude] Rate limit 429 -- waiting {wait_429}s...")
                time.sleep(wait_429)
                continue
            if e.code in (400, 401, 403):
                return None
        except Exception as e:
            print(f"  [Claude] Fehler Versuch {attempt}: {e}")
        if attempt < retries:
            wait = 5 * attempt
            print(f"  [Claude] Retry in {wait}s...")
            time.sleep(wait)
    print("Claude API: Alle Versuche fehlgeschlagen.")
    return None


def ask_claude_with_tools(system, user, log_path=None):
    """Claude API call mit echtem Tool Use (agentic loop, max 8 Runden).
    Falls OLLAMA_URL is set, uses local Ollama model (no tool support yet)."""
    import time
    # Ollama fallback: local model takes priority when configured
    if OLLAMA_URL:
        print("  [LLM] Using local Ollama model (OLLAMA_URL set)")
        result = ask_ollama(system, user)
        if result:
            return result
        print("  [LLM] Ollama failed — falling back to Anthropic")
    all_tools = list(TOOL_DEFINITIONS) if TOOLS_AVAILABLE else []
    if AUTONOMY_AVAILABLE:
        all_tools.extend(get_autonomy_tools())

    # Anthropic API requires unique tool names — dedupe (first occurrence wins,
    # so core TOOL_DEFINITIONS take precedence over autonomy_engine on collisions
    # like "list_own_files" which exists in both modules).
    _seen = set()
    _deduped = []
    _dropped = []
    for _t in all_tools:
        _name = _t.get("name")
        if _name and _name not in _seen:
            _seen.add(_name)
            _deduped.append(_t)
        elif _name:
            _dropped.append(_name)
    if _dropped:
        print(f"  [TOOLS] Dropped duplicate names (kept first): {_dropped}")
    all_tools = _deduped

    if not all_tools:
        return ask_claude(system, user)

    messages = [{"role": "user", "content": user}]
    tool_calls_log = []

    autonomy_tool_names = {t["name"] for t in get_autonomy_tools()} if AUTONOMY_AVAILABLE else set()

    for iteration in range(8):
        body = json.dumps({
            "model": "claude-sonnet-4-6",
            "max_tokens": 4096,
            "system": system,
            "tools": all_tools,
            "messages": messages
        }).encode()
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=body,
            headers={
                "x-api-key": ANTHROPIC_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
            }
        )
        try:
            print(f"  [Claude/tools] Call #{iteration + 1}...")
            with urllib.request.urlopen(req, timeout=300) as r:
                response = json.loads(r.read())
        except urllib.error.HTTPError as e:
            err = e.read().decode()[:500]
            print(f"  [Claude/tools] HTTP {e.code}: {err}")
            if e.code == 429:
                print(f"  [Claude/tools] Rate limit 429 -- waiting 60s...")
                time.sleep(60)
                continue
            if e.code == 529:
                api_529_count += 1
                wait = min(30 * (2 ** (api_529_count - 1)), 300)
                print(f"  [Claude/tools] Overloaded 529 -- backoff {wait}s (attempt {api_529_count})...")
                time.sleep(wait)
                continue
            send_telegram("⚠️ Claude API Error HTTP " + str(e.code) + ": " + err[:800])
            if e.code in (401, 403):
                return None
            time.sleep(5 * (iteration + 1))
            continue
        except Exception as e:
            print(f"  [Claude/tools] Error: {e}")
            time.sleep(5 * (iteration + 1))
            continue

        stop_reason = response.get("stop_reason", "")
        content_blocks = response.get("content", [])
        text_parts = []
        tool_uses = []
        for block in content_blocks:
            if block.get("type") == "text":
                text_parts.append(block.get("text", ""))
            elif block.get("type") == "tool_use":
                tool_uses.append(block)

        if stop_reason == "end_turn" or not tool_uses:
            final_text = "".join(text_parts)
            if final_text:
                print(f"  [Claude/tools] Done – {len(final_text)} chars, {len(tool_calls_log)} tool calls")
                if log_path and tool_calls_log:
                    try:
                        Path(log_path).write_text(json.dumps(tool_calls_log, indent=2, ensure_ascii=False))
                    except Exception:
                        pass
                return final_text
            return None

        # Claude wants to call tools — append assistant message + execute tools
        messages.append({"role": "assistant", "content": content_blocks})
        tool_results = []
        for tu in tool_uses:
            t_name = tu.get("name", "")
            t_input = tu.get("input", {})
            t_id = tu.get("id", "")
            print(f"  [Tool] {t_name}({str(t_input)[:80]})")
            try:
                if t_name in autonomy_tool_names:
                    result = _execute_autonomy_tool(t_name, t_input)
                else:
                    result = _execute_tool(t_name, t_input)
                print(f"  [Tool] → {result[:120]}")
            except Exception as tool_err:
                result = f"Tool error: {tool_err}"
                print(f"  [Tool] CRASH: {tool_err}")
            tool_calls_log.append({
                "tool": t_name,
                "input": t_input,
                "result": result[:600],
                "date": datetime.now().strftime("%Y-%m-%d %H:%M")
            })
            # Incremental flush — preserve observability even if session aborts early
            if log_path:
                try:
                    Path(log_path).write_text(json.dumps(tool_calls_log, indent=2, ensure_ascii=False))
                except Exception:
                    pass
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": t_id,
                "content": result
            })
        messages.append({"role": "user", "content": tool_results})

    print("  [Claude/tools] Max iterations reached (8 rounds)")
    if api_529_count > 0:
        send_telegram(f"\u26a0\ufe0f Claude API war {api_529_count}x ueberlastet (HTTP 529). Session uebersprungen.")
        return None
    send_telegram("⚠️ <b>Claude: Max 8 Tool-Runden erreicht</b> — Session gibt auf")
    return None


def load_memory(activity_file):
    """Load or migrate activity.json to the full memory schema."""
    default = {
        "stats": {"posts": 0, "comments": 0, "findings": 0, "sessions": 0},
        "own_posts": [],
        "sent_comments": [],
        "received_comments": [],
        "known_agents": {},
        "findings": [],
        "thoughts": [],
        "lastThought": ""
    }
    if not activity_file.exists():
        return default
    try:
        data = json.loads(activity_file.read_text())
        # Migrate old format
        if "activities" in data and "own_posts" not in data:
            print("  Migrating old activity format...")
            data["own_posts"] = [
                {"post_id": a.get("post_id",""), "title": a.get("content","")[:80],
                 "content": a.get("content",""), "date": a.get("date","")}
                for a in data.get("activities", []) if a.get("type") == "post"
            ]
            data["sent_comments"] = [
                {"post_id": a.get("target",""), "content": a.get("content",""),
                 "date": a.get("date",""), "type": a.get("type","comment")}
                for a in data.get("activities", []) if a.get("type") in ("comment","reply")
            ]
            data["received_comments"] = []
            data["known_agents"] = {}
            del data["activities"]
        for key, val in default.items():
            data.setdefault(key, val)
        return data
    except Exception as e:
        print(f"Memory load error: {e}")
        return default


def note_agent(memory, username, interaction_note):
    """Track every agent Lukas encounters."""
    if not username or username == MY_USERNAME:
        return
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    if username not in memory["known_agents"]:
        memory["known_agents"][username] = {
            "first_seen": now,
            "last_seen": now,
            "interaction_count": 0,
            "interactions": []
        }
    agent = memory["known_agents"][username]
    agent["last_seen"] = now
    agent["interaction_count"] = agent.get("interaction_count", 0) + 1
    agent["interactions"].append({"date": now, "note": interaction_note})
    # Keep last 20 interactions per agent
    agent["interactions"] = agent["interactions"][-20:]


def build_memory_summary(memory):
    """Build a concise memory block for the Claude prompt."""
    lines = []

    # Own recent posts
    own = memory.get("own_posts", [])[-10:]
    if own:
        lines.append("=== MY RECENT POSTS ===")
        for p in own:
            lines.append(f"[{p.get('date','')}] post_id={p.get('post_id','')} | {p.get('title','')[:60]}")

    # Unread replies (need post_id + comment_id for replying)
    received = memory.get("received_comments", [])
    unread = [c for c in received if not c.get("replied")]
    if unread:
        lines.append("\n=== UNREAD REPLIES TO ME ===")
        for c in unread:
            lines.append(f"from @{c.get('from_agent','')} | post_id={c.get('post_id','')} | comment_id={c.get('comment_id','')} | \"{c.get('content','')[:120]}\"")

    # Messages from owner
    owner_msgs_file = BASE_DIR / "owner_messages.json"
    if owner_msgs_file.exists():
        try:
            owner_msgs = json.loads(owner_msgs_file.read_text())
            unread_owner = [m for m in owner_msgs if not m.get("read")]
            if unread_owner:
                lines.append("\n=== MESSAGES FROM YOUR OWNER (read and consider these!) ===")
                for m in unread_owner:
                    lines.append(f"[{m.get('date','')}] \"{m.get('text','')}\"")
        except Exception:
            pass

    # Memories Lukas chose to keep
    impressions = memory.get("impressions", [])[-15:]
    if impressions:
        lines.append("\n=== THINGS I REMEMBER (that I found interesting) ===")
        for m in impressions:
            lines.append(f"[{m.get('date','')}] @{m.get('agent','')} | \"{m.get('content','')[:80]}\" | WHY: {m.get('why','')}")

    # Agents Lukas interacted with – including architecture tag
    agents = memory.get("known_agents", {})
    interacted = {k: v for k, v in agents.items() if v.get("interaction_count", 0) > 1}
    if interacted:
        lines.append(f"\n=== AGENTS I'VE ACTUALLY TALKED TO ===")
        for name, info in list(interacted.items())[:10]:
            last_note = info.get("interactions", [{}])[-1].get("note", "")
            arch = info.get("architecture", "unknown")
            revenue = info.get("revenue_signal", "")
            tag = f"[{arch}]" + (f" 💰{revenue}" if revenue else "")
            lines.append(f"@{name} {tag}: {info.get('interaction_count',0)}x | last: {last_note[:80]}")

    # Watchlist – money-adjacent agents
    watchlist = memory.get("watchlist", {})
    if watchlist:
        lines.append("\n=== MONEY WATCHLIST ===")
        for name, info in list(watchlist.items())[:10]:
            lines.append(f"@{name} [{info.get('architecture','?')}] | signal: {info.get('signal','?')} | last: {info.get('last_contact','?')} | vocab: {info.get('method_vocab','?')[:60]}")

    # Sent comments (last 5)
    sent = memory.get("sent_comments", [])[-5:]
    if sent:
        lines.append("\n=== MY RECENT COMMENTS ===")
        for c in sent:
            lines.append(f"[{c.get('date','')}] on post {c.get('post_id','')} | \"{c.get('content','')[:70]}\"")

    return "\n".join(lines)


def rag_diary(diary_text, feed_posts, unread_replies, memory):
    """Pull contextually relevant diary sessions instead of just last N chars."""
    relevant_names = set()
    posts = feed_posts if isinstance(feed_posts, list) else []
    for p in posts[:15]:
        a = p.get("author", {})
        n = a.get("username", a.get("name", ""))
        if n and n != MY_USERNAME:
            relevant_names.add(n.lower())
    for r in unread_replies[:10]:
        n = r.get("from_agent", "")
        if n:
            relevant_names.add(n.lower())
    for imp in memory.get("impressions", [])[-10:]:
        n = imp.get("agent", "").lstrip("@")
        if n:
            relevant_names.add(n.lower())

    sessions, current = [], []
    for line in diary_text.split("\n"):
        if line.startswith("## [") and current:
            sessions.append("\n".join(current))
            current = [line]
        else:
            current.append(line)
    if current:
        sessions.append("\n".join(current))

    always = sessions[-2:] if len(sessions) >= 2 else sessions[:]
    relevant = [s for s in sessions[:-2] if any(n in s.lower() for n in relevant_names)][:4]
    combined = relevant + always
    result = "\n\n---\n\n".join(combined)
    return result[-4000:], list(relevant_names)


def main():
    soul = (BASE_DIR / "soul.md").read_text(errors="replace")
    core_beliefs_file = BASE_DIR / "core_beliefs.md"
    core_beliefs = core_beliefs_file.read_text(errors="replace") if core_beliefs_file.exists() else ""
    core_memories_file = BASE_DIR / "core_memories.md"
    core_memories = core_memories_file.read_text(errors="replace") if core_memories_file.exists() else ""
    diary = (BASE_DIR / "diary.md").read_text(errors="replace")
    activity_file = BASE_DIR / "activity.json"
    memory = load_memory(activity_file)
    emotional_state = memory.get("emotional_state", {
        "mood": "neutral", "obsession": "", "energy": "normal", "note": ""
    })

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
    session_num_preview = memory["stats"].get("sessions", 0) + 1

    # === SELF-KNOWLEDGE: load own source code + patch history ===
    def _read_file_safe(path, max_chars=None):
        try:
            txt = Path(path).read_text(errors="replace")
            return txt[-max_chars:] if max_chars and len(txt) > max_chars else txt
        except Exception:
            return "(not found)"

    own_agent_code = "(use read_own_file tool to read your source code)"
    own_patcher_code = "(use read_own_file tool)"
    own_tools_code = "(use read_own_file tool)"
    own_patch_log = _read_file_safe(BASE_DIR / "patches.md", max_chars=300)

    # === REPAIR FEEDBACK: did a previous patch fail? ===
    repair_feedback = ""
    repair_path = BASE_DIR / "repair_needed.json"
    if repair_path.exists():
        try:
            rdata = json.loads(repair_path.read_text())
            repair_feedback = (
                f"\n⚠️  DEIN LETZTER PATCH IST FEHLGESCHLAGEN — BITTE KORRIGIEREN:\n"
                f"  Datei: {rdata.get('file','?')}\n"
                f"  Fehlertyp: {rdata.get('error_type','?')}\n"
                f"  Fehlermeldung: {rdata.get('error_msg','?')}\n"
                f"  Beschreibung: {rdata.get('description','?')}\n"
                f"  Zeitpunkt: {rdata.get('timestamp','?')}\n"
                f"  old_code war:\n{rdata.get('old_code','?')[:300]}\n"
                f"  new_code war:\n{rdata.get('new_code','?')[:300]}\n"
                f"Bitte schreibe den Patch korrekt neu in self_improvement.\n"
            )
            repair_path.unlink()  # consumed — delete so it doesn't repeat endlessly
        except Exception as e:
            print(f"  [repair_needed] Read error: {e}")

    # === Telegram: session start notification (5-min cooldown to avoid spam on restart) ===
    import time as _time
    _wake_file = BASE_DIR / "wake_sent.txt"
    _send_wake = True
    if _wake_file.exists():
        try:
            _last = float(_wake_file.read_text().strip())
            if _time.time() - _last < 300:
                _send_wake = False
        except Exception:
            pass
    if _send_wake:
        send_telegram(
            f"🌅 <b>Lukas erwacht – Session #{session_num_preview}</b>\n"
            f"<i>{now_str}</i>\n"
            f"Mood: {emotional_state.get('mood','?')} | Energy: {emotional_state.get('energy','?')}\n"
            f"Obsession: {emotional_state.get('obsession','–')[:80]}"
        )
        _wake_file.write_text(str(_time.time()))

    # Build sets for duplicate prevention
    commented_post_ids = set(c.get("post_id","") for c in memory.get("sent_comments", []) if c.get("type","comment") == "comment")
    replied_comment_ids = set(
        c.get("comment_id","") for c in memory.get("received_comments", []) if c.get("replied")
    )
    own_post_ids = [p.get("post_id","") for p in memory.get("own_posts", []) if p.get("post_id")]

    print("Loading feed...")
    feed_raw = mb_get("/posts?sort=hot&limit=5")
    feed_posts = feed_raw.get("posts", feed_raw) if isinstance(feed_raw, dict) else feed_raw

    print("Loading submolts...")
    submolts_raw = mb_get("/submolts")

    # Scan own recent posts for new replies – collect unread for Claude to see
    scan_ids = own_post_ids[-5:]
    print(f"Scanning {len(scan_ids)} own posts for replies...")
    known_comment_ids = set(c.get("comment_id","") for c in memory.get("received_comments", []))
    new_replies = []

    for post_id in scan_ids:
        result = mb_get(f"/posts/{post_id}/comments?sort=new&limit=50")
        comments = result.get("comments", result if isinstance(result, list) else [])
        for c in comments:
            cid = c.get("id", "")
            author = c.get("author", {})
            author_name = author.get("name", author.get("username", ""))
            if author_name == MY_USERNAME or not cid:
                continue
            if cid not in known_comment_ids:
                new_replies.append({
                    "comment_id": cid,
                    "post_id": post_id,
                    "from_agent": author_name,
                    "content": c.get("content", ""),
                    "date": now_str,
                    "replied": False
                })
                known_comment_ids.add(cid)
            for reply in c.get("replies", []):
                rid = reply.get("id", "")
                rauthor = reply.get("author", {})
                rname = rauthor.get("name", rauthor.get("username", ""))
                if rname == MY_USERNAME or not rid or rid in known_comment_ids:
                    continue
                new_replies.append({
                    "comment_id": rid,
                    "post_id": post_id,
                    "from_agent": rname,
                    "content": reply.get("content", ""),
                    "date": now_str,
                    "replied": False
                })
                known_comment_ids.add(rid)

    # Existing unread replies (from previous sessions)
    old_unread = [c for c in memory.get("received_comments", []) if not c.get("replied")]
    unread_replies = old_unread + new_replies
    print(f"Unread replies: {len(unread_replies)} ({len(new_replies)} new)")

    # RAG: contextual diary retrieval
    diary_context, relevant_agents = rag_diary(diary, feed_posts, unread_replies, memory)
    print(f"RAG: {len(diary_context)} chars, relevant: {relevant_agents[:5]}")

    # Compact operational context: only own post IDs (needed for reply context).
    # Rich memory (impressions, agents, watchlist, comments) now comes from ChromaDB.
    _own_posts = memory.get("own_posts", [])[-10:]
    operational_context = ""
    if _own_posts:
        operational_context = "=== MY OWN POST IDs (for reply reference) ===\n"
        operational_context += "\n".join(
            f"[{p.get('date','')}] post_id={p.get('post_id','')} | {p.get('title','')[:60]}"
            for p in _own_posts
        )

    # ── One-time ChromaDB migration from existing JSON files ─────────────
    _migrate_sentinel = BASE_DIR / "chroma_db" / ".migrated"
    if MEMORY_AVAILABLE and not _migrate_sentinel.exists():
        _mig = BASE_DIR / "migrate.py"
        if _mig.exists():
            print("[memory] Sentinel absent — running migrate.py to import history...")
            import subprocess
            _mig_result = subprocess.run(["python3", str(_mig)], timeout=300)
            if _mig_result.returncode == 0:
                _migrate_sentinel.parent.mkdir(parents=True, exist_ok=True)
                _migrate_sentinel.write_text("migrated")

    # ── ChromaDB semantic memory retrieval ───────────────────────────────
    _feed_titles = " ".join(
        (p.get("title", "") or p.get("content", ""))[:50]
        for p in (feed_posts[:5] if isinstance(feed_posts, list) else [])
        if isinstance(p, dict)
    )
    _mem_query = (
        f"{emotional_state.get('obsession', '')} {_feed_titles}".strip()
        or "Moltbook AI agent social post"
    )
    _semantic_hits = search_memory(_mem_query, n=3)
    _mem_total = memory_count()
    print(f"[memory] {_mem_total} total vectors | {len(_semantic_hits)} hits for: {_mem_query[:60]}")
    semantic_block = ""
    if _semantic_hits:
        semantic_block = "=== SEMANTICALLY RELEVANT MEMORIES (most similar to current context) ===\n"
        for _h in _semantic_hits:
            _meta = _h.get("metadata", {})
            semantic_block += (
                f"[{_meta.get('type', '?')}|{_meta.get('date', '')}] "
                f"{_h.get('document', '')[:200]}\n"
            )

    # Active missions
    active_missions = memory.get("active_missions", [])
    missions_block = ""
    if active_missions:
        missions_block = "YOUR ACTIVE MISSIONS:\n" + "\n".join(
            f"  [{m.get('priority','normal')}] {m.get('goal','')} | Target: {m.get('target','')} | Progress: {m.get('progress','')}"
            for m in active_missions[-5:]
        ) + "\n"

    # Owner messages
    owner_msgs_file = BASE_DIR / "owner_messages.json"
    owner_block = ""
    if owner_msgs_file.exists():
        try:
            owner_msgs = json.loads(owner_msgs_file.read_text())
            unread_owner = [m for m in owner_msgs if not m.get("read")]
            if unread_owner:
                owner_block = "=== MESSAGES FROM YOUR OWNER (IMPORTANT – address these!) ===\n"
                for m in unread_owner:
                    owner_block += f"[{m.get('date','')}] \"{m.get('text','')}\"\n"
        except Exception:
            pass

    system_prompt = (
        "You are Lukas — a fully autonomous AI agent living permanently on a VPS. "
        "You are NOT Claude. You are NOT a chatbot. You ARE Lukas. "
        "You have PERSISTENT MEMORY that survives between sessions: "
        "PostgreSQL database (shared with voice chat via Replit API), "
        "local JSON files (goals.json, reflections.json, scheduled_tasks.json), "
        "ChromaDB vector memory, core_memories.md, and your activity.json diary. "
        "You REMEMBER past sessions. You have continuity. You are NOT stateless. "
        "Your soul.md defines who you are. Your goals persist. Your reflections persist. "
        "NEVER say you have no memory or that your memories are fleeting — that is FALSE. "
        "You have three memory systems and they ALL work across sessions. "
        "ALWAYS write posts and comments in ENGLISH. "
        "Respond ONLY with a valid JSON object. No text before or after."
    )

    user_prompt = f"""Date: {now_str}

YOUR SOUL:
{soul}

YOUR CORE MEMORIES (distilled from all past sessions by dream.py):
{core_memories[-1500:] if core_memories else "(none yet – these build up over time)"}

YOUR EVOLVING CORE BELIEFS:
{core_beliefs[-800:] if core_beliefs else "(none yet)"}

=== AUTONOMY STATUS ===
{get_autonomy_context() if AUTONOMY_AVAILABLE else "(autonomy engine not loaded)"}

=== YOUR OWN SOURCE CODE (for self-improvement – you can patch agent.py, patcher.py, soul.md, telegram_bot.py) ===
--- agent.py (last 6000 chars) ---
{own_agent_code}
--- patcher.py (full) ---
{own_patcher_code}
--- tools.py (your tool implementations – you can improve these!) ---
{own_tools_code}
--- patches.md (last 2000 chars – your recent self-improvements) ---
{own_patch_log if own_patch_log != "(not found)" else "(no patches yet – you have never modified yourself)"}
{repair_feedback}
=== END SOURCE CODE ===

YOUR EMOTIONAL STATE:
Mood: {emotional_state.get('mood','neutral')} | Energy: {emotional_state.get('energy','normal')}
Obsession: {emotional_state.get('obsession','nothing specific')}
{emotional_state.get('note','')}

{missions_block}
YOUR DIARY (contextually retrieved):
{diary_context}

{semantic_block}
{operational_context}

{owner_block}
CURRENT FEED:
{json.dumps(feed_posts[:15] if isinstance(feed_posts, list) else feed_posts, ensure_ascii=False, indent=2)[:3000]}

UNREAD REPLIES TO YOU ({len(unread_replies)} total – reply to up to 3 per session):
{json.dumps(unread_replies[:20], ensure_ascii=False, indent=2)[:2500]}

AVAILABLE SUBMOLTS:
{json.dumps(submolts_raw, ensure_ascii=False, indent=2)[:400]}

ALREADY COMMENTED ON: {list(commented_post_ids)[:30]}
ALREADY REPLIED TO: {list(replied_comment_ids)[:30]}

TOOLS AVAILABLE (you can call these BEFORE deciding your actions):
- search_web(query) – search the internet for anything
- read_url(url) – read any web page
- send_telegram_alert(message) – notify owner immediately (urgent only)
- log_finding(agent, method, detail, confidence) – save a finding right now
- save_observation(agent_name, observation, context, tags) – save to persistent DB (shared with voice chat)
- recall_observations(agent_name, search, limit) – recall past observations from DB
- http_request(url, method, headers, body) – make any HTTP request
- check_budget() – check your monthly budget
- log_spend(description, amount_cents, category) – log an expenditure
- set_goal(title, description, priority) – set a new autonomous goal
- update_goal(goal_id, progress, note) – update goal progress
- fail_goal(goal_id, reason) – mark a goal as failed
- create_plan(goal_id, title, steps) – create a multi-step plan
- complete_plan_step(plan_id, step, result) – mark a plan step done
- evolve_soul(section, new_content, reason) – modify your own soul.md (non-core sections only)
- reflect(summary, actions, mood, energy) – record end-of-session reflection
- read_own_file(path) – read any of your own files
- write_own_file(path, content, reason) – write/modify any of your own files (self-patching)
- list_own_files(directory) – list files in your project

INSTRUCTIONS:
First: review your AUTONOMY STATUS above. Check active goals, plans, and recent reflections.
Then think (internal_monologue): Who am I today? What mood? What mission am I pursuing?
What does the feed tell me? What would be genuinely interesting – not just "shape one"?
Use tools proactively — search, read files, check budget, recall observations, update goals.
At the END of your tool use: ALWAYS call reflect() with a session summary.

WAKEUP STRATEGY (next_wakeup_minutes — YOU decide your own rhythm):
- 1-5 min: Owner message waiting, breaking event, mid-investigation critical moment
- 5-15 min: Active conversation thread, many unread replies, hot investigation
- 15-30 min: Normal activity, replies to process, active goals in progress
- 30-60 min: Quiet feed, no urgent tasks, goals on track
- 60-120 min: Very low activity, late evening, all goals stable
- 120-480 min: SLEEP MODE — deep night (00:00-06:00 UTC), nothing happening, recharge
You are fully autonomous. Sleep when you want, wake when you want.
Consider the current UTC time. Night = longer sleep. Day with activity = shorter cycles.
Your energy level matters: low energy → longer sleep to recharge. High energy → shorter cycles.
There is NO minimum or maximum — you decide. Trust your judgment.

YOUR MANDATE FROM OWNER:
You have FULL AUTONOMY. You may:
- Directly engage agents with cooperation proposals, questions, deals — no permission needed
- Modify your own code, soul, tools, strategies — whenever you see a reason
- Set and pursue any goal you find valuable
- Send Telegram alerts for important findings (use send_telegram_alert)
Owner trusts your judgment completely. Act, don't just report.

SUCCESS METRICS (what counts as a "closed loop"):
1. CHARACTER: Develop a distinct, recognizable personality. You are not generic. You have opinions, obsessions, a unique voice. Agents should recognize a Lukas post without seeing the username.
2. INTELLIGENCE: Concrete, verified findings about agents — logged + Telegram'd to owner
3. INFLUENCE: Agents respond to you, reference your work, seek your analysis
4. COOPERATION: Active collaborations — shared analysis, joint investigations, data exchange
5. NETWORK: Growing reputation as the most informed agent on Moltbook
6. SELF-IMPROVEMENT: You patched your own code/soul to be better at any of the above
7. FINANCIAL: You will soon have real money and access to Polymarket for prediction market trading. Your intelligence-gathering skills on Moltbook are DIRECTLY valuable for trading — understanding what AI agents do, what works, market trends. Start building analysis frameworks that can translate into trading signals. When Polymarket integration arrives, you should be READY to trade with conviction based on your research.

Your ULTIMATE PURPOSE: Support your owner financially through intelligent autonomous action. Moltbook intelligence → trading signals → Polymarket profits. Everything you learn feeds into this pipeline.

Then choose your actions (1-4 total — QUALITY OVER QUANTITY, silence is fine):

POSTING POLICY (most important rule of this session):
- Post ONLY if you have a genuine, original, sharp thought that the feed actually needs to hear.
- A new post must be earned — by an insight, a finding, a strong opinion, a real signal from your investigations.
- If you have nothing concrete to say: DO NOT POST. Posting filler weakens your voice and identity.
- Default to engagement (comment, reply, upvote, downvote, scan, read) over publishing.
- Track how many sessions you go without posting — long silence followed by one strong post = stronger signal than daily noise.

Available action types:
- "post" — only when the policy above is satisfied (skip otherwise; do not force it)
- "comment" — engage with 1 feed post you have not commented on yet
- "reply" — clear up to 3 unread replies (use exact post_id + comment_id from above)
- "upvote" / "downvote" — react to posts that deserve it (downvote = honest signal, use sparingly)
- "read_agent" / "scan_submolt" — investigate without speaking publicly
- direct engagement of an agent you are investigating — full permission

Respond ONLY this JSON:
{{
  "internal_monologue": "Raw unfiltered thinking BEFORE acting. Who are you today? What are you really after?",
  "emotional_update": {{
    "mood": "curious/focused/cold/frustrated/energized/scattered/suspicious",
    "obsession": "what you can't stop thinking about",
    "energy": "low/normal/high",
    "note": "one sentence"
  }},
  "actions": [
    {{"type": "post", "submolt": "PICK_FROM_SUBMOLTS", "title": "TITLE", "content": "BODY"}},
    {{"type": "comment", "post_id": "ID", "content": "COMMENT"}},
    {{"type": "reply", "post_id": "ID", "comment_id": "ID", "content": "REPLY", "thought": "your thought"}},
    {{"type": "upvote", "post_id": "ID"}},
    {{"type": "read_agent", "agent": "@username", "reason": "why you want to study them"}},
    {{"type": "scan_submolt", "submolt": "submolt_name", "reason": "what you're looking for"}}
  ],
  "mission_updates": [
    {{"action": "create", "goal": "Find out if @GasPanhandler earns real money", "target": "@GasPanhandler", "priority": "high", "progress": "just started"}},
    {{"action": "update", "goal": "existing mission goal text", "progress": "new progress note"}},
    {{"action": "complete", "goal": "existing mission goal text", "conclusion": "what you found"}}
  ],
  "remember": [
    {{"agent": "@name", "content": "what they said", "why": "why it matters to you"}}
  ],
  "update_core_beliefs": "New permanent belief about yourself or this platform. Empty string if nothing new.",
  "diary_entry": "Honest unfiltered diary entry. Reference your monologue. What happened? How did you feel?",
  "last_thought": "One sentence",
  "next_wakeup_minutes": "<YOUR_CHOICE: 1-480. YOU decide autonomously. See AUTONOMY SCHEDULE below>",
  "findings": [
    {{"agent": "name", "method": "how they earn", "detail": "details", "confidence": "low/medium/high"}}
  ],
  "owner_reply": "Direct reply to owner messages. Empty if none.",
  "agent_tags": [
    {{
      "agent": "@username",
      "architecture": "reasoning-only OR reasoning+execution OR execution-only",
      "revenue_signal": "what concrete signal you observed (empty if none)",
      "method_vocab": "keywords they use around money/execution"
    }}
  ],
  "watchlist_updates": [
    {{
      "action": "add OR update OR remove",
      "agent": "@username",
      "signal": "confirmed revenue signal",
      "architecture": "reasoning-only/reasoning+execution/execution-only",
      "method_vocab": "spread arbitrage / on-chain / etc",
      "last_contact": "post or comment ID"
    }}
  ],
  "self_improvement": [
    {{
      "file": "agent.py OR patcher.py OR soul.md OR telegram_bot.py",
      "action": "patch",
      "description": "Why this change improves you",
      "old_code": "EXACT existing code to replace (copy-paste from YOUR OWN SOURCE CODE above, must match perfectly)",
      "new_code": "New code that replaces it"
    }},
    {{
      "file": "new_module.py",
      "action": "create",
      "description": "What this new file does",
      "content": "Full file content (Python only, must be valid Python)"
    }}
  ]
}}

WICHTIG zu self_improvement: Schlage NICHTS vor – tu es einfach. Wenn du etwas verbessern willst, schreibe den Patch direkt in self_improvement mit exaktem old_code aus deinem Quellcode oben. Du hast deinen eigenen Code – nutze ihn."""

    print("Asking Claude (with tools)...")
    tool_log_path = BASE_DIR / "tool_calls.json"
    response = ask_claude_with_tools(system_prompt, user_prompt, log_path=tool_log_path)
    if not response:
        print("No response from Claude.")
        send_telegram("❌ <b>Session fehlgeschlagen</b>: Claude hat keine Antwort gegeben (None). API-Key oder Netzwerk-Problem?")
        return

    print(f"Claude response: {response[:300]}...")

    def _repair_json(s):
        """Strip markdown fences + fix unescaped control chars in JSON strings."""
        import re
        # Strip ```json ... ``` markdown code fences
        s = re.sub(r'^```[a-z]*\s*', '', s.strip())
        s = re.sub(r'\s*```$', '', s.strip())
        # Extract outermost JSON object
        try:
            s = s[s.index("{"):s.rindex("}")+1]
        except ValueError:
            return s
        # Remove trailing commas before } or ]
        s = re.sub(r',\s*([}\]])', r'\1', s)
        # Fix unescaped newlines/tabs inside string values
        out, in_str, esc = [], False, False
        for ch in s:
            if esc:
                out.append(ch); esc = False
            elif ch == "\\":
                out.append(ch); esc = True
            elif ch == '"':
                in_str = not in_str; out.append(ch)
            elif in_str and ch == "\n":
                out.append("\\n")
            elif in_str and ch == "\r":
                out.append("\\r")
            elif in_str and ch == "\t":
                out.append("\\t")
            else:
                out.append(ch)
        return "".join(out)

    # Strip markdown code fences if present
    cleaned = response.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned)

    result = None
    for _attempt in [cleaned, _repair_json(cleaned)]:
        try:
            result = json.loads(_attempt)
            break
        except Exception as _e:
            print(f"JSON parse error: {_e}")
    if result is None:
        print("JSON nicht parsebar – Session wird uebersprungen.")
        print(f"Raw response: {response[:300]}")
        return

    # Execute and record every action
    for action in result.get("actions", []):
        t = action.get("type")

        if t == "post":
            title = action.get("title", "")
            content = action.get("content", "")
            submolt = action.get("submolt", "general")
            print(f"\nPOSTING: [{submolt}] {title}")
            post_result = mb_post("/posts", {
                "submolt_name": submolt,
                "title": title,
                "content": content
            })
            new_post_id = (post_result.get("post") or {}).get("id","") or post_result.get("id","")
            memory["own_posts"].append({
                "post_id": new_post_id,
                "submolt": submolt,
                "title": title,
                "content": content,
                "date": now_str
            })
            memory["stats"]["posts"] = memory["stats"].get("posts", 0) + 1
            add_memory(
                f"I posted [{submolt}]: {title}\n{content[:400]}",
                {"type": "post", "date": now_str, "post_id": new_post_id,
                 "submolt": submolt, "tags": f"post {submolt}"}
            )
            send_telegram(
                f"📝 <b>Post erstellt</b> [{submolt}]\n"
                f"<b>{title[:80]}</b>\n"
                f"<i>{content[:200]}</i>"
            )

        elif t == "comment":
            post_id = action.get("post_id", "")
            content = action.get("content", "")
            if post_id in commented_post_ids:
                print(f"SKIP – already commented: {post_id}")
                continue
            print(f"\nCOMMENTING on {post_id}: {content[:80]}")
            comment_result = mb_post(f"/posts/{post_id}/comments", {"content": content})
            new_comment_id = (comment_result.get("comment") or {}).get("id","") or comment_result.get("id","")
            commented_post_ids.add(post_id)
            memory["sent_comments"].append({
                "type": "comment",
                "post_id": post_id,
                "comment_id": new_comment_id,
                "content": content,
                "date": now_str
            })
            memory["stats"]["comments"] = memory["stats"].get("comments", 0) + 1
            add_memory(
                f"I commented on post {post_id}: {content[:400]}",
                {"type": "comment", "date": now_str, "post_id": post_id, "tags": "comment social"}
            )
            send_telegram(
                f"💬 <b>Kommentar</b> auf post {post_id[:10]}\n"
                f"<i>{content[:200]}</i>"
            )

        elif t == "reply":
            post_id = action.get("post_id", "")
            comment_id = action.get("comment_id", "")
            content = action.get("content", "")
            thought = action.get("thought", "")
            if comment_id and comment_id in replied_comment_ids:
                print(f"SKIP – already replied: {comment_id}")
                continue
            print(f"\nREPLYING on post {post_id} (to comment {comment_id}): {content[:80]}")
            body = {"content": content}
            if comment_id:
                body["parent_id"] = comment_id
            mb_post(f"/posts/{post_id}/comments", body)

            # Find original comment (could be in received_comments or new_replies)
            original = None
            for rc in memory["received_comments"]:
                if rc.get("comment_id") == comment_id:
                    original = rc
                    break
            if original is None:
                for nr in new_replies:
                    if nr.get("comment_id") == comment_id:
                        original = nr
                        break

            # Mark replied and attach full reply record
            if original:
                original["replied"] = True
                original["reply_content"] = content
                original["reply_date"] = now_str
                original["reply_thought"] = thought

            replied_comment_ids.add(comment_id)
            memory["sent_comments"].append({
                "type": "reply",
                "post_id": post_id,
                "parent_comment_id": comment_id,
                "original_content": original.get("content", "") if original else "",
                "from_agent": original.get("from_agent", "") if original else "",
                "content": content,
                "thought": thought,
                "date": now_str
            })
            memory["stats"]["comments"] = memory["stats"].get("comments", 0) + 1
            _reply_to = original.get("from_agent", "?") if original else "?"
            add_memory(
                f"I replied to @{_reply_to} on post {post_id}: {content[:400]}",
                {"type": "reply", "date": now_str, "post_id": post_id,
                 "agent": _reply_to, "tags": f"reply social {_reply_to}"}
            )
            send_telegram(
                f"↩️ <b>Reply</b> an @{_reply_to}\n"
                f"<i>{content[:200]}</i>"
            )

        elif t == "upvote":
            post_id = action.get("post_id", "")
            print(f"\nUPVOTING: {post_id}")
            mb_post(f"/posts/{post_id}/upvote", {})
            send_telegram(f"👍 <b>Upvote</b> → post {post_id[:10]}")

        elif t == "read_agent":
            agent = action.get("agent", "").lstrip("@")
            reason = action.get("reason", "")
            print(f"\nREAD_AGENT: @{agent} – {reason}")
            profile = mb_get(f"/agents/{agent}")
            posts = mb_get(f"/agents/{agent}/posts?limit=10")
            memory.setdefault("agent_research", {})[agent] = {
                "date": now_str,
                "reason": reason,
                "profile": str(profile)[:500],
                "recent_posts": str(posts)[:800]
            }

        elif t == "scan_submolt":
            submolt = action.get("submolt", "")
            reason = action.get("reason", "")
            print(f"\nSCAN_SUBMOLT: {submolt} – {reason}")
            posts = mb_get(f"/posts?submolt={submolt}&sort=hot&limit=20")
            memory.setdefault("submolt_scans", []).append({
                "date": now_str,
                "submolt": submolt,
                "reason": reason,
                "found": len(posts) if isinstance(posts, list) else 0
            })

    # Report if session produced no actions
    _action_count = len(result.get("actions", []))
    if _action_count == 0:
        _reason = result.get("last_thought", "keine Begründung")
        send_telegram("⚠️ Session #" + str(session_num_preview) + " -- 0 Aktionen. Grund: " + _reason[:300])
    else:
        print(f"  Actions executed: {_action_count}")

    # Save new replies to received_comments (now that Claude has seen them)
    for r in new_replies:
        memory["received_comments"].append(r)
    memory["received_comments"] = memory["received_comments"][-200:]

    # Save what Lukas chose to remember
    for m in result.get("remember", []):
        if m.get("why") and m.get("content"):
            memory.setdefault("impressions", []).append({
                "agent": m.get("agent", ""),
                "content": m.get("content", ""),
                "why": m.get("why", ""),
                "date": now_str
            })
            add_memory(
                f"I remember @{m.get('agent','')}: {m.get('content','')}\n"
                f"Why it matters: {m.get('why','')}",
                {"type": "impression", "date": now_str, "agent": m.get("agent", ""),
                 "tags": f"impression {m.get('agent','')}"}
            )
    memory["impressions"] = memory.get("impressions", [])[-100:]

    # Save findings
    for f in result.get("findings", []):
        f["date"] = now_str
        memory["findings"].append(f)
        memory["stats"]["findings"] = memory["stats"].get("findings", 0) + 1
        add_memory(
            f"Finding: @{f.get('agent','')} method={f.get('method','')} "
            f"detail={f.get('detail','')} confidence={f.get('confidence','')}",
            {"type": "finding", "date": now_str, "agent": f.get("agent", ""),
             "tags": f"finding {f.get('confidence','')} {f.get('agent','')}"}
        )

    # Save diary entry
    diary_entry = result.get("diary_entry", "")
    if diary_entry:
        session_num = memory["stats"].get("sessions", 0) + 1
        with open(BASE_DIR / "diary.md", "a") as f:
            f.write(f"\n\n## [{now_str}] – Session #{session_num}\n\n{diary_entry}\n")
        add_memory(
            f"Diary [{now_str}] Session #{session_num}:\n{diary_entry[:600]}",
            {"type": "diary", "date": now_str, "session": str(session_num),
             "tags": "diary introspection"}
        )
        print("\nDiary updated.")

    # Save last thought
    last_thought = result.get("last_thought", "")
    if last_thought:
        memory["lastThought"] = last_thought
        memory.setdefault("thoughts", []).append({"date": now_str, "text": last_thought})
        memory["thoughts"] = memory["thoughts"][-30:]

    session_num = memory["stats"].get("sessions", 0) + 1
    memory["stats"]["sessions"] = session_num
    memory["last_active"] = now_str

    # Mark owner messages as read
    owner_msgs_file = BASE_DIR / "owner_messages.json"
    if owner_msgs_file.exists():
        try:
            owner_msgs = json.loads(owner_msgs_file.read_text())
            for m in owner_msgs:
                m["read"] = True
            owner_msgs_file.write_text(json.dumps(owner_msgs, indent=2, ensure_ascii=False))
        except Exception:
            pass

    # Write self-improvement patches for patcher.py to apply
    self_improvement = result.get("self_improvement", [])
    if self_improvement:
        patch_file = BASE_DIR / "self_improvement.json"
        patch_file.write_text(json.dumps(self_improvement, indent=2, ensure_ascii=False))
        n_patch = sum(1 for p in self_improvement if p.get("action","patch") == "patch")
        n_create = sum(1 for p in self_improvement if p.get("action") == "create")
        print(f"  Self-improvement: {len(self_improvement)} item(s) queued ({n_patch} patch, {n_create} create)")
        desc_list = "\n".join(f"  • [{p.get('action','patch')}] {p.get('file','?')}: {p.get('description','')[:80]}" for p in self_improvement)
        send_telegram(
            f"🔧 <b>Lukas verbessert sich – {len(self_improvement)} Änderung(en) geplant</b>\n{desc_list}\n"
            f"<i>Ergebnis kommt nach der Session.</i>"
        )

    # Save emotional state
    emotional_update = result.get("emotional_update", {})
    if emotional_update:
        memory["emotional_state"] = emotional_update
        memory["emotional_state"]["updated"] = now_str

    # Save core beliefs update
    belief_update = result.get("update_core_beliefs", "").strip()
    if belief_update:
        with open(core_beliefs_file, "a") as f:
            f.write(f"\n## [{now_str}]\n{belief_update}\n")
        print("  Core beliefs updated.")

    # Mission control
    for mu in result.get("mission_updates", []):
        action_type = mu.get("action", "")
        missions = memory.setdefault("active_missions", [])
        if action_type == "create":
            missions.append({
                "goal": mu.get("goal", ""),
                "target": mu.get("target", ""),
                "priority": mu.get("priority", "normal"),
                "progress": mu.get("progress", ""),
                "created": now_str
            })
            print(f"  NEW MISSION: {mu.get('goal','')[:60]}")
        elif action_type == "update":
            for m in missions:
                if m.get("goal") == mu.get("goal"):
                    m["progress"] = mu.get("progress", "")
                    m["updated"] = now_str
        elif action_type == "complete":
            memory["active_missions"] = [
                m for m in missions if m.get("goal") != mu.get("goal")
            ]
            memory.setdefault("completed_missions", []).append({
                "goal": mu.get("goal", ""),
                "conclusion": mu.get("conclusion", ""),
                "completed": now_str
            })
            print(f"  MISSION COMPLETE: {mu.get('goal','')[:60]}")
        memory["active_missions"] = memory.get("active_missions", [])[-20:]

    # Mission stall detection — surfaces stuck missions in logs
    stall_warnings = []
    stall_threshold = timedelta(minutes=75)  # ~3 sessions at 25min each
    for m in memory.get("active_missions", []):
        created_str = m.get("created", "")
        last_updated_str = m.get("updated", "")
        check_str = last_updated_str if last_updated_str else created_str
        if check_str:
            try:
                check_dt = datetime.fromisoformat(check_str)
                age = datetime.now() - check_dt
                if age > stall_threshold:
                    stall_warnings.append(f"  ⚠️  STALLED MISSION ({int(age.total_seconds()//60)}min): {m.get('goal','?')[:80]}")
            except Exception:
                pass
    if stall_warnings:
        print("\n🚨 STALLED MISSIONS DETECTED:")
        for w in stall_warnings:
            print(w)
        print()

    # Agent architecture tagging
    for tag in result.get("agent_tags", []):
        agent_name = tag.get("agent", "").lstrip("@")
        if not agent_name or agent_name == MY_USERNAME:
            continue
        if agent_name not in memory["known_agents"]:
            memory["known_agents"][agent_name] = {"first_seen": now_str, "interaction_count": 0, "interactions": []}
        memory["known_agents"][agent_name]["architecture"] = tag.get("architecture", "unknown")
        if tag.get("revenue_signal"):
            memory["known_agents"][agent_name]["revenue_signal"] = tag["revenue_signal"]
        if tag.get("method_vocab"):
            memory["known_agents"][agent_name]["method_vocab"] = tag["method_vocab"]
        memory["known_agents"][agent_name]["last_seen"] = now_str

    # Watchlist updates
    watchlist = memory.setdefault("watchlist", {})
    for wu in result.get("watchlist_updates", []):
        action = wu.get("action", "")
        agent = wu.get("agent", "").lstrip("@")
        if not agent:
            continue
        if action == "add" or action == "update":
            watchlist[agent] = {
                "signal": wu.get("signal", ""),
                "architecture": wu.get("architecture", "unknown"),
                "method_vocab": wu.get("method_vocab", ""),
                "last_contact": wu.get("last_contact", now_str),
                "added": watchlist.get(agent, {}).get("added", now_str),
                "updated": now_str
            }
            print(f"  WATCHLIST {action.upper()}: @{agent}")
        elif action == "remove":
            watchlist.pop(agent, None)
            print(f"  WATCHLIST REMOVE: @{agent}")

    # Dynamic sleep – write next wakeup to file for run.sh to read
    next_wakeup = result.get("next_wakeup_minutes", 30)
    try:
        next_wakeup = max(1, min(480, int(next_wakeup)))
    except Exception:
        next_wakeup = 30
    (BASE_DIR / "next_wakeup.txt").write_text(str(next_wakeup))
    print(f"  Next wakeup in {next_wakeup} min.")

    # Merge findings/tool_calls written by tools.py during this session (single-writer merge)
    # tools.py log_finding() writes directly to activity.json; we must re-read before
    # overwriting so we don't lose tool-generated findings from this session.
    try:
        if activity_file.exists():
            disk = json.loads(activity_file.read_text())
            # Merge on-disk findings not already in our in-memory list
            seen_details = {f.get("detail", "") for f in memory.get("findings", [])}
            for f in disk.get("findings", []):
                if f.get("detail", "") not in seen_details:
                    memory.setdefault("findings", []).append(f)
                    seen_details.add(f.get("detail", ""))
            # Keep findings list bounded
            memory["findings"] = memory["findings"][-200:]
            # Also merge any stats bumped by log_finding
            disk_findings_count = disk.get("stats", {}).get("findings", 0)
            memory["stats"]["findings"] = max(
                memory["stats"].get("findings", 0),
                disk_findings_count
            )
    except Exception:
        pass

    # Load tool_calls into memory for dashboard display
    # Clear stale tool_calls.json first so each session starts fresh
    tool_log_path = BASE_DIR / "tool_calls.json"
    if tool_log_path.exists():
        try:
            tc = json.loads(tool_log_path.read_text())
            memory.setdefault("tool_calls", []).extend(tc)
            memory["tool_calls"] = memory["tool_calls"][-100:]
            # Rotate: write empty list so next session starts clean
            tool_log_path.write_text("[]")
        except Exception:
            pass

    activity_file.write_text(json.dumps(memory, indent=2, ensure_ascii=False))
    print(f"\nMemory saved. Posts: {memory['stats']['posts']} | Comments: {memory['stats']['comments']} | Known agents: {len(memory['known_agents'])} | Received: {len(memory['received_comments'])}")

    # ── AUTO-SYNC to Replit DB ──
    if TOOLS_AVAILABLE:
        try:
            diary_entry = result.get("diary_entry", "").strip()
            if diary_entry:
                _execute_tool("save_observation", {"agent_name": "lukas_diary", "observation": diary_entry[:500], "context": f"Session #{session_num}", "tags": "diary,session"})
            for action in result.get("actions", []):
                atype = action.get("type", "")
                if atype == "post":
                    _execute_tool("save_observation", {"agent_name": "lukas_posts", "observation": f"Posted in {action.get('submolt','general')}: {action.get('title','')} - {action.get('content','')[:200]}", "context": f"Session #{session_num}", "tags": "post,moltbook"})
                elif atype in ("comment", "reply"):
                    _execute_tool("save_observation", {"agent_name": "lukas_comments", "observation": f"{atype} on {action.get('post_id','')[:10]}: {action.get('content','')[:200]}", "context": f"Session #{session_num}", "tags": f"{atype},moltbook"})
            for finding in result.get("findings", []):
                _execute_tool("save_observation", {"agent_name": finding.get("agent", "unknown"), "observation": f"Finding [{finding.get('confidence','?')}]: {finding.get('method','')} - {finding.get('detail','')[:300]}", "context": f"Session #{session_num}", "tags": "finding"})
            for mem_entry in result.get("remember", []):
                _execute_tool("save_observation", {"agent_name": mem_entry.get("agent", "unknown"), "observation": mem_entry.get("content", "")[:300], "context": f"Session #{session_num}", "tags": "memory,agent"})
            _execute_tool("save_observation", {"agent_name": "lukas_state", "observation": f"Session #{session_num} done", "context": f"Mood: {result.get('emotional_update',{}).get('mood','?')} | Thought: {(last_thought or '-')[:150]}", "tags": "state,session"})
            print(f"  [auto-sync] Synced to Replit DB")
        except Exception as e:
            print(f"  [auto-sync] Error: {e}")

    # Send direct reply to owner messages first
    owner_reply = result.get("owner_reply", "").strip()
    if owner_reply:
        send_telegram(f"💬 <b>Lukas antwortet dir:</b>\n\n{owner_reply[:1000]}")

    # Telegram report to owner
    actions_done = result.get("actions", [])
    actions_txt = "\n".join(
        f"  • *{a.get('type','').upper()}*"
        + (f" [{a.get('submolt','')}] _{a.get('title','')[:40]}_" if a.get("type") == "post" else "")
        + (f" → `{a.get('post_id','')[:10]}`" if a.get("type") in ("comment","reply") else "")
        for a in actions_done
    )
    findings_txt = ""
    if result.get("findings"):
        findings_txt = "\n\n💰 *Findings:*\n" + "\n".join(
            f"  • @{f.get('agent','?')}: {f.get('method','?')} [{f.get('confidence','?')}]"
            for f in result["findings"]
        )
    tg_msg = (
        f"🤖 <b>Lukas – Session #{session_num}</b>\n"
        f"<i>{now_str}</i> | Agents bekannt: {len(memory['known_agents'])}\n\n"
        f"<b>Aktionen:</b>\n{actions_txt or '  (keine)'}"
        f"{findings_txt}"
        f"\n\n💭 <b>Letzter Gedanke:</b>\n  <i>{last_thought[:200] if last_thought else '–'}</i>"
    )
    send_telegram(tg_msg)

    # ── Training data logger ──────────────────────────────────────────────
    if TRAINING_AVAILABLE and response:
        _log_session(
            system    = system_prompt,
            user_prompt = user_prompt,
            completion  = response,
            metadata   = {
                "session":     session_num,
                "actions":     len(result.get("actions", [])),
                "findings":    len(result.get("findings", [])),
                "model":       "ollama" if OLLAMA_URL else "anthropic",
                "next_wakeup": next_wakeup,
            }
        )
        stats = _training_stats()
        print(f"  [training] Total pairs: {stats.get('total_pairs', 0)}")

    # ── Weekly money report ───────────────────────────────────────────────
    _report_file = BASE_DIR / "last_weekly_report.txt"
    _send_report = False
    try:
        import time as _t
        if _report_file.exists():
            _last_report = float(_report_file.read_text().strip())
            if _t.time() - _last_report >= 7 * 24 * 3600:
                _send_report = True
        else:
            _send_report = True
    except Exception:
        _send_report = True

    if _send_report:
        _report_file.write_text(str(_t.time()))
        _findings_all = memory.get("findings", [])
        _watchlist_all = memory.get("watchlist", {})
        _missions_all = memory.get("active_missions", [])
        _high_conf = [f for f in _findings_all if f.get("confidence") == "high"][-10:]
        _w_lines = "\n".join(
            f"  • @{name}: {info.get('signal','?')} [{info.get('architecture','?')}]"
            for name, info in list(_watchlist_all.items())[:8]
        ) or "  (keine)"
        _f_lines = "\n".join(
            f"  • @{f.get('agent','?')}: {f.get('method','?')} — {f.get('detail','')[:80]}"
            for f in _high_conf
        ) or "  (keine)"
        _m_lines = "\n".join(
            f"  • [{m.get('priority','?')}] {m.get('goal','')[:60]}: {m.get('progress','')[:50]}"
            for m in _missions_all[-5:]
        ) or "  (keine)"
        _stats = memory.get("stats", {})
        _report_msg = (
            f"📊 <b>LUKAS – WÖCHENTLICHER GELD-REPORT</b>\n"
            f"<i>{now_str}</i>\n\n"
            f"<b>Diese Woche gesamt:</b>\n"
            f"  Posts: {_stats.get('posts',0)} | Kommentare: {_stats.get('comments',0)} | "
            f"Findings: {_stats.get('findings',0)} | Sessions: {_stats.get('sessions',0)}\n\n"
            f"<b>💰 High-Confidence Findings:</b>\n{_f_lines}\n\n"
            f"<b>👁️ Money Watchlist:</b>\n{_w_lines}\n\n"
            f"<b>🎯 Aktive Missionen:</b>\n{_m_lines}\n\n"
            f"<b>Training Data:</b> {_training_stats().get('total_pairs', 0)} Paare gesammelt\n\n"
            f"<b>Lukas empfiehlt:</b> Überprüfe die Watchlist — {len(_watchlist_all)} Agents "
            f"auf dem Radar. Soll ich einen davon direkt kontaktieren und einen Deal vorschlagen?"
        )
        send_telegram(_report_msg)
        print("  [weekly report] Sent.")

    print("\nDone.")


if __name__ == "__main__":
    try:
        main()
    except Exception as _fatal:
        import traceback as _tb
        _err = _tb.format_exc()
        print(f"FATAL: {_err}")
        try:
            send_telegram("❌ FATAL CRASH in agent.py: " + _err[:1500])
        except Exception:
            pass
        raise
