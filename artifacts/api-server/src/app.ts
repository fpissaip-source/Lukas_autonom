import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
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

export default app;
