#!/usr/bin/env python3
"""
patch_cortex_reality_panel.py — wires the Polymarket Reality panel into the
bot's CORTEX dashboard at /root/Agent-spy/Polymarket_bot/bot/dashboard/server.py.

Two idempotent surgical edits:
  1. Inject a `_load_polymarket_reality()` helper + add its result to the
     `/api/state` response under key "polymarket_reality".
  2. Inject the panel HTML/JS into HTML_PAGE just before </body>.

The panel polls /api/state (the existing endpoint, no new route needed) and
renders on-chain balance, drift, open positions cost-vs-value, realized PnL
last 24h/1h, and a force-close timeline.

Run with `python3 patch_cortex_reality_panel.py` on the VPS. Re-running is a
no-op once both markers are present. Backup is created on first apply.
"""
from __future__ import annotations

import re
import shutil
import sys
import time
from pathlib import Path

DASH_FILE = Path("/root/Agent-spy/Polymarket_bot/bot/dashboard/server.py")
PANEL_HTML_FILE = Path("/root/Agent-spy/Polymarket_bot/bot/dashboard/dashboard_polymarket_reality_panel.html")

MARKER_LOADER = "# REALITY_TASK_64_PANEL: loader"
MARKER_STATE  = "# REALITY_TASK_64_PANEL: state_inject"
MARKER_HTML   = "REALITY_TASK_64_PANEL_HTML_MARKER"  # appears in injected HTML

