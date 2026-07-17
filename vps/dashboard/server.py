#!/usr/bin/env python3
"""Dashboard server for AgentLukas – reads activity.json and serves the UI.

Deployment path on VPS: /home/user/Agent-spy/dashboard/server.py
  → Path(__file__).parent           = /home/user/Agent-spy/dashboard/
  → Path(__file__).parent.parent    = /home/user/Agent-spy/   (BASE_DIR, where activity.json lives)

This file is stored in vps-source/dashboard_server.py in the Replit repo for reference
and pushed to GitHub branch claude/bot-communication-system-eriiT as dashboard/server.py.
"""

import json
import os
import sys
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

BASE = Path(__file__).parent.parent  # /home/user/Agent-spy/ on VPS

# Task #45: import the UMA paper-report helpers so the dashboard re-uses
# the exact same math the Telegram aggregate report uses (single source of
# truth — no re-implementing _max_drawdown / _sharpe_ish /
# _live_switch_recommendation in the dashboard layer). uma_watcher.py lives
# alongside the bot in BASE_DIR; we add BASE to sys.path so this works on the
# VPS deploy. Falls back to None on import failure so the rest of the
# dashboard keeps working.
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))
try:
    import uma_watcher as _uma_watcher  # type: ignore
except Exception as _e:  # noqa: BLE001
    _uma_watcher = None
    _uma_import_error = repr(_e)
else:
    _uma_import_error = None
ACTIVITY_FILE      = BASE / "activity.json"
TOOL_CALLS_FILE    = BASE / "tool_calls.json"
LOOP_STATUS_FILE   = BASE / "loop_status.json"
BRIDGE_FILE        = BASE / "bridge.json"
MOLTBOOK_BRIDGE_FILE = BASE / "moltbook_bridge.json"
SIGNAL_TRADES_FILE = BASE / "signal_trades.jsonl"
TRAINING_INDEX     = BASE / "training_data" / "_index.jsonl"
SIGNAL_PANEL_FILE  = Path(__file__).parent / "dashboard_signals_panel.html"
SIGNAL_PANEL_MARKER = "id=\"signal-trades-panel\""
MOLTBOOK_PANEL_FILE = Path(__file__).parent / "dashboard_moltbook_panel.html"
MOLTBOOK_PANEL_MARKER = "id=\"moltbook-bridge-panel\""
LIVE_SWITCH_PANEL_FILE = Path(__file__).parent / "dashboard_live_switch_panel.html"
LIVE_SWITCH_PANEL_MARKER = "id=\"live-switch-panel\""
PAPER_REPORT_PANEL_FILE = Path(__file__).parent / "dashboard_paper_report_panel.html"
PAPER_REPORT_PANEL_MARKER = "id=\"uma-paper-report-panel\""
POLY_REALITY_PANEL_FILE = Path(__file__).parent / "dashboard_polymarket_reality_panel.html"
POLY_REALITY_PANEL_MARKER = "id=\"polymarket-reality-panel\""
# Task #64: Polymarket bot writes reality.json into its own bot/ dir.
POLY_REALITY_FILE = BASE / "Polymarket_bot" / "bot" / "reality.json"
POLY_EVENTS_FILE  = BASE / "Polymarket_bot" / "bot" / "events.json"

# Task #38: dashboard-side freshness threshold for the Moltbook bridge.
# Anything older than this counts as "stale"; a missing file counts as "down".
MOLTBOOK_STALE_AFTER_SECONDS = 600  # 10 minutes
PORT = 8080


def count_training_pairs() -> int:
    """Count completed training pairs from the index file."""
    if not TRAINING_INDEX.exists():
        return 0
    try:
        count = 0
        for line in TRAINING_INDEX.read_text(errors="ignore").splitlines():
            if line.strip():
                count += 1
        return count
    except Exception:
        return 0


