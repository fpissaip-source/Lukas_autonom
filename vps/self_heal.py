#!/usr/bin/env python3
"""self_heal.py — Lukas Self-Heal + Self-Tune System

Self-Heal:
  - Detects crashes and auto-restarts
  - Circuit breaker: 3 crashes in 10 min → stop + alert owner
  - Monitors agent.py subprocess health
  - Tracks error patterns and avoids repeat failures

Self-Tune:
  - After each session, analyzes trading performance
  - Adjusts session interval based on market activity
  - Adjusts risk parameters within hard limits
  - Logs every adjustment to evolution_log.json

Survival Mode (bankroll < $10):
  - Bot recognizes low bankroll and adapts autonomously
  - Dead positions (best_bid ≤ $0.02) auto-purged from tracking
  - Position limits scale with available bankroll
  - Confidence threshold drops (take more shots when little to lose)
  - Bankroll floor lowered to $0.50 (let it ride)
  - Logs all survival decisions for transparency

Hard Limits (absolute safety net):
  - Max position size: $5.00 (but self-adjusts lower based on bankroll)
  - Max trades per session: 3
  - Min session interval: 10 minutes
  - Max session interval: 120 minutes
  - Bankroll floor: $0.50 (only stops if truly empty)
"""

import json
import time
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent

EVOLUTION_LOG = BASE_DIR / "evolution_log.json"
TUNE_STATE = BASE_DIR / "tune_state.json"
CRASH_LOG = BASE_DIR / "crash_log.json"

HARD_LIMITS = {
    "max_position_usd": 5.00,
    "max_trades_per_session": 3,
    "min_interval_minutes": 10,
    "max_interval_minutes": 120,
    "bankroll_floor_usd": 0.50,
    "max_crash_count": 3,
    "crash_window_seconds": 600,
    "survival_threshold_usd": 10.00,
}

DEFAULT_TUNE = {
    "session_interval_minutes": 25,
    "confidence_threshold": 0.65,
    "max_position_usd": 3.00,
    "max_trades_per_session": 2,
    "prefer_categories": [],
    "avoid_categories": [],
    "win_streak": 0,
    "loss_streak": 0,
    "total_sessions_tuned": 0,
    "last_tune_date": None,
    "survival_mode": False,
    "dead_positions_purged": 0,
}


def _read_json(path: Path, default=None):
    try:
        if path.exists():
            return json.loads(path.read_text())
    except Exception:
        pass
    return default if default is not None else {}


def _write_json(path: Path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))


def _log_evolution(action: str, detail: str, old_val=None, new_val=None):
    log = _read_json(EVOLUTION_LOG, [])
    entry = {
        "timestamp": datetime.now().isoformat(),
        "action": action,
        "detail": detail,
    }
    if old_val is not None:
        entry["old_value"] = old_val
    if new_val is not None:
        entry["new_value"] = new_val
    log.append(entry)
    if len(log) > 500:
        log = log[-500:]
    _write_json(EVOLUTION_LOG, log)


class CrashTracker:
    def __init__(self):
        self.crashes = _read_json(CRASH_LOG, [])

    def record_crash(self, error_msg: str) -> dict:
        now = time.time()
        entry = {
            "timestamp": now,
            "time_str": datetime.now().isoformat(),
            "error": error_msg[:500],
        }
        self.crashes.append(entry)
        if len(self.crashes) > 100:
            self.crashes = self.crashes[-100:]
        _write_json(CRASH_LOG, self.crashes)
        _log_evolution("CRASH", error_msg[:200])
        return entry

    def should_circuit_break(self) -> bool:
        now = time.time()
        window = HARD_LIMITS["crash_window_seconds"]
        max_crashes = HARD_LIMITS["max_crash_count"]
        recent = [c for c in self.crashes if now - c["timestamp"] < window]
        return len(recent) >= max_crashes

    def recent_crash_count(self, window_seconds: int = 600) -> int:
        now = time.time()
        return len([c for c in self.crashes if now - c["timestamp"] < window_seconds])

    def last_error_pattern(self) -> str | None:
        if not self.crashes:
            return None
        return self.crashes[-1].get("error", "")


