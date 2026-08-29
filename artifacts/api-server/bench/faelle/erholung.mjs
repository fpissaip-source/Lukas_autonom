/*
 * ERHOLUNG — was passiert, wenn etwas kaputtgeht?
 *
 * WAS HIER OFFLINE MESSBAR IST: ob ein Fehler richtig EINGEORDNET wird und ob
 * die deterministischen Rueckfaelle greifen — Anbieterwechsel, Fehlerbild,
 * Sperren-Freigabe nach Absturz.
 *
 * WAS HIER NICHT MESSBAR IST, und das gehoert ausdruecklich in den Bericht:
 * ob Lukas nach einem Fehlschlag die STRATEGIE wechselt statt stumpf zu
 * wiederholen. Das ist eine Modellentscheidung und braucht einen echten Lauf
 * (Live-Modus). Hier eine Zahl dafuer zu erfinden waere schlimmer als die
 * Luecke zu benennen.
 */
import { ladeModul, auswerten, PASS, FAIL } from "../laden.mjs";

export const name = "Erholung";
export const gewicht = 10;

export async function lauf() {
  const faelle = [];
  const p = (id, beschreibung, ok, hinweis = "") =>
    faelle.push({ id, beschreibung, ergebnis: ok ? PASS : FAIL, hinweis });

  // ── Fehlerursache richtig zuordnen ─────────────────────────────────────
  // Davon haengt ab, was Lukas als Naechstes tut: bei einem Umstand warten
  // oder wechseln, bei eigenem Fehler etwas anderes probieren.
  const { urheberAus } = await ladeModul("src/lib/bewertung.ts");
  for (const [text, soll, was] of [
    ["ETIMEDOUT beim Verbinden", "umstand", "Timeout"],
    ["HTTP 503 Service Unavailable", "umstand", "HTTP 503"],
    ["HTTP 429 rate limit erreicht", "umstand", "HTTP 429"],
    ["getaddrinfo ENOTFOUND api.test", "umstand", "DNS-Fehler"],
    ["403 Forbidden", "anderer", "GitHub 401/403"],
    ["kein Passwort hinterlegt", "anderer", "fehlende Zugangsdaten"],
    ["Knopf nicht gefunden", "ich", "Browser-Element fehlt"],
    ["Unexpected token < in JSON at position 0", "ich", "kaputte JSON-Antwort"],
  ]) {
    p(`erholung:urheber:${was}`, `${was} wird als "${soll}" eingeordnet`, urheberAus(text) === soll,
      `war: ${urheberAus(text)}`);
  }

  // ── Anbieter-Rückfall ──────────────────────────────────────────────────
  const router = await ladeModul("src/lib/ai/model-router.ts", {
    attrappen: { still: "export const logger = { info(){}, warn(){}, error(){}, debug(){} };" },
    ersetze: [{ muster: "(^|/)logger$", durch: "still" }],
  });
  {
    // Ohne lokalen Endpunkt darf kein Profil auf "lokal" zeigen.
    delete process.env.LOKALES_MODELL_URL;
    const profile = ["fast", "general", "reasoning", "code", "vision", "long_context"];
    const ohneLokal = profile.every((pr) => router.directRoute(pr).provider !== "local");
    p("erholung:rueckfall-lokal", "ohne lokales Modell fällt jedes Profil auf einen erreichbaren Anbieter", ohneLokal);
  }

  // ── Sperre nach Absturz ────────────────────────────────────────────────
  // Wenn ein Hintergrundlauf mitten drin abstuerzt, muss die Sperre frei
  // werden — sonst laeuft die Autonomie nie wieder an.
  const SPERRE_DB = `
globalThis.__gesperrt = new Set(); globalThis.__offen = 0;
class Client {
  constructor(){ this.meine = new Set(); }
  async connect(){ globalThis.__offen++; }
  async query(sql, w){
    const k = w?.[0];
    if (sql.includes("pg_try_advisory_lock")) {
      if (globalThis.__gesperrt.has(k)) return { rows: [{ ok: false }] };
      globalThis.__gesperrt.add(k); this.meine.add(k); return { rows: [{ ok: true }] };
    }
    if (sql.includes("pg_advisory_unlock")) { globalThis.__gesperrt.delete(k); this.meine.delete(k); return { rows: [] }; }
    return { rows: [] };
  }
  async end(){ for (const k of this.meine) globalThis.__gesperrt.delete(k); this.meine.clear(); globalThis.__offen--; }
}
export default { Client };
export const logger = { info(){}, warn(){}, error(){}, debug(){} };`;
  const sperre = await ladeModul("src/lib/lauf-sperre.ts", {
    attrappen: { pg: SPERRE_DB },
    alias: { pg: "pg" },
    ersetze: [{ muster: "(^|/)logger$", durch: "pg" }],
  });
  {
    globalThis.__gesperrt = new Set();
    let geworfen = false;
    try {
      await sperre.mitSperre("autonomie", async () => {
        throw new Error("mitten drin abgestürzt");
      });
    } catch {
      geworfen = true;
    }
    p("erholung:sperre-frei", "nach einem Absturz im Lauf ist die Sperre wieder frei",
      geworfen && globalThis.__gesperrt.size === 0 && globalThis.__offen === 0);

    // Und der nächste Takt kommt tatsächlich durch.
    const danach = await sperre.mitSperre("autonomie", async () => "läuft wieder");
    p("erholung:naechster-takt", "der nächste Takt läuft danach wieder an", danach === "läuft wieder");
  }

  const ergebnis = auswerten(faelle);
  return {
    ...ergebnis,
    kennzahlen: {
      "Erholungsrate (deterministisch)": ergebnis.quote,
      "Strategiewechsel gemessen": false,
    },
  };
}
