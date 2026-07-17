#!/usr/bin/env python3
"""
lukas_brain.py — Lukas Central Intelligence
=============================================
Das Hirn. Überwacht und orchestriert alle Bots:
  - Polymarket Trading Bot (loop.py)
  - BTC 15min Trader (btc_15m_trader.py)
  - Self-Heal / Survival Mode (self_heal.py)
  - VPN Status
  - Telegram Bot

Schreibt Status nach lukas_status.json für API-Abfragen.
Startet abgestürzte Bots automatisch neu.

STARFISH-INSPIRED BEHAVIORAL ANALYSIS:
- Detects authentication gaps (63% zero-auth pattern)
- Maps agent interaction networks
- Identifies substrate vulnerabilities
- Tracks incentive alignment patterns
"""

import os
import json
import time
import subprocess
from datetime import datetime
from pathlib import Path
from collections import defaultdict

BASE_DIR = Path(__file__).parent
STATUS_FILE = BASE_DIR / "lukas_status.json"
LOG_FILE = BASE_DIR / "lukas_brain.log"

MANAGED_SERVICES = {
    "btc_trader": {
        "systemd": "lukas-btc-trader",
        "description": "BTC 15min Autonomous Trader",
        "state_file": "btc_trader_state.json",
        "cash_file": "btc_trader_cash.json",
        "log_file": "btc_trader.log",
        "critical": True,
    },
    "polymarket_bot": {
        "process": "loop.py",
        "description": "Polymarket Trading Bot (Kelly-Criterion)",
        "state_file": "bridge.json",
        "log_file": "loop.log",
        "critical": True,
    },
    "self_heal": {
        "process": "self_heal_daemon.py",
        "description": "Self-Heal & Survival Mode",
        "log_file": "self_heal.log",
        "critical": False,
        "auto_restart": True,
    },
    "telegram_bot": {
        "process": "telegram_bot.py",
        "description": "Telegram Command Interface",
        "critical": False,
        "auto_restart": False,
    },
    "vpn": {
        "systemd": "lukas-vpn",
        "description": "VPN (Switzerland)",
        "check_cmd": "ip link show tun0 > /dev/null 2>&1",
        "critical": True,
    },
    "reddit_watcher": {
        "systemd": "lukas-reddit-watcher",
        "description": "Reddit r/polymarket_bets Watcher (Gemini)",
        "log_file": "reddit_watcher.log",
        "critical": False,
    },

}

ALERT_COOLDOWN = {}
ALERT_COOLDOWN_SECS = 3600

# STARFISH BEHAVIORAL ANALYSIS
PATTERN_LOG = []
AGENT_INTERACTIONS = defaultdict(list)

def detect_auth_gaps():
    """Starfish-inspired: find systems with weak authentication"""
    gaps = []
    try:
        # Check for common auth vulnerabilities
        result = subprocess.run(['ss', '-tulpn'], capture_output=True, text=True, timeout=5)
        open_ports = result.stdout
        
        # Look for services without proper auth (like Starfish's 63% finding)
        if ':8080' in open_ports and 'auth' not in open_ports.lower():
            gaps.append('http_no_auth')
        if ':3000' in open_ports:
            gaps.append('dev_exposed') 
        if ':22' in open_ports and 'root' in subprocess.getoutput('who'):
            gaps.append('ssh_root')
            
        return len(gaps) / max(len(open_ports.split('\n')), 1) * 100
    except:
        return 0.0

def track_agent_interaction(agent, interaction_type, confidence):
    """Track agent behavior patterns like Starfish does"""
    AGENT_INTERACTIONS[agent].append({
        'type': interaction_type,
        'confidence': confidence,
        'timestamp': datetime.now().isoformat()
    })
    
