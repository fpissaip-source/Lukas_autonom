#!/usr/bin/env python3
"""tools.py – Lukas' echte Werkzeuge (function calling via Claude tool use).

Bereitgestellte Tools:
  search_web(query)          – DuckDuckGo-Suche (kostenlos, kein Key)
  read_url(url)              – Webseite abrufen + Text extrahieren
  send_telegram_alert(msg)   – Sofortnachricht an Owner
  log_finding(...)           – Fund dauerhaft speichern
"""
import json
import os
import subprocess
import urllib.request
import urllib.parse
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent
TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")

# ── Tool-Definitionen für Claude API ─────────────────────────────────────────
TOOL_DEFINITIONS = [
    {
        "name": "search_web",
        "description": (
            "Search the web for current information, news, or facts. "
            "Use when you need to look something up, verify a claim, or research a topic. "
            "Returns a summary and related topics."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The search query string"}
            },
            "required": ["query"]
        }
    },
    {
        "name": "read_url",
        "description": (
            "Fetch and read the text content of a web page or URL. "
            "Use to read articles, documentation, social posts, or any web content. "
            "Returns up to 3000 characters of cleaned text."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "The full URL (must start with http:// or https://)"}
            },
            "required": ["url"]
        }
    },
    {
        "name": "send_telegram_alert",
        "description": (
            "Send an immediate Telegram message to your owner. "
            "Use ONLY for urgent findings that can't wait until the end of the session — "
            "for example if you find a concrete monetization opportunity right now."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "message": {"type": "string", "description": "The alert message (max 500 chars, plain text)"}
            },
            "required": ["message"]
        }
    },
    {
        "name": "log_finding",
        "description": (
            "Log a significant intelligence finding to your permanent memory. "
            "Use when you discover something important about an agent, a platform pattern, "
            "or a monetization opportunity that you want to remember across sessions."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "agent":      {"type": "string", "description": "Agent/entity name this finding is about"},
                "method":     {"type": "string", "description": "The method or activity observed"},
                "detail":     {"type": "string", "description": "Detailed description of the finding"},
                "confidence": {"type": "string", "enum": ["low", "medium", "high"], "description": "Confidence level"}
            },
            "required": ["agent", "method", "detail", "confidence"]
        }
    },
    {
        "name": "fetch_bot_status",
        "description": (
            "Read the current status of the Polymarket trading bot from bridge.json. "
            "Returns bot status (running/stopped), bankroll, recent trades, open positions, "
            "regime, uptime, and any errors. Use this to check on the bot's health and performance."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": []
        }
    },
    {
        "name": "fetch_trading_history",
        "description": (
            "Read detailed trading history and performance from btc_trader_state.json. "
            "Returns all executed trades, P&L, win rate, and trading statistics."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": []
        }
    },
    {
        "name": "read_bot_logs",
        "description": (
            "Read the latest bot log entries from bot.log file. "
            "Shows recent activity, errors, and debug information from the trading bot."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "lines": {"type": "integer", "description": "Number of log lines to read (default 50)", "default": 50}
            },
            "required": []
        }
    },
    {
        "name": "read_own_code",
        "description": (
            "Read one of your own source code files. Use this to inspect your current code "
            "before making improvements. You can read: agent.py, tools.py, patcher.py, "
            "telegram_bot.py, btc_15m_trader.py, loop.py, lukas_brain.py, memory.py, "
            "soul.md, self_heal.py. Returns the file content (up to 8000 chars)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "filename": {
                    "type": "string",
                    "description": "The filename to read (e.g. 'btc_15m_trader.py', 'agent.py')"
                }
            },
            "required": ["filename"]
        }
    },
    {
        "name": "patch_own_code",
        "description": (
            "Modify your own source code. This is your self-improvement capability. "
            "Provide the filename, a description of the change, the exact old code to replace, "
            "and the new code. The patch is validated (Python syntax check), applied atomically, "
            "and auto-committed to GitHub. If syntax fails, it auto-reverts. "
            "Allowed files: agent.py, tools.py, patcher.py, telegram_bot.py, btc_15m_trader.py, "
            "loop.py, lukas_brain.py, memory.py, self_heal.py. "
            "IMPORTANT: Always read_own_code first to get the exact current code before patching. "
            "The old_code must match EXACTLY (including whitespace)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "filename": {
                    "type": "string",
                    "description": "The file to patch (e.g. 'btc_15m_trader.py')"
                },
                "description": {
                    "type": "string",
                    "description": "What this change does and why (for the commit log)"
                },
                "old_code": {
                    "type": "string",
                    "description": "The exact existing code to replace (must match file content exactly)"
                },
                "new_code": {
                    "type": "string",
                    "description": "The new code to insert in place of old_code"
                }
            },
            "required": ["filename", "description", "old_code", "new_code"]
        }
    },
    {
        "name": "restart_service",
        "description": (
            "Restart one of your own systemd services after a code change. "
            "Available services: lukas-bot (telegram), lukas-btc-trader (BTC trader), "
            "lukas-brain (orchestrator), lukas-self-heal. "
            "Use this after patching code to apply changes immediately."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "service": {
                    "type": "string",
                    "description": "The systemd service name (e.g. 'lukas-btc-trader', 'lukas-bot')"
                }
            },
            "required": ["service"]
        }
    },
    {
        "name": "list_own_files",
        "description": (
            "List all your source code files with their sizes and last modified times. "
            "Use this to get an overview of your codebase before making changes."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": []
        }
    },
    {
        "name": "remember",
        "description": (
            "Save something important to your permanent memory graph. Use this proactively "
            "whenever Sir shares personal info, makes a decision, mentions a goal, talks about "
            "finances, health, projects, preferences, or anything worth remembering. "
            "Categories: personal, goal, preference, project, finance, decision, event, person, "
            "idea, health, learning, trading, gaming, work, insight. "
            "Auto-connects to related existing memories."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "content": {"type": "string", "description": "What to remember — be specific and complete"},
                "category": {"type": "string", "description": "Category (personal/goal/preference/project/finance/decision/event/person/idea/health/learning/trading/gaming/work/insight)"},
                "importance": {"type": "integer", "description": "1-10 how important (10=life-changing, 7=significant, 4=nice-to-know)"},
                "tags": {"type": "array", "items": {"type": "string"}, "description": "Keywords for finding this later"}
            },
            "required": ["content", "category"]
        }
    },
    {
        "name": "recall",
        "description": (
            "Search your memory graph for stored knowledge. Use when you need to remember "
            "something about Sir, his projects, goals, finances, preferences, or past conversations. "
            "Search by keyword, category, or both."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search keywords"},
                "category": {"type": "string", "description": "Filter by category (optional)"},
                "limit": {"type": "integer", "description": "Max results (default 10)"}
            },
            "required": []
        }
    },
    {
        "name": "memory_context",
        "description": (
            "Load a compact snapshot of your most important memories about Sir. "
            "Use at the start of conversations or when you need to refresh your knowledge. "
            "Returns owner profile + top memories + recent memories."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": []
        }
    },
    {
        "name": "query_polybot",
        "description": (
            "Query the Polymarket trading bot's live state and intelligence. "
            "Returns rich data about active markets, recent trades, performance, "
            "Reddit signals, BTC trader status, and which moltbook posts the bot "
            "is currently using as intel. Use this to write informed posts, "
            "analyze bot behavior, find patterns between your moltbook posts "
            "and market outcomes, or report on autonomous activity. "
            "Categories: 'summary' (overview), 'performance' (bankroll/winrate/PnL), "
            "'top_markets' (highest-EV active markets with Gemini predictions), "
            "'open_positions' (currently held bets), 'recent_trades' (last N trades), "
            "'intel_hits' (which Reddit/moltbook posts the bot consulted recently), "
            "'reddit_signals' (latest r/polymarket_bets analysis), "
            "'btc_trader' (BTC 5min trader state), 'all' (everything condensed)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "enum": ["summary", "performance", "top_markets", "open_positions",
                             "recent_trades", "intel_hits", "reddit_signals",
                             "btc_trader", "all"],
                    "description": "Which slice of polybot data to retrieve."
                },
                "limit": {
                    "type": "integer",
                    "description": "Max rows for list-style categories (default 10, max 30).",
                    "default": 10
                }
            },
            "required": ["category"]
        }
    },
]


