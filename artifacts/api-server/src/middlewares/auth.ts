import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

function isPublicPath(path: string): boolean {
  return path === "/healthz" || path === "/public" || path.startsWith("/public/");
}

function safeTokenEqual(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

export function lukasAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "OPTIONS" || isPublicPath(req.path)) {
    next();
    return;
  }

  const expectedToken = process.env.LUKAS_API_TOKEN?.trim();

  if (!expectedToken) {
    if (process.env.NODE_ENV !== "production") {
      next();
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(503).json({
      error: "Server authentication is not configured",
    });
    return;
  }

  const authorization = req.get("authorization");
  const bearerToken = authorization?.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : undefined;
  const headerToken = req.get("x-lukas-token")?.trim();
  const providedToken = bearerToken ?? headerToken;

  if (!providedToken || !safeTokenEqual(providedToken, expectedToken)) {
    res.setHeader("Cache-Control", "no-store");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
