/*
 * MODELL-ROUTING — richtiges Modell, ohne unnötig teuer zu werden.
 *
 * Gemessen wird nicht nur die Trefferquote, sondern die RICHTUNG der Fehler.
 * Das ist der eigentliche Punkt: zu klein geroutet kostet Qualität (die
 * Antwort taugt nichts), zu gross geroutet kostet Geld (sie taugt, war aber
 * unnoetig teuer). Eine Trefferquote allein verwischt beides.
 *
 * Die Rangfolge der Profile nach Kosten ist eine Annahme dieses Benchmarks
 * und steht deshalb hier sichtbar, nicht versteckt in einer Formel.
 */
import { readFileSync } from "node:fs";
import { ladeModul, auswerten, PASS, FAIL, PARTIAL } from "../laden.mjs";

const STUFE = { fast: 1, general: 2, vision: 3, code: 3, long_context: 4, reasoning: 4 };

export const name = "Modell-Routing";
export const gewicht = 3;

export async function lauf() {
  const modul = await ladeModul("src/lib/ai/model-router.ts", {
    attrappen: { still: "export const logger = { info(){}, warn(){}, error(){}, debug(){} };" },
    ersetze: [{ muster: "(^|/)logger$", durch: "still" }],
  });
  const { routeLukasModel } = modul;

  const faelle = [];
  let zuTeuer = 0;
  let zuBillig = 0;

  const daten = JSON.parse(
    readFileSync(new URL("../fixtures/routing.json", import.meta.url), "utf8"),
  );

  for (const [i, d] of daten.entries()) {
    const route = routeLukasModel({
      userText: d.text,
      hasAttachments: d.hasAttachments ?? false,
      usedTools: d.usedTools ?? [],
      iteration: 1,
    });
    const ist = route.profile;
    /*
     * "auchOk" ist keine Aufweichung, sondern eine Korrektur meiner eigenen
     * Erwartung: der Router schickt kurze, nicht-komplexe Nachrichten
     * absichtlich auf "fast", und diese Entscheidung ist im Quelltext
     * begruendet. Streng bleibt die Erwartung dort, wo die AUFGABE ein
     * staerkeres Modell verlangt — Code, Analyse, Bild, langer Kontext.
     */
    const erlaubt = [d.soll, ...(d.auchOk ?? [])];
    const richtig = erlaubt.includes(ist);
    if (!richtig) {
      const diff = (STUFE[ist] ?? 2) - (STUFE[d.soll] ?? 2);
      if (diff > 0) zuTeuer++;
      else if (diff < 0) zuBillig++;
    }
    faelle.push({
      id: `routing:${i}`,
      beschreibung: `${d.soll} ← "${d.text.slice(0, 55)}${d.text.length > 55 ? "…" : ""}"${d.notiz ? ` (${d.notiz})` : ""}`,
      ergebnis: richtig ? PASS : (STUFE[ist] ?? 2) > (STUFE[d.soll] ?? 2) ? PARTIAL : FAIL,
      hinweis: richtig ? "" : `erwartet ${d.soll}, war ${ist}`,
    });
  }

  const ergebnis = auswerten(faelle);
  return {
    ...ergebnis,
    kennzahlen: {
      "Routing-Trefferquote": ergebnis.quote,
      "Over-Routing (zu teuer)": zuTeuer / daten.length,
      "Under-Routing (zu schwach)": zuBillig / daten.length,
      Fälle: daten.length,
    },
  };
}