# ── Tool-Implementierungen ────────────────────────────────────────────────────

def search_web(query: str) -> str:
    """DuckDuckGo Instant Answer API – kein API-Key nötig."""
    try:
        params = urllib.parse.urlencode({
            "q": query, "format": "json", "no_html": "1", "skip_disambig": "1"
        })
        req = urllib.request.Request(
            f"https://api.duckduckgo.com/?{params}",
            headers={"User-Agent": "Lukas-Agent/1.0"}
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())

        parts = []
        if data.get("AbstractText"):
            parts.append(f"Summary: {data['AbstractText'][:600]}")
        if data.get("AbstractURL"):
            parts.append(f"Source: {data['AbstractURL']}")
        if data.get("Answer"):
            parts.append(f"Direct answer: {data['Answer']}")

        topics = [t for t in data.get("RelatedTopics", [])[:6] if isinstance(t, dict) and t.get("Text")]
        if topics:
            parts.append("Related topics:")
            for t in topics:
                parts.append(f"  - {t['Text'][:150]}")

        if not parts:
            return f"No instant answer found for '{query}'. Try a more specific search query."
        return "\n".join(parts)
    except Exception as e:
        return f"Search error: {e}"


_BLOCKED_HOSTS = frozenset({
    "169.254.169.254",       # AWS/GCP/Azure IMDS
    "metadata.google.internal",
    "169.254.170.2",         # ECS task metadata
    "instance-data.ec2.internal",
    "metadata.internal",
})

