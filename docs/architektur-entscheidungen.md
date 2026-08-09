# Architektur-Entscheidungen

Bezug: `LUKAS_Final_Technical_Architecture_20260809.md` (Zielarchitektur-Entwurf).
Dieses Dokument hält fest, was davon umgesetzt wurde, was bewusst anders
entschieden wurde und warum.

---

## Ausgangslage: ein Repo, zwei Laufzeiten

Die häufigste Verwirrung zuerst, weil sie fast jede weitere Entscheidung berührt:

| | `artifacts/` | `vps/` |
|---|---|---|
| Sprache | TypeScript | Python |
| Läuft auf | Railway | DigitalOcean-Droplet |
| Inhalt | Dashboard, API, Sprachchat, Portfolio-Widget, WhatsApp | Trading-Bots, Reasoner, Watcher |
| Prozessmodell | ein Web-Service | 10 systemd-Dienste |

Die Verbindung ist bewusst schmal: Die Web-App **liest** die Postgres des VPS über
`VPS_DATABASE_URL` (Trades, Bankroll, `get_trading_stats`). Sie startet oder
steuert die Bots nicht.

Der Architektur-Entwurf behandelt beide als ein System. Das stimmt so nicht — und
die Trennung ist keine Altlast, sondern nützlich: Ein Fehler im Dashboard kann den
Trading-Betrieb nicht stören.

---

## Umgesetzt

### 1. Policy Decision Point (`lib/policy.ts`)

Der Kernsatz des Entwurfs — *„Ein LLM ist niemals ein Autorisierungsserver"* — ist
umgesetzt. Jeder Tool-Aufruf durchläuft eine deterministische Prüfung, **nachdem**
das Modell entschieden hat und **bevor** das Tool mit echten Credentials läuft.

Risikostufen:

| Stufe | Bedeutung | Tools |
|---|---|---|
| R0 | nur lesen | `query_memory`, `fetch_url`, `web_search`, `github_*`, `email_search`, `email_read`, `get_trading_stats`, `get_moltbook_activity` |
| R1 | interner, umkehrbarer Schreibzugriff | `save_memory`, `create_goal`, `update_goal`, `write_diary`, `feel`, `set_status`, `execute_command`, `reset_sandbox` |
| R2 | Wirkung nach außen | `email_send` |
| R3 | Geld, Credentials, unumkehrbar, Host-Ebene | `execute_on_host` |

Zwei Entscheidungen, die Erklärung verdienen:

- **`execute_command` ist R1, nicht R3.** Die Sandbox ist ein isolierter
  Wegwerf-Container ohne Produktions-Secrets und jederzeit zurücksetzbar. Bekäme
  Lukas eine Shell auf dem Host, wäre es zwingend R3.
- **Unbekannte Tools sind R2, nicht R0.** Wer künftig ein Tool ergänzt und die
  Einstufung vergisst, bekommt Freigabepflicht statt versehentlich freie Fahrt.

Freigaben sind an einen SHA-256-Hash der normalisierten Argumente gebunden und
gelten **einmal**. Ändert Lukas ein Argument, passt der Hash nicht mehr.

Geprüft: blockiert ohne Freigabe → läuft nach Freigabe → blockiert erneut
(verbraucht). Argument-Bindung gegen 6 Fälle inkl. Umsortierung und minimaler
Textänderung.

### 2. Ausführung isoliert (`lib/code-sandbox.ts`)

E2B abgelöst durch Docker auf Issas eigenem Droplet. Der Container bekommt:

- root, volles Internet, keinen Befehlsfilter (wie gewünscht)
- **kein** Host-Dateisystem, **keine** Host-Variablen, **keinen** Docker-Socket
- Speicher-, CPU- und PID-Limits, damit ein Amoklauf das Droplet nicht lahmlegt

Einrichtung: `scripts/lukas-deploy/setup_sandbox.sh` (auf dem Droplet ausführen).

### 3. Owner/Public technisch getrennt

War schon vorher so und bleibt: Das öffentliche Widget (`routes/public.ts`) bekommt
**null Tools** und ausschließlich Erinnerungen der Kategorie `public`. Die Trennung
ist Code, kein Prompt-Versprechen.

---

## Bewusst anders entschieden

### Hermes Agent: Lukas installiert ihn selbst, unter Freigabe

Hermes ist real (MIT, läuft mit OpenAI, kleiner VPS reicht) und bringt drei Dinge,
die wir nicht haben: **Skills/prozedurales Lernen, Subagents, MCP**.

