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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
