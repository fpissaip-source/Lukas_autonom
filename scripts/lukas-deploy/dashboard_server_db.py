"""
Polymarket Bot – Live Dashboard Server (v3 — Postgres-backed)
=============================================================
Erreichbar per Browser (Safari / Chrome):  http://<SERVER-IP>:5002

v3 changes:
  • Trades and bankroll history sourced from PostgreSQL (trades + bankroll_history tables)
  • Falls back to JSON files if the database is unavailable
  • load_trades()    → queries trades table, falls back to trades.json
  • load_positions() → queries open trades from DB, falls back to live_positions.json
  • load_bankroll()  → queries latest bankroll_history row, falls back to bankroll_state.json
  • /api/db_status   endpoint reports database connectivity
"""

import json
import os
import sys
import time
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

try:  # TASK_65: speedup status (latency / meta-cache / ws-orderbook)
    from trading import _speedup as _bot_speedup_t65
except Exception:
    _bot_speedup_t65 = None

DASHBOARD_DIR = Path(__file__).parent
BOT_ROOT = DASHBOARD_DIR.parent
STATE_FILE   = BOT_ROOT / "bankroll_state.json"
LOG_FILE     = BOT_ROOT / "bot.log"
TRADES_FILE  = BOT_ROOT / "trades.json"
POSITIONS_FILE = BOT_ROOT / "live_positions.json"
GEMINI_FILE  = BOT_ROOT / "gemini_decisions.json"
REGIME_FILE  = BOT_ROOT / "regime_state.json"

PORT = 5002

# ---------------------------------------------------------------------------
# Database helper (wraps db.py from the Agent-spy root)
# ---------------------------------------------------------------------------

_db_available: bool = False
_db_last_error: str = ""

def _load_db():
    """Import and return the db module from the Agent-spy root, or None."""
    agent_spy_root = str(Path(__file__).parent.parent.parent.parent)  # /root/Agent-spy
    if agent_spy_root not in sys.path:
        sys.path.insert(0, agent_spy_root)
    try:
        import db as _db
        return _db
    except Exception:
        return None


def _db_query(sql: str, params: tuple = ()) -> list:
    """Run a query via db.py's query() function. Returns [] on failure."""
    global _db_available, _db_last_error
    try:
        _db = _load_db()
        if _db is None:
            _db_last_error = "db module not importable"
            _db_available = False
            return []
        rows = _db.query(sql, params)
        _db_available = True
        _db_last_error = ""
        return [dict(r) for r in (rows or [])]
    except Exception as e:
        _db_available = False
        _db_last_error = str(e)
        return []


# ---------------------------------------------------------------------------
# Live CLOB balance cache (updated every 30s in background thread)
# ---------------------------------------------------------------------------
_live_balance: float = 0.0
_live_balance_lock = threading.Lock()
_live_balance_ts: float = 0.0


def _update_live_balance():
    """Background thread: fetch real CLOB balance every 30 seconds."""
    global _live_balance, _live_balance_ts
    bot_root_str = str(BOT_ROOT)
    if bot_root_str not in sys.path:
        sys.path.insert(0, bot_root_str)
    while True:
        try:
            from trading.order_executor import fetch_live_balance_usd
            bal = fetch_live_balance_usd()
            if bal > 0:
                with _live_balance_lock:
                    _live_balance = bal
                    _live_balance_ts = time.time()
        except Exception:
            pass
        time.sleep(30)


_balance_thread = threading.Thread(target=_update_live_balance, daemon=True, name="live-balance")
_balance_thread.start()


# ---------------------------------------------------------------------------
# State helpers — DB-first, JSON fallback
# ---------------------------------------------------------------------------

def _safe_read(path: Path, default):
    try:
        if path.exists():
            return json.loads(path.read_text())
    except Exception:
        pass
    return default


def load_bankroll() -> float:
    """Return live CLOB balance if fresh, else latest DB snapshot, else JSON."""
    with _live_balance_lock:
        bal = _live_balance
        ts = _live_balance_ts
    if bal > 0 and (time.time() - ts) < 90:
        return bal

    rows = _db_query(
        "SELECT balance FROM bankroll_history ORDER BY recorded_at DESC LIMIT 1"
    )
    if rows:
        try:
            return float(rows[0]["balance"])
        except Exception:
            pass

    data = _safe_read(STATE_FILE, {})
    return float(data.get("bankroll", 0.0))


