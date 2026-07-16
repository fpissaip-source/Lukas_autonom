import type { Request, Response, NextFunction } from "express";

// Opt-in Bearer-Auth: aktiv sobald LUKAS_API_TOKEN gesetzt ist.
// /api/healthz bleibt immer offen (Deployment-Healthchecks).
export function lukasAuth(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.LUKAS_API_TOKEN;
  if (!token) return void next();
  if (req.path === "/healthz") return void next();

  const header = req.headers.authorization;
  const provided = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (provided !== token) {
    return void res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
