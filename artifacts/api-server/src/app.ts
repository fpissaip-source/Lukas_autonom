import express, {
  type ErrorRequestHandler,
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { corsOptions } from "./config/security";
import { lukasAuth } from "./middlewares/auth";
import {
  expensiveApiRateLimit,
  globalApiRateLimit,
  publicApiRateLimit,
} from "./middlewares/rate-limit";
import { logger } from "./lib/logger";

const app: Express = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader(
    "Permissions-Policy",
    "camera=(self), microphone=(self), geolocation=()",
  );

  if (process.env.NODE_ENV === "production" && req.secure) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  next();
});

app.use(cors(corsOptions));
app.use(
  express.json({
    limit: process.env.LUKAS_JSON_BODY_LIMIT ?? "2mb",
  }),
);
app.use(
  express.urlencoded({
    extended: true,
    limit: process.env.LUKAS_FORM_BODY_LIMIT ?? "256kb",
  }),
);

// widget.js ändert sich während aktiver Entwicklung häufig — Browser dürfen
// es nie ungefragt aus dem Cache servieren, sonst testet man versehentlich
// eine alte Version.
app.use("/widget.js", (req, res, next) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  next();
});

// Statische Widget-Dateien (widget.js, embed-demo.html); __dirname kommt aus
// dem esbuild-Banner und zeigt auf artifacts/api-server/dist.
app.use(express.static(path.join(__dirname, "..", "public")));

app.use(
  "/api",
  globalApiRateLimit,
  publicApiRateLimit,
  expensiveApiRateLimit,
  lukasAuth,
  router,
);

// Im Deployment liefert der API-Server auch das gebaute Dashboard aus.
const uiDist = path.join(__dirname, "..", "..", "lukas-ui", "dist", "public");
if (fs.existsSync(path.join(uiDist, "index.html"))) {
  app.use(express.static(uiDist));
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(uiDist, "index.html"));
  });
  logger.info({ uiDist }, "Dashboard-UI wird mit ausgeliefert");
} else {
  logger.info("Dashboard-UI nicht gebaut (npm run build:ui) — nur API + Widget");
}

const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : 500;

  req.log?.error({ err: error }, "Unhandled request error");
  res.status(status).json({
    error: status === 413 ? "Request body is too large" : "Internal server error",
  });
};

app.use(errorHandler);

export default app;
