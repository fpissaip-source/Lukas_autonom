import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { mcpServers } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  connectAndListTools,
  AuthorizationRequired,
  slugify,
  callbackUrl,
} from "../lib/mcp";
import { logger } from "../lib/logger";

const router = Router();

/*
 * Tokens gehen NIE an den Browser. Das Dashboard braucht Status und
 * Werkzeugliste — access_token und client_secret haben dort nichts verloren,
 * auch nicht hinter der API-Auth.
 */
const serialize = (r: typeof mcpServers.$inferSelect) => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  url: r.url,
  status: r.status,
  lastError: r.lastError,
  tools: r.tools.map((t) => ({ name: t.name, description: t.description })),
  toolsUpdatedAt: r.toolsUpdatedAt?.toISOString() ?? null,
  riskTier: r.riskTier,
  enabled: r.enabled,
  authorized: Boolean(r.tokens),
  createdAt: r.createdAt.toISOString(),
});

router.get("/lukas/mcp", async (_req, res) => {
  try {
    const rows = await db.select().from(mcpServers).orderBy(desc(mcpServers.createdAt));
    res.json({ callbackUrl: callbackUrl(), servers: rows.map(serialize) });
  } catch (err) {
    logger.error({ err }, "MCP-Server laden fehlgeschlagen");
    res.status(500).json({ error: "Failed to load MCP servers" });
  }
});

const CreateBody = z.object({
  name: z.string().min(1).max(80),
  url: z.string().url().max(500),
});

router.post("/lukas/mcp", async (req, res) => {
  const parsed = CreateBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    return void res.status(400).json({ error: "Name und gültige URL sind nötig." });
  }
  const url = new URL(parsed.data.url);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    // Ueber die Verbindung laufen OAuth-Tokens. Ohne TLS liegen die offen.
    return void res.status(400).json({ error: "Nur https ist erlaubt (außer localhost)." });
  }

  try {
    // Slug eindeutig halten: er steckt im Werkzeugnamen, und zwei Server mit
    // demselben Slug wuerden sich gegenseitig die Werkzeuge ueberschreiben.
    const existing = await db.select().from(mcpServers);
    const taken = new Set(existing.map((r) => r.slug));
    const base = slugify(parsed.data.name);
    let slug = base;
    for (let i = 2; taken.has(slug); i++) slug = `${base}_${i}`;

    const [row] = await db
      .insert(mcpServers)
      .values({ slug, name: parsed.data.name, url: parsed.data.url, status: "new" })
      .returning();
    res.status(201).json(serialize(row));
  } catch (err) {
    logger.error({ err }, "MCP-Server anlegen fehlgeschlagen");
    res.status(500).json({ error: "Failed to create MCP server" });
  }
});

/*
 * Verbinden. Zwei moegliche Ausgaenge:
 *   - Der Server braucht keine Anmeldung (oder wir haben schon ein Token):
 *     Werkzeuge werden gelesen, fertig.
 *   - Anmeldung noetig: wir geben die Autorisierungs-URL zurueck, das
 *     Dashboard schickt Issa dorthin.
 */
router.post("/lukas/mcp/:id/connect", async (req, res) => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id)) return void res.status(400).json({ error: "Ungültige ID" });

  try {
    const tools = await connectAndListTools(id);
    res.json({ status: "connected", tools: tools.length });
  } catch (err) {
    if (err instanceof AuthorizationRequired) {
      return void res.json({ status: "authorize", authorizationUrl: err.authorizationUrl });
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, id }, "MCP-Verbindung fehlgeschlagen");
    await db
      .update(mcpServers)
      .set({ status: "error", lastError: message.slice(0, 800), updatedAt: new Date() })
      .where(eq(mcpServers.id, id))
      .catch(() => {});
    res.status(400).json({ error: message });
  }
});

/*
 * OAuth-Rueckleitung aus dem Browser.
 *
 * Diese Route traegt KEINEN Bearer-Token — sie wird vom Anbieter aufgerufen,
 * nachdem Issa sich dort angemeldet hat. Abgesichert ist sie stattdessen ueber
 * den state-Parameter: ein Zufallswert, den wir beim Start der Anmeldung
 * erzeugt und in genau dieser Serverzeile hinterlegt haben. Nur wer ihn
 * vorweist, gehoert zu einem Vorgang, den wir selbst begonnen haben. Nach dem
 * Einloesen wird er geloescht, ein zweiter Aufruf laeuft also ins Leere.
 *
 * Deshalb steht sie auch in der Ausnahmeliste von lukasAuth — genau wie der
 * WhatsApp-Webhook, aus demselben Grund.
 */
router.get("/lukas/mcp/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  const state = typeof req.query.state === "string" ? req.query.state : undefined;
  const oauthError = typeof req.query.error === "string" ? req.query.error : undefined;

  const page = (titel: string, text: string) =>
    `<!doctype html><meta charset="utf-8"><title>${titel}</title>` +
    `<body style="font-family:system-ui;background:#0b0b0d;color:#e7e7ea;padding:2rem;line-height:1.6">` +
    `<h2>${titel}</h2><p>${text}</p>` +
    `<p><a style="color:#8ab4f8" href="/mcp">Zurück zum Dashboard</a></p></body>`;

  if (oauthError) {
    return void res.status(400).send(page("Anmeldung abgebrochen", `Der Anbieter meldet: ${oauthError}`));
  }
  if (!code || !state) {
    return void res.status(400).send(page("Unvollständige Rückleitung", "Es fehlen code oder state."));
  }

  try {
    const [row] = await db.select().from(mcpServers).where(eq(mcpServers.oauthState, state));
    if (!row) {
      // Kein passender Vorgang: entweder gefaelscht, schon eingeloest oder zu alt.
      return void res
        .status(400)
        .send(page("Ungültige Rückleitung", "Zu dieser Anmeldung gibt es keinen offenen Vorgang."));
    }

    await connectAndListTools(row.id, code);
    logger.info({ server: row.name }, "MCP-Server autorisiert");
    res.send(
      page(
        "Verbunden",
        `„${row.name}“ ist jetzt mit Lukas verbunden. Seine Werkzeuge stehen ihm ab sofort zur Verfügung.`,
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "MCP-Callback fehlgeschlagen");
    res.status(400).send(page("Verbindung fehlgeschlagen", message));
  }
});

const PatchBody = z.object({
  riskTier: z.enum(["R1", "R2", "R3"]).optional(),
  enabled: z.boolean().optional(),
});

router.patch("/lukas/mcp/:id", async (req, res) => {
  const id = Number.parseInt(String(req.params.id), 10);
  const parsed = PatchBody.safeParse(req.body ?? {});
  if (!Number.isInteger(id) || !parsed.success) {
    return void res.status(400).json({ error: "Ungültige Eingabe" });
  }
  try {
    const [row] = await db
      .update(mcpServers)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(mcpServers.id, id))
      .returning();
    if (!row) return void res.status(404).json({ error: "Nicht gefunden" });
    res.json(serialize(row));
  } catch (err) {
    logger.error({ err }, "MCP-Server ändern fehlgeschlagen");
    res.status(500).json({ error: "Failed to update" });
  }
});

router.delete("/lukas/mcp/:id", async (req, res) => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id)) return void res.status(400).json({ error: "Ungültige ID" });
  try {
    await db.delete(mcpServers).where(eq(mcpServers.id, id));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "MCP-Server löschen fehlgeschlagen");
    res.status(500).json({ error: "Failed to delete" });
  }
});

export default router;
