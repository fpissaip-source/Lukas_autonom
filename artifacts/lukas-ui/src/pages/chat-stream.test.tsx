/*
 * Der Fall, den Issa als "er antwortet oft nicht" gesehen hat.
 *
 * Ein Deploy, ein Neustart oder ein abgestuerzter Prozess beenden die
 * SSE-Leitung SAUBER: kein Fehler, keine Ausnahme, der Lesevorgang meldet
 * einfach "fertig". Der Server hat aber nie sein Abschlusssignal geschickt.
 *
 * Vorher passierte dann gar nichts — kein Text, keine Meldung, keine
 * Nachfrage. Die Frage stand im Chat, und es sah aus, als habe Lukas sie
 * ignoriert. Das ist die schlimmste aller Antworten, weil sie wie Absicht
 * aussieht.
 *
 * Geprueft wird hier die Unterscheidung, auf die es ankommt:
 * "Leitung zu Ende" ist NICHT "Antwort fertig".
 */
import { describe, expect, it } from "vitest";
import { parseSseData, takeCompleteLines } from "@/lib/sse";

/**
 * Die Leseschleife aus chat.tsx, auf ihren Kern eingedampft: sie liefert
 * zurueck, ob das Abschlusssignal kam — und damit, ob nachgefragt werden muss.
 *
 * Bewusst nachgebaut statt die Seite zu rendern: der Fall entsteht durch das
 * ENDE eines Streams, und ein abgeschnittener Netzwerk-Stream laesst sich in
 * jsdom nicht ehrlich nachstellen. Was hier geprueft wird, ist die
 * Entscheidungsregel, nicht das React-Drumherum.
 */
function leseLauf(happen: string[]): { text: string; abschluss: boolean; fehler: string | null } {
  let puffer = "";
  let text = "";
  let abschluss = false;
  let fehler: string | null = null;
  let done = false;

  for (const h of happen) {
    if (done) break;
    puffer += h;
    const { zeilen, rest } = takeCompleteLines(puffer);
    puffer = rest;
    for (const zeile of zeilen) {
      const p = parseSseData(zeile);
      if (!p) continue;
      if (p.content) text += String(p.content);
      if (p.error) fehler = String(p.error);
      if (p.done) {
        done = true;
        abschluss = true;
      }
    }
  }
  return { text, abschluss, fehler };
}

const paket = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

describe("Chat-Stream: Ende ist nicht Abschluss", () => {
  it("ein vollständiger Zug meldet den Abschluss", () => {
    const r = leseLauf([paket({ content: "Hallo" }), paket({ done: true })]);
    expect(r.text).toBe("Hallo");
    expect(r.abschluss).toBe(true);
  });

  /*
   * Der eigentliche Fall: der Prozess stirbt nach den Werkzeugen, bevor die
   * Antwort kommt. Alles sieht normal aus — nur das Abschlusssignal fehlt.
   */
  it("ein abgeschnittener Zug meldet KEINEN Abschluss — dann muss nachgefragt werden", () => {
    const r = leseLauf([
      paket({ tool: "browse_page" }),
      paket({ step: { name: "browse_page", ok: true } }),
      // hier stirbt der Server
    ]);
    expect(r.abschluss).toBe(false);
    expect(r.text).toBe("");
    expect(r.fehler).toBeNull();
  });

  it("auch wenn schon Text da war, aber der Abschluss fehlt", () => {
    const r = leseLauf([paket({ content: "Ich habe angefangen…" })]);
    expect(r.text).toBe("Ich habe angefangen…");
    expect(r.abschluss).toBe(false);
  });

  /*
   * Ein Fehler vom Server ist etwas anderes als Stille: den zeigt die
   * Oberflaeche an, statt nachzufragen.
   */
  it("ein gemeldeter Fehler kommt an und ist kein Abschluss", () => {
    const r = leseLauf([paket({ error: "GitHub API 403" })]);
    expect(r.fehler).toBe("GitHub API 403");
    expect(r.abschluss).toBe(false);
  });

  /*
   * Und der alte Fehler, wegen dessen die Puffer-Logik überhaupt entstand:
   * ein großes Paket kommt in mehreren Netzwerk-Happen an. Wer jeden Happen
   * für sich zerlegt, verliert die abgeschnittene letzte Zeile.
   */
  it("eine über Happen zerrissene Antwort geht nicht verloren", () => {
    const ganz = paket({ content: "Eine lange Antwort mit Umlauten: äöü" }) + paket({ done: true });
    const mitte = Math.floor(ganz.length / 2);
    const r = leseLauf([ganz.slice(0, mitte), ganz.slice(mitte)]);
    expect(r.text).toBe("Eine lange Antwort mit Umlauten: äöü");
    expect(r.abschluss).toBe(true);
  });

  it("und die Seite selbst fragt bei fehlendem Abschluss nach", async () => {
    /*
     * Am Quelltext, und das steht hier ausdrücklich so: die Alternative wäre,
     * einen abbrechenden Netzwerk-Stream in jsdom nachzubauen — der Aufwand
     * stünde in keinem Verhältnis, und das Ergebnis wäre eine Attrappe, die
     * genau das nachstellt, was sie prüfen soll.
     */
    const quelle = await import("node:fs").then((fs) =>
      fs.readFileSync("src/pages/chat.tsx", "utf8"),
    );
    expect(quelle).toMatch(/let abschlussGesehen = false/);
    expect(quelle).toMatch(/abschlussGesehen = true/);
    expect(quelle).toMatch(/if \(!abschlussGesehen && !controller\.signal\.aborted\)/);
    expect(quelle).toMatch(/setWartetAufNachzuegler\(true\)/);

    /*
     * Und die Unterscheidung selbst: das Ende des Streams darf den Abschluss
     * NICHT setzen. Genau daran hängt alles — wer beides gleichsetzt, hat die
     * Prüfung wieder ausgehebelt, ohne dass eine Zeile rot wird.
     */
    const streamEnde = quelle.match(/if \(streamDone\)[^\n]*/)?.[0] ?? "";
    expect(streamEnde).toContain("done = true");
    expect(streamEnde).not.toContain("abschlussGesehen");
  });
});
