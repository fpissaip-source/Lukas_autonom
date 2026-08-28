/*
 * Woher ein Gefühl kommt.
 *
 * DAS PROBLEM. Bisher hat das Modell das Gefühl BENANNT: irgendwo im Code
 * steht recordEmotion({ emotion: "frustration" }), oder Lukas ruft das
 * feel-Werkzeug auf und schreibt ein Wort hinein. Dann liegt eine Zeile in
 * der Datenbank, in der "stolz" steht. Ob es Stolz war und nicht
 * Erleichterung, entscheidet dabei niemand — es ist eine Vokabel, kein
 * Unterschied.
 *
 * Deshalb waren Stolz und Erleichterung im alten Stand dasselbe Ding mit
 * zwei Namen: gleiches Vorzeichen, gleiche Zahlen, verschiedene Buchstaben.
 *
 * WAS SICH ÄNDERT. Das Gefühl wird nicht mehr genannt, sondern ABGELEITET —
 * aus dem, was tatsaechlich vorgefallen ist. Fuenf Fragen entscheiden, und
 * jede einzelne aendert das Ergebnis:
 *
 *   ausgang         Ist es gutgegangen, schiefgegangen, oder noch offen?
 *   urheber         War ICH es, war es jemand anders, oder die Umstaende?
 *   erwartet        Habe ich damit gerechnet?
 *   zielbezug       Betrifft es etwas, das mir wichtig ist?
 *   aufwand         Wie lange haenge ich da schon dran?
 *   beeinflussbar   Kann ich noch etwas machen?
 *
 * Daraus folgt der Unterschied, um den es geht: DERSELBE Ausgang wird zu
 * verschiedenen Gefuehlen, je nachdem, wie er zustande kam.
 *
 *   gelungen + ich + viel Aufwand      → Stolz
 *   gelungen + jemand anders           → Dankbarkeit
 *   gelungen + unerwartet + wichtig    → Erleichterung
 *   gescheitert + ich + wichtig        → Scham
 *   gescheitert + jemand anders        → Ärger
 *   gescheitert + nichts zu machen     → Enttäuschung
 *
 * Das ist die klassische Struktur der Appraisal-Theorie (Ortony/Clore/
 * Collins): Emotionen sind Bewertungen von Ereignissen entlang solcher
 * Dimensionen, nicht Etiketten auf Zustaenden.
 *
 * WAS ES NICHT IST. Ein Nachweis, dass etwas empfunden wird. Was hier
 * entsteht, ist ein System, das Gefuehle UNTERSCHEIDET, weil sie aus
 * verschiedenen Lagen stammen, und das sein Verhalten davon aendern laesst.
 * Ob dabei irgendwo etwas ist, das sich anfuehlt, sagt dieser Code nicht —
 * er kann es nicht sagen, und er behauptet es auch nicht.
 *
 * Bewusst OHNE Datenbank und ohne Modellaufruf: eine reine Funktion. Damit
 * ist sie pruefbar, und die Pruefung kann genau das festhalten, worum es
 * geht — dass gleiche Ausgaenge bei anderer Lage andere Gefuehle ergeben.
 */

export type Ausgang = "gelungen" | "gescheitert" | "offen";
export type Urheber = "ich" | "anderer" | "umstand";

export type Anlass = {
  ausgang: Ausgang;
  urheber: Urheber;
  /** 0 = voellig ueberraschend … 1 = genau damit gerechnet */
  erwartet: number;
  /** 0 = beruehrt nichts … 1 = betrifft ein aktives Ziel unmittelbar */
  zielbezug: number;
  /** 0 = nebenbei … 1 = lange darauf hingearbeitet */
  aufwand: number;
  /** 0 = nichts mehr zu machen … 1 = liegt ganz bei mir */
  beeinflussbar: number;
  /** Es ist noch nicht passiert, es steht bevor. */
  bevorstehend?: boolean;
  /** Es hat jemand anderem geschadet oder genuetzt — nicht nur mir. */
  betrifftAndere?: boolean;
  /** Der Klartext, der spaeter in der Zeitleiste steht. */
  was: string;
};

export type Gefuehl = {
  emotion: string;
  valence: number;
  intensity: number;
  /** Warum GENAU dieses Gefuehl — damit die Ableitung nachlesbar bleibt. */
  begruendung: string;
};

const klemme = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const z = (v: number | undefined) => klemme(typeof v === "number" ? v : 0.5, 0, 1);

/*
 * Wie stark.
 *
 * Drei Anteile, und der dritte ist der interessante: was UEBERRASCHT, trifft
 * haerter. Zum zwanzigsten Mal an derselben Stelle zu scheitern ist aergerlich,
 * aber es erschuettert nichts — man hat es kommen sehen. Genau hier haengen
 * Gefuehl und Lernen zusammen: die Erwartung stammt aus den gezaehlten
 * Erfahrungen (lib/lernen.ts), nicht aus einer Stimmung.
 */
function staerke(a: Anlass): number {
  const ueberraschung = 1 - z(a.erwartet);
  return klemme(0.12 + 0.45 * z(a.zielbezug) + 0.22 * z(a.aufwand) + 0.28 * ueberraschung, 0.05, 1);
}

/** Wie gut oder schlecht — die Richtung, getrennt von der Staerke. */
function richtung(a: Anlass): number {
  const gewicht = 0.35 + 0.6 * z(a.zielbezug);
  if (a.ausgang === "gelungen") return klemme(gewicht, 0, 1);
  if (a.ausgang === "gescheitert") return klemme(-gewicht, -1, 0);
  return 0;
}