def load_trades() -> list:
    """Return closed trades from DB (pnl != NULL), or fall back to trades.json."""
    rows = _db_query(
        """SELECT market_slug   AS market,
                  market_question AS question,
                  side,
                  stake::float   AS size,
                  entry_price::float AS entry_price,
                  exit_price::float  AS exit_price,
                  pnl::float    AS pnl,
                  status,
                  opened_at,
                  closed_at
           FROM trades
           WHERE pnl IS NOT NULL
           ORDER BY closed_at DESC NULLS LAST
           LIMIT 200"""
    )
    if rows:
        result = []
        for r in rows:
            result.append({
                "market":      (r.get("market") or "")[:40],
                "question":    (r.get("question") or "")[:80],
                "side":        r.get("side", "?"),
                "size":        round(float(r.get("size") or 0), 2),
                "entry_price": round(float(r.get("entry_price") or 0), 4),
                "exit_price":  round(float(r.get("exit_price") or 0), 4),
                "pnl":         round(float(r.get("pnl") or 0), 4),
                "status":      r.get("status", ""),
                "opened_at":   str(r.get("opened_at") or ""),
                "closed_at":   str(r.get("closed_at") or ""),
            })
        return result
    return _safe_read(TRADES_FILE, [])


def load_positions() -> list:
    """Return open positions from DB (status='open'), or fall back to JSON."""
    rows = _db_query(
        """SELECT market_slug   AS market_id,
                  market_question AS question,
                  side,
                  stake::float   AS size,
                  entry_price::float AS entry_price,
                  opened_at
           FROM trades
           WHERE status = 'open'
           ORDER BY opened_at DESC"""
    )
    if rows:
        result = []
        for r in rows:
            result.append({
                "market_id":   (r.get("market_id") or "?")[:40],
                "question":    (r.get("question") or "")[:60],
                "side":        r.get("side", "?"),
                "size":        round(float(r.get("size") or 0), 2),
                "exec_price":  round(float(r.get("entry_price") or 0), 4),
                "entry_price": round(float(r.get("entry_price") or 0), 4),
                "end_time":    0,
            })
        return result

    raw = _safe_read(POSITIONS_FILE, {})
    if isinstance(raw, dict):
        return list(raw.values())
    return raw


def load_bankroll_history(limit: int = 200) -> list:
    """Return recent bankroll snapshots from DB."""
    rows = _db_query(
        """SELECT bot, balance::float, pnl::float, open_pos::float, recorded_at
           FROM bankroll_history
           ORDER BY recorded_at DESC
           LIMIT %s""",
        (limit,),
    )
    return rows


def load_gemini_decisions() -> list:
    data = _safe_read(GEMINI_FILE, [])
    return list(reversed(data[-60:]))


def load_regime() -> dict:
    return _safe_read(REGIME_FILE, {})


SHARPE_FILE  = BOT_ROOT / "sharpe_state.json"
CLUSTER_FILE = BOT_ROOT / "alpha_cluster_state.json"


def load_sharpe() -> dict:
    return _safe_read(SHARPE_FILE, {})


def load_clusters() -> dict:
    return _safe_read(CLUSTER_FILE, {})


def load_recent_logs(n: int = 80) -> list:
    try:
        if not LOG_FILE.exists():
            return ["Keine Log-Datei gefunden. Starte den Bot: python3 main.py"]
        lines = LOG_FILE.read_text(errors="replace").splitlines()
        return lines[-n:]
    except Exception:
        return []


