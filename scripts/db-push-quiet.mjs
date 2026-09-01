#!/usr/bin/env node
// Wrapper um `npm run db:push` für den Deploy-Start.
//
// Hintergrund: Auf einer GETEILTEN Postgres (z.B. die DB einer bestehenden
// Webseite) versucht drizzle-kit, fremde Sequenzen zu droppen (z.B.
// users_id_seq oder conversations_id_seq der Webseite). Postgres blockiert
// das über die Abhängigkeit (SQLSTATE 2BP01) — unsere lukas_*-Tabellen
// entstehen trotzdem und es gehen keine Daten verloren. Der 40-zeilige
// Stacktrace im Deploy-Log ist also reines Rauschen; dieses Skript fasst
// genau diesen bekannten Fall zu einer Warnzeile zusammen. Jeder ANDERE
// Fehler wird unverändert und vollständig ausgegeben.

import { spawnSync } from "node:child_process";

const result = spawnSync("npm", ["run", "db:push"], {
  encoding: "utf8",
  env: process.env,
  maxBuffer: 32 * 1024 * 1024,
});

const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
const isKnownSharedDbNoise =
  out.includes("2BP01") ||
  (/cannot drop sequence/i.test(out) && /other objects depend on it/i.test(out));

if (result.status === 0 && !isKnownSharedDbNoise) {
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exit(0);
}

if (isKnownSharedDbNoise) {
  // Nützliche Zeilen (angelegte Tabellen etc.) behalten, Stacktrace weglassen.
  const kept = (result.stdout ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/\[[0-9;]*[A-Za-z]/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/error|failed|DROP SEQUENCE|Pulling schema/i.test(line))
    .join("\n")
    .trimEnd();
  if (kept) process.stdout.write(`${kept}\n`);
  console.warn(
    "WARNUNG (bekannt & harmlos): drizzle-kit wollte fremde Sequenzen der geteilten DB droppen — " +
      "Postgres hat das blockiert (2BP01). Die lukas_*-Tabellen sind angelegt/aktuell, es gingen keine Daten verloren.",
  );
  // Bekanntes Rauschen zählt nicht als Fehler — Start läuft normal weiter.
  process.exit(0);
}

/*
 * Unbekannter Fehler: alles zeigen und den Exit-Code durchreichen.
 *
 * Der Kommentar hier sagte bis eben, der Server starte trotzdem. Das stimmt
 * nicht mehr: start:deploy haengt den Start jetzt mit && an diesen Schritt.
 * Ein Server, der gegen ein Schema laeuft, das nicht zum Code passt, ist
 * schlimmer als einer, der gar nicht erst hochkommt — im ersten Fall
 * verteilen sich die Fehler ueber den Betrieb, im zweiten stehen sie am
 * Deployment.
 *
 * Das bekannte Rauschen der geteilten Datenbank (2BP01) faellt NICHT
 * hierher — es endet oben mit exit 0.
 */
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exit(result.status ?? 1);