Was gegen einen Blind-Umstieg spricht — und weiterhin gilt:

1. **Der Nutzen ist kleiner als der Entwurf nahelegt.** Cron haben wir (Worker),
   das Messaging-Gateway haben wir gerade selbst gebaut (WhatsApp), und das
   Gedächtnis behalten wir laut Entwurf ohnehin selbst. Bleiben drei echte Gewinne
   gegen eine große externe Abhängigkeit plus Ersatz eines funktionierenden
   Agent-Loops.
2. **Der Entwurf nennt selbst ein offenes Sicherheitsproblem** in Hermes, bei dem
   Memory-Provider-Tools die `disabled_toolsets`-Grenze umgehen. Er geht damit
   richtig um (verlässt sich nicht darauf) — aber es zeigt: junges, schnell
   bewegtes Projekt.
3. **Die Voraussetzung fehlt noch.** Hermes sinnvoll einzusetzen setzt die
   Control Plane voraus, die davor prüft. Deren Kern (Policy + Approvals) steht
   erst seit heute.

Deshalb: Hermes kommt dazu, ersetzt aber vorerst nichts. Zielbild bleibt
`hermes-owner` im Shadow Mode — nur lesende Capabilities, keine
Produktions-Writes, gegen dieselbe Policy-Schicht. Erst wenn das trägt, wandert
Verantwortung dorthin.

**Korrektur zu einer früheren Einschätzung:** Ich hatte geschrieben, Lukas
selbst installieren zu lassen würde ihm erst Root auf dem Droplet verschaffen.
Das war falsch — der Python-Lukas auf dem VPS *hatte diese Macht bereits*:
`patcher.py` schrieb Dateien und pushte mit `--force`, `lukas_brain.py` und
`loss_reasoner.py` starten Dienste neu. Die Frage war also nie, ob wir ihm das
geben, sondern ob es unbeaufsichtigt bestehen bleibt.

Entschieden wurde: **absichern statt abschalten.**

- `patcher.py` pusht nicht mehr mit `--force` auf einen festen Branch, sondern
  auf einen eigenen Branch pro Lauf (`lukas/self-patch-<zeitstempel>`) und meldet
  ihn per Telegram. Nichts wird überschrieben, jeder Diff bleibt nachvollziehbar,
  Issa merged. Die Selbstverbesserung bleibt vollständig erhalten.
  Das war dringlicher als es klingt: Am Anfang dieser Kette stehen Eingaben, die
  Fremde beeinflussen können (Reddit-Posts im Watcher, Logs im Bug-Reasoner) —
  ein manipulierter Input konnte bis in den Code durchschlagen und die Spur
  gleich mitüberschreiben.
- Der Dashboard-Lukas bekommt `execute_on_host` (R3) und kann damit Hermes
  selbst installieren. Jeder einzelne Befehl braucht Issas Freigabe, gebunden an
  genau diesen Wortlaut. Bewusst keine Ausnahme für "harmlos aussehende"
  Befehle: ob ein `curl … | bash` harmlos ist, hängt allein davon ab, was gerade
  unter der URL liegt.

### Kein 8-Phasen-Umbau am Stück

Der Entwurf beschreibt Monate an Arbeit. Die Probleme, die zuletzt tatsächlich
gestört haben (Text unlesbar auf Mobil, Lukas kennt seine eigenen Tools nicht,
Higgsfield scheitert ohne Fehlermeldung), löst keine Control Plane. Die Reihenfolge
hier ist deshalb: erst das, was wehtut, dann Struktur — und Struktur nur dort, wo
sie echtes Risiko senkt.

---

## Offen

- **Task Engine mit Wiederaufnahme** (`queued → running → waiting_approval → …`).
  Aktuell ist ein Freigabe-Vorgang an das laufende Gespräch gebunden; ein
  Neustart verliert den Faden. Für lang laufende Hintergrundarbeit nötig.
- **Audit-Log** über alle Tool-Aufrufe. Teilweise vorhanden (`lukas_debug_log`,
  Freigaben), aber nicht durchgängig korreliert.
- **SSRF-Härtung** in `fetch_url`: private/Loopback/Metadata-Ziele werden noch
  nicht geblockt. Konkretes Risiko, weil Lukas URLs aus E-Mails folgen kann.
- **`vps/`-Dienste hinter definierte APIs** stellen, bevor irgendetwas ihre
  Orchestrierung übernimmt.