def load_signal_trades_from_log(limit: int = 50) -> list[dict]:
    """Read signal_trades.jsonl directly (last `limit` rows, newest first).

    Used as a fallback when bridge.json hasn't been refreshed yet — it lets
    the dashboard show the trade-with-signals timeline immediately.
    """
    if not SIGNAL_TRADES_FILE.exists():
        return []
    rows: list[dict] = []
    try:
        for raw in SIGNAL_TRADES_FILE.read_text(errors="ignore").splitlines():
            line = raw.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                continue
    except Exception:
        return []
    return list(reversed(rows[-limit:]))


def compute_signal_winrate_split(rows: list[dict]) -> dict:
    """Local mirror of signal_trade_log.compute_stats — kept here so the
    dashboard server can compute the split even without the helper module
    on the path."""
    total = 0
    buckets = {
        "with_signal":    {"count": 0, "wins": 0, "losses": 0, "unresolved": 0},
        "without_signal": {"count": 0, "wins": 0, "losses": 0, "unresolved": 0},
    }
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        total += 1
        b = buckets["with_signal"] if r.get("has_signal") else buckets["without_signal"]
        b["count"] += 1
        pnl = r.get("pnl")
        if pnl is None:
            b["unresolved"] += 1
        else:
            try:
                p = float(pnl)
            except (TypeError, ValueError):
                b["unresolved"] += 1
                continue
            if p > 0:
                b["wins"] += 1
            elif p < 0:
                b["losses"] += 1
    out: dict = {"total": total}
    for name, b in buckets.items():
        resolved = b["wins"] + b["losses"]
        out[name] = {
            "count": b["count"],
            "resolved": resolved,
            "wins": b["wins"],
            "losses": b["losses"],
            "unresolved": b["unresolved"],
            "win_rate": round(b["wins"] / resolved, 3) if resolved else None,
        }
    return out


def load_data():
    data = {"stats": {}, "activities": [], "findings": [], "thoughts": [], "lastThought": "Noch keine Aktivität.", "tool_calls": []}
    if ACTIVITY_FILE.exists():
        try:
            data = json.loads(ACTIVITY_FILE.read_text())
        except Exception:
            pass
    # Merge latest tool_calls.json (current session) if exists
    if TOOL_CALLS_FILE.exists():
        try:
            tc = json.loads(TOOL_CALLS_FILE.read_text())
            existing = {str(t): True for t in data.get("tool_calls", [])}
            for t in tc:
                if str(t) not in existing:
                    data.setdefault("tool_calls", []).append(t)
        except Exception:
            pass
    # Merge loop_status.json written by loop.py
    if LOOP_STATUS_FILE.exists():
        try:
            ls = json.loads(LOOP_STATUS_FILE.read_text())
            data["loop_status"] = ls
        except Exception:
            pass

    # Task #34: surface the Polymarket bot's bridge state, including the
    # per-trade Reddit-signal attachments and the win-rate split.
    bridge = None
    if BRIDGE_FILE.exists():
        try:
            bridge = json.loads(BRIDGE_FILE.read_text())
        except Exception:
            bridge = None
    data["bridge"] = bridge or {}

    if bridge and bridge.get("signal_trades_history"):
        data["signal_trades"] = bridge["signal_trades_history"]
    else:
        data["signal_trades"] = load_signal_trades_from_log()

    if bridge and bridge.get("signal_stats"):
        data["signal_stats"] = bridge["signal_stats"]
    else:
        data["signal_stats"] = compute_signal_winrate_split(
            load_signal_trades_from_log(limit=500)
        )

    # Task #38: surface the Moltbook → Poly-Bot bridge state. We read the
    # exact same moltbook_bridge.json that moltbook_bridge.py writes and the
    # bot consumes — no duplicate logic. The dashboard re-derives the
    # high-level status purely from file presence + mtime so the tile shows
    # "down" even if the writer crashed before updating the embedded status,
    # and "stale" when the file is older than MOLTBOOK_STALE_AFTER_SECONDS.
    data["moltbook_bridge"] = load_moltbook_bridge()

    # Task #43: surface the LIVE-ON / LIVE-OFF audit trail written by
    # uma_watcher.enable_live_mode / disable_live_mode. The events live in
    # activity.json under `live_switch_events`; we just pass them through
    # so the dashboard panel (dashboard_live_switch_panel.html) can render
    # them. Default to an empty list so the panel renders cleanly even on
    # a fresh activity.json.
    if "live_switch_events" not in data or not isinstance(data.get("live_switch_events"), list):
        data["live_switch_events"] = []

    # Task #45: surface the 7-day UMA paper-report (window WR/PnL/sharpe/maxDD,
    # paper-trade count, live-switch verdict + reason) on the dashboard. Reuses
    # uma_watcher.compute_paper_report_snapshot which in turn reuses the same
    # helpers the Telegram aggregate report uses, so the two surfaces always
    # show identical numbers.
    if _uma_watcher is not None:
        try:
            data["uma_paper_report"] = _uma_watcher.compute_paper_report_snapshot()
        except Exception as e:
            data["uma_paper_report"] = {"error": f"snapshot failed: {e!r}"}
    else:
        data["uma_paper_report"] = {
            "error": f"uma_watcher import failed: {_uma_import_error}"
        }

    # Task #64: surface Polymarket bot's on-chain reality (balance, drift,
    # open positions cost-vs-value, realized 24h PnL, force-close timeline).
    # Writer is bot/trading/reality.py invoked from the bot's _tick() loop.
    data["polymarket_reality"] = load_polymarket_reality()

    # Add training data stats
    data["training_pairs"] = count_training_pairs()
    return data