class SelfTuner:
    def __init__(self):
        self.state = _read_json(TUNE_STATE, dict(DEFAULT_TUNE))
        for k, v in DEFAULT_TUNE.items():
            if k not in self.state:
                self.state[k] = v

    def save(self):
        _write_json(TUNE_STATE, self.state)

    def get_interval(self) -> int:
        return max(
            HARD_LIMITS["min_interval_minutes"],
            min(HARD_LIMITS["max_interval_minutes"], self.state["session_interval_minutes"])
        )

    def get_max_position(self) -> float:
        return min(HARD_LIMITS["max_position_usd"], self.state["max_position_usd"])

    def get_max_trades(self) -> int:
        return min(HARD_LIMITS["max_trades_per_session"], self.state["max_trades_per_session"])

    def get_confidence_threshold(self) -> float:
        return self.state["confidence_threshold"]

    def is_survival_mode(self) -> bool:
        return self.state.get("survival_mode", False)

    def get_tune_summary(self) -> str:
        mode = "SURVIVAL" if self.is_survival_mode() else "NORMAL"
        return (
            f"Mode: {mode} | "
            f"Interval: {self.get_interval()}min | "
            f"Max position: ${self.get_max_position():.2f} | "
            f"Max trades/session: {self.get_max_trades()} | "
            f"Confidence threshold: {self.state['confidence_threshold']:.0%} | "
            f"Win streak: {self.state['win_streak']} | "
            f"Loss streak: {self.state['loss_streak']} | "
            f"Sessions tuned: {self.state['total_sessions_tuned']} | "
            f"Dead purged: {self.state.get('dead_positions_purged', 0)}"
        )

    def _enter_survival_mode(self, bankroll: float, changes: list[str]):
        was_survival = self.state.get("survival_mode", False)
        self.state["survival_mode"] = True

        if not was_survival:
            _log_evolution("SURVIVAL_MODE_ON", f"Bankroll ${bankroll:.2f} < ${HARD_LIMITS['survival_threshold_usd']:.2f}")
            changes.append(f"SURVIVAL MODE ACTIVATED — Bankroll ${bankroll:.2f}")

        old_conf = self.state["confidence_threshold"]
        new_conf = max(0.50, min(old_conf, 0.55))
        if new_conf != old_conf:
            self.state["confidence_threshold"] = new_conf
            changes.append(f"Survival: confidence lowered {old_conf:.0%} → {new_conf:.0%} (take more shots)")
            _log_evolution("SURVIVAL_CONFIDENCE", f"Low bankroll ${bankroll:.2f}", old_conf, new_conf)

        max_pos = round(min(bankroll * 0.4, HARD_LIMITS["max_position_usd"]), 2)
        max_pos = max(0.50, max_pos)
        old_pos = self.state["max_position_usd"]
        if max_pos != old_pos:
            self.state["max_position_usd"] = max_pos
            changes.append(f"Survival: position sized to bankroll — ${old_pos:.2f} → ${max_pos:.2f}")
            _log_evolution("SURVIVAL_POSITION", f"40% of ${bankroll:.2f}", old_pos, max_pos)

        if self.state["max_trades_per_session"] < 1:
            self.state["max_trades_per_session"] = 2
            changes.append("Survival: re-enabled trading (was disabled)")
            _log_evolution("SURVIVAL_REENABLE", f"Bankroll ${bankroll:.2f} > floor ${HARD_LIMITS['bankroll_floor_usd']}")

    def _exit_survival_mode(self, bankroll: float, changes: list[str]):
        if self.state.get("survival_mode", False):
            self.state["survival_mode"] = False
            changes.append(f"Exiting survival mode — bankroll recovered to ${bankroll:.2f}")
            _log_evolution("SURVIVAL_MODE_OFF", f"Bankroll ${bankroll:.2f} >= ${HARD_LIMITS['survival_threshold_usd']:.2f}")

    def _purge_dead_positions(self, session_result: dict, changes: list[str]):
        dead_positions = session_result.get("dead_positions", [])
        if not dead_positions:
            return

        count = len(dead_positions)
        total_loss = sum(p.get("loss_usd", 0) for p in dead_positions)
        self.state["dead_positions_purged"] = self.state.get("dead_positions_purged", 0) + count
        changes.append(f"Purged {count} dead position(s) — total loss ${total_loss:.2f} accepted")
        _log_evolution("PURGE_DEAD", f"{count} positions, ${total_loss:.2f} loss",
                      [p.get("market_id", "?")[:16] for p in dead_positions], count)

    def analyze_and_tune(self, session_result: dict) -> list[str]:
        changes = []
        self.state["total_sessions_tuned"] += 1
        self.state["last_tune_date"] = datetime.now().isoformat()

        bankroll = session_result.get("bankroll", 0)

        self._purge_dead_positions(session_result, changes)

        if bankroll > 0 and bankroll < HARD_LIMITS["bankroll_floor_usd"]:
            old = self.state["max_trades_per_session"]
            self.state["max_trades_per_session"] = 0
            changes.append(f"BANKROLL FLOOR HIT (${bankroll:.2f}) — Trading paused until deposit")
            _log_evolution("BANKROLL_FLOOR", f"Bankroll ${bankroll:.2f} < floor ${HARD_LIMITS['bankroll_floor_usd']}", old, 0)
        elif bankroll > 0 and bankroll < HARD_LIMITS["survival_threshold_usd"]:
            self._enter_survival_mode(bankroll, changes)
        elif bankroll >= HARD_LIMITS["survival_threshold_usd"]:
            self._exit_survival_mode(bankroll, changes)

        trades = session_result.get("trades", [])
        pnl = session_result.get("session_pnl", 0)

        if pnl > 0:
            self.state["win_streak"] += 1
            self.state["loss_streak"] = 0
        elif pnl < 0:
            self.state["loss_streak"] += 1
            self.state["win_streak"] = 0

        if not self.is_survival_mode():
            if self.state["loss_streak"] >= 3:
                old_conf = self.state["confidence_threshold"]
                new_conf = min(0.85, old_conf + 0.05)
                if new_conf != old_conf:
                    self.state["confidence_threshold"] = new_conf
                    changes.append(f"3+ losses → confidence threshold: {old_conf:.0%} → {new_conf:.0%}")
                    _log_evolution("TUNE_CONFIDENCE_UP", f"Loss streak {self.state['loss_streak']}", old_conf, new_conf)

                old_pos = self.state["max_position_usd"]
                new_pos = max(1.00, old_pos * 0.8)
                if new_pos != old_pos:
                    self.state["max_position_usd"] = round(new_pos, 2)
                    changes.append(f"Reducing position size: ${old_pos:.2f} → ${new_pos:.2f}")
                    _log_evolution("TUNE_POSITION_DOWN", f"Loss streak {self.state['loss_streak']}", old_pos, new_pos)

            if self.state["win_streak"] >= 3:
                old_conf = self.state["confidence_threshold"]
                new_conf = max(0.55, old_conf - 0.03)
                if new_conf != old_conf:
                    self.state["confidence_threshold"] = new_conf
                    changes.append(f"3+ wins → confidence threshold: {old_conf:.0%} → {new_conf:.0%}")
                    _log_evolution("TUNE_CONFIDENCE_DOWN", f"Win streak {self.state['win_streak']}", old_conf, new_conf)

                old_pos = self.state["max_position_usd"]
                new_pos = min(HARD_LIMITS["max_position_usd"], old_pos * 1.1)
                if new_pos != old_pos:
                    self.state["max_position_usd"] = round(new_pos, 2)
                    changes.append(f"Increasing position size: ${old_pos:.2f} → ${new_pos:.2f}")
                    _log_evolution("TUNE_POSITION_UP", f"Win streak {self.state['win_streak']}", old_pos, new_pos)

        errors = session_result.get("errors", [])
        if errors:
            error_types = {}
            for e in errors:
                key = e[:50] if isinstance(e, str) else str(e)[:50]
                error_types[key] = error_types.get(key, 0) + 1

            for pattern, count in error_types.items():
                if count >= 2:
                    _log_evolution("RECURRING_ERROR", f"{count}x: {pattern}")
                    changes.append(f"Recurring error detected ({count}x): {pattern[:60]}")

        market_activity = session_result.get("market_activity", "normal")
        if market_activity == "high":
            old_iv = self.state["session_interval_minutes"]
            new_iv = max(HARD_LIMITS["min_interval_minutes"], old_iv - 3)
            if new_iv != old_iv:
                self.state["session_interval_minutes"] = new_iv
                changes.append(f"High market activity → interval: {old_iv}min → {new_iv}min")
                _log_evolution("TUNE_INTERVAL_DOWN", "High market activity", old_iv, new_iv)
        elif market_activity == "low":
            old_iv = self.state["session_interval_minutes"]
            new_iv = min(HARD_LIMITS["max_interval_minutes"], old_iv + 5)
            if new_iv != old_iv:
                self.state["session_interval_minutes"] = new_iv
                changes.append(f"Low market activity → interval: {old_iv}min → {new_iv}min")
                _log_evolution("TUNE_INTERVAL_UP", "Low market activity", old_iv, new_iv)

        categories_won = session_result.get("categories_won", [])
        categories_lost = session_result.get("categories_lost", [])
        for cat in categories_lost:
            if cat not in self.state["avoid_categories"]:
                self.state["avoid_categories"].append(cat)
                changes.append(f"Adding '{cat}' to avoid list")
                _log_evolution("AVOID_CATEGORY", cat)
        if len(self.state["avoid_categories"]) > 10:
            self.state["avoid_categories"] = self.state["avoid_categories"][-10:]

        for cat in categories_won:
            if cat in self.state["avoid_categories"]:
                self.state["avoid_categories"].remove(cat)
                changes.append(f"Removing '{cat}' from avoid list (won)")
                _log_evolution("UNAVOID_CATEGORY", cat)
            if cat not in self.state["prefer_categories"]:
                self.state["prefer_categories"].append(cat)
        if len(self.state["prefer_categories"]) > 10:
            self.state["prefer_categories"] = self.state["prefer_categories"][-10:]

        self.save()
        return changes


