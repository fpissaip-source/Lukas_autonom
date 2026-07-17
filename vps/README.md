# LUKAS VPS-System (die 99 Dateien)

Das autonome Python-System, das als 10 systemd-Services auf dem VPS läuft.
**Dieses Verzeichnis ist jetzt die Quelle der Wahrheit** — Änderungen hier machen,
committen und mit dem Deploy-Skript ausrollen (nicht mehr direkt auf dem VPS editieren).

## Services

| Service | Einstieg | Zweck |
| --- | --- | --- |
| lukas-bot | `Polymarket_bot/bot/main.py --live` | Polymarket-Trading (Kelly-Criterion, TP/SL, Dashboard Port 5002) |
| lukas-brain | `lukas_brain.py` | Zentrale Überwachung, startet abgestürzte Bots neu |
| lukas-btc-trader | `btc_15m_trader.py` | BTC 15-min-Trader |
| lukas-btc-paper-trader | `btc_15m_paper_trader.py` | Schatten-Strategie (Paper) |
| lukas-telegram | `telegram_bot.py` | Steuerung + Alerts über Telegram |
| lukas-reddit-watcher | `reddit_polymarket_watcher.py` | Signal-Mining aus r/polymarket_bets |
| lukas-bug-reasoner | `bug_reasoner.py` | Log-/Code-Scanner + Self-Patch |
| lukas-loss-reasoner | `loss_reasoner.py` | Verlust-Diagnose + Self-Patch |
| lukas-manual-sell-watcher | `manual_sell_watcher.py` | Erkennt manuelle Positionsschließungen |
| lukas-self-heal | `self_heal_daemon.py` | Circuit-Breaker + Self-Tune |

## Deployment

```bash
# Vom Repo-Root, benötigte Secrets als Env-Variablen setzen (siehe deploy.sh Kopf)
bash scripts/lukas-deploy/deploy.sh <VPS_IP> <ROOT_PASSWORT>
```

Das Skript kopiert `vps/` nach `/root/Agent-spy`, installiert Python-Abhängigkeiten,
rotiert das Postgres-Passwort, schreibt die `.env` und legt alle systemd-Units an
(`scripts/lukas-deploy/install_services.sh`).

## Secrets

**Niemals Secrets in diese Dateien hartkodieren.** Alle Keys kommen aus
`/root/Agent-spy/.env` (wird vom Deploy-Skript geschrieben):
`GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
`POLYMARKET_PRIVATE_KEY`, `ANTHROPIC_API_KEY`, `DATABASE_URL`.

> ⚠️ In einer früheren Version dieser Dateien (`run.sh`) war ein Telegram-Bot-Token
> hartkodiert und lag im Code-Archiv. Der Token sollte über @BotFather **rotiert**
> werden — er ist als kompromittiert zu betrachten.

## Verbindung zur Web-App

Die neue Lukas-Web-App (dieses Repo, `artifacts/`) startet dieses System nicht —
sie liest nur dessen Postgres über `VPS_DATABASE_URL` (`/api/trades`,
`/api/bankroll-history`, Chat-Tool `get_trading_stats`).