def load_polymarket_reality() -> dict:
    """Read Polymarket_bot/bot/reality.json and overlay a freshness flag."""
    if not POLY_REALITY_FILE.exists():
        return {
            "status": "down",
            "error": "reality.json not found — bot has not synced yet.",
        }
    try:
        snap = json.loads(POLY_REALITY_FILE.read_text())
        if not isinstance(snap, dict):
            raise ValueError("reality.json is not an object")
    except Exception as e:
        return {"status": "down", "error": f"reality.json unreadable: {e}"}
    try:
        snap["file_age_seconds"] = int(time.time() - POLY_REALITY_FILE.stat().st_mtime)
    except Exception:
        snap["file_age_seconds"] = None
    age = snap.get("file_age_seconds")
    if age is None:
        snap["status"] = "down"
    elif age > 180:
        snap["status"] = "stale"
    else:
        snap["status"] = "fresh"
    return snap


def load_moltbook_bridge() -> dict:
    """Read moltbook_bridge.json and overlay a dashboard-computed freshness
    status. Returns a dict shaped like the on-disk bridge file plus:
      status:        "fresh" | "stale" | "down"
      file_age_seconds: int | None  (mtime age of moltbook_bridge.json itself)
    """
    if not MOLTBOOK_BRIDGE_FILE.exists():
        return {
            "status": "down",
            "sources": [],
            "newest_source_age_seconds": None,
            "file_age_seconds": None,
            "stats": {},
            "recent_posts": [],
            "diary_entries": [],
            "owner_hints": [],
            "last_error": "moltbook_bridge.json not found",
            "updated": None,
        }
    try:
        bridge = json.loads(MOLTBOOK_BRIDGE_FILE.read_text())
        if not isinstance(bridge, dict):
            raise ValueError("moltbook_bridge.json did not contain an object")
    except Exception as e:
        return {
            "status": "down",
            "sources": [],
            "newest_source_age_seconds": None,
            "file_age_seconds": None,
            "stats": {},
            "recent_posts": [],
            "diary_entries": [],
            "owner_hints": [],
            "last_error": f"could not read moltbook_bridge.json: {e}",
            "updated": None,
        }

    try:
        file_age = int(time.time() - MOLTBOOK_BRIDGE_FILE.stat().st_mtime)
    except Exception:
        file_age = None
    bridge["file_age_seconds"] = file_age

    if file_age is None:
        bridge["status"] = "down"
    elif file_age > MOLTBOOK_STALE_AFTER_SECONDS:
        bridge["status"] = "stale"
    else:
        bridge["status"] = "fresh"
    return bridge


