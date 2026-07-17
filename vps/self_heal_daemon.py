#!/usr/bin/env python3
"""self_heal_daemon.py — long-running supervisor wrapper around self_heal.py.

Why a daemon?
  self_heal.py is a library + oneshot status reporter (no main loop).
  The brain registry checks `pgrep -f python3.*self_heal_daemon.py`,
  so we need a persistent process to satisfy the heartbeat AND
  to actually exercise the circuit-breaker / self-tune logic on a cadence.

What it does:
  - Every 60s: check circuit-breaker, write heartbeat to self_heal_daemon.json
  - Every 5min: log a SELF-HEAL status line + tune summary
  - On crash inside library calls: log + sleep + continue (never die silently)
"""
import json
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

import self_heal  # local module — exposes get_tuner(), should_circuit_break(), etc.

BASE_DIR = Path(__file__).parent
HEARTBEAT_FILE = BASE_DIR / "self_heal_daemon.json"
LOG_FILE = BASE_DIR / "self_heal.log"

TICK_SECONDS = 60
STATUS_EVERY_N_TICKS = 5  # ⇒ log full status every 5 minutes


def log(msg: str) -> None:
    line = f"[{datetime.now(timezone.utc).isoformat()}] {msg}"
    print(line, flush=True)
    try:
        with LOG_FILE.open("a") as f:
            f.write(line + "\n")
    except Exception:
        pass


def write_heartbeat(payload: dict) -> None:
    try:
        HEARTBEAT_FILE.write_text(json.dumps(payload, indent=2))
    except Exception as e:
        log(f"heartbeat write failed: {e}")


def main() -> None:
    log("self_heal_daemon starting (tick=60s, status every 5min)")
    tick = 0
    while True:
        tick += 1
        now = datetime.now(timezone.utc).isoformat()
        try:
            tripped = self_heal.should_circuit_break()
            crashes = self_heal._crash_tracker.recent_crash_count()
            tune_summary = self_heal._tuner.get_tune_summary()

            write_heartbeat({
                "ts": now,
                "tick": tick,
                "circuit_breaker_tripped": tripped,
                "recent_crashes_10min": crashes,
                "tune_summary": tune_summary,
                "alive": True,
            })

            if tick % STATUS_EVERY_N_TICKS == 0 or tick == 1:
                log(
                    f"SELF-HEAL ok | crashes(10m)={crashes} | "
                    f"circuit_breaker={'TRIPPED' if tripped else 'ok'} | "
                    f"tune={tune_summary[:120]}"
                )
                if tripped:
                    log("⚠ circuit breaker is TRIPPED — alerting via stderr")
        except Exception as e:
            log(f"tick {tick} error: {e}")
            traceback.print_exc()
            write_heartbeat({"ts": now, "tick": tick, "alive": True, "error": str(e)})
        time.sleep(TICK_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("self_heal_daemon stopped (SIGINT)")


################################################################################
## SECTION: 9_AGENT_SPY_OTHER
################################################################################