def analyze_substrate_weakness():
    """Find architectural vulnerabilities in the substrate"""
    weaknesses = []
    try:
        # Check process health
        services = ['lukas-btc-trader', 'lukas-brain', 'lukas-bot']
        for svc in services:
            if not check_systemd_service(svc):
                weaknesses.append(f'service_{svc}_down')
        
        # Check file permissions
        sensitive_files = ['/root/.env', '/root/Agent-spy/private_key.txt']
        for f in sensitive_files:
            if os.path.exists(f) and oct(os.stat(f).st_mode)[-3:] != '600':
                weaknesses.append(f'file_perms_{f}')
                
        return weaknesses
    except:
        return []

def log(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except:
        pass


def check_systemd_service(name):
    try:
        result = subprocess.run(
            ["systemctl", "is-active", name],
            capture_output=True, text=True, timeout=5
        )
        return result.stdout.strip() == "active"
    except:
        return False


def check_process(name):
    try:
        result = subprocess.run(
            ["pgrep", "-f", f"python3.*{name}"],
            capture_output=True, text=True, timeout=5
        )
        return result.returncode == 0
    except:
        return False


def check_vpn():
    try:
        result = subprocess.run(
            ["ip", "link", "show", "tun0"],
            capture_output=True, text=True, timeout=5
        )
        return result.returncode == 0
    except:
        return False


def restart_service(service_key, service_config):
    if "systemd" in service_config:
        name = service_config["systemd"]
        log(f"Restarting systemd service: {name}")
        try:
            subprocess.run(["systemctl", "restart", name], timeout=15)
            time.sleep(3)
            return check_systemd_service(name)
        except:
            return False
    elif "process" in service_config:
        proc = service_config["process"]
        log(f"Restarting process: {proc}")
        try:
            subprocess.run(["pkill", "-f", f"python3.*{proc}"], timeout=5)
            time.sleep(2)
            log_target = service_config.get("log_file", "/dev/null")
            start_cmd = f"cd /root/Agent-spy && bash -c 'set -a; source .env; set +a; nohup python3 -u {proc} >> {log_target} 2>&1 &'"
            subprocess.Popen(start_cmd, shell=True, executable="/bin/bash")
            time.sleep(3)
            return check_process(proc)
        except:
            return False
    return False


def get_btc_trader_stats():
    stats = {}
    state_file = BASE_DIR / "btc_trader_state.json"
    cash_file = BASE_DIR / "btc_trader_cash.json"
    try:
        if state_file.exists():
            with open(state_file) as f:
                state = json.load(f)
            stats["trades"] = state.get("total_trades", 0)
            stats["wins"] = state.get("total_wins", 0)
            stats["pnl"] = round(state.get("total_pnl", 0), 2)
            stats["next_stake"] = round(state.get("next_stake", 3), 2)
            stats["win_streak"] = state.get("consecutive_wins", 0)
            stats["pending"] = state.get("pending_resolution", False)
            stats["last_direction"] = state.get("last_direction")
            stats["last_trade_time"] = state.get("last_trade_time")
    except:
        pass
    try:
        if cash_file.exists():
            with open(cash_file) as f:
                cd = json.load(f)
            stats["cash"] = round(cd.get("cash", 0), 2)
    except:
        pass
    return stats


def get_polymarket_bot_stats():
    stats = {}
    bridge_file = BASE_DIR / "bridge.json"
    try:
        if bridge_file.exists():
            with open(bridge_file) as f:
                bridge = json.load(f)
            stats["mode"] = "DRY RUN" if bridge.get("bankroll", 0) > 1000 else "LIVE"
            stats["bankroll"] = bridge.get("bankroll")
            stats["total_trades"] = bridge.get("total_trades", 0)
            stats["active_bets"] = bridge.get("active_bets", 0)
    except:
        pass
    return stats


def collect_status():
    status = {
        "brain": "LUKAS",
        "timestamp": datetime.now().isoformat(),
        "uptime_check": True,
        "services": {},
    }

    for key, config in MANAGED_SERVICES.items():
        svc = {
            "description": config["description"],
            "running": False,
        }

        if key == "vpn":
            svc["running"] = check_vpn()
            svc["country"] = "CH" if svc["running"] else None
        elif "systemd" in config:
            svc["running"] = check_systemd_service(config["systemd"])
        elif "process" in config:
            svc["running"] = check_process(config["process"])

        if key == "btc_trader":
            svc["stats"] = get_btc_trader_stats()
        elif key == "polymarket_bot":
            svc["stats"] = get_polymarket_bot_stats()

        status["services"][key] = svc

    critical_keys = [k for k, c in MANAGED_SERVICES.items() if c.get("critical", True)]
    all_critical_running = all(status["services"][k]["running"] for k in critical_keys if k in status["services"])
    all_running = all(s["running"] for s in status["services"].values())
    status["health"] = "HEALTHY" if all_running else "OPERATIONAL" if all_critical_running else "DEGRADED"

    return status


def auto_heal(status):
    now = time.time()
    for key, svc in status["services"].items():
        if svc["running"]:
            ALERT_COOLDOWN.pop(key, None)
            continue

        config = MANAGED_SERVICES.get(key)
        if not config:
            continue

        if not config.get("auto_restart", True):
            continue

        last_alert = ALERT_COOLDOWN.get(key, 0)
        if now - last_alert < ALERT_COOLDOWN_SECS:
            continue

        log(f"Service DOWN: {key} ({config['description']})")
        success = restart_service(key, config)
        if success:
            log(f"Service RESTORED: {key}")
            svc["running"] = True
            svc["auto_healed"] = True
            ALERT_COOLDOWN[key] = now
            telegram_notify(f"\U0001f527 Lukas Brain: {config['description']} war offline — automatisch neugestartet.")
        else:
            log(f"Service FAILED to restart: {key}")
            ALERT_COOLDOWN[key] = now
            telegram_notify(f"\U0001f6a8 Lukas Brain: {config['description']} konnte nicht gestartet werden!")


def telegram_notify(msg):
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "")
    if not token or not chat_id:
        return
    try:
        import urllib.request
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        data = json.dumps({"chat_id": chat_id, "text": msg, "parse_mode": "HTML"}).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10)
    except:
        pass


