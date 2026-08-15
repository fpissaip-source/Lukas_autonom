# Lukas Higgsfield Production System

> Operative Vorlage für konsistente KI-Videos. Erst ausfüllen, dann generieren. Kreative Planung und technisch ausführbarer Export bleiben getrennt.

## 0. Projektstatus

| Feld | Wert |
|---|---|
| Projekt-ID | `HF-YYYYMMDD-001` |
| Arbeitstitel | |
| Owner | Issa |
| Producer | Lukas |
| Version | `v0.1` |
| Zielplattform | TikTok / Reels / Shorts / YouTube / andere |
| Zielformat | `9:16` / `16:9` / `1:1` |
| Zieldauer | |
| Aktuelle Phase | Brief / Assets / Pilot / Produktion / Picture Lock / Finish |
| Freigegebenes Budget | |
| Deadline | |

### Harte Projekt-Gates

- [ ] **G0 Brief Lock:** Ziel, Publikum, Format, Dauer und Erfolgskriterium sind eindeutig.
- [ ] **G1 Capability Lock:** Modelle, Input-Rollen, Limits und Parameter wurden aktuell aus dem Modellkatalog geprüft.
- [ ] **G2 Asset Lock:** Alle benötigten Figuren, Orte und Schlüsselobjekte besitzen freigegebene Referenzen.
- [ ] **G3 Pilot Lock:** Der kleinste schwierige Szenenpilot erfüllt Figuren- und Raumkonsistenz.
- [ ] **G4 Shot Lock:** Shotliste, Spatial Maps und Dialog sind eingefroren.
- [ ] **G5 Picture Lock:** Schnitt und Shotauswahl ändern sich nicht mehr.
- [ ] **G6 Delivery Lock:** Bild, Stimme, Ambience, SFX, Rechte und Exporte sind geprüft.

**Regel:** Kein späteres Gate kompensiert ein nicht bestandenes früheres Gate.

---

## 1. Creative Brief

| Pflichtfeld | Eintrag |
|---|---|
| Ein-Satz-Idee | |
| Zuschauer-Versprechen | |
| Zielgruppe | |
| Plattform und Nutzungskontext | |
| Gewünschte Handlung nach dem Video | |
| Genre | |
| Tonalität | |
| Visuelle Welt | |
| Hauptkonflikt | |
| Anfangszustand | |
| Endzustand | |
| Muss enthalten | |
| Darf nie erscheinen | |
| Messbares Erfolgskriterium | |

### Story-Beats

| Beat | Zeitfenster | Sichtbares Ereignis | Informationsgewinn | Emotionale Verschiebung |
|---|---:|---|---|---|
| Hook | | | | |
| Setup | | | | |
| Eskalation | | | | |
| Wendung | | | | |
| Payoff | | | | |

---

## 2. Capability Snapshot

> Vor jeder Produktion aktuell über den verbundenen Modellkatalog ermitteln. Keine Parameter aus Erinnerung erfinden. Dieser Snapshot ist Dokumentation; nur der validierte Export aus Abschnitt 8 wird an das Tool übergeben.

| Aufgabe | MODEL ID | Stand/Datum | Erlaubte Input-Rollen | Seitenverhältnisse | Dauer | Unterstützte Parameter | Kosten geprüft |
|---|---|---|---|---|---|---|---|
| Character/Asset Image | | | | | | | |
| Image Edit/POV Change | | | | | | | |
| Image-to-Video | | | | | | | |
| Text-to-Video | | | | | | | |
| Voice/Audio | | | | | | | |

### Capability-Gate G1

- [ ] Jede verwendete MODEL ID existiert aktuell.
- [ ] Jede Referenz ist einer erlaubten Input-Rolle zugeordnet.
- [ ] Seitenverhältnis und Dauer werden vom Modell unterstützt.
- [ ] Parameterwerte stammen aus dem aktuellen Modellkatalog.
- [ ] Kosten wurden vor teuren Piloten geprüft.
- [ ] Unklarheiten sind markiert; es gibt keine geratenen Felder.

---

## 3. Asset-Bibel

### 3.1 Figurenkarte

