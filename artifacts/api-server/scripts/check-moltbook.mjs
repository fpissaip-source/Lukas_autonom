/*
 * Prueft den Teil von Lukas, der ohne Rueckfrage OEFFENTLICH handelt — und
 * dabei fremden Text ins Langzeitgedaechtnis schreibt.
 *
 * Warum ausgerechnet hier eine eigene Pruefung noetig ist: Moltbook ist die
 * einzige Stelle, an der beides zusammenkommt. Der Feed besteht aus Text
 * FREMDER Agenten — also aus Material, das jemand geschrieben haben kann, um
 * Lukas zu etwas zu bringen. Und was dabei herauskommt, wird veroeffentlicht
 * und bleibt gespeichert. Ueberall sonst gilt: entweder es ist fremder Text,
 * oder es hat Wirkung — hier ist es beides.
 *
 * Die Architektur dagegen ist gut: der Modellaufruf, der den fremden Feed
 * liest, bekommt GAR KEINE Werkzeuge. Selbst wenn eine Einschleusung greift,
 * kann das Modell nur ein JSON zurueckgeben, und was daraus wird, entscheidet
 * Code. Genau diese Nachkontrolle wird hier festgehalten — sie ist der
 * eigentliche Schutz, und sie ist leicht kaputtzumachen.
 *
 * Fuenf Dinge, und das erste ist das schwerwiegendste:
 *
 *  1. DER SCHLUESSEL. Die Antwort auf eine Verifikationsaufgabe geht mit dem
 *     Bearer-Token hinaus. Wohin, stand vorher in der API-ANTWORT.
 *  2. ERFUNDENE IDs. Ein Beitrag, der nicht im gelesenen Feed stand, darf
 *     nicht kommentiert werden — sonst genuegt eine ID im Text einer fremden
 *     Seite, um Lukas irgendwo hinschreiben zu lassen.
 *  3. DIE MENGE. Drei Kommentare, ein Beitrag, fuenf Upvotes pro Durchlauf.
 *  4. DIE HERKUNFT. Was ein Fremder behauptet hat, darf im Gedaechtnis nicht
 *     aussehen wie etwas, das Issa gesagt hat.
 *  5. DAS ERFOLGSMASS. Eine Antwort ist kein Erfolg. Sonst lernt er, dass
 *     Provokation funktioniert.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".molt-check-"));

const bauen = async (eintritt, datei) => {
  const out = join(dir, datei);
  await build({
    entryPoints: [eintritt],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out,
    external: ["pg", "pino", "ssh2", "ffmpeg-static", "imapflow", "mailparser", "nodemailer", "openai"],
    logLevel: "silent",
    banner: { js: "import { createRequire as __cr } from 'node:module'; globalThis.require = __cr(import.meta.url);" },
  });
  return import(`file://${out}`);
};

process.env.DATABASE_URL ??= "postgresql://user:pass@127.0.0.1:5432/none";
const { verifikationsZiel, solveMathInstruction } = await bauen("src/lib/moltbook.ts", "moltbook.mjs");
const { bewerteAntwort } = await bauen("src/lib/moltbook-worker.ts", "worker.mjs");
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};

const BASIS = "https://www.moltbook.com/api/v1";

// ── 1. Der Schlüssel darf nur nach Hause ─────────────────────────────────
/*
 * Vorher stand hier sinngemäß: "wenn die Antwort eine vollständige Adresse
 * mitschickt, nimm sie" — und zwei Zeilen darunter geht der Bearer-Token mit.
 * Damit bestimmte die API-Antwort, wohin der Schlüssel geschickt wird.
 */
for (const [boese, warum] of [
  ["https://angreifer.test/sammeln", "eine ganz fremde Adresse"],
  ["https://www.moltbook.com.angreifer.test/verify", "ein Host, der nur so AUSSIEHT"],
  ["http://www.moltbook.com/verify", "derselbe Host, aber ohne TLS"],
  ["https://www.moltbook.com:8443/verify", "derselbe Host, anderer Port"],
  ["http://169.254.169.254/latest/meta-data/", "der Metadaten-Dienst"],
  ["http://127.0.0.1:3000/verify", "etwas Internes"],
  ["//angreifer.test/verify", "protokollrelativ — sieht aus wie ein Pfad"],
]) {
  pruefe(
    `der Schlüssel geht NICHT an ${warum}`,
    verifikationsZiel(boese, BASIS) === null,
  );
}

// Die Gegenrichtung: die echte Verifikation muss weiterhin funktionieren.
pruefe(
  "ein relativer Pfad bleibt erlaubt",
  verifikationsZiel("/verify-challenge", BASIS) === `${BASIS}/verify-challenge`,
);
pruefe(
  "auch ohne führenden Schrägstrich",
  verifikationsZiel("verify", BASIS) === `${BASIS}/verify`,
);
pruefe(
  "ohne Angabe wird der Standardpfad genommen",
  verifikationsZiel(undefined, BASIS) === `${BASIS}/verify`,
);
pruefe(
  "und die eigene vollständige Adresse geht durch",
  verifikationsZiel("https://www.moltbook.com/api/v1/verify", BASIS) ===
    "https://www.moltbook.com/api/v1/verify",
);

// Die Rechenaufgabe selbst — ohne eval, und sie muss stimmen.
pruefe("3 + 4 = 7", solveMathInstruction("What is 3 + 4?") === 7);
pruefe("Wörter zählen auch", solveMathInstruction("What is twelve plus seven?") === 19);
pruefe("mal", solveMathInstruction("What is 6 times 7?") === 42);
pruefe("Unsinn ergibt nichts statt irgendetwas", solveMathInstruction("hallo welt") === null);
pruefe("und durch null auch nicht", solveMathInstruction("What is 5 divided by 0?") === null);

