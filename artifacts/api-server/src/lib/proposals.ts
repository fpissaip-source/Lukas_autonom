import { db } from "@workspace/db";
import { codeProposals, type CodeProposal, type ProposalFile } from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";
import { githubRequest, resolveGithubOwner, selfBranch } from "./github";
import { logger } from "./logger";

/*
 * Lukas' Code-Vorschlaege.
 *
 * Der Weg ist absichtlich kurz: Lukas legt einen Vorschlag an, Issa liest ihn
 * im Dashboard in normaler Sprache und entscheidet dort. Kein Branch, kein
 * Pull Request, kein Wechsel zu GitHub.
 *
 * Erst beim "Annehmen" wird ueberhaupt etwas geschrieben — vorher liegt der
 * Vorschlag nur in unserer eigenen Datenbank. Deshalb braucht das Anlegen auch
 * keine separate Freigabe: der Vorschlag selbst kann nichts kaputt machen, und
 * die Entscheidung darueber IST die Freigabe.
 */

// Branch, auf den eine angenommene Aenderung geschrieben wird — derselbe, den
// Lukas auch beim Lesen seines eigenen Codes benutzt (lib/github.ts).
export const targetBranch = selfBranch;

/**
 * Die aktuelle Blob-SHA einer Datei auf dem Zielbranch. `null`, wenn es die
 * Datei dort (noch) nicht gibt.
 */