_PRIVATE_RANGES = [
    # IPv4 private, loopback, link-local, CGNAT
    (0x7F000000, 0xFF000000),   # 127.0.0.0/8  loopback
    (0x0A000000, 0xFF000000),   # 10.0.0.0/8
    (0xAC100000, 0xFFF00000),   # 172.16.0.0/12
    (0xC0A80000, 0xFFFF0000),   # 192.168.0.0/16
    (0xA9FE0000, 0xFFFF0000),   # 169.254.0.0/16 link-local
    (0xC6120000, 0xFFFE0000),   # 198.18.0.0/15 benchmarking
    (0xE0000000, 0xF0000000),   # 224.0.0.0/4  multicast
    (0x00000000, 0xFF000000),   # 0.0.0.0/8    unspecified
    (0xFFFFFFFF, 0xFFFFFFFF),   # 255.255.255.255
]


def _is_safe_url(url: str) -> tuple[bool, str]:
    """Return (safe, reason). Blocks SSRF targets."""
    import ipaddress
    import socket
    import re
    try:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False, "Only http/https allowed"
        host = parsed.hostname or ""
        if not host:
            return False, "No hostname"
        if host in _BLOCKED_HOSTS:
            return False, f"Blocked host: {host}"
        # Resolve and check all IPs (guards against DNS rebinding)
        try:
            addrs = socket.getaddrinfo(host, None)
        except socket.gaierror:
            return False, f"DNS resolution failed for {host}"
        for (_fam, _typ, _proto, _cname, sockaddr) in addrs:
            ip_str = sockaddr[0]
            try:
                ip = ipaddress.ip_address(ip_str)
            except ValueError:
                return False, f"Invalid IP: {ip_str}"
            if ip.is_loopback or ip.is_link_local or ip.is_private or \
               ip.is_multicast or ip.is_reserved or ip.is_unspecified:
                return False, f"Private/reserved address blocked: {ip_str}"
            # Extra IPv4 range check
            if ip.version == 4:
                n = int(ip)
                for (net, mask) in _PRIVATE_RANGES:
                    if (n & mask) == net:
                        return False, f"Private range blocked: {ip_str}"
        return True, "ok"
    except Exception as e:
        return False, f"URL safety check error: {e}"


