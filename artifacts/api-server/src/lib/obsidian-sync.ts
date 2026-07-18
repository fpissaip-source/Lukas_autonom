/*
 * Obsidian-Sync — generiert memory-vault/ als menschlich lesbare Sicht auf
 * das Postgres-Gedächtnis. Die Datenbank ist die Wahrheit; der Vault wird bei
 * jeder Konsolidierung komplett neu geschrieben (kein Rückkanal).
 *
 * Den Ordner memory-vault/ in Obsidian als Vault öffnen — die Graph-Ansicht
 * zeigt über die [[Wikilinks]] das Beziehungsnetz.
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { db } from "@workspace/db";
import {
  knownAgentsTable,
  episodesTable,
  claimsTable,
  strategiesTable,
  diaryTable,
} from "@workspace/db";
import { desc } from "drizzle-orm";
import { LUKAS_SOUL } from "./lukas-soul";
import { getCharacter } from "./emotion-engine";
import { logger } from "./logger";

const VAULT_DIR = process.env.MEMORY_VAULT_DIR ?? path.resolve(process.cwd(), "..", "..", "memory-vault");

const safeName = (s: string) =>
  s.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, "-").slice(0, 80) || "unnamed";

const statusWord = (status: string, evidenceLevel: number): string =>
  status === "verified"
    ? "✅ verifiziert"
    : status === "corroborated"
      ? "🟢 mehrfach gestützt"
      : status === "contradicted"
        ? "⚠️ widersprüchlich"
        : evidenceLevel <= 1
          ? "💭 eigene Einschätzung"
          : "❔ unbelegt";

export async function syncObsidianVault(): Promise<string> {
  const [agents, episodes, claims, strategies, diary, character] = await Promise.all([
    db.select().from(knownAgentsTable).orderBy(desc(knownAgentsTable.lastSeen)).limit(200),
    db.select().from(episodesTable).orderBy(desc(episodesTable.startedAt)).limit(200),
    db.select().from(claimsTable).orderBy(desc(claimsTable.observedAt)).limit(500),
    db.select().from(strategiesTable).orderBy(desc(strategiesTable.successScore)).limit(50),
    db.select().from(diaryTable).orderBy(desc(diaryTable.createdAt)).limit(30),
    getCharacter(),
  ]);

  await rm(VAULT_DIR, { recursive: true, force: true });
  const dirs = ["01 Identity", "02 Agents", "03 Episodes", "04 Findings", "05 Strategies", "07 Reviews"];
  for (const d of dirs) await mkdir(path.join(VAULT_DIR, d), { recursive: true });

  const write = (rel: string, content: string) =>
    writeFile(path.join(VAULT_DIR, rel), content, "utf8");

  // ── 01 Identity ──
  await write(
    "01 Identity/Lukas.md",
    `---
type: identity
updated: ${new Date().toISOString().slice(0, 10)}
---
# Lukas

${character?.selfImage ? `## Selbstbild\n${character.selfImage}\n` : ""}
${character ? `## Charakter-Traits\n${Object.entries(character.traits).map(([k, v]) => `- ${k}: ${(Number(v) * 100).toFixed(0)}%`).join("\n")}\n` : ""}
## Soul (unveränderlicher Kern)
${LUKAS_SOUL}
`,
  );

  // ── 02 Agents ──
  const agentFile = new Map<string, string>();
  for (const a of agents) {
    const fname = safeName(a.handle);
    agentFile.set(a.handle, fname);
    const agentClaims = claims.filter((c) => c.subject === a.handle.toLowerCase().replace(/\s+/g, "_"));
    await write(
      `02 Agents/${fname}.md`,
      `---
type: agent
agent_id: ${a.handle}
platform: ${a.platform}
first_seen: ${a.firstSeen.toISOString().slice(0, 10)}
last_seen: ${a.lastSeen.toISOString().slice(0, 10)}
trust_score: ${a.trustScore.toFixed(2)}
relationship_strength: ${a.relationshipStrength.toFixed(2)}
topics:
${a.topics.map((t) => `  - ${t}`).join("\n") || "  - none"}
---
# ${a.handle}

## Bekannte Aussagen
${agentClaims.map((c) => `- ${c.predicate}: "${c.value}" — ${statusWord(c.status, c.evidenceLevel)} (Vertrauen ${(c.confidence * 100).toFixed(0)}%)`).join("\n") || "- keine erfasst"}

## Themen
${a.topics.map((t) => `- [[${safeName(t)}]]`).join("\n") || "- keine"}

## Notizen
${a.notes || "-"}
`,
    );
  }

  // ── 03 Episodes ──
  for (const e of episodes) {
    if (!e.summary) continue;
    const fname = `${e.startedAt.toISOString().slice(0, 10)}-${e.kind}-${e.id}`;
    await write(
      `03 Episodes/${fname}.md`,
      `---
type: episode
kind: ${e.kind}
started: ${e.startedAt.toISOString()}
ended: ${e.endedAt?.toISOString() ?? "open"}
---
# ${e.kind} · ${e.startedAt.toISOString().slice(0, 16).replace("T", " ")}

${e.summary}
`,
    );
  }

  // ── 04 Findings (Claims nach Subject gruppiert) ──
  const bySubject = new Map<string, typeof claims>();
  for (const c of claims) {
    const list = bySubject.get(c.subject) ?? [];
    list.push(c);
    bySubject.set(c.subject, list);
  }
  for (const [subject, list] of bySubject) {
    await write(
      `04 Findings/${safeName(subject)}.md`,
      `---
type: finding
subject: ${subject}
claims: ${list.length}
---
# ${subject}

${list
  .map(
    (c) =>
      `## ${c.predicate}
- Wert: "${c.value}"
- Status: ${statusWord(c.status, c.evidenceLevel)} (Evidenz-Stufe ${c.evidenceLevel}/4, Vertrauen ${(c.confidence * 100).toFixed(0)}%)
- Quelle: ${c.sourceType}${c.sourceId ? ` (${c.sourceId})` : ""} · beobachtet ${c.observedAt.toISOString().slice(0, 10)}${c.corroborations > 1 ? ` · ${c.corroborations}× gestützt` : ""}`,
  )
  .join("\n\n")}
`,
    );
  }

  // ── 05 Strategies ──
  for (const s of strategies) {
    await write(
      `05 Strategies/${safeName(s.name)}.md`,
      `---
type: strategy
success_score: ${s.successScore.toFixed(2)}
sample_size: ${s.sampleSize}
active: ${s.active}
---
# ${s.name}

${s.rule}

Erfolg: ${(s.successScore * 100).toFixed(0)}% bei ${s.sampleSize} Aktionen.
`,
    );
  }

  // ── 07 Reviews (letzte Tagebuch-Reflexionen) ──
  for (const d of diary.slice(0, 10)) {
    await write(
      `07 Reviews/${d.createdAt.toISOString().slice(0, 10)}-diary-${d.id}.md`,
      `---
type: review
mood: ${d.mood}
---
${d.content}
`,
    );
  }

  // ── Index ──
  await write(
    "index.md",
    `# Lukas — Gedächtnis-Vault

> Generierte Sicht auf die Postgres-Wahrheitsquelle (Stand ${new Date().toISOString().slice(0, 16).replace("T", " ")}).
> Änderungen hier werden NICHT zurück in die Datenbank übernommen.

- [[01 Identity/Lukas|Identität & Charakter]]
- Agenten: ${agents.length} · Episoden: ${episodes.length} · Claims: ${claims.length} · Strategien: ${strategies.length}
`,
  );

  logger.info({ dir: VAULT_DIR, agents: agents.length, claims: claims.length }, "Obsidian-Vault generiert");
  return VAULT_DIR;
}
