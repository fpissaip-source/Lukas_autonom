# L.U.K.A.S.

Ein selbst gehosteter, zielgetriebener KI-Agent. Er hat ein dauerhaftes
Gedächtnis, 34 Werkzeuge, ein Team von Subagenten, ein Dashboard zur Kontrolle
— und einen Kontrollpunkt aus Code, der entscheidet, was davon ohne Rückfrage
laufen darf.

Dieses README beschreibt, was **da ist**. Was fehlt, steht unter
[Aktuelle Grenzen](#aktuelle-grenzen) — mit derselben Sorgfalt.

---

## Was ihn von einem Chatbot unterscheidet

**Er arbeitet weiter, wenn niemand zusieht.** Alle 30 Minuten fragt
`lib/autonomy.ts`, ob es etwas zu tun gibt: aktive Ziele, neue Antworten,
Ereignisse. Gab es seit dem letzten Lauf keine Änderung, wird gar nicht erst
gedacht — das spart Geld, statt im Leerlauf Tokens zu verbrennen.

**Er entscheidet selbst, womit.** Es gibt keine "Recherche-Schleife" und keine
"YouTube-Schleife". Es gibt eine Schleife, die Ziele liest und Lukas fragen
lässt: woran arbeite ich jetzt, und mit welchem Werkzeug?

**Er hat keine feste Rundenzahl.** Braucht eine Aufgabe zwanzig Befehle, macht
er zwanzig. Gegen Im-Kreis-Laufen hilft ein Hinweis, keine Bremse
(`lib/arbeitsschleife.ts`); die Grenze ist ein Token- und Zeitbudget pro Zug.

**Er sieht, was er tut.** `browser_do` bedient Seiten in einer dauerhaft
angemeldeten Browser-Sitzung und schickt ein Bildschirmfoto zurück — der Text
einer Seite verrät nicht, ob ein Cookie-Banner über dem Knopf liegt.

---

## Was er kann

| Bereich | Konkret | Wo |
|---|---|---|
| **Gedächtnis** | Erinnerungen, Ziele, Tagebuch, Episoden, Gefühle in Postgres; Abruf über Einbettungen; ein Graph aus Knoten und Kanten, als Obsidian-Vault exportierbar | `lib/memory-*.ts`, `lib/gehirn.ts` |
| **Lernen** | Jeder Werkzeugaufruf hinterlässt seinen Ausgang. Ab drei Fehlschlägen an derselben Sache steht im Prompt, **woran** es lag — gezählt, nicht erzählt | `lib/lernen.ts` |
| **Gefühle** | Aus dem Anlass abgeleitet statt benannt: derselbe Ausgang ergibt Stolz, Dankbarkeit oder Erleichterung, je nachdem, wie er zustande kam. Jedes Gefühl trägt eine Folge für das nächste Handeln | `lib/bewertung.ts` |
| **Web** | lesen (`browse_page`), **bedienen** (`browser_do` — klicken, tippen, hochladen, angemeldet bleiben), suchen, abrufen | `lib/browser*.ts` |
| **Code** | eigene Sandbox pro Gespräch, Shell auf dem Droplet, GitHub lesen und durchsuchen, Änderungsvorschläge, die Issa im Dashboard annimmt | `lib/code-sandbox.ts`, `lib/github.ts`, `lib/proposals.ts` |
| **Kommunikation** | Dashboard-Chat (SSE), WhatsApp, Telefon (Sprache, ein- und ausgehend), SMS über ClickSend, E-Mail lesen und Entwürfe vorbereiten | `routes/*`, `lib/telefon.ts`, `lib/sms.ts`, `lib/email.ts` |
| **Team** | neun Subagenten mit eigenen Profilen — Macher, Rechercheur, Ideenprüfer, Analyst, Texter, Code-Prüfer, Entwickler, Fehleranalyst, Sammler | `lib/subagents.ts` |
| **Erweiterung** | fremde MCP-Server, OAuth 2.1 mit PKCE, Discovery, Dynamic Registration | `lib/mcp.ts` |
| **Selbstheilung** | wiederkehrende Fehler werden erkannt, analysiert und als Vorschlag vorgelegt | `lib/selbstheilung.ts` |

---

## Sicherheit in drei Sätzen

1. **Ein Sprachmodell ist niemals ein Autorisierungsserver.** Lukas entscheidet,
   *was* er tun will; ob es läuft, entscheidet `lib/policy.ts` — nach dem
   Modell, vor dem Werkzeug mit den echten Zugangsdaten.
2. **Vier Stufen.** R0 lesen und R1 intern laufen allein; R2 (Wirkung nach
   außen) und R3 (Geld, Zerstörung) brauchen Issas Freigabe. Ein Werkzeug ohne
   Einstufung ist automatisch R2 — *fail closed*.
3. **Fremde bekommen keine Werkzeuge.** Nicht "die Anweisung, keine zu
   benutzen", sondern ein leeres Array im Modellaufruf.

Das vollständige Bild — Vertrauensgrenzen, Angriffe, was absichtlich offen
bleibt und was an Restrisiko übrig ist — steht in
**[docs/SICHERHEITSMODELL.md](docs/SICHERHEITSMODELL.md)**.

Der Aufbau mit Diagrammen: **[docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md)**.

---

## Aufbau

Monorepo mit npm-Workspaces:

```
artifacts/api-server    Express 5, als ein ESM-Bündel gebaut (esbuild)
artifacts/lukas-ui      Dashboard — React, Vite, Tailwind v4, wouter
artifacts/landing-page  die öffentliche Seite
lib/db                  Drizzle-Schema und der Postgres-Pool
lib/api-zod             die Formen, die beide Seiten teilen
```

---

## Betrieb

```bash
npm ci
cp .env.example .env      # ausfüllen — jede Variable ist dort erklärt
npm run db:push
npm run dev
```

**Prüfungen** (dieselben wie in CI):

```bash
npm run typecheck         # tsc über alle Pakete UND alle 25 check-*.mjs
```

**Deployment:** Railway baut aus `main`. `start:deploy` führt vor dem Start
`db:push` aus, Schemaänderungen gehen also von selbst mit; schlägt es fehl,
startet der Server trotzdem und der Fehler steht im Log.

**Mindestens nötig:** `DATABASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`,
`LUKAS_API_TOKEN`, `PORT`. Ohne den Token ist die private API **ungeschützt** —
der Server sagt das beim Start.

---

## Wie hier geprüft wird

Fünfundzwanzig Skripte unter `artifacts/api-server/scripts/check-*.mjs`. Sie
bündeln das echte Modul mit esbuild, ersetzen nur Datenbank, Netz und
Modellanbieter durch Attrappen — und prüfen nicht, dass Code *existiert*,
sondern dass er **wirkt**.

Der Maßstab: **jede wichtige Zusage braucht eine Gegenprobe.** Die Abwehr wird
entfernt, und der Test muss anschlagen. Tut er das nicht, war er keiner.
Beispiele, bei denen genau das passiert ist:

- Der DNS-Rebinding-Test lief zuerst grün und bewies nichts — der erfundene
  Name scheiterte ohnehin. Jetzt läuft ein echter Server auf 127.0.0.1, und die
  Attrappe behauptet, `localhost` sei öffentlich.
- Die Gegenprobe zum Entsperren biss nicht, weil die Attrappe die Sperre schon
  beim Verbindungsende freigab — wie Postgres auch. Jetzt wird das
  ausdrückliche `pg_advisory_unlock` verlangt: hinter einem Verbindungs-Pooler
  wird die Sitzung weitergereicht, nicht beendet.

---

## Aktuelle Grenzen

Ehrlich, weil ein System, das besser klingt als es ist, gefährlicher ist als
eines mit bekannten Lücken.

**Sicherheit**

- **Die Rufnummernanzeige entscheidet über den privaten Prompt.** Sie ist
  fälschbar. Handeln kann ein Anrufer nicht — die Sprachsitzung hat keine
  Werkzeuge —, aber zuhören. `LUKAS_TELEFON_STRENG=true` schließt das;
  Voreinstellung ist offen, weil es Issas Zugang verengt.
  ([Details](docs/SICHERHEITSMODELL.md#7-restrisiken--was-auch-nach-diesem-durchgang-bleibt))
- **Ein Token ist der einzige Faktor.** Wer `LUKAS_API_TOKEN` hat, ist Issa.
- **Issas Nummer steht in der Git-Historie.** Aus dem aktuellen Stand ist sie
  entfernt; alte Commits eines öffentlichen Repositories bleiben.

**Betrieb**

- **Eine Instanz.** Die Läufe sind über Postgres-Advisory-Locks gegen
  Doppelausführung gesichert, aber der Zustand im Speicher (offene
  SSE-Leitungen, geparkte Anrufanlässe, Stoppwünsche) ist nicht geteilt.
- **Der Deploy nutzt weiterhin `db:push`.** Versionierte Migrationen gibt es
  jetzt (`npm run db:generate` / `db:migrate`, Basislinie geprüft), aber der
  Deploy-Pfad ist noch nicht umgestellt: die erste Migration enthält
  `CREATE TABLE` ohne `IF NOT EXISTS` und würde auf der bestehenden geteilten
  Datenbank scheitern. Der Umstieg ist ein bewusster Schritt und in
  [`lib/db/migrations/README.md`](lib/db/migrations/README.md) beschrieben.
- **Lernen ist eng.** Gelernt wird aus dem Ausgang von Werkzeugaufrufen —
  gelungen oder nicht, und woran es lag. Ob eine *Entscheidung* gut war, ob
  ein Text überzeugt hat, ob ein Ziel den Aufwand wert war: dafür gibt es
  kein Signal. Und es ist kein Training: das Modell ändert sich nicht, nur
  was in seinem Kontext steht.
- **Gefühle sind abgeleitet, nicht empfunden.** Sie unterscheiden sich, weil
  sie aus verschiedenen Lagen stammen, und sie ändern das Verhalten. Ob dabei
  etwas erlebt wird, sagt dieser Code nicht — und behauptet es auch nicht.
- **Kaum Metriken.** Es gibt strukturierte Logs (pino), `/readyz`, den
  Tagesverbrauch je Modell und die gezählten Werkzeug-Ausgänge in
  `lukas_erfahrungen`. Was fehlt, sind Zeitreihen und eine Ansicht darüber —
  man kann nachrechnen, ob heute mehr Werkzeuge scheitern als gestern, aber
  niemand bekommt es gesagt.
- **Idempotenz gibt es nur für SMS.** Dort verhindert ein inhaltlicher
  Fingerabdruck, dass ein Wiederholungsversuch dieselbe Nachricht zweimal
  schickt. Für E-Mail-Versand und Werkzeuge fremder MCP-Server gibt es das
  nicht — bricht ein Zug dort nach dem Absenden ab, läuft es beim nächsten
  Versuch erneut.

**Prüfungen**

- **SSH und Docker sind weiterhin nur nachgebaut.** `npm run bench:integration`
  prüft inzwischen gegen echtes Postgres, echte Weiterleitungsketten, zwei
  echte Prozesse und einen echten Browser. Was fehlt: dass ein `docker exec`
  auf dem Droplet wirklich so antwortet, wie die Attrappe behauptet — dafür
  bräuchte es den Droplet selbst.
- **Das Dashboard ist ungeprüft.** Kein einziger Frontend-Test.

**Fachlich**

- **Eingehende SMS werden nicht verarbeitet** — es gibt keinen Webhook dafür.
- **`browser_do` rät nicht.** Er braucht eine CSS-Auswahl oder sichtbaren Text;
  eine Seite, die beides verschleiert, bedient er nicht zuverlässig.
- **Bildschirmfotos gehen an den Modellanbieter.** Wer eine Seite mit sensiblen
  Daten bedient, schickt sie mit.