def _inject_signal_panel(html: bytes) -> bytes:
    """Inject the Signals → Trades panel (Task #34) into the served index.html.

    Idempotent — does nothing when the marker `id="signal-trades-panel"` is
    already present (e.g. someone hand-edited index.html to embed it). The
    snippet is appended right before `</body>` so it sits at the bottom of
    the page; it auto-mounts a container and starts its own /api/data poll
    loop independent of the host page's existing JS, so the user sees the
    panel without anyone editing index.html on the VPS.
    """
    return _inject_panel(html, SIGNAL_PANEL_FILE, SIGNAL_PANEL_MARKER)


def _inject_moltbook_panel(html: bytes) -> bytes:
    """Inject the Moltbook-Bridge tile (Task #38) before </body>. Idempotent —
    no-op when `id="moltbook-bridge-panel"` is already present."""
    return _inject_panel(html, MOLTBOOK_PANEL_FILE, MOLTBOOK_PANEL_MARKER)


def _inject_live_switch_panel(html: bytes) -> bytes:
    """Inject the UMA Live-Switch audit panel (Task #43) before </body>.
    Idempotent — no-op when `id="live-switch-panel"` is already present."""
    return _inject_panel(html, LIVE_SWITCH_PANEL_FILE, LIVE_SWITCH_PANEL_MARKER)


def _inject_paper_report_panel(html: bytes) -> bytes:
    """Inject the UMA 7-day paper-report panel (Task #45) before </body>.
    Idempotent — no-op when `id="uma-paper-report-panel"` is already present."""
    return _inject_panel(html, PAPER_REPORT_PANEL_FILE, PAPER_REPORT_PANEL_MARKER)


def _inject_polymarket_reality_panel(html: bytes) -> bytes:
    """Inject the Polymarket Reality panel (Task #64) before </body>.
    Idempotent — no-op when `id="polymarket-reality-panel"` is already present."""
    return _inject_panel(html, POLY_REALITY_PANEL_FILE, POLY_REALITY_PANEL_MARKER)


def _inject_panel(html: bytes, snippet_file: Path, marker: str) -> bytes:
    if not snippet_file.exists():
        return html
    try:
        text = html.decode("utf-8", errors="replace")
    except Exception:
        return html
    if marker in text:
        return html  # already embedded by hand
    try:
        snippet = snippet_file.read_text(encoding="utf-8")
    except Exception:
        return html
    needle = "</body>"
    if needle in text:
        text = text.replace(needle, snippet + "\n" + needle, 1)
    else:
        text = text + "\n" + snippet
    return text.encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass  # suppress logs

    def do_GET(self):
        if self.path == "/api/data":
            data = json.dumps(load_data()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)

        elif self.path in ("/", "/index.html"):
            try:
                html = (Path(__file__).parent / "index.html").read_bytes()
            except FileNotFoundError:
                html = b"<!doctype html><html><head><meta charset=\"utf-8\"><title>AgentLukas</title></head><body></body></html>"
            html = _inject_signal_panel(html)
            html = _inject_moltbook_panel(html)
            html = _inject_live_switch_panel(html)
            html = _inject_paper_report_panel(html)
            html = _inject_polymarket_reality_panel(html)
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(html)

        else:
            self.send_response(404)
            self.end_headers()


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Dashboard läuft auf http://0.0.0.0:{PORT}")
    server.serve_forever()


################################################################################
## SECTION: 3_BTC_TRADER
################################################################################
