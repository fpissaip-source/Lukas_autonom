import { db } from "@workspace/db";
import { codeProposals, type CodeProposal, type ProposalFile } from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";
import { githubRequest, resolveGithubOwner } from "./github";
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

/*
 * Branch, auf den eine angenommene Aenderung geschrieben wird.
 *
 * Issas Erwartung ist eindeutig: annehmen heisst deployen. Deshalb wird per
 * Standard genau der Branch beschrieben, aus dem dieser Server gebaut wurde --
 * Railway legt ihn als RAILWAY_GIT_BRANCH in die Umgebung. Damit ist ohne jede
 * Konfiguration garantiert, dass die Aenderung dort landet, wo sie auch
 * ausgeliefert wird, und nicht auf einem Branch, den niemand baut.
 *
 * LUKAS_SELF_PATCH_BRANCH sticht das, falls es doch mal woandershin soll.
 * Ist beides leer (lokal), schreibt GitHub auf den Default-Branch.
 */
export function targetBranch(): string | null {
  const explicit = process.env.LUKAS_SELF_PATCH_BRANCH?.trim();
  if (explicit) return explicit;
  const railway = process.env.RAILWAY_GIT_BRANCH?.trim();
  return railway || null;
}

export async function createProposal(args: {
  conversationId?: number;
  repo: string;
  title: string;
  summary: string;
  reasoning: string;
  files: ProposalFile[];
}): Promise<CodeProposal> {
  const [row] = await db
    .insert(codeProposals)
    .values({
      conversationId: args.conversationId ?? null,
      repo: args.repo,
      title: args.title,
      summary: args.summary,
      reasoning: args.reasoning,
      files: args.files,
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

/*
 * Angenommenen Vorschlag anwenden: jede Datei einzeln ueber die Contents-API
 * schreiben. Bestehende Dateien brauchen ihre Blob-SHA, sonst lehnt GitHub den
 * Schreibvorgang ab; fehlt die Datei, ist es ein Neuanlegen.
 */
async function applyProposal(proposal: CodeProposal): Promise<string> {
  const { owner, repo } = await resolveGithubOwner(proposal.repo);
  const branch = targetBranch();

  const written: string[] = [];
  for (const file of proposal.files) {
    const cleanPath = file.path.replace(/^\/+/, "");
    const apiPath = `/repos/${owner}/${repo}/contents/${cleanPath
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;

    let sha: string | undefined;
    try {
      const query = branch ? `?ref=${encodeURIComponent(branch)}` : "";
      const existing = (await githubRequest(`${apiPath}${query}`)) as { sha?: string };
      sha = existing?.sha;
    } catch {
      sha = undefined; // Datei gibt es noch nicht
    }

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

  return branch
    ? `Übernommen auf ${branch}: ${written.join(", ")}. Railway baut den Branch neu — in ein paar Minuten ist es live.`
    : `Übernommen (Default-Branch): ${written.join(", ")}`;
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