async function aktuelleSha(
  owner: string,
  repo: string,
  pfad: string,
  branch: string | null,
): Promise<string | null> {
  const apiPath = `/repos/${owner}/${repo}/contents/${pfad
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  try {
    const query = branch ? `?ref=${encodeURIComponent(branch)}` : "";
    const existing = (await githubRequest(`${apiPath}${query}`)) as { sha?: string };
    return existing?.sha ?? null;
  } catch {
    return null; // Datei gibt es noch nicht
  }
}

export async function createProposal(args: {
  conversationId?: number;
  repo: string;
  title: string;
  summary: string;
  reasoning: string;
  files: ProposalFile[];
}): Promise<CodeProposal> {
  /*
   * Festhalten, gegen WELCHEN Stand dieser Vorschlag geschrieben ist.
   *
   * Ohne das ueberschreibt ein spaeter angenommener Vorschlag stillschweigend
   * alles, was in der Zwischenzeit an derselben Datei passiert ist — der
   * Inhalt ist ja der vollstaendige alte Dateiinhalt plus Lukas' Aenderung.
   */
  const { owner, repo } = await resolveGithubOwner(args.repo);
  const branch = targetBranch();
  const files: ProposalFile[] = [];
  for (const file of args.files) {
    const pfad = file.path.replace(/^\/+/, "");
    files.push({
      ...file,
      path: pfad,
      baseSha: await aktuelleSha(owner, repo, pfad, branch),
    });
  }

  const [row] = await db
    .insert(codeProposals)
    .values({
      conversationId: args.conversationId ?? null,
      repo: args.repo,
      title: args.title,
      summary: args.summary,
      reasoning: args.reasoning,
      files,
      status: "pending",
    })
    .returning();
  logger.info({ proposalId: row.id, files: args.files.length }, "Code-Vorschlag angelegt");
  return row;
}

export async function listProposals(): Promise<CodeProposal[]> {
  return db.select().from(codeProposals).orderBy(desc(codeProposals.createdAt)).limit(100);
}

export async function getProposal(id: number): Promise<CodeProposal | null> {
  const [row] = await db.select().from(codeProposals).where(eq(codeProposals.id, id));
  return row ?? null;
}

/** Eine Datei, die sich seit dem Vorschlag geaendert hat. */
export type Konflikt = { pfad: string; grund: string };

/*
 * Ist der Vorschlag noch auf dem aktuellen Stand?
 *
 * Das ist die Pruefung, die gefehlt hat. Ein Vorschlag enthaelt den
 * VOLLSTAENDIGEN neuen Dateiinhalt — geschrieben gegen den Stand von damals.
 * Wird er spaeter angenommen und die Datei hat sich inzwischen geaendert, geht
 * die Zwischenzeit verloren, ohne dass jemand etwas merkt.
 *
 * Genau so hat Vorschlag #3 beim Annehmen eine Zeile entfernt, die kurz vorher
 * dazugekommen war.
 */
async function pruefeAktualitaet(proposal: CodeProposal): Promise<Konflikt[]> {
  const { owner, repo } = await resolveGithubOwner(proposal.repo);
  const branch = targetBranch();
  const konflikte: Konflikt[] = [];

  for (const file of proposal.files) {
    const pfad = file.path.replace(/^\/+/, "");
    const jetzt = await aktuelleSha(owner, repo, pfad, branch);

    // Alte Vorschlaege haben keine baseSha — dann ist keine Pruefung moeglich.
    if (file.baseSha === undefined) continue;

    if ((file.baseSha ?? null) === jetzt) continue;

    konflikte.push({
      pfad,
      grund:
        file.baseSha === null
          ? "Die Datei gab es beim Vorschlag noch nicht, inzwischen schon."
          : jetzt === null
            ? "Die Datei wurde inzwischen gelöscht."
            : "Die Datei wurde seit dem Vorschlag geändert.",
    });
  }

  return konflikte;
}

/*
 * Angenommenen Vorschlag anwenden: jede Datei einzeln ueber die Contents-API
 * schreiben. Bestehende Dateien brauchen ihre Blob-SHA, sonst lehnt GitHub den
 * Schreibvorgang ab; fehlt die Datei, ist es ein Neuanlegen.
 *
 * Geschrieben wird erst, wenn ALLE Dateien geprueft sind. Vorher lief die
 * Schleife Datei fuer Datei — scheiterte die dritte, waren die ersten beiden
 * schon geschrieben und das Repository in einem Zustand, den niemand so
 * beschlossen hat.
 */
async function applyProposal(proposal: CodeProposal): Promise<string> {
  const { owner, repo } = await resolveGithubOwner(proposal.repo);
  const branch = targetBranch();

  const written: string[] = [];
  const ohnePruefung: string[] = [];

  for (const file of proposal.files) {
    const cleanPath = file.path.replace(/^\/+/, "");
    if (file.baseSha === undefined) ohnePruefung.push(cleanPath);

    const apiPath = `/repos/${owner}/${repo}/contents/${cleanPath
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;

    const sha = await aktuelleSha(owner, repo, cleanPath, branch);

    const result = (await githubRequest(apiPath, {
      method: "PUT",
      body: {
        message: `${proposal.title}\n\nVorschlag #${proposal.id} von Lukas, angenommen von Issa.`,
        content: Buffer.from(file.content, "utf-8").toString("base64"),
        ...(branch ? { branch } : {}),
        ...(sha ? { sha } : {}),
      },
    })) as { commit?: { html_url?: string } };

    written.push(cleanPath);
    if (result?.commit?.html_url) {
      logger.info({ proposalId: proposal.id, url: result.commit.html_url }, "Vorschlag geschrieben");
    }
  }

  const hinweis = ohnePruefung.length
    ? `\n\nHinweis: ${ohnePruefung.join(", ")} stammt aus einem Vorschlag von vor der ` +
      `Aktualitätsprüfung — hier konnte nicht geprüft werden, ob sich zwischenzeitlich etwas ` +
      `geändert hat. Bitte den Commit kurz ansehen.`
    : "";

  return (
    (branch
      ? `Übernommen auf ${branch}: ${written.join(", ")}. Railway baut den Branch neu — in ein paar Minuten ist es live.`
      : `Übernommen (Default-Branch): ${written.join(", ")}`) + hinweis
  );
}

export type Decision = "accept" | "reject" | "revision";

