/*
 * Obsidian-Sync — schreibt den Gehirn-Snapshot als Vault auf die Platte.
 *
 * Die Datenbank ist die Wahrheit; der Vault wird bei jeder Konsolidierung
 * komplett neu geschrieben (kein Rueckkanal).
 *
 * Frueher stand der komplette Vault-Aufbau hier drin — und er kannte nur die
 * Haelfte von Lukas: Agenten, Episoden, Claims, Strategien, Tagebuch. Seine
 * Erinnerungen, Ziele, Gefuehle, sein Team und die offenen Meldungen fehlten,
 * also fehlten auch alle Verbindungen dorthin. Gebaut wird der Graph deshalb
 * jetzt in gehirn.ts, an EINER Stelle, und hier wird er nur noch abgelegt.
 * Denselben Vault laedt Issa im Dashboard als ZIP herunter.
 *
 * Den Ordner memory-vault/ in Obsidian als Vault oeffnen — Graph-Ansicht zeigt
 * ueber die [[Wikilinks]] das Beziehungsnetz, Gehirn.canvas die gelegte Karte.
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { baueGehirn, gehirnVault } from "./gehirn";
import { logger } from "./logger";

const VAULT_DIR = process.env.MEMORY_VAULT_DIR ?? path.resolve(process.cwd(), "..", "..", "memory-vault");

export async function syncObsidianVault(): Promise<string> {
  const gehirn = await baueGehirn();
  const dateien = gehirnVault(gehirn);

  await rm(VAULT_DIR, { recursive: true, force: true });
  for (const datei of dateien) {
    const ziel = path.join(VAULT_DIR, datei.pfad);
    await mkdir(path.dirname(ziel), { recursive: true });
    await writeFile(ziel, datei.inhalt, "utf8");
  }

  logger.info(
    { dir: VAULT_DIR, knoten: gehirn.zahlen.knoten, kanten: gehirn.zahlen.kanten },
    "Obsidian-Vault generiert",
  );
  return VAULT_DIR;
}