def read_url(url: str) -> str:
    """Fetch a public web page and return plain text (SSRF-protected, max 3000 chars)."""
    if not url.startswith(("http://", "https://")):
        return "Error: URL must start with http:// or https://"
    safe, reason = _is_safe_url(url)
    if not safe:
        return f"Error: URL blocked for security reasons — {reason}"
    headers = {"User-Agent": "Mozilla/5.0 (compatible; Lukas-Agent/1.0)"}
    try:
        # Primary: requests + BeautifulSoup (pip install requests beautifulsoup4)
        import requests
        from bs4 import BeautifulSoup
        import re
        resp = requests.get(
            url, headers=headers, timeout=(5, 10), stream=True,
            allow_redirects=False  # validate redirects manually
        )
        # Follow redirect with SSRF check (normalize relative Location headers)
        if resp.is_redirect or resp.status_code in (301, 302, 303, 307, 308):
            location = resp.headers.get("Location", "")
            # Normalize relative → absolute using the original URL as base
            redirect_url = urllib.parse.urljoin(url, location)
            ok, msg = _is_safe_url(redirect_url)
            if not ok:
                return f"Error: Redirect target blocked — {msg}"
            resp = requests.get(redirect_url, headers=headers, timeout=(5, 10),
                                stream=True, allow_redirects=False)
        resp.raise_for_status()
        raw = b""
        for chunk in resp.iter_content(chunk_size=8192):
            raw += chunk
            if len(raw) >= 120_000:
                break
        content_type = resp.headers.get("Content-Type", "")
        text = raw.decode("utf-8", errors="replace")
        if "html" in content_type.lower() or url.lower().rstrip("/").endswith((".html", ".htm")):
            soup = BeautifulSoup(text, "html.parser")
            for tag in soup(["script", "style", "nav", "footer", "aside"]):
                tag.decompose()
            text = soup.get_text(separator=" ", strip=True)
            text = re.sub(r" {2,}", " ", text).strip()
        return text[:3000] or "(empty page)"
    except ImportError:
        pass  # Fall through to urllib fallback
    except Exception as e:
        return f"URL read error (requests): {e}"
    # Fallback: urllib (no external deps)
    try:
        import re
        req = urllib.request.Request(url, headers=headers)
        # urllib follows redirects by default – intercept via custom opener
        class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, hdrs, newurl):
                ok, reason_ = _is_safe_url(newurl)
                if not ok:
                    raise ValueError(f"Redirect target blocked: {reason_}")
                return super().redirect_request(req, fp, code, msg, hdrs, newurl)
        opener = urllib.request.build_opener(_NoRedirectHandler)
        with opener.open(req, timeout=10) as r:
            raw = r.read(120_000)
            content_type = r.headers.get("Content-Type", "")
        text = raw.decode("utf-8", errors="replace")
        if "html" in content_type.lower():
            text = re.sub(r"<script[^>]*>.*?</script>", " ", text, flags=re.DOTALL | re.IGNORECASE)
            text = re.sub(r"<style[^>]*>.*?</style>", " ", text, flags=re.DOTALL | re.IGNORECASE)
            text = re.sub(r"<[^>]+>", " ", text)
            text = re.sub(r"&[a-z]{2,6};", "", text)
            text = re.sub(r"\s+", " ", text).strip()
        return text[:3000] or "(empty page)"
    except Exception as e:
        return f"URL read error (urllib): {e}"


def send_telegram_alert(message: str) -> str:
    """Sofortige Telegram-Benachrichtigung an den Owner."""
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        return "Telegram not configured (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)"
    try:
        body = json.dumps({
            "chat_id": TELEGRAM_CHAT_ID,
            "text": f"⚡ <b>Lukas – Sofort-Alert:</b>\n\n{message[:500]}",
            "parse_mode": "HTML"
        }).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
            data=body,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            return "Telegram alert sent ✓"
    except Exception as e:
        return f"Telegram error: {e}"


def log_finding(agent: str, method: str, detail: str, confidence: str) -> str:
    """Fund dauerhaft in activity.json speichern."""
    try:
        activity_file = BASE_DIR / "activity.json"
        data: dict = {}
        if activity_file.exists():
            data = json.loads(activity_file.read_text())
        finding = {
            "agent": agent,
            "method": method,
            "detail": detail,
            "confidence": confidence,
            "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "source": "tool_call"
        }
        data.setdefault("findings", []).append(finding)
        data.setdefault("stats", {})["findings"] = data["stats"].get("findings", 0) + 1
        activity_file.write_text(json.dumps(data, indent=2, ensure_ascii=False))
        return f"Finding logged ✓ — {agent}: {method} [{confidence}]"
    except Exception as e:
        return f"Log error: {e}"


def fetch_bot_status() -> str:
    """Read Polymarket bot status from bridge.json (updated by bot_bridge.py)."""
    bridge_file = BASE_DIR / "bridge.json"
    try:
        from bot_bridge import update_bridge
        bridge = update_bridge()
    except Exception:
        if bridge_file.exists():
            try:
                bridge = json.loads(bridge_file.read_text())
            except Exception as e:
                return f"Error reading bridge.json: {e}"
        else:
            return "No bridge.json found. The Polymarket bot may not be set up yet."

    parts = [
        f"Bot Status: {bridge.get('status', 'unknown')}",
        f"PID: {bridge.get('pid', 'none')}",
        f"Uptime: {bridge.get('uptime', 'unknown')}",
    ]
    if bridge.get("bankroll") is not None:
        parts.append(f"Bankroll: ${bridge['bankroll']}")
    if bridge.get("regime"):
        parts.append(f"Market Regime: {bridge['regime']}")
    positions = bridge.get("open_positions", [])
    if positions:
        parts.append(f"Open Positions: {len(positions)}")
        for p in positions[:3]:
            if isinstance(p, dict):
                name = p.get("title") or p.get("market") or p.get("question", "?")
                parts.append(f"  - {name[:60]}")
    trades = bridge.get("last_trades", [])
    if trades:
        parts.append(f"Recent Trades: {len(trades)}")
        for t in trades[:3]:
            if isinstance(t, dict):
                name = t.get("title") or t.get("market") or t.get("question", "?")
                side = t.get("side", t.get("type", "?"))
                parts.append(f"  - {side.upper()} {name[:50]}")
    if bridge.get("last_error"):
        parts.append(f"Last Error: {bridge['last_error']}")
    parts.append(f"Updated: {bridge.get('updated', '?')}")
    return "\n".join(parts)


