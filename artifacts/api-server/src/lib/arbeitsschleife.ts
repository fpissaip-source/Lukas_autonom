/*
 * Wie lange Lukas an einem Zug arbeiten darf.
 *
 * Vorher stand hier eine Zahl: nach 8 (spaeter 12) Werkzeugrunden war Schluss,
 * egal wie gut es lief. Das ist genau die falsche Grenze. Wenn er fuer eine
 * Recherche 15 Seiten lesen oder 20 Befehle absetzen muss, DANN SOLL ER DAS.
 * Er hat einen eigenen Server; ihn nach zwoelf Handgriffen anzuhalten macht
 * ihn zu einem Chat-Fenster mit Extras.
 *
 * Das eigentliche Problem war nie die Anzahl, sondern das Im-Kreis-Laufen: ein
 * Werkzeug, das dreimal identisch aufgerufen wird, bringt beim vierten Mal auch
 * nichts Neues. Dagegen hilft keine Obergrenze, sondern ein Hinweis an ihn.
 *
 * Deshalb hier drei Dinge, und keine Bremse:
 *
 *  1. Er bekommt gesagt, wenn er sich wiederholt — mit der Aufforderung,
 *     entweder etwas anderes zu probieren oder ehrlich zu sagen, dass er nicht
 *     weiterkommt.
 *  2. Er bekommt ab und zu eine Standortbestimmung: "du bist bei Runde N,
 *     laeuft es noch?". Kein Stopp, nur die Frage.
 *  3. Eine sehr hohe Notbremse gegen eine echte Endlosschleife. Die ist nicht
 *     gegen Lukas gerichtet, sondern gegen einen Fehler, der eine Schleife nie
 *     verlassen wuerde — und sie liegt so hoch, dass normale Arbeit sie nie
 *     sieht.
 */

/** Notbremse gegen echte Endlosschleifen. Kein Arbeitslimit. */
export const NOTBREMSE = Number(process.env.LUKAS_MAX_TOOL_ROUNDS ?? 200);

/** Ab wie vielen identischen Aufrufen wird er darauf hingewiesen. */
const WIEDERHOLUNGEN = 3;

/** Alle wie viele Runden eine Standortbestimmung kommt. */
const STANDORT_ALLE = 25;

export type Hinweis = { role: "system"; content: string };

export class Arbeitsschleife {
  private gesehen = new Map<string, number>();
  private gemeldet = new Set<string>();
  private runde = 0;
  readonly begonnen = Date.now();

  /** Nur die Notbremse — sonst laeuft er, solange er arbeitet. */
  darfWeiter(): boolean {
    return this.runde < NOTBREMSE;
  }

  naechsteRunde(): number {
    return this.runde++;
  }

  get rundenZahl(): number {
    return this.runde;
  }

  /**
   * Hinweise fuer die naechste Runde: Wiederholung erkannt, Standortbestimmung
   * faellig. Leer, solange alles seinen Gang geht.
   */
  hinweise(aufrufe: Array<{ name: string; arguments: string }>): Hinweis[] {
    const raus: Hinweis[] = [];

    for (const a of aufrufe) {
      const schluessel = `${a.name}:${a.arguments}`;
      const anzahl = (this.gesehen.get(schluessel) ?? 0) + 1;
      this.gesehen.set(schluessel, anzahl);

      if (anzahl >= WIEDERHOLUNGEN && !this.gemeldet.has(schluessel)) {
        this.gemeldet.add(schluessel);
        raus.push({
          role: "system",
          content:
            `Du hast "${a.name}" jetzt ${anzahl}× mit exakt denselben Argumenten aufgerufen. ` +
            `Beim nächsten Mal kommt dasselbe zurück. Probier einen anderen Weg — andere ` +
            `Argumente, ein anderes Werkzeug, eine andere Quelle. Wenn du nicht weiterkommst: ` +
            `sag das offen und beschreibe, woran es hängt. Das ist kein Scheitern, sondern ` +
            `die brauchbarere Antwort. Weitermachen ist ausdrücklich erlaubt — im Kreis laufen nicht.`,
        });
      }
    }

    if (this.runde > 0 && this.runde % STANDORT_ALLE === 0) {
      const minuten = Math.round((Date.now() - this.begonnen) / 60000);
      raus.push({
        role: "system",
        content:
          `Standortbestimmung: du bist bei Runde ${this.runde}, seit etwa ${minuten} Minuten dran. ` +
          `Das ist völlig in Ordnung, solange du vorankommst — arbeite weiter, wenn du weißt, was ` +
          `als Nächstes zu tun ist. Falls du dich im Kreis drehst oder das Ziel unklar geworden ` +
          `ist, brich hier ab und sag, was du hast und was fehlt.`,
      });
    }

    return raus;
  }

  /** Für den Fall, dass die Notbremse wirklich gegriffen hat. */
  notbremseGriff(): boolean {
    return this.runde >= NOTBREMSE;
  }
}