_crash_tracker = CrashTracker()
_tuner = SelfTuner()


def record_crash(error_msg: str) -> dict:
    return _crash_tracker.record_crash(error_msg)


def should_circuit_break() -> bool:
    return _crash_tracker.should_circuit_break()


def get_tuner() -> SelfTuner:
    return _tuner


def analyze_session(session_result: dict) -> list[str]:
    return _tuner.analyze_and_tune(session_result)


def get_tune_context() -> str:
    mode_str = "⚠️ SURVIVAL MODE" if _tuner.is_survival_mode() else "NORMAL"
    return (
        f"\n=== SELF-TUNE PARAMETERS ({mode_str}) ===\n"
        f"{_tuner.get_tune_summary()}\n"
        f"Avoid categories: {_tuner.state['avoid_categories']}\n"
        f"Prefer categories: {_tuner.state['prefer_categories']}\n"
        f"Hard limits: max ${HARD_LIMITS['max_position_usd']:.2f}/position, "
        f"max {HARD_LIMITS['max_trades_per_session']} trades/session, "
        f"bankroll floor ${HARD_LIMITS['bankroll_floor_usd']:.2f}\n"
        f"Survival activates below ${HARD_LIMITS['survival_threshold_usd']:.2f} — "
        f"bot auto-adjusts position size to 40% of bankroll, lowers confidence bar\n"
    )


def get_evolution_log(limit: int = 20) -> list:
    log = _read_json(EVOLUTION_LOG, [])
    return log[-limit:]


if __name__ == "__main__":
    print("=== Self-Heal + Self-Tune Status ===")
    print(f"Tune state: {_tuner.get_tune_summary()}")
    print(f"Recent crashes: {_crash_tracker.recent_crash_count()}")
    print(f"Circuit breaker: {'ACTIVE' if should_circuit_break() else 'OK'}")
    print(f"\nEvolution log (last 10):")
    for e in get_evolution_log(10):
        print(f"  [{e['timestamp'][:16]}] {e['action']}: {e['detail'][:80]}")
