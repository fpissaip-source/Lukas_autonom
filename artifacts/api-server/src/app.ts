import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { lukasAuth } from "./middlewares/auth";
import { logger } from "./lib/logger";

const app: Express = express();

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
app.use(cors());
// Rohen Body mitschneiden: die WhatsApp-Webhook-Signatur (HMAC-SHA256) wird
// ueber die exakten Bytes gebildet — nach dem JSON-Parsen laesst sie sich
// nicht mehr zuverlaessig nachrechnen.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

// widget.js ändert sich während aktiver Entwicklung häufig — Browser dürfen
// es nie ungefragt aus dem Cache servieren, sonst testet man versehentlich
// eine alte Version (genau das hat schon zu falschen Fehlerbildern geführt).
app.use("/widget.js", (req, res, next) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  next();
});

// Statische Widget-Dateien (widget.js, embed-demo.html); __dirname kommt aus
// dem esbuild-Banner und zeigt auf artifacts/api-server/dist.
app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/api", lukasAuth, router);

// Im Deployment (Railway etc.) liefert der API-Server auch das gebaute
// Dashboard (lukas-ui) aus — ein Service für API + UI + Widget.
// Im Dev-Betrieb läuft die UI weiter über den Vite-Dev-Server (npm run dev:ui).
const uiDist = path.join(__dirname, "..", "..", "lukas-ui", "dist", "public");
if (fs.existsSync(path.join(uiDist, "index.html"))) {
  app.use(express.static(uiDist));
  // SPA-Fallback: Client-Routen (/chat, /goals, …) liefern index.html
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(uiDist, "index.html"));
  });
  logger.info({ uiDist }, "Dashboard-UI wird mit ausgeliefert");
} else {
  logger.info("Dashboard-UI nicht gebaut (npm run build:ui) — nur API + Widget");
}

export default app;
