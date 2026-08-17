/*
 * Ein winziger ZIP-Schreiber.
 *
 * Ein Obsidian-Vault ist ein ORDNER — viele kleine Dateien, die zusammen erst
 * einen Sinn ergeben. Auf Railway liegt dieser Ordner in einem Container, der
 * beim naechsten Deploy weg ist; Issa kommt da nie ran. Der Snapshot muss also
 * als eine einzige Datei ueber die Leitung, und das einzige Format, das jedes
 * Betriebssystem ohne Zusatzprogramm oeffnet, ist ZIP.
 *
 * Warum von Hand und nicht mit einer Bibliothek: das hier sind achtzig Zeilen
 * gegen eine neue Abhaengigkeit im Server-Bundle. Node bringt deflate schon
 * mit; es fehlen nur die Kopfsaetze drumherum.
 *
 * Bewusst NICHT unterstuetzt: Zip64 (>4 GB), Verschluesselung, Ordner-
 * Eintraege. Ordner entstehen in jedem Entpacker automatisch aus den Pfaden.
 */
import { deflateRawSync } from "node:zlib";

const crcTabelle = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTabelle[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Datum/Uhrzeit im MS-DOS-Format, das ZIP seit 1989 mit sich herumtraegt. */
function dosZeit(d: Date): { zeit: number; datum: number } {
  return {
    zeit: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f),
    datum: (((Math.max(d.getFullYear(), 1980) - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export type ZipDatei = { pfad: string; inhalt: string | Buffer };

export function packeZip(dateien: ZipDatei[], stand = new Date()): Buffer {
  const { zeit, datum } = dosZeit(stand);
  const stuecke: Buffer[] = [];
  const verzeichnis: Buffer[] = [];
  let versatz = 0;

  for (const datei of dateien) {
    const name = Buffer.from(datei.pfad.replace(/\\/g, "/"), "utf8");
    const roh = Buffer.isBuffer(datei.inhalt) ? datei.inhalt : Buffer.from(datei.inhalt, "utf8");
    const gepackt = deflateRawSync(roh, { level: 9 });
    const summe = crc32(roh);

    const kopf = Buffer.alloc(30);
    kopf.writeUInt32LE(0x04034b50, 0);
    kopf.writeUInt16LE(20, 4); // benoetigte Version
    kopf.writeUInt16LE(0x0800, 6); // Bit 11: Name ist UTF-8 (Umlaute in Titeln!)
    kopf.writeUInt16LE(8, 8); // Verfahren: deflate
    kopf.writeUInt16LE(zeit, 10);
    kopf.writeUInt16LE(datum, 12);
    kopf.writeUInt32LE(summe, 14);
    kopf.writeUInt32LE(gepackt.length, 18);
    kopf.writeUInt32LE(roh.length, 22);
    kopf.writeUInt16LE(name.length, 26);
    kopf.writeUInt16LE(0, 28);

    stuecke.push(kopf, name, gepackt);

    const eintrag = Buffer.alloc(46);
    eintrag.writeUInt32LE(0x02014b50, 0);
    eintrag.writeUInt16LE(20, 4); // erzeugt von
    eintrag.writeUInt16LE(20, 6); // benoetigte Version
    eintrag.writeUInt16LE(0x0800, 8);
    eintrag.writeUInt16LE(8, 10);
    eintrag.writeUInt16LE(zeit, 12);
    eintrag.writeUInt16LE(datum, 14);
    eintrag.writeUInt32LE(summe, 16);
    eintrag.writeUInt32LE(gepackt.length, 20);
    eintrag.writeUInt32LE(roh.length, 24);
    eintrag.writeUInt16LE(name.length, 28);
    eintrag.writeUInt32LE(0, 38); // externe Attribute: normale Datei
    eintrag.writeUInt32LE(versatz, 42);
    verzeichnis.push(eintrag, name);

    versatz += kopf.length + name.length + gepackt.length;
  }

  const inhalt = Buffer.concat(verzeichnis);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0);
  ende.writeUInt16LE(dateien.length, 8);
  ende.writeUInt16LE(dateien.length, 10);
  ende.writeUInt32LE(inhalt.length, 12);
  ende.writeUInt32LE(versatz, 16);

  return Buffer.concat([...stuecke, inhalt, ende]);
}