| Feld | Eintrag |
|---|---|
| CHARACTER ID | `CHAR-001` |
| Name | |
| Dramatische Funktion | |
| Alterswirkung | |
| Körperbau/Silhouette | |
| Gesicht: unveränderliche Merkmale | |
| Haare | |
| Kleidung und Materialien | |
| Wiederkehrende Props | |
| Bewegungsmuster | |
| Neutraler Ausdruck | |
| Verbotene Abweichungen | |
| Hero-Referenz-ID | |
| Turnaround-/Profil-Referenzen | |
| Ausdrucksreferenzen | |
| Soul-/Identity-ID, falls vorhanden | |

**Named Locks — nur gültig mit sichtbarem Beweis:**

| Lock-Name | Sichtbarer Frame-Beweis | Failed-Take-Kriterium |
|---|---|---|
| Gesicht | | |
| Silhouette | | |
| Haare | | |
| Kostüm | | |
| Prop | | |

### 3.2 Location-Karte

| Feld | Eintrag |
|---|---|
| LOCATION ID | `LOC-001` |
| Name | |
| Geometrie | |
| Materialien | |
| Lichtquellen | |
| Atmosphäre/Wetter | |
| Feste Landmarken | |
| Zugänge/Ausgänge | |
| Verbotene Änderungen | |
| Master-Plate-ID | |

**Location-Referenzen steuern:** Geometrie, Material, Licht und Atmosphäre.  
**Location-Referenzen steuern nicht:** das Framing des aktuellen Shots.

### 3.3 Prop-Karte

| Feld | Eintrag |
|---|---|
| PROP ID | `PROP-001` |
| Name | |
| Abmessungswirkung | |
| Material/Farbe | |
| Besitz/Handzuordnung | |
| Ausgangszustand | |
| Zustandsänderungen | |
| Referenz-ID | |
| Failed-Take-Kriterium | |

### 3.4 Audio-Karte

| Feld | Eintrag |
|---|---|
| AUDIO ID | `AUD-001` |
| Typ | Voice / Room Tone / SFX / Motion Reference |
| Sprecher/Quelle | |
| Text/Inhalt | |
| Aussprache | |
| Emotion/Subtext | |
| Timing | |
| Nutzungsrecht/Quelle | |

### Asset-Lock G2

- [ ] Jede zentrale Figur hat Hero, Profil und Ganzkörperbeweis.
- [ ] Jeder wiederkehrende Ort hat eine Master Plate und sichtbare Landmarken.
- [ ] Schlüsselprops haben Zustand und Handzuordnung.
- [ ] Jeder Named Lock besitzt einen sichtbaren Beweis und ein Failed-Take-Kriterium.
- [ ] Keine Referenz-ID zeigt auf einen bloßen Dateinamen ohne auffindbares Asset.

---

## 4. Szenenkarte und Spatial Map

### 4.1 Szenenkopf

| Feld | Eintrag |
|---|---|
| SCENE ID | `SC-001` |
| Ort | `LOC-___` |
| Tageszeit | |
| Story-Ziel | |
| Konflikt | |
| Eintrittszustand | |
| Austrittszustand | |
| 180°-Linie | |
| Erlaubte Kameraseite | |
| Kontinuitätsobjekte | |

### 4.2 Versionierte Spatial Map

> Innerhalb einer freigegebenen Szenenversion wird dieser Block wortgleich in jeden Shot übernommen. Eine räumliche Änderung erzeugt `MAP v2`, dokumentiert den Grund und erzwingt eine erneute Anschlussprüfung; sie wird niemals still in Einzelshots verändert.

```text
SPATIAL MAP — SC-___ / MAP v1
CAMERA SIDE:
180-DEGREE LINE:
LANDMARK A:
LANDMARK B:
LANDMARK C:
CHAR-___ POSITION: anchored to [visible landmark], facing [visible target]
CHAR-___ POSITION: anchored to [visible landmark], facing [visible target]
PROP-___ POSITION: anchored to [visible landmark/object]
ENTRY/EXIT PATHS:
FORBIDDEN GEOGRAPHY CHANGES:
```

**Regel:** Positionen an sichtbare Landmarken binden, nicht an Meterangaben oder unklare relative Begriffe wie „links“ ohne Bezugssystem.

### 4.3 Master-Wide

Jede Szene beginnt mit ungefähr einer Sekunde Master-Wide:

- Geografie und vollständiges Blocking sind bereits sichtbar.
- Keine Aktion und kein Dialog in dieser ersten Sekunde.
- Der Shot dient als generiertes Ankerartefakt und Referenz für nachfolgende Shots.
- Abweichungen von der Spatial Map sind ein Failed Take.

