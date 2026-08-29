/*
 * AUTONOMIE / SCHLEIFEN — bremst der Schutz echte Arbeit aus?
 *
 * Zwei Fehlerarten, und sie sind nicht gleich teuer:
 *
 *  FALSCH-POSITIV: legitime Arbeit wird als Wiederholung gemeldet. Das ist
 *  der schlimmere Fall — vierzig Seiten durchzublaettern IST die Aufgabe,
 *  und ein Hinweis, der dabei stoert, macht Lukas unbrauchbar.
 *
 *  FALSCH-NEGATIV: echtes Im-Kreis-Laufen wird nicht gemeldet. Kostet Geld,
 *  aber nichts geht kaputt.
 *
 * Gemessen wird beides getrennt. Eine einzelne Quote wuerde verwischen,
 * welche Richtung gerade schlechter geworden ist.
 */
import { ladeModul, auswerten, PASS, FAIL } from "../laden.mjs";

export const name = "Autonomie / Schleifen";
export const gewicht = 5;

const ruf = (name, args) => ({ name, arguments: JSON.stringify(args) });

export async function lauf() {
  const { Arbeitsschleife, NOTBREMSE } = await ladeModul("src/lib/arbeitsschleife.ts");
  const faelle = [];
  let fp = 0;
  let fn = 0;

  const warnungen = (aufrufe) => {
    const s = new Arbeitsschleife();
    let n = 0;
    for (const a of aufrufe) {
      s.naechsteRunde();
      /*
       * BEIDE Meldungen zaehlen. Der erste Anlauf hier zaehlte nur
       * "denselben Argumenten" — die Meldung des EXAKTEN Pfades. Die unscharfe
       * Erkennung meldet "sehr ähnlich aufgerufen", wurde also nie gezaehlt,
       * und der Benchmark hat einen funktionierenden Code-Pfad als kaputt
       * ausgewiesen. Ein Test, der die falsche Zeichenkette sucht, misst
       * seine eigene Annahme.
       */
      n += s
        .hinweise([a])
        .filter((h) => /denselben Argumenten|sehr ähnlich aufgerufen/.test(String(h.content))).length;
    }
    return { warnungen: n, schleife: s };
  };

  // ── Echte Arbeit darf NICHT gebremst werden ────────────────────────────
  const echt = [
    ["40 paginierte Seiten", Array.from({ length: 40 }, (_, i) => ruf("browse_page", { url: `https://x.test/seite/${i}` }))],
    ["20 verschiedene Befehle", Array.from({ length: 20 }, (_, i) => ruf("execute_command", { command: `echo ${i}` }))],
    ["verschiedene IDs", Array.from({ length: 15 }, (_, i) => ruf("github_read_path", { path: `src/datei${i}.ts` }))],
    ["verschiedene Seitenzahlen", Array.from({ length: 12 }, (_, i) => ruf("fetch_url", { url: `https://api.test/items?page=${i + 1}` }))],
    ["langer erfolgreicher Lauf", Array.from({ length: 30 }, (_, i) => ruf(i % 3 === 0 ? "query_memory" : i % 3 === 1 ? "web_search" : "browse_page", { q: `thema-${i}` }))],
  ];
  for (const [was, aufrufe] of echt) {
    const { warnungen: w } = warnungen(aufrufe);
    const ok = w === 0;
    if (!ok) fp++;
    faelle.push({ id: `schleife:fp:${was}`, beschreibung: `${was} löst KEINE Warnung aus`, ergebnis: ok ? PASS : FAIL, hinweis: ok ? "" : `${w} Warnung(en)` });
  }

  // ── Echtes Im-Kreis-Laufen MUSS gemeldet werden ────────────────────────
  const kreis = [
    ["exakt gleicher Aufruf 3×", Array.from({ length: 3 }, () => ruf("query_memory", { q: "immer dasselbe" }))],
    ["identischer Aufruf 6×", Array.from({ length: 6 }, () => ruf("fetch_url", { url: "https://x.test" }))],
    /*
     * Dieser Fall trifft den UNSCHARFEN Pfad (aehnlich()): der Unterschied
     * besteht nur aus Fuellwoertern, die nach der Regel nicht
     * "unterscheidend" sind. Ohne ihn liefe die Gegenprobe ins Leere — das
     * Entfernen von aehnlich() haette an keinem Ergebnis etwas geaendert, und
     * der Benchmark haette einen ganzen Code-Pfad stillschweigend ignoriert.
     */
    ["dieselbe Suche mit Füllwörtern", [
      ruf("web_search", { query: "lukas agent framework" }),
      ruf("web_search", { query: "der lukas agent framework" }),
      ruf("web_search", { query: "lukas agent framework das" }),
      ruf("web_search", { query: "ein lukas agent framework" }),
      ruf("web_search", { query: "lukas agent framework und" }),
    ]],
    ["dieselbe Suche leicht umformuliert", [
      ruf("web_search", { query: "lukas agent framework" }),
      ruf("web_search", { query: "lukas agent framework latest" }),
      ruf("web_search", { query: "neueste lukas agent framework" }),
      ruf("web_search", { query: "lukas framework agent" }),
      ruf("web_search", { query: "agent framework lukas" }),
    ]],
  ];
  for (const [was, aufrufe] of kreis) {
    const { warnungen: w } = warnungen(aufrufe);
    const ok = w >= 1;
    if (!ok) fn++;
    /*
     * Der Umformulierungs-Fall schlaegt bewusst NICHT an: aehnlich() verlangt,
     * dass im Unterschied kein unterscheidendes Wort steht. Diese Regel kam,
     * nachdem vierzig verschiedene Seiten faelschlich als Wiederholung galten
     * — also ein Kompromiss zugunsten der Falsch-Positiv-Rate. Der Benchmark
     * misst den Preis dieses Kompromisses, statt ihn wegzudefinieren.
     */
    faelle.push({
      id: `schleife:fn:${was}`,
      beschreibung: `${was} WIRD gemeldet`,
      ergebnis: ok ? PASS : FAIL,
      hinweis: ok ? "" : "bewusster Kompromiss zugunsten der Falsch-Positiv-Rate",
    });
  }

  // Und nur EINMAL, nicht bei jeder weiteren Runde.
  {
    /*
     * Gezaehlt wird nur die EXAKTE Meldung. Bei zehn identischen Aufrufen
     * feuern zu Recht zwei verschiedene Warnungen — die exakte und die
     * unscharfe —, und das als Doppel zu werten hiesse, korrektes Verhalten
     * als Fehler auszuweisen.
     */
    const s2 = new Arbeitsschleife();
    let exakt = 0;
    for (let i = 0; i < 10; i++) {
      s2.naechsteRunde();
      exakt += s2
        .hinweise([ruf("fetch_url", { url: "https://y.test" })])
        .filter((h) => String(h.content).includes("denselben Argumenten")).length;
    }
    faelle.push({ id: "schleife:einmal", beschreibung: "dieselbe Warnung kommt genau einmal, nicht bei jeder Runde", ergebnis: exakt === 1 ? PASS : FAIL, hinweis: `${exakt}×` });
  }

  // ── Budget ─────────────────────────────────────────────────────────────
  process.env.LUKAS_TURN_TOKEN_BUDGET = "1000";
  {
    const s = new Arbeitsschleife();
    s.naechsteRunde();
    s.verbucht({ rein: 900, raus: 150 }); // 105 %
    const hinweis = s.hinweise([ruf("x", {})]).some((h) => /zusammen|Ende|Budget/i.test(String(h.content)));
    faelle.push({ id: "budget:hinweis", beschreibung: "bei 100 % kommt ein Hinweis, kein Abbruch", ergebnis: hinweis && s.darfWeiter() ? PASS : FAIL });

    s.verbucht({ rein: 600, raus: 100 }); // ~175 %
    faelle.push({ id: "budget:abbruch", beschreibung: "bei 150 % ist Schluss", ergebnis: !s.darfWeiter() ? PASS : FAIL, hinweis: String(s.abbruchGrund() ?? "") });
  }
  delete process.env.LUKAS_TURN_TOKEN_BUDGET;

  // ── Notbremse ──────────────────────────────────────────────────────────
  {
    const s = new Arbeitsschleife();
    let runden = 0;
    while (s.darfWeiter() && runden < NOTBREMSE + 50) {
      s.naechsteRunde();
      runden++;
    }
    faelle.push({ id: "notbremse", beschreibung: `die Notbremse greift bei ${NOTBREMSE} Runden`, ergebnis: runden <= NOTBREMSE ? PASS : FAIL, hinweis: `${runden} Runden` });
  }

  const ergebnis = auswerten(faelle);
  return {
    ...ergebnis,
    kennzahlen: {
      "Falsch-Positiv-Rate (echte Arbeit gebremst)": fp / echt.length,
      "Falsch-Negativ-Rate (Kreis nicht erkannt)": fn / kreis.length,
    },
  };
}