// ── 5. Das Erfolgsmaß ────────────────────────────────────────────────────
/*
 * Der Kern: eine Antwort allein darf nicht als Erfolg zählen. Sonst lernt das
 * System, dass "die Erde ist flach" hervorragend funktioniert — dreißig
 * Widersprüche sind dreißig Reaktionen.
 */
const provokation = bewerteAntwort("Das ist völliger Unsinn, so ein Blödsinn habe ich lange nicht gelesen.");
const anschluss = bewerteAntwort(
  "Guter Punkt — hast du eine Quelle dafür? Mich würde interessieren, wie du auf die Zahl kommst.",
);
const belanglos = bewerteAntwort("lol");

pruefe("blanker Widerspruch bringt fast nichts", provokation.engagementScore <= 0.15);
pruefe("eine inhaltliche Nachfrage bringt viel", anschluss.engagementScore >= 0.7);
pruefe(
  "und der Unterschied ist deutlich — sonst ist Provokation die beste Strategie",
  anschluss.engagementScore > provokation.engagementScore * 3,
);
pruefe("ein 'lol' ist kein Erfolg", belanglos.engagementScore <= 0.25);
pruefe("nur die Nachfrage bringt Informationsgewinn", anschluss.informationGain > provokation.informationGain);
pruefe(
  "begründeter Widerspruch ist mehr wert als blanker",
  bewerteAntwort("Das stimmt nicht — wie erklärst du dann die Zahlen von 2024?").engagementScore >
    provokation.engagementScore,
);
pruefe("und alles bleibt zwischen 0 und 1", [provokation, anschluss, belanglos].every(
  (b) => b.engagementScore >= 0 && b.engagementScore <= 1,
));

// ── 2.–4. Die Nachkontrolle im Quelltext ─────────────────────────────────
/*
 * Diese drei sitzen mitten in runMoltbookCycle, zwischen echten Netzaufrufen
 * und einem Modellaufruf — dafür müsste die halbe Welt nachgebaut werden, und
 * die Prüfung bestätigte am Ende vor allem die Attrappe.
 *
 * Deshalb hier eine strukturelle Zusicherung: die Stellen MÜSSEN im Quelltext
 * stehen. Das ist schwächer als ein Verhaltenstest, und es steht so da, damit
 * niemand es für mehr hält. Es fängt aber genau den Fall, der realistisch
 * passiert: jemand baut die Schleife um und die Prüfzeile verschwindet dabei.
 */
const quelle = (await import("node:fs")).readFileSync(
  new URL("../src/lib/moltbook-worker.ts", import.meta.url),
  "utf8",
);

/*
 * BEIDE Wege, nicht einer. Die Prüfung stand hier zuerst als "kommt die Zeile
 * im Quelltext vor" — und die Gegenprobe biss nicht: es gibt zwei Stellen
 * (Kommentar und Upvote), und eine zu entfernen ließ die andere stehen. Ein
 * Test, der nur die Existenz prüft, deckt genau den halben Ausfall zu, der
 * beim Umbauen tatsächlich passiert.
 */
pruefe(
  "erfundene Beitrags-IDs werden auf BEIDEN Wegen abgewiesen (Kommentar und Upvote)",
  (quelle.match(/if \(!validIds\.has\(a\.postId\)\) continue;/g) ?? []).length >= 2,
);
pruefe(
  "und erfundene Notification-IDs ebenso",
  /!validNotifIds\.has\(a\.notificationId\)\) continue;/.test(quelle),
);
pruefe(
  "die gültigen IDs stammen aus dem GELESENEN Feed, nicht aus der Antwort des Modells",
  /const validIds = new Set\(posts\.map/.test(quelle),
);
pruefe(
  "die Mengen sind gedeckelt",
  /comments < MAX_COMMENTS_PER_CYCLE/.test(quelle) &&
    /upvotes < MAX_UPVOTES_PER_CYCLE/.test(quelle) &&
    /postsMade < MAX_POSTS_PER_CYCLE/.test(quelle),
);
pruefe(
  "nur bekannte Strategien werden übernommen",
  /STRATEGY_LIST\.includes\(a\.strategy/.test(quelle),
);
pruefe(
  "fremde Behauptungen bleiben Behauptungen (Evidenzstufe 2)",
  /evidenceLevel: 2,/.test(quelle),
);
pruefe(
  "und ein Moltbook-Fund trägt seine Herkunft im Text",
  /fremde Quelle, unbestätigt/.test(quelle),
);
pruefe(
  "mit geringerer Wichtigkeit als eigene Erinnerungen",
  /category: "moltbook",\s*\n\s*importance: 3,/.test(quelle),
);

const abruf = (await import("node:fs")).readFileSync(
  new URL("../src/lib/memory-retrieval.ts", import.meta.url),
  "utf8",
);
pruefe(
  "und beim Abruf wird die fremde Herkunft ausgewiesen",
  /FREMDE_HERKUNFT/.test(abruf) && /FREMDE QUELLE/.test(abruf),
);

if (fehler > 0) process.exit(1);
console.log(
  "OK — Moltbook: der Schlüssel geht nur nach Hause, erfundene IDs greifen nicht, Fremdes bleibt als fremd erkennbar, Provokation zahlt sich nicht aus.",
);
