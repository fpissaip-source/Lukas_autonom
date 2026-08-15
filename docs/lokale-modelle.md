# Lokale und offene Modelle

Lukas hing bisher an einem Konto: alles ging an OpenAI. Er kann jetzt jedes
Modell benutzen, das die OpenAI-Schnittstelle spricht — und das tun praktisch
alle: Ollama, llama.cpp, vLLM, LM Studio, und die Anbieter, die offene Modelle
hosten.

Der Code kennt dafür keinen einzigen Modellnamen. Er kennt eine Adresse.

## Einschalten

Zwei Variablen, mehr nicht:

```
LUKAS_LOCAL_BASE_URL=http://127.0.0.1:11434/v1     # Ollama auf demselben Rechner
LUKAS_LOCAL_API_KEY=                                # meist leer — lokale Server haben keine Anmeldung
```

Und dann pro Rolle entscheiden, wer sie übernimmt. Das Präfix `local:` schickt
die Rolle an diese Adresse:

```
LUKAS_MODEL_FAST=local:qwen2.5:7b          # kurze Rückfragen — lokal, kostenlos
LUKAS_MODEL_GENERAL=openai:gpt-5.6-terra   # normales Gespräch — bleibt beim starken Modell
LUKAS_MODEL_CODE=openai:gpt-5.6-sol        # Code — bleibt beim starken Modell
```

Genau so ist es gedacht: **nicht alles oder nichts.** Die billigen Rollen
lokal, die schwierigen weiter beim starken Modell. Was er wofür nimmt,
entscheidet er ohnehin pro Nachricht selbst.

## Was passiert, wenn der lokale Server aus ist

Nichts Schlimmes. Fehlt die Adresse oder antwortet der Server nicht, fällt der
Aufruf automatisch auf OpenAI zurück. Ein abgeschaltetes Ollama macht Lukas
also teurer, nicht kaputt. Das ist geprüft, nicht behauptet — siehe
`scripts/check-lokales-modell.mjs`.

## Was auf dem Droplet realistisch läuft

Hier die unangenehme Zahl vorweg: **Kimi K2 hat rund eine Billion Parameter**
(MoE, ~32B davon pro Token aktiv). Selbst stark quantisiert braucht das
mehrere hundert GB Speicher. Auf einem normalen DigitalOcean-Droplet läuft das
nicht — nicht langsam, sondern gar nicht.

Was auf einer CPU-Maschine wirklich geht:

| Modell | Bedarf (Q4) | Wofür brauchbar |
|---|---|---|
| `qwen2.5:7b` | ~5 GB RAM | Zusammenfassen, Einordnen, kurze Antworten |
| `qwen2.5-coder:7b` | ~5 GB RAM | einfache Code-Fragen |
| `llama3.1:8b` | ~6 GB RAM | allgemeines Gespräch |
| `qwen2.5:14b` | ~10 GB RAM | spürbar besser, spürbar langsamer |

Ohne GPU heißt das Sekunden bis Minuten pro Antwort. Für Lukas' Chat zu
langsam, für Hintergrundarbeit (Moltbook-Entscheidungen, Zusammenfassungen,
Sortieren) völlig ausreichend — und dort fällt der Löwenanteil der Aufrufe an.

**Werkzeugaufrufe sind der Knackpunkt.** Kleine Modelle können sie, aber
deutlich unzuverlässiger. Für Rollen, die viel mit Werkzeugen arbeiten, ist ein
lokales 7B-Modell die falsche Wahl.

## Kimi K2 trotzdem benutzen

Über einen Anbieter, der es hostet — dieselbe Schnittstelle, nur eine andere
Adresse:

```
LUKAS_LOCAL_BASE_URL=https://api.moonshot.ai/v1
LUKAS_LOCAL_API_KEY=<schluessel>
LUKAS_MODEL_GENERAL=local:kimi-k2-0905-preview
```

Das ist dann nicht kostenlos und nicht lokal, aber offen und meist deutlich
billiger. Für Lukas ist es derselbe Weg.

## Ollama auf dem Droplet einrichten

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:7b
```

Ollama hört standardmäßig nur auf `127.0.0.1`. Lukas läuft auf Railway, also
**woanders** — damit er den Server erreicht, muss er von außen erreichbar sein.
Das aber bitte nicht offen ins Netz stellen: ein offener Ollama ist eine
kostenlose Rechenmaschine für jeden, der ihn findet. Entweder über einen
Tunnel, oder hinter einem Reverse-Proxy mit Passwort (dann `LUKAS_LOCAL_API_KEY`
setzen).
