export type RoutedTool =
  | "web_search"
  | "fetch_url"
  | "execute_command"
  | "query_memory"
  | "email_search"
  | "get_trading_stats";

export type ToolRoute = {
  tool: RoutedTool | null;
  reason: string;
};

const URL_RE = /https?:\/\/[^\s<>()]+/i;
const VIDEO_URL_RE =
  /(?:youtube\.com|youtu\.be|tiktok\.com|instagram\.com|vimeo\.com|twitch\.tv|\.mp4(?:\?|$)|\.mov(?:\?|$)|\.webm(?:\?|$))/i;

function normalized(message: string): string {
  return message.toLocaleLowerCase("de-DE").replace(/\s+/g, " ").trim();
}

/**
 * Erzwingt nur den ERSTEN sinnvollen Werkzeugschritt. Danach entscheidet Lukas
 * wieder selbst und kann weitere Tools verketten. So bleiben offene Aufgaben
 * flexibel, aber aktuelle Fakten, URLs und Serverarbeiten werden nicht mehr
 * versehentlich aus Modellwissen beantwortet.
 */
export function routeInitialTool(message: string): ToolRoute {
  const text = normalized(message);
  const hasUrl = URL_RE.test(message);

  const serverAction =
    /\b(installier|installiere|deinstallier|update|aktualisier|starte|stoppe|restart|neustart|deploy|baue|build|clone|klone|lösche|loesche|verschiebe|kopiere|erstelle)\b/.test(text) &&
    /\b(vps|server|ubuntu|linux|docker|container|dienst|service|systemd|terminal|shell|paket|npm|apt|pip|datei|verzeichnis|repository|repo|mcp|cli)\b/.test(text);

  const explicitCommand =
    /\b(execute_command|terminal|shell-befehl|bash|sudo|apt(-get)?|npm (i|install)|pip install|docker compose|systemctl|journalctl|ffmpeg|yt-dlp)\b/.test(text);

  if (serverAction || explicitCommand) {
    return {
      tool: "execute_command",
      reason: "Die Nachricht verlangt eine konkrete Aktion oder Prüfung auf dem VPS.",
    };
  }

  if (hasUrl && VIDEO_URL_RE.test(message)) {
    return {
      tool: "execute_command",
      reason: "Video-Links werden über den VPS abgerufen und technisch geprüft.",
    };
  }

  if (hasUrl) {
    return {
      tool: "fetch_url",
      reason: "Die Nachricht enthält eine konkrete URL, deren Inhalt abgerufen werden muss.",
    };
  }

  if (
    /\b(was (hatte|habe) ich dir|erinnerst du dich|damals erzählt|weisst du noch|weißt du noch|aus deinem gedächtnis|aus deiner erinnerung)\b/.test(
      text,
    )
  ) {
    return {
      tool: "query_memory",
      reason: "Die Antwort hängt von Lukas' gespeichertem Langzeitgedächtnis ab.",
    };
  }

  if (
    /\b(meine|neueste|letzte|ungelesene) (mail|mails|e-mail|e-mails)|postfach|suche.*(mail|e-mail)|hat .* geschrieben\b/.test(
      text,
    )
  ) {
    return {
      tool: "email_search",
      reason: "Die Anfrage betrifft Issas aktuelles E-Mail-Postfach.",
    };
  }

  if (/\b(trading|polymarket|bankroll|offene position|pnl|win.?rate|bot-status)\b/.test(text)) {
    return {
      tool: "get_trading_stats",
      reason: "Die Anfrage betrifft aktuelle Daten des Trading-Systems.",
    };
  }

  const explicitResearch =
    /\b(such(e)? (im )?(web|internet)|recherchier|prüf(e)? online|verifizier|quelle|quellen|finde heraus)\b/.test(
      text,
    );
  const timeSensitive =
    /\b(aktuell|heute|gestern|morgen|neueste|neusten|letzte version|derzeit|momentan|gerade|preis|preise|news|nachrichten|stand 20\d{2}|dieses jahr|diese woche|verfügbar|verfuegbar|release|update)\b/.test(
      text,
    );
  const uncertainty =
    /\b(bist du sicher|prüf das|pruef das|stimmt das|zuverlässig|zuverlaessig|beleg|beweise)\b/.test(
      text,
    );

  if (explicitResearch || timeSensitive || uncertainty) {
    return {
      tool: "web_search",
      reason: "Die Antwort braucht aktuelle oder verifizierte Informationen aus externen Quellen.",
    };
  }

  return {
    tool: null,
    reason: "Keine zwingende externe Aktion erkannt; Lukas kann frei entscheiden.",
  };
}
