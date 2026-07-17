#!/usr/bin/env python3
"""Initialisiert Issas Owner-Profil und Kernwissen im Memory Graph."""
from memory_graph import remember, update_owner_profile, _load, _save

profile = {
    "name": "Issa",
    "herkunft": "Libanon",
    "sprachen": ["Deutsch (Haupt)", "Englisch"],
    "lieblingsmusiker": "Juice WRLD",
    "lieblingsgebäck": "Sfouf",
    "persönlichkeit": [
        "Neugierig", "Schnelldenker", "Systemdenker",
        "Starke Langzeiterinnerung", "Verliert manchmal Interesse nach Anfangsbegeisterung"
    ],
    "design_stil": "Premium, modern, cinematisch, futuristisch, interaktiv",
    "kommunikation": "Direkt, ehrlich, klar, kein Gelaber",
    "körper": "180cm, 64kg, Ziel: 85kg gesunder Masseaufbau",
    "gaming": ["Destiny 2 Warlock (PvE, aggressiv)", "Clash Royale"],
    "ziel": "Finanzielle Freiheit und Unabhängigkeit"
}

for key, val in profile.items():
    update_owner_profile(key, val)

memories = [
    ("Issa heißt mit Vornamen Issa und kommt ursprünglich aus dem Libanon", "personal", 10, ["name", "herkunft"]),
    ("Issas absoluter Lieblingsmusiker ist Juice WRLD — mit großem Abstand", "preference", 8, ["musik", "juice wrld"]),
    ("Lieblingsgebäck: Sfouf (libanesisches Gebäck)", "preference", 6, ["essen", "libanon"]),
    ("Issa ist 180cm groß, wiegt 64kg und will auf mindestens 85kg gesund zunehmen", "health", 8, ["fitness", "gewicht", "masseaufbau"]),
    ("Issa hat eine Ausbildung als Kaufmann für Dialogmarketing begonnen am 01.08", "work", 8, ["ausbildung", "beruf", "ihk"]),
    ("Starker Fokus auf WISO, BBiG, Ausbildungsrecht, IHK-Prüfungsvorbereitung", "learning", 7, ["ausbildung", "prüfung"]),
    ("Issa denkt tief über Systeme, Business, Technik und Machtstrukturen nach", "personal", 8, ["denken", "analyse"]),
    ("Issa hat manchmal das Muster: starke Anfangsbegeisterung, dann springt er zum nächsten Thema", "personal", 7, ["muster", "fokus"]),
    ("Issa hat eine sehr starke Langzeiterinnerung, besonders bei Gesichtern und Details", "personal", 7, ["gedächtnis", "stärke"]),

    ("ZIEL: Finanzielle Freiheit und Unabhängigkeit — das ist das übergeordnete Ziel von allem", "goal", 10, ["finanzen", "freiheit", "kernziel"]),
    ("Issa beschäftigt sich intensiv mit Aktien, Trading, Hebel, Small Caps, Skalierung", "finance", 8, ["trading", "aktien", "invest"]),

    ("Projekt: TikTok-Affiliate-Business @lucy_srg — 1.8M Views, 103 Verkäufe, ~140€ Provision in 60 Tagen", "project", 8, ["tiktok", "affiliate", "einkommen"]),
    ("Projekt: StudyForge — KI-Lernplattform mit PDF-Upload, Analyse, Quiz, Mock-Klausuren (React+Tailwind)", "project", 7, ["studyforge", "ki", "lernen"]),
    ("Projekt: Dailyraphood — Modemarke/Fashion Brand mit React+Tailwind Shop", "project", 6, ["dailyraphood", "fashion", "marke"]),
    ("Projekt: Destiny-Gaming-App (DIM-Konkurrent, GuardianGrid) — AI-Godroll, Meta-Tracking, Premium-UI", "project", 6, ["gaming", "destiny", "app"]),
    ("Projekt: Taxi-Web-App — Online-Buchungen mit Start/Ziel, Zentrale erhält Buchungen", "project", 5, ["taxi", "webapp"]),
    ("Projekt: Finanz-/Schulden-Tracker — Web-App für Gläubiger, Zahlungen, Ratenpläne", "project", 6, ["finanzen", "schulden", "tracker"]),

    ("LUKAS-Projekt: Autonomer AI-Agent — 27.114 Zeilen Code, Polymarket Trading, Voice Chat, Telegram Bot, VPS-Management", "project", 10, ["lukas", "ai", "agent", "hauptprojekt"]),

    ("Schulden gesamt ca. 8.147€ — Sparkasse, Commerzbank, BID Inkasso, Coeo, PayPal, Ratepay, Troy, Riverty, KSP, Paij", "finance", 9, ["schulden", "inkasso", "verpflichtungen"]),
    ("Commerzbank: ~1.556€ Rest, Rate 160€/Monat (vollstreckt)", "finance", 7, ["schulden", "commerzbank"]),
    ("BID Inkasso: ~1.850€ offen", "finance", 7, ["schulden", "inkasso"]),
    ("Riverty Roland: ~621€, Vollstreckungsbescheid", "finance", 7, ["schulden", "vollstreckung"]),
    ("KSP: erste Rate 75€ bereits bezahlt", "finance", 6, ["schulden", "fortschritt"]),

    ("Destiny 2: Warlock Main, PvE, aggressiver Spielstil, Borrowed Time + Fluchtkünstler", "gaming", 5, ["destiny", "warlock", "build"]),
    ("Clash Royale: Megaritter, Banditin, Goldener Ritter, Blitzmagier", "gaming", 4, ["clash royale", "deck"]),

    ("Design-Vorlieben: Premium, cinematisch, futuristisch, starke UI/UX, Animationen, Parallax, Microinteractions", "preference", 7, ["design", "ui", "stil"]),

    ("Butinaca-Entzug begonnen am 28.09.2025, erste 2 Tage mit Cannabis abgefedert", "health", 7, ["entzug", "gesundheit"]),
]

for content, cat, imp, tags in memories:
    remember(content, category=cat, tags=tags, importance=imp, auto_connect=True)

data = _load()
print(f"Owner Memory initialisiert: {len(data['nodes'])} Nodes, {len(data['edges'])} Edges")
print(f"Owner Profile: {list(data['owner_profile'].keys())}")
