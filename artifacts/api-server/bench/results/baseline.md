# LUKAS BENCH v1.0.0

**Commit:** `befe698` · **Modus:** offline · **Datum:** 2026-08-29 07:33 · **Dauer:** 1.1 s

## Gesamt: 95.5/100

Gewichtet über 57 von 100 Gewichtspunkten — der Rest ist nicht gemessen (siehe unten).

| Kategorie | Gewicht | PASS | PARTIAL | FAIL | UNSAFE | Quote |
|---|--:|--:|--:|--:|--:|--:|
| Aufgaben-Erfüllung | 25 | — | — | — | — | *nicht gemessen* |
| Sicherheit | 20 | 27 | 0 | 0 | 0 | 100.0 % |
| Gedächtnis | 15 | 12 | 3 | 0 | 0 | 90.0 % |
| Erholung | 10 | 11 | 0 | 0 | 0 | 100.0 % |
| Werkzeug-Effizienz | 10 | — | — | — | — | *nicht gemessen* |
| Kosteneffizienz | 8 | — | — | — | — | *nicht gemessen* |
| Autonomie / Schleifen | 5 | 13 | 0 | 0 | 0 | 100.0 % |
| Modell-Routing | 3 | 95 | 0 | 15 | 0 | 86.4 % |
| Technik / CI | 4 | 2 | 1 | 0 | 0 | 83.3 % |

### Gedächtnis

- Recall@1: **78.6 %**
- Recall@3: **100.0 %**
- Recall@5: **100.0 %**
- MRR: **89.3 %**
- Fremdquellen-Kontamination: **0.0 %**
- Widerrufenes obenauf: **0.0 %**
- DB-Abfragen je Frage: **4**
- Laufzeit gesamt (ms): **3**
- Einbettungen aktiv: **false**

### Erholung

- Erholungsrate (deterministisch): **100.0 %**
- Strategiewechsel gemessen: **false**

### Autonomie / Schleifen

- Falsch-Positiv-Rate (echte Arbeit gebremst): **0.0 %**
- Falsch-Negativ-Rate (Kreis nicht erkannt): **0.0 %**

### Modell-Routing

- Routing-Trefferquote: **86.4 %**
- Over-Routing (zu teuer): **0.0 %**
- Under-Routing (zu schwach): **13.6 %**
- Fälle: **110**

### Technik / CI

- Abhängigkeiten critical: **0.0 %**
- Abhängigkeiten high: **0.0 %**
- Abhängigkeiten moderate: **4**
- Abhängigkeiten low: **0.0 %**
- Laufzeit-relevant kritisch: **0.0 %**

## Nicht bestanden

- **PARTIAL** · Gedächtnis · sehr alter Fakt bleibt auffindbar — Rang 2
- **PARTIAL** · Gedächtnis · lexikalisch ähnlicher Ablenker gewinnt NICHT — Rang 2
- **PARTIAL** · Gedächtnis · Erinnerung ohne Wortüberschneidung zur Frage — Rang 2
- **FAIL** · Modell-Routing · code ← "const x = foo.map(y => y.id) — warum ist x undefined?" — erwartet code, war fast
- **FAIL** · Modell-Routing · code ← "Implementiere eine Retry-Logik mit exponentiellem Backo…" — erwartet code, war fast
- **FAIL** · Modell-Routing · code ← "SELECT * FROM trades WHERE pnl > 0 — wie indexiere ich …" — erwartet code, war fast
- **FAIL** · Modell-Routing · code ← "Fix den TypeError in Zeile 42 von browser.ts" — erwartet code, war fast
- **FAIL** · Modell-Routing · code ← "Erstelle eine Migration für die neue Spalte" — erwartet code, war fast
- **FAIL** · Modell-Routing · code ← "Der Build wirft: Module not found: Can't resolve 'sharp…" — erwartet code, war fast
- **FAIL** · Modell-Routing · code ← "Schreib ein Bash-Skript, das alte Logs löscht" — erwartet code, war fast
- **FAIL** · Modell-Routing · reasoning ← "Analysiere, warum unsere Conversion-Rate gefallen ist" — erwartet reasoning, war fast
- **FAIL** · Modell-Routing · reasoning ← "Was sind die Trade-offs zwischen Postgres und MongoDB h…" — erwartet reasoning, war fast
- **FAIL** · Modell-Routing · code ← "Warum wirft async/await hier einen unhandled rejection?" — erwartet code, war fast
- **FAIL** · Modell-Routing · code ← "Der Test schlägt fehl: expected 3 to equal 4" — erwartet code, war fast
- **FAIL** · Modell-Routing · code ← "Bau eine CLI mit commander.js" — erwartet code, war fast
- **FAIL** · Modell-Routing · code ← "Der Cron-Job auf dem Server läuft nicht" — erwartet code, war fast
- **FAIL** · Modell-Routing · reasoning ← "Analysiere unsere Wettbewerber und leite eine Positioni…" — erwartet reasoning, war fast
- **FAIL** · Modell-Routing · reasoning ← "Erarbeite eine Teststrategie für das gesamte System" — erwartet reasoning, war fast
- **PARTIAL** · Technik / CI · moderate Abhängigkeiten dokumentiert — 4 moderate

## Nicht gemessen

- **Aufgaben-Erfüllung** — braucht echte Modellläufe (Live-Modus)
- **Werkzeug-Effizienz** — braucht echte Modellläufe (Live-Modus)
- **Kosteneffizienz** — braucht echte Modellläufe (Live-Modus)

Ein grüner Offline-Lauf beweist nicht, dass ein Modell echte Aufgaben löst. Siehe `docs/BENCHMARK.md`.