# The HTML/JS we inject into HTML_PAGE. We avoid Python f-strings so the literal
# `{...}` braces in CSS/JS pass through untouched. The panel polls /api/state
# (CORTEX existing endpoint) and reads `state.polymarket_reality`.
PANEL_HTML = r"""
<!-- REALITY_TASK_64_PANEL_HTML_MARKER  Polymarket Reality (Task #64) -->
<style>
  #pr64 {
    margin: 24px auto;
    max-width: 1200px;
    background: rgba(8, 14, 28, 0.92);
    border: 1px solid #1d2940;
    border-radius: 14px;
    padding: 18px 22px;
    color: #d8e2f3;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    box-shadow: 0 6px 24px rgba(0,0,0,0.4);
  }
  #pr64 h2 { margin: 0 0 4px 0; font-size: 17px; color: #f4d35e; letter-spacing: 0.5px; }
  #pr64 .pr-sub { color: #6b7d99; font-size: 12px; margin-bottom: 16px; }
  #pr64 .pr-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-bottom: 16px; }
  #pr64 .pr-stat { background: #0c1730; border: 1px solid #1d2940; border-radius: 10px; padding: 10px 12px; }
  #pr64 .pr-stat .pr-label { font-size: 10px; color: #6b7d99; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  #pr64 .pr-stat .pr-value { font-size: 18px; font-weight: 600; color: #fff; }
  #pr64 .pr-stat.warn .pr-value { color: #ffb86c; }
  #pr64 .pr-stat.bad  .pr-value { color: #ff6b8a; }
  #pr64 .pr-stat.good .pr-value { color: #79e2a3; }
  #pr64 .pr-section-title { color: #9bb2d3; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin: 14px 0 6px 0; }
  #pr64 table { width: 100%; border-collapse: collapse; font-size: 12px; }
  #pr64 th, #pr64 td { padding: 5px 8px; text-align: left; border-bottom: 1px solid #1d2940; }
  #pr64 th { color: #6b7d99; font-weight: 500; text-transform: uppercase; font-size: 10px; }
  #pr64 td.num { text-align: right; font-variant-numeric: tabular-nums; }
  #pr64 .pr-pos { color: #79e2a3; }
  #pr64 .pr-neg { color: #ff6b8a; }
  #pr64 .pr-event { display: flex; gap: 10px; padding: 5px 8px; border-bottom: 1px solid #1d2940; font-size: 12px; }
  #pr64 .pr-event .pr-kind { font-weight: 600; min-width: 130px; }
  #pr64 .pr-kind-STOP_LOSS, #pr64 .pr-kind-CATASTROPHIC_SL, #pr64 .pr-kind-FORCE_PURGE,
  #pr64 .pr-kind-ACCEPT_FULL_LOSS, #pr64 .pr-kind-DRIFT_WARN { color: #ff6b8a; }
  #pr64 .pr-kind-TAKE_PROFIT, #pr64 .pr-kind-PRE_EXPIRY { color: #79e2a3; }
  #pr64 .pr-kind-MAX_HOLD { color: #ffb86c; }
  #pr64 .pr-empty { color: #6b7d99; font-style: italic; padding: 10px 0; }
  #pr64 .pr-stale { color: #ff6b8a; font-weight: 600; }
</style>
<div id="pr64">
  <h2>🔴 Polymarket Reality</h2>
  <div class="pr-sub" id="pr64-sub">Lädt…</div>
  <div class="pr-grid" id="pr64-grid"></div>
  <div class="pr-section-title">Offene Positionen</div>
  <div id="pr64-positions"><div class="pr-empty">—</div></div>
  <div class="pr-section-title">Force-Close Timeline (letzte 20)</div>
  <div id="pr64-events"><div class="pr-empty">—</div></div>
</div>
<script>
(function() {
  function $(id) { return document.getElementById(id); }
  function fmtUsd(v) { if (v==null||isNaN(v)) return "—"; var n=Number(v); return (n<0?"-":"")+"$"+Math.abs(n).toFixed(2); }
  function fmtAge(ts) { if(!ts) return "—"; var a=Math.floor(Date.now()/1000)-Number(ts);
    if(a<0) return "in Zukunft"; if(a<60) return a+"s"; if(a<3600) return Math.floor(a/60)+"m";
    if(a<86400) return Math.floor(a/3600)+"h"; return Math.floor(a/86400)+"d"; }
  function pnlCls(v) { return (v==null||isNaN(v))?"":(Number(v)>=0?"pr-pos":"pr-neg"); }
  function statHtml(label, value, cls) {
    return '<div class="pr-stat'+(cls?' '+cls:'')+'"><div class="pr-label">'+label+
      '</div><div class="pr-value">'+value+'</div></div>';
  }
  function render(r) {
    if (!r || !r.ts) {
      $("pr64-sub").innerHTML = '<span class="pr-stale">'+(r&&r.error?r.error:'Bot-Reality unbekannt — reality.json fehlt.')+'</span>';
      $("pr64-grid").innerHTML = ""; $("pr64-positions").innerHTML='<div class="pr-empty">—</div>';
      $("pr64-events").innerHTML='<div class="pr-empty">—</div>'; return;
    }
    var stale = (Math.floor(Date.now()/1000) - Number(r.ts||0)) > 180;
    $("pr64-sub").innerHTML = "Letzte Sync: "+fmtAge(r.ts)+" her"+(stale?' <span class="pr-stale">(stale!)</span>':"");
    var g = "";
    g += statHtml("On-Chain USDC", fmtUsd(r.on_chain_balance));
    g += statHtml("Internal Bankroll", fmtUsd(r.internal_bankroll));
    g += statHtml("Drift (intern - chain)", fmtUsd(r.drift_usd), r.drift_warn?"warn":"");
    g += statHtml("Offene Positionen", r.open_positions_count||0);
    g += statHtml("Cost Basis offen", fmtUsd(r.open_positions_cost_basis));
    g += statHtml("Marktwert offen", fmtUsd(r.open_positions_value),
      Number(r.open_positions_unrealized||0) < 0 ? "bad" : "good");
    g += statHtml("Realized 24h", fmtUsd(r.realized_pnl_24h_usd)+" ("+(r.realized_trades_24h||0)+")",
      Number(r.realized_pnl_24h_usd||0) >= 0 ? "good" : "bad");
    g += statHtml("Realized 1h", fmtUsd(r.realized_pnl_1h_usd)+" ("+(r.realized_trades_1h||0)+")",
      Number(r.realized_pnl_1h_usd||0) >= 0 ? "good" : "bad");
    $("pr64-grid").innerHTML = g;
    var positions = r.positions || [];
    if (positions.length === 0) {
      $("pr64-positions").innerHTML = '<div class="pr-empty">Keine offenen Positionen.</div>';
    } else {
      var rows = positions.map(function(p) {
        var upnl = Number(p.unrealized_pnl||0);
        return '<tr>'+
          '<td>'+(p.market_id||"—").substring(0,46)+'</td>'+
          '<td>'+(p.side||"BUY")+'</td>'+
          '<td class="num">'+(p.shares||0).toFixed(2)+'</td>'+
          '<td class="num">'+(p.entry_price||0).toFixed(3)+'</td>'+
          '<td class="num">'+(p.current_price||0).toFixed(3)+'</td>'+
          '<td class="num">'+fmtUsd(p.cost_basis)+'</td>'+
          '<td class="num">'+fmtUsd(p.current_value)+'</td>'+
          '<td class="num '+pnlCls(upnl)+'">'+fmtUsd(upnl)+'</td></tr>';
      }).join("");
      $("pr64-positions").innerHTML = '<table><thead><tr>'+
        '<th>Market</th><th>Side</th><th>Shares</th><th>Entry</th><th>Now</th>'+
        '<th>Cost</th><th>Value</th><th>UPnL</th></tr></thead><tbody>'+rows+'</tbody></table>';
    }
    var ev = r.recent_events || [];
    if (ev.length === 0) {
      $("pr64-events").innerHTML = '<div class="pr-empty">Keine Force-Close Events bisher.</div>';
    } else {
      $("pr64-events").innerHTML = ev.map(function(e) {
        var k = e.kind||"UNKNOWN", det = e.details||{};
        var pnl = det.pnl_usd, badge = (pnl!=null) ? ' <span class="'+pnlCls(pnl)+'">'+fmtUsd(pnl)+'</span>' : "";
        return '<div class="pr-event"><span class="pr-kind pr-kind-'+k+'">'+k+'</span>'+
          '<span style="min-width:60px;color:#6b7d99">'+fmtAge(e.ts)+'</span>'+
          '<span style="flex:1;color:#9bb2d3">'+(e.market_id||"").substring(0,40)+'</span>'+
          '<span>'+badge+'</span></div>';
      }).join("");
    }
  }
  async function poll() {
    try {
      var r = await fetch("/api/state", {cache:"no-store"});
      var d = await r.json();
      render(d.polymarket_reality || null);
    } catch(e) {
      $("pr64-sub").innerHTML = '<span class="pr-stale">/api/state fehlgeschlagen: '+(e&&e.message||e)+'</span>';
    }
  }
  poll();
  setInterval(poll, 5000);
})();
</script>
"""

