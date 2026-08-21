#!/usr/bin/env node
/*
 * Telefon einrichten, ohne die Twilio-Konsole zu oeffnen.
 *
 * Anlass: die Konsole ist auf dem Handy kaum bedienbar — Auswahlfelder und
 * halbe Tabellen fehlen schlicht. Alles, was dort geklickt wird, geht aber
 * genauso ueber die REST-API. Dieses Skript macht die vier Schritte, die
 * noetig sind, damit ein Anruf bei Lukas landet:
 *
 *   1. Trunk anlegen (oder den vorhandenen finden)
 *   2. Origination-URI auf OpenAI zeigen lassen
 *   3. Eine Nummer kaufen (optional) und an den Trunk haengen
 *   4. Sagen, was danach in die Railway-Variablen gehoert
 *
 * Aufruf:
 *   node scripts/telefon-einrichten.mjs status
 *   node scripts/telefon-einrichten.mjs nummern DE
 *   node scripts/telefon-einrichten.mjs kaufen +4932112345678
 *   node scripts/telefon-einrichten.mjs verbinden +4932112345678
 *
 * Gebraucht werden TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN und
 * OPENAI_PROJECT_ID in der Umgebung.
 */

const SID = process.env.TWILIO_ACCOUNT_SID?.trim();
const TOKEN = process.env.TWILIO_AUTH_TOKEN?.trim();
const PROJEKT = process.env.OPENAI_PROJECT_ID?.trim();
const SIP_HOST = process.env.OPENAI_SIP_HOST ?? "sip.api.openai.com";
const TRUNK_NAME = "Lukas";

function fehlt(name) {
  console.error(`\n${name} fehlt. Setz die Variablen und ruf das Skript erneut auf:\n`);
  console.error("  export TWILIO_ACCOUNT_SID=AC...");
  console.error("  export TWILIO_AUTH_TOKEN=...");
  console.error("  export OPENAI_PROJECT_ID=proj_...\n");
  process.exit(1);
}

if (!SID) fehlt("TWILIO_ACCOUNT_SID");
if (!TOKEN) fehlt("TWILIO_AUTH_TOKEN");

const auth = "Basic " + Buffer.from(`${SID}:${TOKEN}`).toString("base64");

