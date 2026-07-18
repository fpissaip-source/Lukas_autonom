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
| `ELEVENLABS_API_KEY` | Stimme für das Portfolio-Widget (ElevenLabs, Flash v2.5 ≈ 75 ms Latenz) |
| `ELEVENLABS_VOICE_ID` | Deine gewählte Stimme aus dem ElevenLabs VoiceLab |
| `LUKAS_PUBLIC_MODEL` | Modell für den öffentlichen Widget-Chat (Standard `claude-haiku-4-5` für minimale Latenz) |

## Portfolio-Widget (issahareb.me)

Lukas lässt sich mit einer Zeile auf jeder Webseite einbetten — Besucher können mit ihm
schreiben **und sprechen** (Mikrofon → Web Speech API, Antwort → ElevenLabs-Stimme):

```html
<script src="https://DEINE-LUKAS-DOMAIN/widget.js" data-api="https://DEINE-LUKAS-DOMAIN" defer></script>
```

- Demo lokal: `http://localhost:5000/embed-demo.html`
- Endpoints: `POST /api/public/chat` (SSE, ohne Auth, Rate-Limit pro IP) und `POST /api/public/tts` (ElevenLabs-Proxy — der Key bleibt auf dem Server)
- **Was Besucher wissen dürfen**, steuerst du über Erinnerungen mit Kategorie `public` — nur die fließen in den öffentlichen System-Prompt. Private Memories bleiben privat.
- Für Voice braucht die Seite HTTPS (Mikrofon-Zugriff) und Chrome/Edge/Safari (Web Speech API).

## Gedächtnisarchitektur (Vier Schichten)

PostgreSQL ist die **Wahrheitsquelle**; alles andere sind Sichten darauf:

1. **Episodisch** (`lukas_episodes`): was wann konkret passiert ist (unveränderlich)
2. **Semantisch** (`lukas_claims`): Aussagen mit Quelle, Vertrauen und **Evidenz-Stufe 0–4**
   (Gedanke → Beobachtung → fremde Behauptung → mehrfach gestützt → verifiziert).
   Fremde Behauptungen werden NIE als Fakten gespeichert; Widersprüche werden markiert,
   unbestätigte Claims verlieren täglich Vertrauen.
3. **Prozedural** (`lukas_strategies`): Strategien mit *gemessenem* Erfolg — jede
   Moltbook-Aktion bekommt ein Resultat (Antwort erhalten? Engagement?), täglich ausgewertet.
4. **Arbeitsgedächtnis**: Session-State der Worker (nicht dauerhaft).

Abruf über `memory-retrieval.ts`: Score = Relevanz × Vertrauen × Wichtigkeit × Aktualität ×
Quellenqualität; optional semantisch via `VOYAGE_API_KEY` (sonst lexikalisch). Im Chat als
Kontext-Injektion und als Tool `query_memory`.

**Obsidian-Sicht**: Die tägliche Konsolidierung generiert `memory-vault/` (Identity, Agents
mit trust_score-Frontmatter, Episodes, Findings, Strategies — mit Wikilinks). Ordner in
Obsidian als Vault öffnen; Änderungen dort fließen NICHT zurück (DB ist die Wahrheit).
Wenn `graphify` installiert ist, wird der Wissensgraph darüber automatisch aktualisiert.

## Codebase-Graph (Graphify + Obsidian)

Das Repo enthält unter `docs/obsidian-vault/` einen mit [graphify](https://graphify.net)
generierten Wissens-Graphen der Codebase als Markdown-Wiki — den Ordner einfach in
Obsidian als Vault öffnen (Graph-Ansicht zeigt das Netzwerk). Neu erzeugen:

```bash
pip install graphifyy
graphify update .            # Graph bauen (ohne API-Key, nur Code-AST)
graphify label .             # optional: Communities per LLM benennen (braucht ANTHROPIC_API_KEY)
```

Interaktive HTML-Ansicht: `graphify-out/graph.html` im Browser öffnen.

## Struktur

- `artifacts/api-server` — Express-5-API (Chat mit Tool-Loop, Lukas-Routen, Higgsfield, Trades)
- `artifacts/lukas-ui` — React-Oberfläche (Dashboard, Chat, Memory, Goals, Diary, Studio)
- `lib/db` — Drizzle-Schema (Postgres)
- `lib/api-spec` — OpenAPI-Spec (Quelle der Wahrheit) + Orval-Codegen
- `lib/api-zod` / `lib/api-client-react` — generierte Clients
- `lib/integrations-anthropic-ai` — Anthropic-Client

## VPS-Trading-System (die 99 Dateien)

Das autonome Python-System liegt versioniert unter [`vps/`](vps/README.md) und wird mit
`bash scripts/lukas-deploy/deploy.sh <IP> <PASSWORT>` als 10 systemd-Services auf den VPS
ausgerollt. Die Web-App liest dessen Postgres über `VPS_DATABASE_URL`.

## Wichtig

- Vor öffentlichem Deployment `LUKAS_API_TOKEN` setzen — ohne Token ist die API offen.
- Der frühere `TELEGRAM_BOT_TOKEN` war im Code-Archiv hartkodiert → über @BotFather rotieren.
