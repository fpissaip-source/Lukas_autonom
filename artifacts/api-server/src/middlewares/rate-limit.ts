import type { NextFunction, Request, Response } from "express";
import { parsePositiveInt } from "../config/security";

type Bucket = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  name: string;
  windowMs: number;
  max: number;
  applies?: (req: Request) => boolean;
};

const stores = new Map<string, Map<string, Bucket>>();

function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function createRateLimiter(options: RateLimitOptions) {
  const store = stores.get(options.name) ?? new Map<string, Bucket>();
  stores.set(options.name, store);

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of store) {
      if (bucket.resetAt <= now) store.delete(key);
    }
  }, Math.max(options.windowMs, 60_000));
  cleanup.unref();

  return function rateLimiter(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (req.method === "OPTIONS" || options.applies?.(req) === false) {
      next();
      return;
    }

    const now = Date.now();
    const key = clientKey(req);
    let bucket = store.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      store.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, options.max - bucket.count);
    const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

    res.setHeader("RateLimit-Limit", String(options.max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(resetSeconds));

    if (bucket.count > options.max) {
      res.setHeader("Retry-After", String(resetSeconds));
      res.status(429).json({
        error: "Too many requests",
        retryAfterSeconds: resetSeconds,
      });
      return;
    }

    next();
  };
}

const minute = 60_000;

export const globalApiRateLimit = createRateLimiter({
  name: "global-api",
  windowMs: minute,
  max: parsePositiveInt(process.env.LUKAS_RATE_LIMIT_PER_MINUTE, 180),
});

export const publicApiRateLimit = createRateLimiter({
  name: "public-api",
  windowMs: minute,
  max: parsePositiveInt(process.env.LUKAS_PUBLIC_RATE_LIMIT_PER_MINUTE, 60),
  applies: (req) =>
    req.path === "/public" || req.path.startsWith("/public/"),
});

export const expensiveApiRateLimit = createRateLimiter({
  name: "expensive-api",
  windowMs: minute,
  max: parsePositiveInt(process.env.LUKAS_EXPENSIVE_RATE_LIMIT_PER_MINUTE, 20),
  applies: (req) =>
    ["/coding", "/showroom", "/voice", "/integrations"].some(
      (prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`),
    ),
});