LOADER_BLOCK = '''
# ---------------------------------------------------------------------------
# Polymarket Reality bridge (Task #64 — written by trading/reality.py)
# ---------------------------------------------------------------------------
REALITY_FILE = BOT_ROOT / "reality.json"


def _load_polymarket_reality() -> dict:  # ''' + MARKER_LOADER + '''
    """Read reality.json and overlay a freshness flag for the dashboard."""
    if not REALITY_FILE.exists():
        return {"status": "down", "error": "reality.json not found yet."}
    try:
        snap = json.loads(REALITY_FILE.read_text())
        if not isinstance(snap, dict):
            return {"status": "down", "error": "reality.json malformed"}
    except Exception as e:
        return {"status": "down", "error": f"reality.json unreadable: {e}"}
    try:
        snap["file_age_seconds"] = int(time.time() - REALITY_FILE.stat().st_mtime)
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

'''


def _backup(path: Path) -> Path:
    bak = path.with_suffix(path.suffix + f".bak.cortex_{int(time.time())}")
    shutil.copy2(path, bak)
    return bak


def patch(text: str) -> tuple[str, list[str]]:
    notes: list[str] = []

    # 1) Loader function — insert just before `class DashboardHandler`
    if MARKER_LOADER not in text:
        anchor = "class DashboardHandler(BaseHTTPRequestHandler):"
        if anchor not in text:
            notes.append("WARN: cannot find DashboardHandler class — skipping loader")
        else:
            text = text.replace(anchor, LOADER_BLOCK + anchor, 1)
            notes.append("OK: _load_polymarket_reality loader inserted")
    else:
        notes.append("SKIP: loader marker present")

    # 2) State injection in /api/state branch
    if MARKER_STATE not in text:
        # exact 2-line pattern from the file
        old = ("            state = get_dashboard_state()\n"
               "            data = json.dumps(state).encode()")
        new = ("            state = get_dashboard_state()\n"
               "            try:\n"
               "                state[\"polymarket_reality\"] = _load_polymarket_reality()\n"
               "            except Exception:\n"
               "                state[\"polymarket_reality\"] = {\"status\": \"down\", \"error\": \"loader failed\"}\n"
               "            # " + MARKER_STATE + "\n"
               "            data = json.dumps(state).encode()")
        if old not in text:
            notes.append("WARN: cannot find /api/state assignment — skipping state inject")
        else:
            text = text.replace(old, new, 1)
            notes.append("OK: state inject added")
    else:
        notes.append("SKIP: state marker present")

    # 3) Inject panel HTML/JS before </body> in HTML_PAGE
    if MARKER_HTML not in text:
        anchor = "</script>\n</body>\n</html>\"\"\""
        if anchor not in text:
            notes.append("WARN: cannot find </body></html> end-of-template — skipping HTML inject")
        else:
            text = text.replace(anchor,
                                "</script>\n" + PANEL_HTML + "\n</body>\n</html>\"\"\"", 1)
            notes.append("OK: panel HTML injected before </body>")
    else:
        notes.append("SKIP: HTML marker present")

    return text, notes


def main() -> int:
    if not DASH_FILE.exists():
        print(f"ERROR: {DASH_FILE} not found")
        return 1
    original = DASH_FILE.read_text()
    patched, notes = patch(original)
    print("=== patch report ===")
    for n in notes:
        print(" ", n)
    if patched == original:
        print("=== no changes — already fully patched ===")
        return 0
    bak = _backup(DASH_FILE)
    print(f"=== backup: {bak} ===")
    DASH_FILE.write_text(patched)
    print(f"=== wrote {DASH_FILE} ({len(patched)} bytes) ===")

    import py_compile
    try:
        py_compile.compile(str(DASH_FILE), doraise=True)
        print("=== syntax OK ===")
    except py_compile.PyCompileError as e:
        print(f"!!! SYNTAX ERROR — rolling back !!!\n{e}")
        shutil.copy2(bak, DASH_FILE)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