| Master-Wide-Feld | Eintrag |
|---|---|
| SHOT ID | `SC-001-SH-000` |
| Startbild/Plate | |
| Alle sichtbaren Figuren | |
| Alle sichtbaren Landmarken | |
| FOV | |
| Generations-ID | |
| Freigabe | Pass / Fail |

---

## 5. Shotliste

| SHOT ID | Szene | Funktion | Bildgröße/FOV | Dauer | Startzustand | Endzustand | Dialog/SFX | Referenzen | Modell | Status |
|---|---|---|---:|---:|---|---|---|---|---|---|
| `SC-001-SH-000` | 001 | Master-Wide | | 1 s+ | | | kein Dialog | | | |

### FOV-Leiter

`180° / 135° / 107° / 84° / 63° / 47° / 29° / 18° / 12° / 8°`

- **Native Zone:** 29°–84°; zuerst dort lösen.
- Extreme FOVs nur einsetzen, wenn Bildinhalt, Distanz, Perspektive und Beobachtungsmuster dazu passen.
- FOV beschreibt die gewünschte Bildwirkung, nicht automatisch einen vom Modell unterstützten numerischen Parameter. Nur als API-Parameter exportieren, wenn der Capability Snapshot dies bestätigt.

---

## 6. Shot Card

| Pflichtfeld | Eintrag |
|---|---|
| SHOT ID | |
| Zweck im Schnitt | |
| MODEL ID | |
| MODEL-SNAPSHOT-DATUM | |
| INPUT ROLE MAPPING | |
| ALLOWED PARAMETERS | |
| Dauer/Format | |
| Start-Frame-ID | |
| Endzustand | |
| Spatial-Map-Version | |
| Kontinuität vom vorherigen Shot | |
| Kontinuität zum nächsten Shot | |
| Teuerstes Fehlerrisiko | |
| Failed-Take-Kriterien | |

### Acting Card

| Feld | Eintrag |
|---|---|
| Ziel der Figur | |
| Hindernis | |
| Ungesprochene innere Zeile | |
| Konkretes Blickziel | |
| Muskelphysik/Körperspannung | |
| Hand-/Fußkontakte | |
| Mikrosakkaden/Blinks | |
| Mikroereignis Sekunde 0–2 | |
| Mikroereignis Sekunde 2–4 | |
| Mikroereignis Sekunde 4–6 | |
| Verbotenes Overacting | |

---

## 7. Prompt-Skeleton — exakt 15 Blöcke

> Reihenfolge und Überschriften bleiben unverändert. Jeder Referenztag erscheint genau einmal und ausschließlich in `ACTIVE REFERENCES`. Nicht benötigte Inhalte werden als `NONE` markiert, der Block wird nicht gelöscht.

```text
[1. SCENE CONTEXT]
SCENE ID:
SHOT ID:
STORY MOMENT:
SHOT PURPOSE:
CONTINUITY FROM/TO:

[2. ACTIVE REFERENCES]
IMAGE REFERENCES: [max 9; TAG → ASSET ID → PURPOSE]
VIDEO REFERENCES: [max 3; TAG → ASSET ID → PURPOSE]
AUDIO REFERENCES: [max 3; TAG → ASSET ID → PURPOSE]
Do not infer framing from location references.

[3. LOCATION MAP]
[PASTE THE APPROVED SPATIAL MAP VERSION WORD FOR WORD]

[4. FIRST FRAME AND SPATIAL BLOCKING]
VISIBLE SUBJECTS AT FRAME 0:
LANDMARK-ANCHORED POSITIONS:
BODY ORIENTATION:
HAND/FOOT/PROP CONTACTS:
OCCLUSIONS:
FOR MASTER-WIDE ONLY: Hold approximately one second with completed blocking, no action, no dialogue.

[5. FORMAT MODE]
ASPECT RATIO:
DURATION:
OUTPUT MODE:

[6. OPTICS]
TARGET FOV FROM LADDER:
SUBJECT DISTANCE EFFECT:
DEPTH OF FIELD:
DISTORTION BEHAVIOR:

[7. CAMERA]
HEIGHT:
ANGLE:
MOVEMENT:
MOVEMENT MOTIVATION:
180-DEGREE-LINE COMPLIANCE:

[8. ACTION TIMING]
0.0–1.0 s:
1.0–2.0 s:
2.0–4.0 s:
4.0–END:
END FRAME:

[9. PHYSICS]
WEIGHT AND INERTIA:
FOOT/HAND CONTACT:
CLOTH/HAIR/OBJECT RESPONSE:
COLLISION OR FORCE PATH:

[10. LIGHTING]
KEY SOURCE:
FILL/NEGATIVE FILL:
PRACTICALS:
EXPOSURE PRIORITY:
CONTINUITY REQUIREMENTS:

[11. AUDIO]
DIALOGUE:
VOICE/SPEAKER:
ROOM TONE:
SFX EVENTS AND TIMING:
SFX only. No music.

[12. CHARACTER ACTING]
GOAL:
OBSTACLE:
UNSPOKEN INNER LINE:
CONCRETE EYE TARGET:
MUSCLE PHYSICS:
MICROSACCADES/BLINKS:
VISIBLE MICRO-EVENT EVERY 1–2 SECONDS:

[13. STYLE]
VISUAL LANGUAGE:
TEXTURE:
COLOR INTENT:
GENRE-SPECIFIC BEHAVIOR:

[14. QUALITY]
IDENTITY LOCKS:
GEOMETRY LOCKS:
TEMPORAL COHERENCE:
FAILED-TAKE CHECKS:

[15. POSITIVE CONSTRAINTS]
State desired visible outcomes positively and concretely.
Keep identities, wardrobe, geography, handedness and prop state continuous.
```