async function twilio(url, form) {
  const res = await fetch(url, {
    method: form ? "POST" : "GET",
    headers: {
      Authorization: auth,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const text = await res.text();
  let daten;
  try {
    daten = JSON.parse(text);
  } catch {
    daten = { raw: text };
  }
  if (!res.ok) {
    // Twilios Fehler sind brauchbar — sie durchreichen statt zu verschlucken.
    const grund = daten?.message ?? text.slice(0, 300);
    throw new Error(`Twilio ${res.status}: ${grund}${daten?.more_info ? `\n  ${daten.more_info}` : ""}`);
  }
  return daten;
}

const API = `https://api.twilio.com/2010-04-01/Accounts/${SID}`;
const TRUNKING = "https://trunking.twilio.com/v1";

/** Den Lukas-Trunk finden oder anlegen. */
async function trunkHolen() {
  const { trunks = [] } = await twilio(`${TRUNKING}/Trunks?PageSize=50`);
  const vorhanden = trunks.find((t) => t.friendly_name === TRUNK_NAME);
  if (vorhanden) return vorhanden;

  console.log(`Lege Trunk "${TRUNK_NAME}" an…`);
  return twilio(`${TRUNKING}/Trunks`, { FriendlyName: TRUNK_NAME });
}

/*
 * Die Origination-URI ist die Stelle, an die Twilio eingehende Anrufe
 * weiterreicht — hier also OpenAI. Ohne sie klingelt es nirgends.
 */
async function originationSetzen(trunkSid) {
  if (!PROJEKT) fehlt("OPENAI_PROJECT_ID");
  const ziel = `sip:${PROJEKT}@${SIP_HOST};transport=tls`;

  const { origination_urls = [] } = await twilio(`${TRUNKING}/Trunks/${trunkSid}/OriginationUrls`);
  if (origination_urls.some((u) => u.sip_url === ziel)) {
    console.log(`  Origination zeigt bereits auf ${ziel}`);
    return;
  }

  await twilio(`${TRUNKING}/Trunks/${trunkSid}/OriginationUrls`, {
    FriendlyName: "OpenAI Realtime",
    SipUrl: ziel,
    Priority: "10",
    Weight: "10",
    Enabled: "true",
  });
  console.log(`  Origination gesetzt: ${ziel}`);
}

const befehl = process.argv[2];
const argument = process.argv[3];

/*
 * Ein Stacktrace hilft niemandem, der das hier auf dem Handy im Terminal
 * ausfuehrt. Twilios Fehlermeldungen sind brauchbar — die sollen zu sehen
 * sein, sonst nichts.
 */
process.on("uncaughtException", (err) => {
  console.error(`\n${err.message}\n`);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

if (befehl === "status") {
  const trunk = (await twilio(`${TRUNKING}/Trunks?PageSize=50`)).trunks?.find(
    (t) => t.friendly_name === TRUNK_NAME,
  );
  console.log(`\nTrunk "${TRUNK_NAME}": ${trunk ? trunk.sid : "— noch nicht angelegt"}`);

  if (trunk) {
    const { origination_urls = [] } = await twilio(`${TRUNKING}/Trunks/${trunk.sid}/OriginationUrls`);
    console.log("Origination:");
    if (origination_urls.length === 0) console.log("  — keine (Anrufe laufen ins Leere)");
    for (const u of origination_urls) console.log(`  ${u.enabled ? "aktiv " : "aus   "} ${u.sip_url}`);

    const { phone_numbers = [] } = await twilio(`${TRUNKING}/Trunks/${trunk.sid}/PhoneNumbers`);
    console.log("Nummern am Trunk:");
    if (phone_numbers.length === 0) console.log("  — keine");
    for (const n of phone_numbers) console.log(`  ${n.phone_number}`);
  }

  const { incoming_phone_numbers = [] } = await twilio(`${API}/IncomingPhoneNumbers.json?PageSize=50`);
  console.log("\nAlle Nummern im Konto:");
  if (incoming_phone_numbers.length === 0) console.log("  — noch keine gekauft");
  for (const n of incoming_phone_numbers) console.log(`  ${n.phone_number}  (${n.friendly_name})`);
  console.log();
} else if (befehl === "nummern") {
  const land = (argument ?? "DE").toUpperCase();
  /*
   * Ortsnummern brauchen in Deutschland einen Adressnachweis. Deshalb hier
   * beides: was es gibt, und ob es ohne Nachweis zu haben ist.
   */
  for (const art of ["Local", "Mobile", "TollFree"]) {
    try {
      const daten = await twilio(
        `${API}/AvailablePhoneNumbers/${land}/${art}.json?VoiceEnabled=true&PageSize=5`,
      );
      const liste = daten.available_phone_numbers ?? [];
      console.log(`\n${art} in ${land}: ${liste.length === 0 ? "— nichts frei" : ""}`);
      for (const n of liste) {
        const nachweis = n.address_requirements && n.address_requirements !== "none"
          ? `  [Adressnachweis: ${n.address_requirements}]`
          : "";
        console.log(`  ${n.phone_number}${nachweis}`);
      }
    } catch (err) {
      console.log(`\n${art} in ${land}: ${err.message}`);
    }
  }
  console.log("\nKaufen mit:  node scripts/telefon-einrichten.mjs kaufen +49…\n");
} else if (befehl === "kaufen") {
  if (!argument) {
    console.error("Welche Nummer? node scripts/telefon-einrichten.mjs kaufen +49…");
    process.exit(1);
  }
  const gekauft = await twilio(`${API}/IncomingPhoneNumbers.json`, {
    PhoneNumber: argument,
    FriendlyName: "Lukas",
  });
  console.log(`\nGekauft: ${gekauft.phone_number}`);
  console.log(`Weiter mit:  node scripts/telefon-einrichten.mjs verbinden ${gekauft.phone_number}\n`);
} else if (befehl === "verbinden") {
  const trunk = await trunkHolen();
  console.log(`Trunk: ${trunk.sid}`);
  await originationSetzen(trunk.sid);

  let nummer = argument;
  if (!nummer) {
    const { incoming_phone_numbers = [] } = await twilio(`${API}/IncomingPhoneNumbers.json?PageSize=50`);
    if (incoming_phone_numbers.length !== 1) {
      console.error(
        `\nWelche Nummer? Im Konto sind ${incoming_phone_numbers.length}. ` +
          `Gib sie an: node scripts/telefon-einrichten.mjs verbinden +49…\n`,
      );
      process.exit(1);
    }
    nummer = incoming_phone_numbers[0].phone_number;
  }

  const { incoming_phone_numbers = [] } = await twilio(
    `${API}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(nummer)}`,
  );
  const eintrag = incoming_phone_numbers[0];
  if (!eintrag) {
    console.error(`\n${nummer} gehört diesem Konto nicht. Erst kaufen.\n`);
    process.exit(1);
  }

  await twilio(`${TRUNKING}/Trunks/${trunk.sid}/PhoneNumbers`, { PhoneNumberSid: eintrag.sid });
  console.log(`  ${nummer} hängt jetzt am Trunk.`);

  console.log(`
Fertig auf der Twilio-Seite. Was noch in die Railway-Variablen gehört:

  TWILIO_ACCOUNT_SID   ${SID}
  TWILIO_AUTH_TOKEN    (den, mit dem du dieses Skript aufgerufen hast)
  TWILIO_NUMMER        ${nummer}
  OPENAI_PROJECT_ID    ${PROJEKT}
  OPENAI_WEBHOOK_SECRET (aus der OpenAI-Plattform, Webhook auf
                         https://DEINE-DOMAIN/api/telefon/eingehend)

Ohne OPENAI_WEBHOOK_SECRET wird jeder Anruf abgewiesen — das ist Absicht.
Danach: deine eigene Nummer im Dashboard unter Telefon als "Privat" eintragen.
`);
} else {
  console.log(`
Telefon einrichten — ohne Twilio-Konsole.

  status                  Was ist schon eingerichtet?
  nummern [DE]            Freie Nummern suchen (mit Adressnachweis-Hinweis)
  kaufen +49…             Nummer kaufen
  verbinden [+49…]        Trunk anlegen, auf OpenAI zeigen, Nummer anhängen

Nötig: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, OPENAI_PROJECT_ID
`);
}
