# LUKAS — Autonomer KI-Agent

Lukas ist ein persistenter KI-Agent mit eigener Persönlichkeit, Gedächtnis und echten Werkzeugen.
Er lebt in einer PostgreSQL-Datenbank, chattet über die OpenAI-API und kann während des Gesprächs
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

## Deployment auf Railway (empfohlen, HTTPS inklusive)

Railway betreibt echte Dauer-Container — die Hintergrund-Worker (Moltbook,
Konsolidierung, Reflexion) laufen dort durch. (Vercel ist dafür ungeeignet: Serverless
friert den Prozess ein.) Schritte:

1. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** →
   dieses Repo + Branch wählen. Build/Start sind über `railway.json` vorkonfiguriert
   (`npm ci && npm run build`, Start: `npm run start:deploy` = Schema-Sync + Server).
2. Im Projekt **+ New → Database → PostgreSQL** anlegen. Beim App-Service unter
   *Variables*: `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (Referenz).
3. Weitere Variablen setzen (`PORT` setzt Railway automatisch):
   - `AI_INTEGRATIONS_OPENAI_API_KEY` — Key von platform.openai.com
   - `AI_INTEGRATIONS_OPENAI_BASE_URL` = `https://api.openai.com/v1`
   - optional `LUKAS_CORE_MODEL` (Standard `gpt-4o`) und `LUKAS_PUBLIC_MODEL`
     (Standard `gpt-4o-mini`), falls andere Modelle gewünscht/verfügbar sind
   - `LUKAS_API_TOKEN` (Pflicht — schützt die private API)
   - `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_LLM_TOKEN`
   - optional: `MOLTBOOK_API_KEY`, `VOYAGE_API_KEY`, `VPS_DATABASE_URL`, `HIGGSFIELD_API_KEY`
4. Service → *Settings → Networking* → **Generate Domain**. Diese Domain ist dann:
   - das Dashboard: `https://<domain>/`
   - das Widget: `https://<domain>/widget.js` (+ `data-api="https://<domain>"`)
   - für ElevenLabs Custom LLM: `https://<domain>/api/public/llm/v1`
5. Optional eigene Domain (z.B. `lukas.issahareb.me`) per CNAME in den
   Networking-Settings verbinden.

### Bestehende Railway-Postgres mitnutzen (statt neuer DB)

Lukas kann die (fast ungenutzte) Postgres eines anderen Railway-Projekts mitbenutzen:

- **Gleiches Projekt**: Lukas-Service in dasselbe Railway-Projekt deployen →
  `DATABASE_URL = ${{Postgres.DATABASE_URL}}` (privates Netz, kein Egress).
- **Anderes Projekt**: beim dortigen Postgres-Service die `DATABASE_PUBLIC_URL`
  kopieren und beim Lukas-Service als `DATABASE_URL` eintragen.

Das ist sicher: Alle Lukas-Tabellen sind `lukas_*`-geprefixt, und der Schema-Sync
(`drizzle-kit push`) ist per `tablesFilter` hart auf Lukas-Tabellen begrenzt —
die Tabellen der Webseite werden weder verändert noch angetastet (verifiziert).

**Noch sauberer (empfohlen)**: eigene Datenbank in derselben Postgres-Instanz —
eine Railway-Postgres kann beliebig viele Datenbanken enthalten, kostenlos:

```bash
# Einmalig mit der DATABASE_PUBLIC_URL des Postgres-Service verbinden:
psql "<DATABASE_PUBLIC_URL>" -c "CREATE DATABASE lukas;"
```

Dann als `DATABASE_URL` denselben Connection-String verwenden, nur mit
`/lukas` statt des Webseiten-Datenbanknamens am Ende — komplett getrennte
Namensräume, null Risiko für die Webseite.

Der Server liefert im Deployment alles aus einem Prozess: API, Dashboard-UI
(SPA), Widget und die öffentlichen Endpoints.

### Troubleshooting: „Healthcheck failed"

1. **Deploy-Logs öffnen** (Service → Deployments → auf das fehlgeschlagene klicken).
   Direkt nach `Server listening` steht eine **Env-Status**-Zeile: welche Variablen
   gesetzt sind und welche FEHLEN.
2. **Pflicht zum Booten**: nur `DATABASE_URL` (Railway setzt `PORT` selbst).
   Ohne `AI_INTEGRATIONS_OPENAI_API_KEY` startet der Server trotzdem — Lukas kann
   dann nur nicht denken (Chat liefert Fehler), bis der Key nachgetragen ist.
