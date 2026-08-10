import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

/*
 * Bearer-Auth fuer die private API.
 *
 * Immer offen bleiben:
 *   /healthz            Railways Healthcheck — sonst killt die Plattform das Deployment
 *   /public/*           Portfolio-Widget, hat ein eigenes Rate-Limit
 *   /whatsapp/webhook   Meta kann keinen Bearer-Token mitschicken; abgesichert
 *                       ist der Endpunkt durch die HMAC-Signaturpruefung
 *                       (X-Hub-Signature-256) und die Absender-Allowlist.
 */
function isOpenPath(path: string): boolean {
  return path === "/healthz" || path.startsWith("/public/") || path === "/whatsapp/webhook";
}

let warnedAboutMissingToken = false;

export function lukasAuth(req: Request, res: Response, next: NextFunction): void {
  if (isOpenPath(req.path)) return void next();

  // .trim(): manche Provider-UIs (z.B. Railways Variablen-Editor) haengen beim
  // Speichern einen Zeilenumbruch an den Wert an. Fuer diesen Zugangscode ist
  // das kein Sicherheitsproblem, also tolerieren wir Rand-Whitespace bewusst,
  // statt Nutzer:innen daran verzweifeln zu lassen.
  const token = process.env.LUKAS_API_TOKEN?.trim();

  if (!token) {
    /*
     * Ohne Token war hier frueher alles offen — die Auth hat sich bei fehlender
     * Konfiguration selbst abgeschaltet. Hinter diesen Routen liegen Issas
     * Erinnerungen, Ziele, Tagebuch, Anhaenge und Lukas' Tools inklusive Shell
     * und Mailversand. Ein vergessenes oder beim Umzug verlorenes Secret haette
     * das alles offen ins Netz gestellt, ohne dass irgendetwas kaputt aussieht.
     *
     * Jetzt: lokal weiter offen, damit man entwickeln kann. In Produktion dicht.
     * Fail closed — und mit einer Fehlermeldung, die sagt, was zu tun ist,
     * statt eines stummen 401.
     */
    if (process.env.NODE_ENV === "production") {
      if (!warnedAboutMissingToken) {
        warnedAboutMissingToken = true;
        logger.error(
          "LUKAS_API_TOKEN fehlt in Produktion — die private API bleibt geschlossen. Variable setzen und neu deployen.",
        );
      }
      return void res
        .status(503)
        .json({ error: "Private API ist nicht konfiguriert (LUKAS_API_TOKEN fehlt)" });
    }
    return void next();
  }

  const header = req.headers.authorization;
  const provided = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
  if (provided !== token) {
    return void res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
