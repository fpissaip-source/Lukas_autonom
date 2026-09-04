/*
 * Was wirklich schiefging — statt "fetch failed".
 *
 * DER ANLASS steht in Lukas' eigener Antwort: er konnte nicht sagen, "ob DNS,
 * TLS, Proxy, Egress oder Control Plane betroffen ist", weil ihm nur
 * `fetch failed` vorlag. Das Aergerliche daran: die Information WAR da. Node
 * wirft bei einem gescheiterten fetch ein `TypeError: fetch failed` und haengt
 * den echten Fehler als `cause` daran — getaddrinfo ENOTFOUND, ECONNREFUSED,
 * ein Zertifikatsfehler, ein Zeitlimit. Der Code hat immer nur `err.message`
 * gelesen und die Ursache damit weggeworfen.
 *
 * Ein Agent, der "fetch failed" liest, kann nichts anderes tun als es erneut
 * zu versuchen. Ein Agent, der "getaddrinfo ENOTFOUND api.github.com" liest,
 * weiss, dass ein zweiter Versuch nichts bringt.
 *
 * WARUM DIE GANZE KETTE und nicht nur eine Ebene: undici verpackt gern
 * mehrfach. `fetch failed` -> `ConnectTimeoutError` -> `ETIMEDOUT` ist keine
 * Seltenheit, und erst die letzte Ebene ist die brauchbare.
 */

/** Wie tief die Ursachenkette verfolgt wird. Mehr als drei Ebenen gibt es nicht. */
const MAX_TIEFE = 5;

/**
 * Der Fehlertext samt aller Ursachen, als eine Zeile.
 *
 * Doppelte Ebenen fallen raus: undici wiederholt dieselbe Meldung gern zwei
 * Ebenen tief, und "fetch failed: fetch failed" hilft niemandem.
 */
export function fehlerText(err: unknown): string {
  const teile: string[] = [];
  let aktuell: unknown = err;

  for (let i = 0; i < MAX_TIEFE && aktuell; i++) {
    const text =
      aktuell instanceof Error
        ? aktuell.message
        : typeof aktuell === "string"
          ? aktuell
          : "";
    const code = (aktuell as { code?: unknown })?.code;
    const mitCode = code && typeof code === "string" && !text.includes(code)
      ? `${text} (${code})`
      : text;

    const knapp = mitCode.split("\n")[0].trim();
    if (knapp && !teile.includes(knapp)) teile.push(knapp);

    aktuell = (aktuell as { cause?: unknown })?.cause;
  }

  return teile.join(" ← ") || String(err);
}

/**
 * Dasselbe, aber mit einer Einordnung, was das fuer das naechste Vorgehen
 * heisst.
 *
 * Die Unterscheidung, die Lukas braucht, ist nicht "welcher Fehlercode",
 * sondern: LOHNT EIN ZWEITER VERSUCH? Ein Zeitlimit vielleicht. Ein
 * unbekannter Name nie. Genau danach sind die Faelle sortiert.
 */
export function netzDiagnose(err: unknown, ziel?: string): string {
  const roh = fehlerText(err);
  const wo = ziel ? ` (${ziel})` : "";
  const nochmal = " Ein zweiter Versuch kann klappen.";
  const niemals = " Ein zweiter Versuch bringt nichts — hier stimmt die Konfiguration nicht.";

  if (/ENOTFOUND|EAI_AGAIN/i.test(roh)) {
    return `Der Name lässt sich nicht auflösen${wo} — DNS. ${roh}.${niemals}`;
  }
  if (/ECONNREFUSED/i.test(roh)) {
    return `Die Gegenstelle${wo} lehnt die Verbindung ab — dort hört niemand auf diesem Port. ${roh}.${niemals}`;
  }
  if (/CERT_|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|DEPTH_ZERO/i.test(roh)) {
    return `Die TLS-Prüfung schlägt fehl${wo} — das Zertifikat der Gegenstelle passt nicht. ${roh}.${niemals}`;
  }
  if (/ETIMEDOUT|ConnectTimeout|UND_ERR_CONNECT_TIMEOUT|HeadersTimeout|BodyTimeout/i.test(roh)) {
    return `Zeitüberschreitung beim Verbinden${wo} — die Gegenstelle antwortet nicht. ${roh}.${nochmal}`;
  }
  if (/ECONNRESET|EPIPE|socket hang up|other side closed/i.test(roh)) {
    return `Die Verbindung${wo} wurde mitten drin abgebrochen. ${roh}.${nochmal}`;
  }
  if (/EHOSTUNREACH|ENETUNREACH|ENETDOWN/i.test(roh)) {
    return `Kein Netzweg zur Gegenstelle${wo}. ${roh}.${niemals}`;
  }
  if (/407|proxy/i.test(roh)) {
    return `Ein Proxy lehnt die Anfrage ab${wo}. ${roh}.${niemals}`;
  }

  /*
   * "fetch failed" GANZ ALLEIN heisst: Node hat die Ursache nicht mitgegeben.
   * Das ist selten und gehoert benannt, statt es als vollwertige Meldung
   * durchgehen zu lassen — sonst sucht Lukas nach einer Bedeutung, die der
   * Text nicht hat.
   */
  if (/^fetch failed$/i.test(roh)) {
    return (
      `Die Verbindung${wo} ist gescheitert, ohne dass Node einen Grund mitgeliefert hat ` +
      `("fetch failed" ohne Ursache). Das ist alles, was bekannt ist — ` +
      `rate nicht, ob es DNS, TLS oder ein Proxy war.${nochmal}`
    );
  }

  return `${roh}${wo ? ` — beim Zugriff auf ${ziel}` : ""}`;
}