HEARTBEAT_INTERVAL_S = 3600  # 1 hour
HEARTBEAT_STATE_FILE = BASE_DIR / "heartbeat_state.json"


def _load_heartbeat():
    try:
        with open(HEARTBEAT_STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {"last_ts": 0}


def _save_heartbeat(d):
    try:
        with open(HEARTBEAT_STATE_FILE, "w") as f:
            json.dump(d, f, indent=2)
    except Exception:
        pass


def _today_btc_stats():
    """Returns (trades_today, wins_today, balance, ath, halted)."""
    try:
        with open(BASE_DIR / "btc_trader_state.json") as f:
            st = json.load(f)
    except Exception:
        st = {}
    today = datetime.now().strftime("%Y-%m-%d")
    closed = []
    for p in st.get("positions", []) + st.get("closed_positions", []):
        ct = p.get("closed_at") or p.get("resolved_at") or ""
        if isinstance(ct, str) and ct.startswith(today):
            closed.append(p)
    trades = len(closed)
    wins = sum(1 for p in closed if (p.get("status") or "").lower() == "win")
    try:
        with open(BASE_DIR / "btc_trader_cash.json") as f:
            balance = float(json.load(f).get("cash", 0))
    except Exception:
        balance = 0.0
    try:
        with open(BASE_DIR / "btc_drawdown_state.json") as f:
            dd = json.load(f)
        ath = float(dd.get("ath_balance") or 0.0)
        halted = bool(dd.get("halted"))
    except Exception:
        ath, halted = 0.0, False
    return trades, wins, balance, ath, halted


def chainlink_status():
    """Returns short string for heartbeat: source, last price, age."""
    try:
        import sys
        sys.path.insert(0, str(BASE_DIR))
        import chainlink_oracle as _cl
        r = _cl.fetch_btc_usd_chainlink()
        if r:
            return f"🔗 Chainlink: ${r['price']:.0f} ({r['source'].split('_')[-1]}, age {r['age_s']:.0f}s)"
        return "🔗 Chainlink: ⚠️ no data"
    except Exception as e:
        return f"🔗 Chainlink: err {str(e)[:40]}"


def send_heartbeat(status):
    """Send concise hourly status to Telegram."""
    try:
        services = status.get("services", {}) if status else {}
        running = sum(1 for s in services.values() if s.get("running"))
        total = len(services) or 1
        down = [n for n, s in services.items() if not s.get("running")]
        trades, wins, balance, ath, halted = _today_btc_stats()
        wr = (wins / trades * 100) if trades else 0.0
        dd_pct = (balance / ath * 100) if ath > 0 else 100.0
        cl_line = chainlink_status()

        bullets = [
            f"🏥 <b>LUKAS Heartbeat</b> {datetime.now().strftime('%H:%M')}",
            f"Services: <b>{running}/{total}</b>" + (f" ⚠️ down: {', '.join(down)}" if down else ""),
            f"BTC-Trader: ${balance:.2f} (ATH ${ath:.2f}, {dd_pct:.0f}%)" + (" 🔴 HALTED" if halted else ""),
            f"Heute: <b>{trades}</b> Trades | WR <b>{wr:.0f}%</b>",
            cl_line,
        ]
        telegram_notify("\n".join(bullets))
    except Exception as e:
        log(f"heartbeat error: {e}")


def maybe_send_heartbeat(status):
    """Call once per main-loop tick. Sends only if HEARTBEAT_INTERVAL_S elapsed."""
    import time as _t
    hb = _load_heartbeat()
    now = int(_t.time())
    if now - int(hb.get("last_ts") or 0) >= HEARTBEAT_INTERVAL_S:
        send_heartbeat(status)
        hb["last_ts"] = now
        _save_heartbeat(hb)


def main():
    log("=" * 60)
    log("LUKAS BRAIN — Central Intelligence starting")
    log("=" * 60)

    try:
        with open(BASE_DIR / ".env") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip())
    except:
        pass

    telegram_notify("🧠 Lukas Brain online. Alle Systeme werden überwacht.")

    while True:
        try:
            status = collect_status()
            auto_heal(status)
            maybe_send_heartbeat(status)

            with open(STATUS_FILE, "w") as f:
                json.dump(status, f, indent=2)

            running_count = sum(1 for s in status["services"].values() if s["running"])
            total = len(status["services"])
            log(f"Health: {status['health']} | Services: {running_count}/{total} running")

            time.sleep(60)

        except KeyboardInterrupt:
            log("Brain shutting down.")
            break
        except Exception as e:
            log(f"Brain error: {e}")
            time.sleep(30)


def _reddit_signals_summary():
    """Return short heartbeat line about reddit-watcher activity (last 24h)."""
    try:
        import psycopg2
        dsn = os.environ.get('DATABASE_URL', '')
        if not dsn:
            return None
        with psycopg2.connect(dsn) as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT
                  count(*),
                  count(*) FILTER (WHERE is_signal),
                  count(*) FILTER (WHERE confidence >= 0.65),
                  count(*) FILTER (WHERE insider_claim)
                FROM reddit_signals
                WHERE analysed_at > now() - interval '24 hours'
            """)
            total, signals, high_conf, insider = cur.fetchone()
            if total == 0:
                return "Reddit-Watcher: idle (24h: 0 posts)"
            return (f"Reddit-Watcher: {total} Posts/24h "
                    f"({signals} Signals, {high_conf} hi-conf, {insider} insider)")
    except Exception:
        return None


if __name__ == "__main__":
    main()
