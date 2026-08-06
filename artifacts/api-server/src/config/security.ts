import type { CorsOptionsDelegate } from "cors";
import type { Request } from "express";

function parseOrigins(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((origin) => origin.trim().replace(/\/$/, ""))
      .filter(Boolean),
  );
}

function isSameOrigin(req: Request, origin: string): boolean {
  try {
    const originUrl = new URL(origin);
    const forwardedHost = req.headers["x-forwarded-host"];
    const requestHost =
      (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ??
      req.get("host");

    return Boolean(requestHost) && originUrl.host === requestHost;
  } catch {
    return false;
  }
}

function isPublicApiRequest(req: Request): boolean {
  return req.path === "/api/public" || req.path.startsWith("/api/public/");
}

export const corsOptions: CorsOptionsDelegate<Request> = (req, callback) => {
  const origin = req.get("origin");

  // Server-to-server requests, curl and same-process health checks have no Origin.
  if (!origin) {
    callback(null, { origin: false });
    return;
  }

  const normalizedOrigin = origin.replace(/\/$/, "");
  const privateOrigins = parseOrigins(process.env.LUKAS_ALLOWED_ORIGINS);
  const publicOrigins = parseOrigins(process.env.LUKAS_PUBLIC_ORIGINS ?? "*");

  const isAllowed = isPublicApiRequest(req)
    ? publicOrigins.has("*") || publicOrigins.has(normalizedOrigin)
    : isSameOrigin(req, normalizedOrigin) || privateOrigins.has(normalizedOrigin);

  callback(null, {
    origin: isAllowed ? normalizedOrigin : false,
    credentials: false,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "X-Lukas-Token",
      "X-Requested-With",
    ],
    exposedHeaders: [
      "RateLimit-Limit",
      "RateLimit-Remaining",
      "RateLimit-Reset",
      "Retry-After",
    ],
    maxAge: 600,
  });
};

export function parsePositiveInt(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
