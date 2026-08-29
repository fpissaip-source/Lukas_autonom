# Migrationen

Bis hierher lief das Schema über `db:push`: drizzle vergleicht Schema und
Datenbank und gleicht an. Bequem beim Entwickeln — aber ohne Verlauf, ohne
Zurück und ohne Datei, die jemand vorher liest. Eine versehentlich
zerstörende Änderung fällt erst im Betrieb auf.

```bash
npm run db:generate   # Schemaänderung → nummerierte SQL-Datei hier
npm run db:migrate    # offene Migrationen der Reihe nach einspielen
```

`migrate` merkt sich in `drizzle.__drizzle_migrations`, was schon lief.
Geprüft: auf einer frischen Datenbank entstehen daraus alle 26 `lukas_*`
Tabellen (`bench/integration`).

## Der Umstieg auf der bestehenden Datenbank

**`0000` darf dort nicht einfach laufen.** Die Datei enthält `CREATE TABLE`
ohne `IF NOT EXISTS` — auf der Produktionsdatenbank, wo alles schon steht,
würde sie scheitern.

Der Umstieg ist deshalb ein bewusster Schritt: `0000` wird als *bereits
angewendet* markiert, ohne ausgeführt zu werden (Basislinie). Alles danach
läuft normal durch. Solange das nicht passiert ist, bleibt `start:deploy` auf
`push` — ich habe den Deploy-Pfad **nicht** umgestellt, weil ein
fehlgeschlagener Umstieg auf einer geteilten Produktionsdatenbank nichts ist,
was sich zurücknehmen lässt.

Was sich dagegen schon geändert hat: `start:deploy` startet den Server
**nicht mehr**, wenn der Schema-Schritt fehlschlägt. Vorher stand dort ein
`|| echo WARNUNG` — der Server lief dann gegen ein Schema, das nicht zum Code
passt, und die Fehler tauchten verstreut in den Logs auf statt beim Deployment.