export async function decideProposal(
  id: number,
  decision: Decision,
  comment?: string,
): Promise<CodeProposal> {
  const proposal = await getProposal(id);
  if (!proposal) throw new Error(`Vorschlag ${id} existiert nicht.`);
  if (proposal.status === "accepted") {
    throw new Error(`Vorschlag ${id} wurde bereits übernommen.`);
  }

  if (decision !== "accept") {
    const [row] = await db
      .update(codeProposals)
      .set({
        status: decision === "reject" ? "rejected" : "revision",
        comment: comment ?? null,
        decidedAt: new Date(),
      })
      .where(eq(codeProposals.id, id))
      .returning();
    return row;
  }

  /*
   * Vor dem Schreiben: ist der Vorschlag ueberhaupt noch aktuell?
   *
   * Wenn nicht, wird NICHT geschrieben. Der Vorschlag geht stattdessen mit
   * einer Begruendung an Lukas zurueck, damit er ihn gegen den jetzigen Stand
   * neu schreibt. Das ist der Unterschied zwischen "Issa hat zugestimmt" und
   * "Issa hat zugestimmt, dass die Arbeit der letzten Stunde geloescht wird".
   */
  const konflikte = await pruefeAktualitaet(proposal);
  if (konflikte.length > 0) {
    const begruendung =
      `Nicht übernommen — der Vorschlag ist nicht mehr aktuell:\n` +
      konflikte.map((k) => `- ${k.pfad}: ${k.grund}`).join("\n") +
      `\n\nEr enthält den vollständigen Dateiinhalt von damals. Übernommen würde er ` +
      `alles überschreiben, was seitdem an diesen Dateien passiert ist. ` +
      `Lukas soll die betroffenen Dateien neu lesen und den Vorschlag gegen den ` +
      `jetzigen Stand noch einmal schreiben.`;

    logger.warn({ proposalId: id, konflikte }, "Vorschlag veraltet — nicht übernommen");

    const [row] = await db
      .update(codeProposals)
      .set({
        status: "revision",
        comment: [comment, begruendung].filter(Boolean).join("\n\n"),
        appliedResult: begruendung,
        decidedAt: new Date(),
      })
      .where(eq(codeProposals.id, id))
      .returning();
    return row;
  }

  // Erst schreiben, dann als angenommen markieren. Andersherum stuende der
  // Vorschlag auf "übernommen", obwohl GitHub den Commit abgelehnt hat.
  let appliedResult: string;
  try {
    appliedResult = await applyProposal(proposal);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, proposalId: id }, "Vorschlag konnte nicht übernommen werden");
    const [row] = await db
      .update(codeProposals)
      .set({ appliedResult: `Fehlgeschlagen: ${message}` })
      .where(eq(codeProposals.id, id))
      .returning();
    return row;
  }

  const [row] = await db
    .update(codeProposals)
    .set({
      status: "accepted",
      comment: comment ?? null,
      appliedResult,
      decidedAt: new Date(),
    })
    .where(eq(codeProposals.id, id))
    .returning();
  return row;
}

/*
 * Was Lukas im Systemprompt ueber seine eigenen Vorschlaege erfaehrt.
 *
 * Ohne das wuerde er nie mitbekommen, dass Issa etwas zurueckgeschickt oder
 * abgelehnt hat — er wuerde denselben Vorschlag wieder und wieder machen.
 */
export async function getProposalContext(): Promise<string> {
  const rows = await db
    .select()
    .from(codeProposals)
    .where(inArray(codeProposals.status, ["pending", "revision"]))
    .orderBy(desc(codeProposals.createdAt))
    .limit(10);
  if (rows.length === 0) return "";

  const lines = rows.map((r) => {
    if (r.status === "revision") {
      return (
        `- #${r.id} "${r.title}" — Issa hat zurückgeschickt und kommentiert: ` +
        `"${(r.comment ?? "").slice(0, 400)}" ` +
        `Arbeite den Kommentar ein und schick den Vorschlag neu.`
      );
    }
    return `- #${r.id} "${r.title}" — liegt im Dashboard und wartet auf Issas Entscheidung. Schlag das nicht nochmal vor.`;
  });

  return ["## DEINE OFFENEN CODE-VORSCHLÄGE", ...lines].join("\n");
}