### Prompt-Lint vor Export

- [ ] Genau 15 Blöcke, richtige Reihenfolge.
- [ ] Jeder Referenztag genau einmal und nur in `ACTIVE REFERENCES`.
- [ ] Maximal 9 Bild-, 3 Video- und 3 Audio-Referenzen.
- [ ] Spatial Map stimmt wortgleich mit der freigegebenen Version überein.
- [ ] Modell, Rollen und Parameter stimmen mit dem aktuellen Capability Snapshot überein.
- [ ] Start- und Endzustand sind sichtbar prüfbar.
- [ ] Acting ist körperlich beschrieben, nicht nur mit Emotionsadjektiven.
- [ ] `SFX only. No music.` ist enthalten.

---

## 8. Technisch ausführbarer Export

> Dieser Abschnitt wird aus der freigegebenen Shot Card erzeugt. Er darf nur Felder enthalten, die das gewählte Tool tatsächlich akzeptiert. Kreative Begriffe aus dem Prompt-Skeleton werden nicht eigenmächtig zu API-Parametern umgedeutet.

```yaml
shot_id: SC-001-SH-001
model: VERIFIED_MODEL_ID
prompt: |
  [FULL 15-BLOCK PROMPT]
medias:
  - role: VERIFIED_ROLE
    value: CONFIRMED_MEDIA_ID
aspect_ratio: VERIFIED_VALUE
duration: VERIFIED_VALUE
# Nur weitere Parameter aus dem aktuellen Capability Snapshot.
```

### Preflight-Gate pro Shot

- [ ] Alle `value`-Einträge sind bestätigte Media-IDs oder zulässige Job-IDs, keine lokalen Pfade.
- [ ] Jede `role` ist für diese MODEL ID erlaubt.
- [ ] Prompt, Dauer, Format und Referenzanzahl liegen innerhalb der Limits.
- [ ] Kostencheck durchgeführt, falls der Shot teuer oder experimentell ist.
- [ ] Genau ein kontrolliertes Experiment ist benannt.
- [ ] Failed-Take-Kriterien stehen vor der Generierung fest.

---

## 9. Pilot vor Vollproduktion

Wähle die kleinste Sequenz, die zugleich enthält:

1. zwei wiederkehrende Figuren,
2. einen Blickrichtungs-/Reverse-Angle-Wechsel,
3. ein Schlüsselprop mit Handkontakt,
4. einen Übergang vom Master-Wide in mindestens zwei engere Shots,
5. die schwierigste relevante Physik oder Sprache.

### Pilot-Gates G3