3. **DB-Verbindung**: Hostname `…railway.internal` funktioniert NUR, wenn Lukas im
   selben Railway-Projekt wie die Postgres läuft; sonst die `DATABASE_PUBLIC_URL`
   (`…proxy.rlwy.net`) verwenden. Ein db:push-Fehler blockiert den Start nicht mehr,
   steht aber am Anfang des Logs.
4. Nach dem Setzen fehlender Variablen: **Redeploy** (Variablenänderung triggert das
   meist automatisch).

## Umgebungsvariablen

| Variable | Zweck |
| --- | --- |
| `PORT` | Port des API-Servers |
| `DATABASE_URL` | Postgres für Lukas (Gedächtnis, Ziele, Tagebuch, Chats) |
| `AI_INTEGRATIONS_OPENAI_API_KEY` / `_BASE_URL` | OpenAI-Zugang (Key von platform.openai.com) |
| `LUKAS_CORE_MODEL` | Modell für Lukas' "Gehirn" — Chat, Reflexion, Moltbook, Higgsfield-Prompts (Standard `gpt-4o`) |
| `HIGGSFIELD_API_KEY` | Optional: Higgsfield Media-Generierung |
| `LUKAS_API_TOKEN` | Optional: schützt alle `/api`-Routen (außer `/api/healthz` und `/api/public/*`) per Bearer-Token. Sobald gesetzt, zeigt das Dashboard beim Aufruf automatisch einen Login-Screen — dort den Token eingeben, kein Dev-Console-Zugriff nötig. |
| `VPS_DATABASE_URL` | Optional: Postgres des VPS-Trading-Systems (Fallback: `DATABASE_URL`) |
| `ELEVENLABS_API_KEY` | Stimme für das Portfolio-Widget (ElevenLabs, Flash v2.5 ≈ 75 ms Latenz) |
| `ELEVENLABS_VOICE_ID` | Deine gewählte Stimme aus dem ElevenLabs VoiceLab |
| `ELEVENLABS_AGENT_ID` | ElevenLabs-Agent für die Sprach-Konversation (Issas Agent „L.U.K.A.S.": `agent_4501ky1q2tgvepx906k5waew8bwk`) |
| `ELEVENLABS_LLM_TOKEN` | Selbst erzeugter Zufallsstring; schützt den Custom-LLM-Endpoint `/api/public/llm/v1` — denselben Wert in der ElevenLabs-Konsole als API-Key eintragen |
| `LUKAS_PUBLIC_MODEL` | Modell für den öffentlichen Widget-Chat (Standard `gpt-4o-mini` für minimale Latenz) |
| `LUKAS_REALTIME_MODEL` | Modell für den privaten Sprachchat im Dashboard (Standard `gpt-realtime-2.1`, Speech-to-Speech, ~200-300ms Latenz). Nutzt denselben `AI_INTEGRATIONS_OPENAI_API_KEY`. |
| `LUKAS_REALTIME_VOICE` | Stimme für den privaten Sprachchat (Standard `cedar` = männlich; `marin` = weiblich; weitere: `alloy`, `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`) |

## Sprachchat im Dashboard (privat)

Auf der Comm-Link-Seite des Dashboards gibt es oben einen "Sprechen"-Button, der direkt
mit Lukas per Sprache spricht — über die **OpenAI Realtime API** (Speech-to-Speech,
`gpt-realtime-2.1`), nicht über ElevenLabs. Grund: Realtime spricht und hört gleichzeitig
im selben Modell, ohne Umweg über separate STT/TTS-Schritte, und antwortet dadurch im
Millisekunden- statt Sekundenbereich.

Ablauf: Der Browser holt sich über `POST /api/lukas/realtime-session` ein kurzlebiges
Client-Secret (`ek_...`, 10 Minuten gültig). Lukas' vollständiger privater System-Prompt
(Erinnerungen, Ziele, Tagebuch, Emotionen, Charakter) wird dabei serverseitig in die
Session-Konfiguration eingebettet — der Browser bekommt nur das Secret, nie den
Prompt-Text selbst. Das Frontend verbindet sich damit direkt per WebRTC zu OpenAI
(`@openai/agents-realtime`).

Das **öffentliche Portfolio-Widget** bleibt bewusst auf ElevenLabs Agents (siehe unten) —
das ist bereits gut eingespielt und dort nicht Teil dieser Umstellung.

## Portfolio-Widget (issahareb.me)

Lukas lässt sich mit einer Zeile auf jeder Webseite einbetten — Besucher können mit ihm
schreiben **und sprechen** (Mikrofon → Web Speech API, Antwort → ElevenLabs-Stimme):

```html
<script src="https://DEINE-LUKAS-DOMAIN/widget.js" data-api="https://DEINE-LUKAS-DOMAIN" defer></script>
```

- Demo + komplette Design-Doku: `http://localhost:5000/embed-demo.html`
- **Beliebig designbar**: Theme/Farben/Radius/Position/Texte per `data-`-Attributen
  (`data-theme`, `data-accent`, `data-radius`, `data-position`, `data-title`, …); zusätzlich
  volle CSS-Kontrolle über stabile Klassen (`.lukas-btn`, `.lukas-panel`, `.lukas-m`, …) —
  kein Shadow-DOM, die Host-Seite kann alles überschreiben.
- **Stimme (empfohlen): ElevenLabs Agents** — `data-voice="agent"` + `data-agent-id="…"`.
  WebRTC mit Sub-Sekunden-Latenz, echtes Turn-Taking. Issas Agent heißt **L.U.K.A.S.**
  (Agent-ID `agent_4501ky1q2tgvepx906k5waew8bwk`); fertiges Embed für die Portfolio-Seite:

  ```html
  <script src="https://DEINE-LUKAS-DOMAIN/widget.js"
          data-api="https://DEINE-LUKAS-DOMAIN"
          data-voice="agent"
          data-agent-id="agent_4501ky1q2tgvepx906k5waew8bwk"
          defer></script>
  ```

  Damit der Agent wirklich Lukas ist (und nicht das Standard-LLM von ElevenLabs), einmalig
  in der ElevenLabs-Konsole → Agent **L.U.K.A.S.** → LLM → **Custom LLM** eintragen:
  1. Server-URL: `https://DEINE-DOMAIN/api/public/llm/v1`
  2. Model-ID: `lukas` (beliebig, wird serverseitig ignoriert)
  3. API-Key: exakt der Wert von `ELEVENLABS_LLM_TOKEN` aus den Railway-Variablen
     (ohne ihn antwortet der Endpoint mit 401/503)

  Private Agents bekommen die Verbindung über `GET /api/public/voice-session` (signed URL,
  braucht `ELEVENLABS_API_KEY` + `ELEVENLABS_AGENT_ID`). Alternativ gibt es ElevenLabs'
  eigenes `<elevenlabs-convai>`-Widget — funktioniert auch, ist aber im Design kaum
  anpassbar; unser `widget.js` ist die frei gestaltbare Variante.
- Fallback `data-voice="classic"`: Browser-Spracherkennung + `GET /api/public/tts`
  (progressives Streaming — spielt ab, während noch geladen wird).
- Endpoints: `POST /api/public/chat` (SSE), `GET|POST /api/public/tts`,
  `POST /api/public/llm/v1/chat/completions` (OpenAI-kompatibel — und seit der
  Umstellung auf die OpenAI-API auch tatsächlich OpenAI dahinter, Bearer-Token) — alle
  rate-limitiert, Keys bleiben serverseitig.
- **Was Besucher wissen dürfen**, steuerst du über Erinnerungen mit Kategorie `public` — nur die fließen in den öffentlichen System-Prompt. Private Memories bleiben privat.
- Die Portfolio-Seite braucht HTTPS (Mikrofon-Zugriff).

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
graphify label .             # optional: Communities per LLM benennen (braucht eigenen ANTHROPIC_API_KEY —
                              # separates Drittanbieter-Tool, nicht unser LLM-Unterbau; ohne Key bleibt
                              # dieser Schritt einfach aus, kein Blocker)
```

Interaktive HTML-Ansicht: `graphify-out/graph.html` im Browser öffnen.

## Struktur

- `artifacts/api-server` — Express-5-API (Chat mit Tool-Loop, Lukas-Routen, Higgsfield, Trades)
- `artifacts/lukas-ui` — React-Oberfläche (Dashboard, Chat, Memory, Goals, Diary, Studio)
- `lib/db` — Drizzle-Schema (Postgres)
- `lib/api-spec` — OpenAPI-Spec (Quelle der Wahrheit) + Orval-Codegen
- `lib/api-zod` / `lib/api-client-react` — generierte Clients
- `lib/integrations-openai-ai` — OpenAI-Client

## VPS-Trading-System (die 99 Dateien)

Das autonome Python-System liegt versioniert unter [`vps/`](vps/README.md) und wird mit
`bash scripts/lukas-deploy/deploy.sh <IP> <PASSWORT>` als 10 systemd-Services auf den VPS
ausgerollt. Die Web-App liest dessen Postgres über `VPS_DATABASE_URL`.

## Wichtig

- Vor öffentlichem Deployment `LUKAS_API_TOKEN` setzen — ohne Token ist die API offen.
- Der frühere `TELEGRAM_BOT_TOKEN` war im Code-Archiv hartkodiert → über @BotFather rotieren.
