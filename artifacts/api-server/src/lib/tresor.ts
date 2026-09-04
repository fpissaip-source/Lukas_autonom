/*
 * Verschluesseln und entschluesseln — fuer Geheimnisse, die ruhen.
 *
 * WARUM UEBERHAUPT. Ein Passwort, das im Klartext in Postgres steht, steht
 * damit auch im naechsten Backup, im Abzug fuer eine Fehlersuche und in jedem
 * Werkzeug, das jemand mal an die Datenbank haengt. Es ist dann nicht mehr
 * "in der Datenbank", sondern an fuenf Orten, von denen man drei vergessen
 * hat.
 *
 * WARUM GCM UND NICHT CBC. Nicht wegen der Geschwindigkeit: GCM merkt, wenn
 * jemand am Kryptotext gedreht hat, und wirft. Bei CBC bekaeme man klaglos
 * Muell zurueck — der dann als Passwort in ein fremdes Anmeldeformular
 * getippt wird. Ein falsches Passwort ist ein gescheiterter Anmeldeversuch;
 * fuenf davon sind ein gesperrtes Konto.
 *
 * WARUM EIGENER IV JE WERT. Zweimal dasselbe Passwort unter demselben
 * Schluessel ergaebe zweimal denselben Kryptotext. Man wuesste dann ohne
 * jeden Schluessel, dass Issa fuer zwei Dienste dasselbe Passwort benutzt —
 * und genau das ist die Information, die einen Einbruch von einem zum
 * naechsten Konto traegt.
 *
 * WAS PASSIERT, WENN DER SCHLUESSEL FEHLT: es wird GEWORFEN. Nie ein
 * Rueckfall auf Klartext, nie ein stilles "dann eben unverschluesselt". Eine
 * Verschluesselung, die sich bei fehlender Konfiguration selbst abschaltet,
 * ist keine — sie ist ein Etikett.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";

/*
 * Ein fester Salt fuer die Ableitung.
 *
 * Salt gegen Rainbow Tables braucht man, wenn viele Geheimnisse mit
 * demselben Verfahren gespeichert werden. Hier wird EIN Schluessel EINMAL
 * abgeleitet, aus einem Wert, den nur Issa kennt. Ein zufaelliger Salt
 * muesste dann irgendwo liegen und mitwandern — mehr bewegliche Teile fuer
 * keinen Gewinn. Die Kosten von scrypt tragen die Sicherheit, nicht der Salt.
 */
const SALT = "lukas-tresor-v1";

let zwischengespeichert: Buffer | null = null;
let ausWert: string | null = null;

/**
 * Der Schluessel aus der Umgebung.
 *
 * Zwei Formen werden angenommen: 32 Bytes als Hex oder base64 werden direkt
 * benutzt, alles andere gilt als Passphrase und wird mit scrypt abgeleitet.
 * Der Grund fuer die zweite Form ist schlicht: Issa wird eine Passphrase
 * eintippen, keine 64 Hexzeichen — und eine Passphrase, die abgelehnt wird,
 * fuehrt dazu, dass jemand "geheim123" als Hex faelscht.
 */
function schluessel(): Buffer {
  const roh = process.env.LUKAS_TRESOR_SCHLUESSEL?.trim();
  if (!roh) {
    throw new Error(
      "LUKAS_TRESOR_SCHLUESSEL ist nicht gesetzt — ohne Schlüssel wird nichts gespeichert. " +
        "Setz eine lange, zufällige Passphrase in der Umgebung des Servers.",
    );
  }
  if (roh.length < 16) {
    throw new Error("LUKAS_TRESOR_SCHLUESSEL ist zu kurz — mindestens 16 Zeichen.");
  }
  if (zwischengespeichert && ausWert === roh) return zwischengespeichert;

  let key: Buffer;
  if (/^[0-9a-f]{64}$/i.test(roh)) {
    key = Buffer.from(roh, "hex");
  } else {
    const b64 = Buffer.from(roh, "base64");
    key = b64.length === 32 ? b64 : scryptSync(roh, SALT, 32);
  }

  zwischengespeichert = key;
  ausWert = roh;
  return key;
}

/** Ob überhaupt verschlüsselt werden kann — für die Oberfläche, nicht als Tor. */
export function tresorBereit(): boolean {
  try {
    schluessel();
    return true;
  } catch {
    return false;
  }
}

export function verschluessele(klartext: string): string {
  const iv = randomBytes(12); // 96 Bit — die für GCM vorgesehene Länge.
  const c = createCipheriv(ALGO, schluessel(), iv);
  const daten = Buffer.concat([c.update(klartext, "utf8"), c.final()]);
  return [
    iv.toString("base64url"),
    c.getAuthTag().toString("base64url"),
    daten.toString("base64url"),
  ].join(":");
}

/**
 * Zurück in Klartext — oder ein Fehler. Nie etwas dazwischen.
 *
 * Der Fehlertext nennt bewusst weder Feld noch Sitzung noch irgendeinen Teil
 * des Werts: er landet in Protokollen, und ein Protokoll ist kein Tresor.
 */
export function entschluessele(gespeichert: string): string {
  const teile = gespeichert.split(":");
  if (teile.length !== 3) throw new Error("Gespeicherter Wert hat nicht die erwartete Form.");
  const [ivB64, tagB64, datenB64] = teile;

  const d = createDecipheriv(ALGO, schluessel(), Buffer.from(ivB64, "base64url"));
  d.setAuthTag(Buffer.from(tagB64, "base64url"));
  // final() wirft, wenn der Schluessel falsch ist ODER jemand am Kryptotext
  // gedreht hat. Beides soll scheitern, nicht Muell liefern.
  return Buffer.concat([d.update(Buffer.from(datenB64, "base64url")), d.final()]).toString("utf8");
}
