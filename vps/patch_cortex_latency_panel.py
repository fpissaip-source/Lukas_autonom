#!/usr/bin/env python3
"""
patch_cortex_latency_panel.py — exposes Task #65 speedup status
(latency histogram, CLOB-meta cache stats, ws orderbook status) on the
CORTEX dashboard so we can verify the sub-400ms target visually.

Adds three things to /root/Agent-spy/cortex/main.py (or whatever file
defines /api/state):
    1. import bot.trading._speedup at module top
    2. injection of {"speedup": _speedup.status()} into /api/state JSON
    3. (optional) a lightweight HTML panel rendered in the dashboard
       template if a template file is present.

Idempotent — re-running is safe.
"""
from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

CANDIDATE_DASHBOARDS = [
    Path("/root/Agent-spy/dashboard/server.py"),
    Path("/root/Agent-spy/cortex/main.py"),
    Path("/root/Agent-spy/cortex/server.py"),
    Path("/root/Agent-spy/cortex/app.py"),
    Path("/root/Agent-spy/cortex/dashboard.py"),
    Path("/root/Agent-spy/Polymarket_bot/bot/dashboard/server.py"),
]

SENT_IMPORT = "# PATCH-65-DASH-IMPORT-V1"
SENT_INJECT = "# PATCH-65-DASH-INJECT-V1"


def find_dashboard() -> Path | None:
    for p in CANDIDATE_DASHBOARDS:
        if p.exists():
            return p
    # fall back: search cortex/ for a file with "/api/state"
    cortex_dir = Path("/root/Agent-spy/cortex")
    if cortex_dir.exists():
        for p in cortex_dir.rglob("*.py"):
            try:
                if "/api/state" in p.read_text():
                    return p
            except Exception:
                continue
    return None


def patch_dashboard(p: Path) -> int:
    src = p.read_text()
    orig = src
    changes: list[str] = []

    # 1) import
    if SENT_IMPORT not in src:
        # Insert near the top, after the first import block.
        m = re.search(r"^(import [^\n]+|from [^\n]+ import [^\n]+)\n", src, flags=re.M)
        if m:
            insert_at = m.end()
            src = src[:insert_at] + (
                "try:\n"
                "    from bot.trading import _speedup as _bot_speedup  "
                f"{SENT_IMPORT}\n"
                "except Exception:\n"
                "    _bot_speedup = None\n"
            ) + src[insert_at:]
            changes.append("import")

    # 2) inject into /api/state response.  We patch the function that
    # builds the state dict by inserting a try/except just before its
    # `return jsonify(...)` / `return ...` of a dict literal containing
    # `polymarket` (the existing key for the bot panel).
    if SENT_INJECT not in src:
        # Look for the pattern: "polymarket": ...  inside a dict that gets
        # returned.  We add a sibling key "speedup".
        # Strategy: find    "polymarket":    occurrences and inject
        # "speedup": ... directly after the polymarket value's terminating
        # comma — but value spans are complex, so we instead append a
        # post-build mutation in any function returning a dict that
        # contains "polymarket".
        injected = False
        # Find function definitions that contain "polymarket" within a
        # ~60-line window.
        for fn_match in re.finditer(r"^def\s+(\w+)\s*\([^)]*\)\s*:\s*\n", src, flags=re.M):
            fn_name = fn_match.group(1)
            fn_start = fn_match.end()
            # End of function = next top-level def/class or EOF.
            tail = re.search(r"\n(def |class |@app\.route)", src[fn_start:])
            fn_end = fn_start + tail.start() if tail else len(src)
            body = src[fn_start:fn_end]
            if '"polymarket"' not in body and "'polymarket'" not in body:
                continue
            # Find the last `return` in this function.
            last_return = None
            for r in re.finditer(r"^(    )return\s+([^\n]+)", body, flags=re.M):
                last_return = r
            if not last_return:
                continue
            # Wrap: insert lines BEFORE the return to enrich a `state` var.
            ret_full = last_return.group(0)
            ret_expr = last_return.group(2)
            # Heuristic: build pre-return enrichment that calls jsonify(...)
            # only if the existing return uses jsonify; otherwise return dict.
            uses_jsonify = ret_expr.strip().startswith("jsonify(")
            new_block = (
                "    try:\n"
                "        _sp = _bot_speedup.status() if _bot_speedup else None\n"
                f"    except Exception:  {SENT_INJECT}\n"
                "        _sp = None\n"
                "    try:\n"
                f"        _payload = {ret_expr.strip()}\n"
                "        # If jsonify wrapping a dict literal, unwrap once for mutation.\n"
                "        import flask as _flask\n"
                "        if isinstance(_payload, _flask.Response):\n"
                "            import json as _json\n"
                "            _data = _json.loads(_payload.get_data(as_text=True))\n"
                "            if isinstance(_data, dict) and _sp is not None:\n"
                "                _data['speedup'] = _sp\n"
                "            return _flask.jsonify(_data)\n"
                "        if isinstance(_payload, dict) and _sp is not None:\n"
                "            _payload['speedup'] = _sp\n"
                "        return _payload\n"
                "    except Exception:\n"
                f"        return {ret_expr.strip()}\n"
            )
            new_body = body[:last_return.start()] + new_block
            src = src[:fn_start] + new_body + src[fn_end:]
            injected = True
            changes.append(f"inject:{fn_name}")
            break
        if not injected:
            print("WARN: could not locate state-building function to inject speedup payload")

    if src == orig:
        print(f"{p}: already patched, nothing to do")
        return 0
    backup = p.with_suffix(p.suffix + ".bak-task65-dash")
    if not backup.exists():
        shutil.copy2(p, backup)
        print(f"Backed up to {backup}")
    p.write_text(src)
    print(f"Patched {p}: {', '.join(changes)}")
    return 0


def main() -> int:
    p = find_dashboard()
    if p is None:
        print("FATAL: could not locate cortex dashboard module")
        return 2
    print(f"Target: {p}")
    return patch_dashboard(p)


if __name__ == "__main__":
    sys.exit(main())
