import type { Request, Response, NextFunction } from "express";

// Opt-in Bearer-Auth: aktiv sobald LUKAS_API_TOKEN gesetzt ist.
// /api/healthz (Healthchecks) und /api/public/* (Portfolio-Widget, eigenes
// Rate-Limit) bleiben immer offen.
export function lukasAuth(req: Request, res: Response, next: NextFunction): void {
  // .trim(): manche Provider-UIs (z.B. Railways Variablen-Editor) haengen beim
  // Speichern einen Zeilenumbruch an den Wert an. Fuer diesen Zugangscode ist
  // das kein Sicherheitsproblem, also tolerieren wir Rand-Whitespace bewusst,
  // statt Nutzer:innen daran verzweifeln zu lassen.
  const token = process.env.LUKAS_API_TOKEN?.trim();
  if (!token) return void next();
  // /whatsapp/webhook muss offen bleiben: Meta ruft ihn auf und kann keinen
  // Bearer-Token mitschicken. Abgesichert ist er stattdessen durch die
  // HMAC-Signaturpruefung (X-Hub-Signature-256) und die Absender-Allowlist.
  if (
    req.path === "/healthz" ||
    req.path.startsWith("/public/") ||
    req.path === "/whatsapp/webhook"
  ) {
    return void next();
  }

  const header = req.headers.authorization;
  const provided = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
  if (provided !== token) {
    return void res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
