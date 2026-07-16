# LUKAS — Autonomer KI-Agent

Persistenter KI-Agent mit Persönlichkeit, Gedächtnis (PostgreSQL), echtem Tool-Use im Chat, Tagebuch-Reflexionen, Higgsfield-Media-Generierung und Anbindung an das VPS-Trading-System.

## Run & Operate

- `npm run dev:api` — API-Server starten (PORT aus .env, Standard 5000)
- `npm run dev:ui` — Oberfläche starten (Vite, lukas-ui)
- `npm run typecheck` — kompletter Typecheck
- `npm run build` — Typecheck + Build aller Pakete
- `npm run codegen` — API-Hooks/Zod-Schemas aus der OpenAPI-Spec neu generieren
- `npm run db:push` — DB-Schema pushen (nur Dev)
- Benötigte Env: `DATABASE_URL`; optional `AI_INTEGRATIONS_ANTHROPIC_*`, `HIGGSFIELD_API_KEY`, `LUKAS_API_TOKEN`, `VPS_DATABASE_URL` (siehe `.env.example`)

## Stack

- npm workspaces, Node.js ≥20, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API-Codegen: Orval (aus OpenAPI-Spec)
- Build: esbuild (ESM-Bundle)
- KI: Anthropic API (`claude-opus-4-8`), Streaming + Tool-Use

## Where things live

- DB-Schema: `lib/db/src/schema/` (lukas.ts, conversations.ts, messages.ts, trades.ts, bankroll_history.ts)
- API-Vertrag: `lib/api-spec/openapi.yaml` (Quelle der Wahrheit, danach `npm run codegen`)
- Lukas-Persona: `artifacts/api-server/src/lib/lukas-soul.ts`
- Lukas-Tools (save_memory, goals, diary, status, web_search, fetch_url, trading): `artifacts/api-server/src/lib/lukas-tools.ts`
- Chat mit agentischem Tool-Loop (SSE): `artifacts/api-server/src/routes/anthropic.ts`
- Selbstreflexion (Auto-Tagebuch): `artifacts/api-server/src/lib/reflection.ts`
- Auth-Middleware (opt-in via LUKAS_API_TOKEN): `artifacts/api-server/src/middlewares/auth.ts`
- Trading-Lesezugriff (raw pg auf VPS-DB): `artifacts/api-server/src/lib/vps-db.ts`, `src/routes/trades.ts`

## Architecture decisions

- Lukas' Status ist konzeptionell eine Zeile → `lukas-status.ts` updated in place statt Zeilen anzuhängen.
- Der Chat-Endpoint streamt SSE und führt Tools in einer Schleife aus (max. 8 Iterationen); Tool-Aufrufe werden als `{tool: name}`-Events an die UI gemeldet.
- Tagebuch-Reflexionen entstehen automatisch nach Gesprächen mit 6h-Cooldown (`maybeReflect`), erzwingbar per `POST /api/lukas/reflect`.
- Trades/Bankroll werden per raw SQL (parametrisiert) gelesen — die Tabellen gehören dem VPS-System; `VPS_DATABASE_URL` mit Fallback auf `DATABASE_URL`.
- Higgsfield-Jobs werden ehrlich als `failed` markiert, wenn kein API-Key gesetzt ist oder der API-Call fehlschlägt.

## Gotchas

- Nach Änderungen an `openapi.yaml` immer `npm run codegen` laufen lassen, sonst passen Server-Zod-Schemas und UI-Hooks nicht.
- `LUKAS_API_TOKEN` schützt die API erst, wenn gesetzt; UI liest den Token aus `localStorage.getItem("lukas_token")`.
- Das alte Python-/VPS-System ist NICHT Teil dieses Repos — nur Lesezugriff auf dessen Postgres.

## User preferences

- Owner: Issa. Antworten auf Deutsch. Design: premium, modern, cinematisch.
- npm statt pnpm (Umstellung Juli 2026).
