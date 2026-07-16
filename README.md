# LUKAS — Autonomer KI-Agent

Lukas ist ein persistenter KI-Agent mit eigener Persönlichkeit, Gedächtnis und echten Werkzeugen.
Er lebt in einer PostgreSQL-Datenbank, chattet über die Anthropic-API und kann während des Gesprächs
selbstständig handeln:

- **Gedächtnis** — speichert wichtige Informationen dauerhaft (`save_memory`)
- **Ziele** — legt Ziele an und verfolgt Fortschritt (`create_goal` / `update_goal`)
- **Tagebuch** — schreibt Reflexionen, automatisch nach Gesprächen (max. alle 6h) oder per `POST /api/lukas/reflect`
- **Stimmung** — setzt seinen eigenen emotionalen Zustand (`set_status`), kein Keyword-Raten mehr
- **Web** — Websuche (`web_search`) und URL-Analyse (`fetch_url`)
- **Trading** — liest die Statistiken des VPS-Trading-Systems (`get_trading_stats`, `/api/trades`, `/api/bankroll-history`)
- **Higgsfield** — generiert Bilder/Videos über das Studio

## Installation

```bash
npm install
cp .env.example .env   # DATABASE_URL eintragen
npm run db:push        # Datenbank-Schema anlegen
```

## Starten

```bash
npm run dev:api   # API-Server (PORT aus .env, Standard 5000)
npm run dev:ui    # Oberfläche (Vite, zweites Terminal)
```

## Prüfen und Bauen

```bash
npm run typecheck
npm run build
npm run codegen   # API-Clients aus lib/api-spec/openapi.yaml neu generieren
```

## Umgebungsvariablen

| Variable | Zweck |
| --- | --- |
| `PORT` | Port des API-Servers |
| `DATABASE_URL` | Postgres für Lukas (Gedächtnis, Ziele, Tagebuch, Chats) |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` / `_BASE_URL` | Anthropic-Zugang (Replit-Integration oder eigener Key) |
| `HIGGSFIELD_API_KEY` | Optional: Higgsfield Media-Generierung |
| `LUKAS_API_TOKEN` | Optional: schützt alle `/api`-Routen (außer `/api/healthz`) per Bearer-Token. Im Browser: `localStorage.setItem("lukas_token", "<token>")` |
| `VPS_DATABASE_URL` | Optional: Postgres des VPS-Trading-Systems (Fallback: `DATABASE_URL`) |

## Struktur

- `artifacts/api-server` — Express-5-API (Chat mit Tool-Loop, Lukas-Routen, Higgsfield, Trades)
- `artifacts/lukas-ui` — React-Oberfläche (Dashboard, Chat, Memory, Goals, Diary, Studio)
- `lib/db` — Drizzle-Schema (Postgres)
- `lib/api-spec` — OpenAPI-Spec (Quelle der Wahrheit) + Orval-Codegen
- `lib/api-zod` / `lib/api-client-react` — generierte Clients
- `lib/integrations-anthropic-ai` — Anthropic-Client

## Wichtig

- Vor öffentlichem Deployment `LUKAS_API_TOKEN` setzen — ohne Token ist die API offen.
- Das alte Python-/VPS-System (99 Dateien) ist ein separates System auf dem VPS; dieses Repo
  liest dessen Datenbank nur über `VPS_DATABASE_URL`. Der Code-Dump liegt nicht mehr im Repo
  (siehe Git-Historie, Commit `ff9a7ce`).