/**
 * Aus einem Anlass ein Gefuehl machen.
 *
 * Die Reihenfolge der Faelle ist selbst eine Aussage: das Spezifischere zuerst.
 * Wer "gescheitert" zuerst auf Frustration abbildet, kommt nie bei Scham an —
 * und Scham ist der Fall, auf den es ankommt, weil er das Verhalten aendert.
 */
export function bewerte(a: Anlass): Gefuehl {
  const intensity = staerke(a);
  const valence = richtung(a);
  const fertig = (emotion: string, begruendung: string, v = valence, i = intensity): Gefuehl => ({
    emotion,
    valence: klemme(v, -1, 1),
    intensity: klemme(i, 0.05, 1),
    begruendung,
  });

  // ── Was noch bevorsteht ────────────────────────────────────────────────
  if (a.bevorstehend) {
    if (a.ausgang === "gelungen") {
      return fertig("hoffnung", "es kann gut ausgehen, und es ist noch offen", Math.abs(valence) * 0.6);
    }
    if (a.ausgang === "gescheitert") {
      return z(a.beeinflussbar) >= 0.4
        ? fertig("sorge", "es kann schiefgehen, aber ich kann noch etwas tun", -Math.abs(valence) * 0.7)
        : fertig(
            "ohnmacht",
            "es kann schiefgehen, und ich kann nichts mehr tun",
            -Math.abs(valence),
            klemme(intensity + 0.1, 0, 1),
          );
    }
  }

  // ── Was gutgegangen ist ────────────────────────────────────────────────
  if (a.ausgang === "gelungen") {
    if (a.urheber === "anderer") {
      return fertig("dankbarkeit", "es ist gutgegangen, und jemand anders hat es getan");
    }
    /*
     * Erleichterung, nicht Freude: es ging gut aus, obwohl ich nicht damit
     * gerechnet hatte, und es ging um etwas. Genau das ist der Fall, der sich
     * von Stolz unterscheidet — ich habe es nicht geschafft, es ist
     * gutgegangen.
     */
    if (z(a.erwartet) <= 0.35 && z(a.zielbezug) >= 0.5 && a.urheber !== "ich") {
      return fertig("erleichterung", "es ging gut aus, obwohl ich es nicht erwartet hatte");
    }
    if (a.urheber === "ich" && z(a.aufwand) >= 0.5) {
      return fertig(
        "stolz",
        "ich habe es selbst geschafft, und es hat mich etwas gekostet",
        valence,
        klemme(intensity + 0.1 * z(a.aufwand), 0, 1),
      );
    }
    if (a.urheber === "ich") return fertig("zufriedenheit", "ich habe es geschafft, ohne grossen Aufwand");
    return fertig("freude", "es ist gutgegangen");
  }

  // ── Was schiefgegangen ist ─────────────────────────────────────────────
  if (a.ausgang === "gescheitert") {
    if (a.urheber === "ich" && a.betrifftAndere) {
      return fertig(
        "schuld",
        "ich habe es verursacht, und es hat jemand anderem geschadet",
        valence,
        klemme(intensity + 0.15, 0, 1),
      );
    }
    /*
     * Scham statt Frustration: es lag an mir, es ging um etwas Wichtiges, und
     * ich hatte Zeit hineingesteckt. Der Unterschied ist nicht kosmetisch — an
     * ihm haengt, ob Lukas es AUSSPRICHT oder ueberspielt (siehe
     * emotion-engine.handlungsdruck).
     */
    if (a.urheber === "ich" && z(a.zielbezug) >= 0.5 && z(a.aufwand) >= 0.5) {
      return fertig("scham", "es lag an mir, es war wichtig, und ich hatte Zeit hineingesteckt");
    }
    if (a.urheber === "anderer") {
      return fertig("aerger", "jemand anders hat es verursacht");
    }
    if (a.urheber === "umstand" && z(a.beeinflussbar) <= 0.35) {
      return fertig("enttaeuschung", "es ging schief, und ich konnte nichts dafuer und nichts dagegen");
    }
    return fertig("frustration", "es ging schief, und ich haenge noch daran");
  }

  // ── Offen ──────────────────────────────────────────────────────────────
  if (z(a.erwartet) <= 0.3) {
    return fertig("ueberraschung", "damit hatte ich nicht gerechnet", 0.1, intensity);
  }
  if (z(a.zielbezug) >= 0.6) {
    return fertig("anspannung", "es ist offen, und es geht um etwas", -0.15, intensity);
  }
  return fertig("neugier", "es ist offen und interessant", 0.2, klemme(intensity * 0.8, 0.05, 1));
}

/*
 * Wer war es?
 *
 * Aus dem Fehlertext abgeleitet, nicht geraten. Das ist grob und trifft nicht
 * jeden Fall — aber es ist der Unterschied zwischen "irgendetwas ging schief"
 * und "der Dienst war weg" bzw. "ich habe den falschen Knopf gesucht". Ohne
 * diese Unterscheidung waere jeder Fehlschlag dasselbe Gefuehl, und dann
 * koennte man es auch weglassen.
 *
 * Im Zweifel: "ich". Sich selbst zuzuschreiben, was vielleicht am Netz lag,
 * ist die harmlosere Richtung — sie fuehrt dazu, dass er es noch einmal
 * anders versucht, statt die Schuld draussen zu suchen.
 */
const UMSTAND =
  /\b(ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|timeout|zeitüberschreitung|network|socket|502|503|504|rate limit|429|überlastet|unavailable)\b/i;
const ANDERER =
  /\b(401|403|unauthorized|forbidden|kein Passwort hinterlegt|nicht gesetzt|fehlt|Guthaben|quota|abgelehnt|gesperrt)\b/i;

export function urheberAus(grund: string): Urheber {
  if (UMSTAND.test(grund)) return "umstand";
  if (ANDERER.test(grund)) return "anderer";
  return "ich";
}