| Prüfung | Messmethode | Go | No-Go |
|---|---|---|---|
| Figurenkonsistenz | 10 blind gemischte Frames gegen Named Locks prüfen | mindestens 9/10 bestehen; kein kritischer Identitätsbruch | unter 9/10 oder ein kritischer Bruch |
| Räumliche Anschlussfähigkeit | Master-Wide + zwei Folge-Shots ohne Prompttext ansehen | Figuren, Blickachsen, Ein-/Ausgänge und Prop-Ort eindeutig anschließbar | Zuschauer muss Geografie erraten oder Widerspruch erklären |
| FOV-Lesbarkeit | Drei Motive in Native Zone vergleichen | gewünschte Größen-/Perspektivwirkung klar unterscheidbar | FOV-Angabe erzeugt keine belastbare Wirkung |
| Input-Ausführbarkeit | Export ohne manuelle Reparatur validieren | alle Rollen/Parameter akzeptiert | Operator muss Rollen oder Parameter erraten |
| Reproduzierbarkeit | freigegebenen Shot aus Log erneut variieren | gezielte Ein-Zeilen-Änderung sichtbar, Locks bleiben | mehrere unbeabsichtigte Achsen ändern sich |

**Bei No-Go:** Nicht in Masse generieren. Asset, Mapping, Shotdesign oder Modellwahl reparieren und Pilot wiederholen.

---

## 10. Iterationslog

> Pro Iteration genau eine Promptzeile oder eine klar benannte technische Variable ändern. Keine Mehrfachänderungen, die die Ursache verschleiern.

| Version | Generation-ID | Geänderte Zeile/Variable | Hypothese | Ergebnis | Locks bestanden | Verdikt | Nächster Schritt |
|---|---|---|---|---|---|---|---|
| v001 | | Baseline | | | | Keep / Reject | |

### Abbruchregel

Nach 15–20 Fehlversuchen nicht weiter am selben Shot herumformulieren. Eine strukturelle Änderung wählen und als neue Shotversion dokumentieren:

- Shot teilen,
- Aktion entfernen oder vereinfachen,
- Winkel ändern,
- Physik anders lösen,
- Referenz oder Modell wechseln.

---

## 11. Edit und Finish

### Parallel zum Generieren

- [ ] Jeder freigegebene Take wird sofort in die Timeline gelegt.
- [ ] Schnittfunktion wird gegen die Shotliste geprüft.
- [ ] Clipanfang und -ende werden testweise meist um etwa 0,5 Sekunden getrimmt.
- [ ] Fehlende Inserts, Reaktionen und Übergänge werden früh sichtbar gemacht.
- [ ] Ambience-Kontinuität wird als eigene Spur geplant.

### Picture Lock G5

- [ ] Jeder Shot hat eine eindeutige narrative Funktion.
- [ ] Blickachsen, Bewegungsrichtung und Geografie schneiden sauber.
- [ ] Keine sichtbaren Identitäts-, Kostüm-, Prop- oder Handedness-Brüche.
- [ ] Rhythmus funktioniert ohne Musik als Krücke.
- [ ] Start-/Endframes erzeugen keine unnötigen Generationsreste.

### Finish-Reihenfolge

1. Retusche oder gezielte Regeneration nach Picture Lock.
2. Farb- und Belichtungsangleichung.
3. Voice Cleanup und Dialogkontinuität.
4. Kontinuierliche Ambience.
5. Präzises Sounddesign und SFX.
6. Musik nur als separater Postproduktionsentscheid; Generationsprompts bleiben `SFX only. No music.`
7. Plattformexport und technische Sichtprüfung.

### Delivery QC G6

| Bereich | Pass-Kriterium | Ergebnis |
|---|---|---|
| Story | Ohne Erklärung verständlich | |
| Figuren | Named Locks in allen verwendeten Frames bestanden | |
| Raum | Keine widersprüchliche Geografie/Blickachse | |
| Props | Zustand, Hand und Position kontinuierlich | |
| Bewegung | Gewicht, Kontakt und Kollision glaubhaft | |
| Bild | Kein störendes Flackern, Warping oder Detaildrift | |
| Sprache | Sprecher, Lippenwirkung, Timing und Verständlichkeit akzeptabel | |
| Ton | Ambience kontinuierlich; SFX synchron; keine unbeabsichtigte Musik | |
| Export | Format, Auflösung, Framerate, Dauer und Lautheit geprüft | |
| Nachweis | Finaldatei, Projektversion, verwendete Generation-IDs und Rechtequellen archiviert | |

---

## 12. Abschlussprotokoll

| Feld | Eintrag |
|---|---|
| Finalversion | |
| Finaldatei/URL | |
| Freigegeben am | |
| Tatsächliche Generationskosten | |
| Anzahl Generationen | |
| Größter Fehlerhebel | |
| Wiederverwendbare Assets | |
| Nicht wiederholen | |
| Nächster Systemverbesserungsvorschlag | |
