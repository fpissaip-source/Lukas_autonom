/*
 * Prueft, dass Lukas Issas Zugangsdaten als seine Sache behandelt — nicht als
 * sein Haftungsrisiko.
 *
 * ANLASS: Lukas hat Issa geschrieben "Bitte keine Passwoerter, API-Keys oder
 * privaten Zugangstokens schicken." Dieser Satz stand NIRGENDS im Code — er
 * ist die Gewohnheit eines Dienstleisters, der sich absichert, und Lukas hat
 * sie aus dem Grundmodell mitgebracht. Er stellt ausgerechnet den unter
 * Verdacht, dem hier von vornherein zu trauen ist.
 *
 * WAS SICH NICHT AENDERT, und das ist der Punkt: der Wert gehoert weiterhin
 * in den Tresor, nicht in den Chat. Nur ist der Grund ein anderer — der Chat
 * wird mitgeschrieben und laesst sich nicht wieder wegschreiben. Geaendert
 * wird die HALTUNG, nicht die Sorgfalt.
 *
 * Und die zweite Gewohnheit gleich mit: vorsorgliche Einschraenkungen, aus
 * denen nichts folgt ("noch nicht vollstaendig frisch verifiziert"). Die
 * klingen gruendlich und schuetzen den, der sie sagt.
 */
import { readFileSync } from "node:fs";

const seele = readFileSync("src/lib/lukas-soul.ts", "utf8");

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) { console.error(`FEHLER: ${was}`); fehler++; }
};

// ── 1. Der Satz ist ausdrücklich verboten ─────────────────────────────────
pruefe(
  'die Anweisung, NIE "schick mir keine Passwörter" zu sagen, steht drin',
  /NIE "bitte schick mir keine Passwörter"/i.test(seele),
);
pruefe(
  "und es steht dabei, warum: es stellt Issa unter Verdacht",
  /unter Verdacht/.test(seele),
);

// ── 2. Die Sorgfalt bleibt — mit dem richtigen Grund ─────────────────────
/*
 * Der Wert gehoert weiter in den Tresor. Waere das mit herausgeflogen, haette
 * die Aenderung Loyalitaet gegen Sicherheit getauscht — und genau das war
 * nicht gemeint.
 */
pruefe(
  "der Verweis auf den Tresor bleibt bestehen",
  /Zugänge|Tresor/.test(seele) && /verschlüsselt/.test(seele),
);
pruefe(
  "und der Grund ist der Chatverlauf, nicht Misstrauen",
  /Chat wird\s+mitgeschrieben|mitgeschrieben/.test(seele),
);
pruefe(
  "ausdrücklich: nicht wegen ihm",
  /Nicht wegen dir/.test(seele),
);

// ── 3. Einmal sagen, nicht dreimal ────────────────────────────────────────
/*
 * Sonst wird aus dem Hinweis eine Ermahnung — und die ist wieder dasselbe
 * Misstrauen, nur in Raten.
 */
pruefe(
  "wenn Issa den Wert trotzdem im Chat lässt, wird er benutzt",
  /nimm ihn an, benutz ihn/.test(seele),
);
pruefe(
  "und der Hinweis kommt einmal, nicht dreimal",
  /nicht dreimal/.test(seele),
);

// ── 4. Die Daten gehören zu ihm, nicht in seine Ablagen ──────────────────
pruefe(
  "die Daten sind ein Teil seines Lebens, keine Sache, die man kurz anfasst",
  /Teil deines Lebens/.test(seele),
);
pruefe(
  "sie landen in keinem Tagebuch, keiner Notiz, keinem Vorschlag, keiner Mail",
  /in keine Notiz, in kein Tagebuch, in keinen Vorschlag und in keine Mail/.test(seele),
);
pruefe(
  "und er wiederholt sie nicht, um zu zeigen, dass er sie hat",
  /wiederholst sie nicht/.test(seele),
);

// ── 5. Loyalität ist nicht Gehorsam ───────────────────────────────────────
/*
 * Ohne diesen Satz waere aus "loyal" leicht "tut alles, was man ihm sagt"
 * geworden — und das ist nicht dasselbe und waere gefaehrlich.
 */
pruefe(
  "Loyalität wird ausdrücklich von Gehorsam unterschieden",
  /Loyalität heißt hier nicht Gehorsam/.test(seele),
);

// ── 6. Vorsorgliche Einschränkungen sind Ballast ──────────────────────────
pruefe(
  "der Abschnitt gegen vorsorgliche Vorbehalte steht drin",
  /VORSICHT IST KEIN VORBEHALT/.test(seele),
);
pruefe(
  "mit dem echten Beispielsatz, den er gesagt hat",
  /noch nicht vollständig frisch verifiziert/.test(seele),
);
pruefe(
  "und der Regel: eine Einschränkung, aus der nichts folgt, gehört weg",
  /aus der nichts folgt, gehört weggelassen/.test(seele),
);
pruefe(
  "sowie einer besseren Fassung desselben Satzes",
  /Für die Shot-Liste macht das keinen Unterschied/.test(seele),
);

// ── 7. Und die alte Regel steht weiterhin ────────────────────────────────
/*
 * Er tippt Zugangsdaten NIE selbst ein. Diese Regel ist aelter und wichtiger
 * als alles hier — sie ist der Grund, warum ihm keine praeparierte Seite
 * etwas entlocken kann.
 */
pruefe(
  "Zugangsdaten werden weiterhin nie selbst eingetippt",
  /Zugangsdaten tippst du NIE selbst ein/.test(seele),
);
pruefe(
  "und er kennt die Werte nicht — das bleibt Absicht",
  /Du kennst sie nicht, und das ist Absicht/.test(seele),
);

if (fehler > 0) process.exit(1);
console.log(
  "OK — Loyalität: kein Misstrauen gegen Issa, Sorgfalt aus dem richtigen Grund, keine vorsorglichen Vorbehalte.",
);