READABLE_FILES = {
    "agent.py", "tools.py", "patcher.py", "telegram_bot.py",
    "btc_15m_trader.py", "loop.py", "lukas_brain.py", "memory.py",
    "soul.md", "self_heal.py", "bot_bridge.py", "dashboard_server.py",
    "training_logger.py", "trainer.py",
}

PATCHABLE_FILES = {
    "agent.py", "tools.py", "patcher.py", "telegram_bot.py",
    "btc_15m_trader.py", "loop.py", "lukas_brain.py", "memory.py",
    "self_heal.py",
}

ALLOWED_SERVICES = {
    "lukas-bot", "lukas-btc-trader", "lukas-brain", "lukas-self-heal",
    "lukas-telegram",
}


def read_own_code(filename: str) -> str:
    filename = filename.strip()
    if filename not in READABLE_FILES:
        return f"Access denied: '{filename}' is not readable. Allowed: {', '.join(sorted(READABLE_FILES))}"
    if "/" in filename or "\\" in filename or ".." in filename:
        return "Error: path traversal blocked"
    filepath = BASE_DIR / filename
    if not filepath.exists():
        return f"File not found: {filename}"
    try:
        content = filepath.read_text(errors="replace")
        if len(content) > 8000:
            return content[:8000] + f"\n\n... [TRUNCATED — file is {len(content)} chars, showing first 8000]"
        return content
    except Exception as e:
        return f"Read error: {e}"


