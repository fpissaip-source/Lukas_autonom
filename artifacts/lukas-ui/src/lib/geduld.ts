/*
 * Wie lange die Oberflaeche nachfragt, wenn die Leitung waehrend eines Zuges
 * abgerissen ist.
 *
 * Der Fall: Tab gewechselt, Bildschirm zu, Funkloch. Der Server arbeitet
 * weiter und speichert die Antwort — der Browser bekommt davon nur nichts mehr
 * mit. Er muss also nachfragen, bis die Antwort da ist.
 *
 * Frueher stand hier eine feste Frist von zwei Minuten. Das war die Ursache
 * dafuer, dass Lukas "oefter nicht antwortet": ein Zug, der ein Dutzend
 * Dateien liest, dauert laenger als zwei Minuten. Die Oberflaeche gab auf,
 * waehrend er noch arbeitete, und die Antwort landete unbemerkt in der
 * Datenbank.
 *
 * Jetzt entscheidet nicht die Uhr, sondern der Server: solange er meldet, dass
 * der Zug laeuft, wird die Frist immer wieder verlaengert. Erst wenn er
 * "fertig" meldet und trotzdem nichts ankommt, laeuft sie ab — dann ist
 * wirklich etwas kaputt und Aufgeben die richtige Antwort.
 *
 * Eigene Datei ohne React, damit genau diese Entscheidung fuer sich pruefbar
 * ist (siehe scripts/check-geduld.mjs).
 */

/** So lange wird nach der letzten gemeldeten Arbeit noch nachgefragt. */
export const GEDULD_MS = 90_000;

export type Warteschritt = {
  /** Zeitpunkt, bis zu dem weiter nachgefragt wird. */
  frist: number;
  /** Aufgeben und den Fehler anzeigen. */
  aufgeben: boolean;
};

/**
 * Ein Takt des Nachfragens.
 *
 * @param jetzt     aktuelle Zeit in ms
 * @param laeuft    was der Server ueber diesen Zug sagt
 * @param frist     die bisherige Frist
 * @param geduldMs  Zugabe nach jedem Lebenszeichen
 */
export function warteSchritt(
  jetzt: number,
  laeuft: boolean,
  frist: number,
  geduldMs: number = GEDULD_MS,
): Warteschritt {
  // Ein Lebenszeichen setzt die Frist neu — deshalb kann sie nie ablaufen,
  // solange er arbeitet, egal wie lange der Zug dauert.
  const neueFrist = laeuft ? jetzt + geduldMs : frist;
  return { frist: neueFrist, aufgeben: jetzt > neueFrist };
}
