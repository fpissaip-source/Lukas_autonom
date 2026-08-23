import type { Request, Response, NextFunction } from "express";

/*
 * Grundschutz fuer die private API: wer darf sie aus dem Browser aufrufen, wie
 * oft, und mit welchen Kopfzeilen antwortet der Server.
 *
 * Vorher stand hier ein blankes `app.use(cors())` — also: jede Webseite der
 * Welt durfte im Browser eines Angemeldeten Anfragen an diese API stellen und
 * die Antwort lesen. Der Bearer-Token hat das bisher aufgefangen: ohne ihn
 * kommt nichts durch. Aber eine Tuer, die nur deshalb zu ist, weil dahinter
 * noch ein Schloss haengt, sollte man trotzdem schliessen.
 *
 * Was hier NICHT steht, und warum:
 *
 *  - Keine Content-Security-Policy. Eine falsche CSP legt das Dashboard
 *    lautlos lahm (Vite bootet ueber ein Inline-Skript, three.js baut den
 *    WebGL-Kontext zur Laufzeit). Das sauber zu machen heisst: Nonces durch
 *    den Build reichen. Das ist eine eigene Aufgabe, keine Zeile nebenbei —
 *    und eine halbe CSP ist schlimmer als keine, weil sie Sicherheit
 *    vortaeuscht und Funktionen kaputtmacht.
 *  - Kein Cross-Origin-Opener-Policy. Die MCP-Anmeldung laeuft ueber ein
 *    Browserfenster zu einem fremden Anbieter und zurueck; COOP kann genau
 *    diesen Rueckweg abschneiden.
 */

/** Die echte Adresse hinter Railways Proxy — sonst zaehlt alles auf eine IP. */
export function klientIp(req: Request): string {
  const weitergeleitet = req.headers["x-forwarded-for"];
  const erste = Array.isArray(weitergeleitet)
    ? weitergeleitet[0]
    : weitergeleitet?.split(",")[0];
  return erste?.trim() || req.ip || "?";
}

const istSchleife = (ip: string) =>
  ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";

/*
 * Der oeffentliche Teil bleibt fuer jede Herkunft offen: das Widget sitzt auf
 * Issas Portfolio, und dort ist es genau richtig. Geschuetzt ist es an anderer
 * Stelle — eigene Host-Liste und ein eigenes, engeres Limit in public.ts.
 */
const istOeffentlich = (pfad: string) =>
  pfad.startsWith("/api/public/") ||
  pfad === "/api/whatsapp/webhook" ||
  pfad === "/api/telefon/eingehend" ||
  pfad === "/healthz";

const istApi = (pfad: string) => pfad.startsWith("/api/");

function eigeneHosts(req: Request): string[] {
  const host = req.headers.host?.split(":")[0];
  return host ? [host] : [];
}