def get_dashboard_state() -> dict:
    bankroll  = load_bankroll()
    trades    = load_trades()
    positions = load_positions()
    gemini    = load_gemini_decisions()
    regime    = load_regime()
    logs      = load_recent_logs(80)

    committed = sum(float(p.get("size") or p.get("entry_size") or 0) for p in positions)
    total_portfolio = bankroll + committed

    total_trades = len(trades)
    wins   = [t for t in trades if t.get("pnl", 0) > 0]
    losses = [t for t in trades if t.get("pnl", 0) < 0]
    total_pnl   = sum(t.get("pnl", 0) for t in trades)
    win_rate    = len(wins) / total_trades * 100 if total_trades else 0.0
    biggest_win  = max((t.get("pnl", 0) for t in trades), default=0)
    biggest_loss = min((t.get("pnl", 0) for t in trades), default=0)

    recent = trades[:20]  # already sorted newest-first from DB
    equity_curve = []
    running = bankroll - total_pnl
    for t in reversed(recent):
        running += t.get("pnl", 0)
        equity_curve.append(round(running, 4))

    active_positions = []
    now = time.time()
    for pos in positions:
        end_t = pos.get("end_time", 0)
        remaining = max(0, end_t - now) if end_t > 0 else 0
        active_positions.append({
            "market":  (pos.get("market_id") or pos.get("market") or "?")[:40],
            "question": (pos.get("question") or "")[:60],
            "side":    pos.get("side", "?"),
            "size":    round(float(pos.get("size", 0)), 2),
            "entry":   round(float(pos.get("exec_price") or pos.get("entry_price") or 0), 4),
            "remaining_min": round(remaining / 60, 1) if remaining > 0 else None,
        })

    regimes = regime.get("regimes", {})
    gas_info = regime.get("gas", {})
    tick     = regime.get("tick", 0)

    sharpe_data = load_sharpe()
    sharpe_ratio = 0.0
    sharpe_class = "NO_DATA"
    max_drawdown = 0.0
    if sharpe_data:
        pnl_history = sharpe_data.get("pnl_history", [])
        if len(pnl_history) >= 2:
            mean_pnl = sum(pnl_history) / len(pnl_history)
            var_pnl = sum((p - mean_pnl) ** 2 for p in pnl_history) / len(pnl_history)
            std_pnl = var_pnl ** 0.5
            sharpe_ratio = round(mean_pnl / std_pnl, 3) if std_pnl > 1e-8 else 0.0
        if sharpe_ratio >= 2.0:
            sharpe_class = "EXCELLENT"
        elif sharpe_ratio >= 1.0:
            sharpe_class = "SOLID"
        else:
            sharpe_class = "UNSTABLE"
        peak = sharpe_data.get("peak_capital", 0)
        current = sharpe_data.get("current_capital", 0)
        if peak > 0:
            max_drawdown = round((peak - current) / peak * 100, 1)

    cluster_data = load_clusters()
    cluster_summary = []
    for cid, c in cluster_data.items():
        n = c.get("total_trades", 0)
        if n > 0:
            wr = c.get("wins", 0) / n if n > 0 else 0
            cluster_summary.append({
                "cluster": cid,
                "trades": n,
                "win_rate": round(wr * 100, 1),
                "pnl": round(c.get("total_pnl", 0), 4),
            })
    cluster_summary.sort(key=lambda x: x.get("pnl", 0), reverse=True)

    return {
        "bankroll":    round(bankroll, 2),
        "free_cash":   round(bankroll, 2),
        "committed":   round(committed, 2),
        "total_portfolio": round(total_portfolio, 2),
        "balance_fresh": (time.time() - _live_balance_ts) < 90 and _live_balance > 0,
        "total_trades": total_trades,
        "wins":        len(wins),
        "losses":      len(losses),
        "win_rate":    round(win_rate, 1),
        "total_pnl":   round(total_pnl, 4),
        "biggest_win": round(biggest_win, 4),
        "biggest_loss": round(biggest_loss, 4),
        "recent_trades": recent,
        "equity_curve": equity_curve,
        "active_positions": active_positions,
        "gemini_decisions": gemini,
        "regimes":   regimes,
        "gas_info":  gas_info,
        "tick":      tick,
        "logs":      logs,
        "timestamp": time.strftime("%H:%M:%S"),
        "sharpe_ratio": sharpe_ratio,
        "sharpe_class": sharpe_class,
        "max_drawdown": max_drawdown,
        "alpha_clusters": cluster_summary[:10],
        "db_available": _db_available,
        "db_error": _db_last_error,
        "data_source": "postgres" if _db_available else "json_files",
    }


# ---------------------------------------------------------------------------
# HTTP handler — serves dashboard HTML + /status JSON + /api/db_status
# ---------------------------------------------------------------------------

REALITY_FILE = BOT_ROOT / "reality.json"


def _get_reality():
    """Read reality.json and overlay a freshness flag for the dashboard."""
    try:
        if not REALITY_FILE.exists():
            return {"status": "down", "error": "reality.json not found yet."}
        snap = json.loads(REALITY_FILE.read_text())
        if not isinstance(snap, dict):
            return {"status": "down", "error": "reality.json malformed"}
        return snap
    except Exception as e:
        return {"status": "down", "error": f"reality.json unreadable: {e}"}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/status", "/status/"):
            state = get_dashboard_state()
            data = json.dumps(state, default=str).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(data)
        elif self.path in ("/api/db_status",):
            payload = {
                "available": _db_available,
                "error": _db_last_error,
                "source": "postgres" if _db_available else "json_files",
            }
            data = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
        elif self.path in ("/api/reality", "/api/reality/"):
            data = json.dumps(_get_reality(), default=str).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
        elif self.path in ("/", "/index.html"):
            html_path = DASHBOARD_DIR / "index.html"
            if html_path.exists():
                html = html_path.read_bytes()
            else:
                html = b"<h1>Dashboard</h1><p>index.html not found</p>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(html)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    print(f"[Dashboard v3] Starting on :{PORT} (DB-backed with JSON fallback)")
    httpd = HTTPServer(("0.0.0.0", PORT), Handler)
    httpd.serve_forever()