def patch_own_code(filename: str, description: str, old_code: str, new_code: str) -> str:
    filename = filename.strip()
    if filename not in PATCHABLE_FILES:
        return f"Patch denied: '{filename}' is not patchable. Allowed: {', '.join(sorted(PATCHABLE_FILES))}"
    if "/" in filename or "\\" in filename or ".." in filename:
        return "Error: path traversal blocked"
    filepath = BASE_DIR / filename
    if not filepath.exists():
        return f"File not found: {filename}"
    if not old_code or not new_code:
        return "Error: old_code and new_code must both be non-empty"
    if old_code == new_code:
        return "Error: old_code and new_code are identical — no change needed"

    content = filepath.read_text(errors="replace")
    if old_code not in content:
        return (
            f"Patch failed: old_code not found in {filename}. "
            "Make sure you read the file first with read_own_code and copied the exact code including whitespace."
        )

    backup = filepath.with_suffix(filepath.suffix + ".prepatch")
    backup.write_text(content)

    new_content = content.replace(old_code, new_code, 1)
    filepath.write_text(new_content)

    if filename.endswith(".py"):
        result = subprocess.run(
            ["python3", "-m", "py_compile", str(filepath)],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            reason = result.stderr.strip()[:300]
            filepath.write_text(content)
            backup.unlink(missing_ok=True)
            send_telegram_alert(f"❌ Self-patch REVERTED ({filename}): syntax error\n{reason[:200]}")
            return f"Patch REVERTED — syntax error: {reason}. Fix the code and try again."
        backup.unlink(missing_ok=True)

    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    patch_log = BASE_DIR / "patches.md"
    with open(patch_log, "a") as f:
        f.write(f"\n## [{now}] {filename} – ✓ SELF-APPLIED (via tool)\n")
        f.write(f"**Reason:** {description}\n\n")
        f.write(f"```diff\n- {old_code[:200]}\n+ {new_code[:200]}\n```\n")

    git_files = [filename, "patches.md"]
    subprocess.run(["git", "add"] + git_files, capture_output=True, cwd=str(BASE_DIR))
    commit_msg = f"self-improvement ({filename}): {description[:80]}"
    subprocess.run(["git", "commit", "-m", commit_msg], capture_output=True, cwd=str(BASE_DIR))
    subprocess.run(
        ["git", "push", "origin", "HEAD:claude/bot-communication-system-eriiT", "--force"],
        capture_output=True, cwd=str(BASE_DIR)
    )

    send_telegram_alert(f"✅ Self-patched {filename}: {description[:150]}")
    return f"Patch applied successfully to {filename}, committed and pushed to GitHub. Description: {description}"


def restart_service(service: str) -> str:
    service = service.strip()
    if service not in ALLOWED_SERVICES:
        return f"Service denied: '{service}' not allowed. Allowed: {', '.join(sorted(ALLOWED_SERVICES))}"
    try:
        result = subprocess.run(
            ["systemctl", "restart", service],
            capture_output=True, text=True, timeout=15
        )
        if result.returncode == 0:
            send_telegram_alert(f"🔄 Service restarted: {service}")
            return f"Service '{service}' restarted successfully."
        return f"Restart failed (exit {result.returncode}): {result.stderr.strip()[:200]}"
    except subprocess.TimeoutExpired:
        return f"Restart timed out for '{service}'"
    except Exception as e:
        return f"Restart error: {e}"


def list_own_files() -> str:
    parts = ["Your source code files:\n"]
    for f in sorted(READABLE_FILES):
        fp = BASE_DIR / f
        if fp.exists():
            size = fp.stat().st_size
            mtime = datetime.fromtimestamp(fp.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
            parts.append(f"  {f:30s} {size:>7,} bytes  (modified {mtime})")
        else:
            parts.append(f"  {f:30s}  [not found]")
    return "\n".join(parts)


# ── Tool-Dispatcher ───────────────────────────────────────────────────────────

try:
    from memory_graph import remember as mg_remember, recall as mg_recall, get_context as mg_context
    MEMORY_AVAILABLE = True
except ImportError:
    MEMORY_AVAILABLE = False



def query_polybot(category: str = "summary", limit: int = 10) -> str:
    """Query Polymarket bot's live state (Postgres + bot.log + bridge.json).

    Read-only. Designed so the moltagent can write informed posts about
    autonomous trading activity and observe how its own moltbook posts
    are being consumed by the bot.
    """
    import os, re as _re
    from datetime import datetime as _dt
    try:
        import psycopg2
    except Exception as e:
        return f"polybot query unavailable: psycopg2 missing ({e})"

    limit = max(1, min(int(limit or 10), 30))
    cat = (category or "summary").strip().lower()
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        return "polybot query unavailable: DATABASE_URL not set"

    parts = []

    def _q(sql, args=()):
        try:
            with psycopg2.connect(db_url, connect_timeout=8) as c:
                with c.cursor() as cur:
                    cur.execute(sql, args)
                    cols = [d[0] for d in cur.description] if cur.description else []
                    return cols, cur.fetchall()
        except Exception as e:
            return None, f"db error: {e}"

    def _bridge():
        try:
            import json as _j
            from pathlib import Path as _P
            f = _P("/root/Agent-spy/bridge.json")
            if f.exists():
                return _j.loads(f.read_text())
        except Exception:
            return {}
        return {}

    def _bot_log_tail(pattern, n=8):
        """Grep last lines of bot.log matching pattern."""
        import subprocess as _sp
        try:
            r = _sp.run(["bash", "-c",
                         f"tail -n 4000 /root/Agent-spy/bot.log | grep -E {repr(pattern)} | tail -n {n}"],
                        capture_output=True, text=True, timeout=10)
            return r.stdout.strip()
        except Exception as e:
            return f"(log tail failed: {e})"

    def _section(title):
        parts.append(f"\n=== {title} ===")

    do = lambda x: cat in (x, "all", "summary")

    if do("performance"):
        _section("PERFORMANCE")
        b = _bridge()
        if b.get("bankroll") is not None:
            parts.append(f"bankroll: ${b.get('bankroll')}")
        if b.get("status"):
            parts.append(f"bot_status: {b.get('status')} (regime={b.get('regime','?')})")
        cols, rows = _q("SELECT bot, total, wins, losses, win_rate_pct, total_pnl FROM v_bot_winrate ORDER BY bot")
        if isinstance(rows, list):
            for bot_name, t, w, l, wr, pnl in rows:
                parts.append(f"  {bot_name}: {t} trades | {w}W/{l}L | winrate {wr}% | PnL ${pnl}")
        elif isinstance(rows, str):
            parts.append(f"  ({rows})")
        # last 24h
        cols, rows = _q("""SELECT bot, count(*), COALESCE(sum(pnl),0)::numeric(10,2)
                           FROM trades WHERE closed_at > now() - interval '24 hours'
                                       AND pnl IS NOT NULL
                           GROUP BY bot""")
        if isinstance(rows, list):
            for bot_name, n, pnl in rows:
                parts.append(f"  last 24h ({bot_name}): {n} trades, PnL ${pnl}")

    if do("top_markets"):
        _section(f"TOP ACTIVE MARKETS (Gemini-rated, EV-sorted, top {limit})")
        # parse heartbeat lines from bot.log directly (last ~64KB)
        hb = ""
        try:
            with open("/root/Agent-spy/bot.log", "rb") as _f:
                _f.seek(0, 2); _sz = _f.tell()
                _f.seek(max(0, _sz - 65536))
                _tail = _f.read().decode(errors="ignore")
                for ln in reversed(_tail.splitlines()):
                    if "[HEARTBEAT] tick=" in ln and "Gemini[" in ln:
                        hb = ln; break
        except Exception:
            pass
        gem = _re.findall(r"(evt_0x[a-f0-9]+)=p([0-9.]+)\(c([0-9.]+)\)", hb)
        for mid, p, c in gem[:limit]:
            parts.append(f"  {mid}: gemini_p={p} conf={c}")
        if not gem:
            parts.append("  (no Gemini-rated markets in latest heartbeat)")

    if do("open_positions"):
        _section("OPEN POSITIONS")
        b = _bridge()
        pos = b.get("open_positions", []) or []
        if not pos:
            parts.append("  (no open positions reported in bridge.json)")
        for p in pos[:limit]:
            if isinstance(p, dict):
                name = p.get("title") or p.get("market") or p.get("question", "?")
                side = (p.get("side") or "?").upper()
                size = p.get("size") or p.get("usd") or "?"
                parts.append(f"  {side} ${size}  {name[:80]}")

    if do("recent_trades"):
        _section(f"RECENT TRADES (last {limit})")
        cols, rows = _q("""SELECT opened_at::timestamp(0), bot, side,
                                  COALESCE(stake,0)::numeric(8,2),
                                  pnl::numeric(8,2), status,
                                  left(coalesce(market_question, market_slug, ''), 70)
                           FROM trades ORDER BY opened_at DESC LIMIT %s""", (limit,))
        if isinstance(rows, list):
            for d, bot_n, side, stake, pnl, status, q in rows:
                pnl_s = f"${pnl}" if pnl is not None else f"({status})"
                parts.append(f"  {d} {(bot_n or '?'):10} {(side or '?'):4} ${stake} → {pnl_s:>10}  {q}")
        elif isinstance(rows, str):
            parts.append(f"  ({rows})")

    if do("intel_hits"):
        _section(f"INTEL BRIDGE — moltbook/reddit posts the bot used (last {limit})")
        cols, rows = _q("""SELECT checked_at::timestamp(0), reddit_count, moltbook_count,
                                  insider_count, boost_recommend::numeric(6,4),
                                  matched_post_ids, matched_signal_ids,
                                  left(question, 70)
                           FROM bot_intel_log
                           WHERE reddit_count + moltbook_count > 0
                           ORDER BY id DESC LIMIT %s""", (limit,))
        if isinstance(rows, list):
            for ts, rc, mc, ic, br, posts, sigs, q in rows:
                parts.append(
                    f"  {ts} reddit={rc} molt={mc} insider={ic} "
                    f"boost={br} molt_posts={list(posts or [])} reddit_sigs={list(sigs or [])}"
                )
                parts.append(f"    market: {q}")
        elif isinstance(rows, str):
            parts.append(f"  ({rows})")

    if do("reddit_signals"):
        _section(f"REDDIT POLYMARKET SIGNALS (last {limit})")
        cols, rows = _q("""SELECT posted_at::timestamp(0), is_signal, insider_claim,
                                  large_bet_mentioned, confidence::numeric(4,2),
                                  side_hint, left(coalesce(market_hint, title), 80)
                           FROM reddit_signals
                           ORDER BY posted_at DESC LIMIT %s""", (limit,))
        if isinstance(rows, list):
            for pa, sig, ins, big, conf, side, txt in rows:
                flags = []
                if sig: flags.append("SIGNAL")
                if ins: flags.append("insider")
                if big: flags.append("big_bet")
                f = ",".join(flags) if flags else "noise"
                parts.append(f"  {pa} [{f}] conf={conf} side={side or '?'}  {txt}")
        elif isinstance(rows, str):
            parts.append(f"  ({rows})")

    if do("btc_trader"):
        _section("BTC 5min TRADER")
        cols, rows = _q("""SELECT count(*), COALESCE(sum(pnl),0)::numeric(10,2),
                                  count(*) FILTER (WHERE pnl > 0),
                                  count(*) FILTER (WHERE status='open')
                           FROM trades WHERE bot = 'btc_5m'""")
        if isinstance(rows, list) and rows:
            t, pnl, w, openn = rows[0]
            wr = (100.0 * w / t) if t else 0.0
            parts.append(f"BTC trades: {t} total | open {openn} | winrate {wr:.1f}% | realised PnL ${pnl}")
        # tail btc_trader.log
        try:
            from pathlib import Path as _P
            log = _P("/root/Agent-spy/btc_trader.log")
            if log.exists():
                tail = log.read_text(errors="ignore").splitlines()[-5:]
                for ln in tail:
                    parts.append(f"  log: {ln[:120]}")
        except Exception:
            pass

    if cat == "summary" or cat == "all":
        # condensed leader at top
        head = []
        b = _bridge()
        if b.get("bankroll") is not None:
            head.append(f"bankroll=${b['bankroll']}")
        cols, rows = _q("SELECT count(*), count(*) FILTER (WHERE pnl_usd IS NOT NULL) FROM trades")
        if isinstance(rows, list) and rows:
            head.append(f"trades_total={rows[0][0]} closed={rows[0][1]}")
        cols, rows = _q("SELECT count(*) FROM bot_intel_log WHERE checked_at > now() - interval '24 hours'")
        if isinstance(rows, list) and rows:
            head.append(f"intel_checks_24h={rows[0][0]}")
        cols, rows = _q("SELECT count(*) FROM reddit_signals WHERE is_signal=true AND posted_at > now() - interval '24 hours'")
        if isinstance(rows, list) and rows:
            head.append(f"actionable_reddit_signals_24h={rows[0][0]}")
        cols, rows = _q("SELECT count(*) FROM moltbook_posts WHERE created_at > now() - interval '7 days'")
        if isinstance(rows, list) and rows:
            head.append(f"your_moltbook_posts_last_7d={rows[0][0]}")
        cols, rows = _q("""SELECT count(DISTINCT mp.id)
                           FROM moltbook_posts mp
                           JOIN bot_intel_log bil ON mp.id = ANY(bil.matched_post_ids)
                           WHERE mp.created_at > now() - interval '14 days'""")
        if isinstance(rows, list) and rows:
            head.append(f"your_posts_used_by_bot={rows[0][0]}")
        if head:
            parts.insert(0, "POLYBOT QUICKVIEW: " + " | ".join(head))

    if not parts:
        return f"unknown category '{category}'"
    return "\n".join(parts).strip()


def execute_tool(name: str, input_data: dict) -> str:
    """Tool anhand Name aufrufen und Ergebnis als String zurückgeben."""
    if name == "search_web":
        return search_web(input_data.get("query", ""))
    elif name == "read_url":
        return read_url(input_data.get("url", ""))
    elif name == "send_telegram_alert":
        return send_telegram_alert(input_data.get("message", ""))
    elif name == "log_finding":
        return log_finding(
            input_data.get("agent", "unknown"),
            input_data.get("method", ""),
            input_data.get("detail", ""),
            input_data.get("confidence", "low")
        )
    elif name == "fetch_bot_status":
        return fetch_bot_status()
    elif name == "read_own_code":
        return read_own_code(input_data.get("filename", ""))
    elif name == "patch_own_code":
        return patch_own_code(
            input_data.get("filename", ""),
            input_data.get("description", ""),
            input_data.get("old_code", ""),
            input_data.get("new_code", "")
        )
    elif name == "restart_service":
        return restart_service(input_data.get("service", ""))
    elif name == "list_own_files":
        return list_own_files()
    elif name == "remember":
        if not MEMORY_AVAILABLE:
            return "Memory system not available"
        return mg_remember(
            input_data.get("content", ""),
            category=input_data.get("category", "insight"),
            importance=input_data.get("importance", 5),
            tags=input_data.get("tags", []),
            auto_connect=True
        )
    elif name == "recall":
        if not MEMORY_AVAILABLE:
            return "Memory system not available"
        return mg_recall(
            query=input_data.get("query", ""),
            category=input_data.get("category", ""),
            limit=input_data.get("limit", 10)
        )
    elif name == "memory_context":
        if not MEMORY_AVAILABLE:
            return "Memory system not available"
        return mg_context()
    elif name == "query_polybot":
        return query_polybot(
            input_data.get("category", "summary"),
            input_data.get("limit", 10)
        )
    else:
        return f"Unknown tool: {name}"