function erlaubteListe(): string[] {
  return (process.env.LUKAS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((eintrag) => {
      // Sowohl "https://foo.de" als auch "foo.de" sollen funktionieren —
      // sonst scheitert es an einem vergessenen Schema.
      try {
        return new URL(eintrag).hostname;
      } catch {
        return eintrag.replace(/^https?:\/\//, "").split("/")[0];
      }
    });
}

/**
 * Darf diese Herkunft die private API im Browser lesen?
 *
 * Kein Origin-Kopf heisst: kein Browser-Cross-Origin — ein Server-Aufruf, curl,
 * oder dieselbe Seite. Das ist erlaubt; abgesichert ist es durch den Token.
 */
export function herkunftErlaubt(req: Request, herkunft: string | undefined): boolean {
  if (!istApi(req.path) || istOeffentlich(req.path)) return true;
  if (!herkunft) return true;

  let host: string;
  try {
    host = new URL(herkunft).hostname;
  } catch {
    return false;
  }

  if (eigeneHosts(req).includes(host)) return true;
  if (erlaubteListe().includes(host)) return true;
  // Im Entwicklungsbetrieb laeuft die Oberflaeche auf einem eigenen Port.
  if (process.env.NODE_ENV === "development" && (host === "localhost" || host === "127.0.0.1")) {
    return true;
  }
  return false;
}

/**
 * Regelwerk fuer das cors-Paket. Bewusst die Bibliothek und keine eigenen
 * Kopfzeilen: die Vorab-Anfrage (OPTIONS) korrekt zu beantworten hat mehr
 * Fallstricke, als es aussieht.
 */
export function korsRegeln(
  req: Request,
  callback: (fehler: Error | null, optionen: { origin: boolean; credentials: boolean }) => void,
): void {
  callback(null, {
    origin: herkunftErlaubt(req, req.headers.origin),
    credentials: false,
  });
}

export function sicherheitsKopfzeilen(req: Request, res: Response, next: NextFunction): void {
  // Kein Raten am Inhaltstyp: verhindert, dass ein hochgeladener Text als
  // Skript ausgefuehrt wird, nur weil er danach aussieht.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Das Dashboard gehoert in kein fremdes Fenster.
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  /*
   * Mikrofon MUSS erlaubt bleiben — daran haengt der Sprachkanal. Genau
   * deshalb steht diese Zeile hier und nicht in einer fertigen Kopfzeilen-
   * Bibliothek: deren Standardwert schaltet ihn ab, und man merkt es erst,
   * wenn das Gespraech stumm bleibt.
   */
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");

  const ueberHttps =
    req.secure || String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() === "https";
  if (ueberHttps) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  next();
}

type Eimer = { anzahl: number; zuruecksetzenUm: number };
const eimer = new Map<string, Eimer>();

/** Nur fuer den Test: den Zaehler leeren. */
export function drosselZuruecksetzen(): void {
  eimer.clear();
}

/*
 * Ein Limit fuer die private API.
 *
 * Es geht hier nicht um einen entschlossenen Angreifer — der braeuchte den
 * Token. Es geht um das, was tatsaechlich passiert: eine Schleife im
 * Dashboard, ein haengendes Skript, ein durchgedrehter Neuversuch. Ohne
 * Deckel laeuft so etwas bis zur Rechnung durch.
 *
 * Grosszuegig gesetzt: das Dashboard fragt mehrere Listen im Halbminutentakt
 * ab, und eine lange Chat-Antwort ist EINE Anfrage, die minutenlang offen
 * bleibt — die zaehlt also nur einmal.
 */
export function apiDrossel(req: Request, res: Response, next: NextFunction): void {
  if (!istApi(req.path) || istOeffentlich(req.path)) return void next();

  const ip = klientIp(req);
  // Lukas selbst ruft ueber die Schleife an, nicht uebers Netz. Sich selbst
  // auszusperren waere die duemmste Art, an ein Limit zu geraten.
  if (istSchleife(ip)) return void next();

  const grenze = Number(process.env.LUKAS_RATE_LIMIT ?? 240);
  if (!Number.isFinite(grenze) || grenze <= 0) return void next();

  const fenster = 60_000;
  const jetzt = Date.now();
  const vorhanden = eimer.get(ip);

  if (!vorhanden || vorhanden.zuruecksetzenUm <= jetzt) {
    // Aufraeumen, solange es billig ist: sonst waechst die Tabelle mit jeder
    // neuen Adresse weiter, auch wenn niemand mehr da ist.
    if (eimer.size > 5000) {
      for (const [schluessel, wert] of eimer) {
        if (wert.zuruecksetzenUm <= jetzt) eimer.delete(schluessel);
      }
    }
    eimer.set(ip, { anzahl: 1, zuruecksetzenUm: jetzt + fenster });
    return void next();
  }

  vorhanden.anzahl++;
  if (vorhanden.anzahl > grenze) {
    const sekunden = Math.max(1, Math.ceil((vorhanden.zuruecksetzenUm - jetzt) / 1000));
    res.setHeader("Retry-After", String(sekunden));
    res.status(429).json({ error: "Zu viele Anfragen — kurz durchatmen.", retryAfter: sekunden });
    return;
  }
  next();
}
