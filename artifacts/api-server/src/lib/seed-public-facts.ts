import { db } from "@workspace/db";
import { memoriesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { recordDebugEvent } from "./debug-log";
import { logger } from "./logger";

// Öffentliche Projekt-Fakten (Kategorie "public") — fließen in den
// öffentlichen Widget-System-Prompt (routes/public.ts::buildPublicSystemPrompt),
// damit Lukas Besuchern konkrete Fragen zu Issas Projekten beantworten kann
// (z.B. "wie sieht's mit SEO bei der Taxi-Seite aus?") statt nichts zu sagen.
// Idempotent pro Fakt (nicht nur ein Marker) — sicher, auch wenn parallel
// manuell weitere public-Erinnerungen über /api/lukas/memories angelegt
// wurden oder dieser Seed mehrfach läuft (z.B. bei jedem Redeploy).
const PUBLIC_FACTS: { content: string; importance: number }[] = [
  { content: "Issa Hareb ist ein 2001 geborener digitaler Creator und angehender Unternehmer aus Essen, Nordrhein-Westfalen.", importance: 9 },
  { content: "Issas Schwerpunkte sind Webentwicklung, KI-gestützte digitale Produkte, Automatisierungen, interaktive Nutzererlebnisse und Unternehmertum.", importance: 9 },
  { content: "Issa arbeitet stark projektorientiert: Er baut lieber funktionierende Prototypen als nur zu planen, und nutzt moderne KI- und No-Code/Low-Code-Werkzeuge für Produktdenken und Systemarchitektur.", importance: 8 },
  { content: "Issas langfristiges Ziel ist der Aufbau eigener digitaler Produkte, Dienstleistungen und einer skalierbaren, finanziell unabhängigen Selbstständigkeit.", importance: 8 },
  { content: "Issa bevorzugt dunkle, reduzierte Designs mit präziser Typografie, kontrollierten Akzentfarben und cinematic Inszenierung; er lehnt generische 'KI-Looks' ab.", importance: 6 },
  { content: "Issa spricht Deutsch (muttersprachlich) und Englisch.", importance: 4 },
  { content: "Issa hat mehrjährige Berufserfahrung in Kundenberatung, Verkauf und Callcenter-Arbeit.", importance: 5 },

  { content: "Issas Portfolio-Webseite ist issahareb.me mit einem cinematic Scroll-Erlebnis, GSAP-Animationen, einer Live-3D-Neuronen-Szene und dem Leitsatz 'I Build Intelligent Systems.'", importance: 8 },
  { content: "Luca (auch L.U.K.A.S. genannt) ist Issas KI-Assistent auf dem Portfolio — er hat ein dauerhaftes Gedächtnis, kann per Text und Sprache (OpenAI Realtime, Millisekunden-Latenz) antworten und bald auch KI-Bilder generieren.", importance: 7 },

  { content: "TaxiBB Essen (taxibbessen.de) ist eine reale Unternehmenswebseite für ein tatsächliches Taxiunternehmen in Essen — kein Konzept, ein reales Kundenprojekt.", importance: 8 },
  { content: "Bei TaxiBB Essen hat Issa die technische SEO-Bewertung (Seobility) durch eine gezielte Überarbeitung von rund 36% auf etwa 94% verbessert.", importance: 8 },
  { content: "Die SEO-Optimierung von TaxiBB Essen umfasste strukturierte Daten (JSON-LD), XML-Sitemaps, Local-SEO-Signale und technische Meta-Optimierung für lokale Suchanfragen in Essen.", importance: 8 },
  { content: "TaxiBB Essen trennt ein statisches, SEO-optimiertes Frontend von dynamischen Backend-Funktionen wie Kontakt-E-Mails über die Resend-API und einer PostgreSQL-Datenbank.", importance: 6 },
  { content: "TaxiBB Essen wurde ursprünglich mit Replit entwickelt und später auf eine eigenständige Hosting-Struktur (eigene Domain/DNS) migriert.", importance: 5 },
  { content: "Nach eigener Aussage von Issa war TaxiBB Essen dank der guten technischen SEO-Struktur zeitweise sogar über ChatGPT auffindbar.", importance: 5 },

  { content: "GuardianGrid (guardiangrid.io) ist ein ambitioniertes Destiny-2-Companion-Projekt mit Bungie-OAuth2-Anmeldung, Inventar- und Loadout-Verwaltung, Godroll-Bewertung von Waffen und PvP-Analyse.", importance: 6 },
  { content: "GuardianGrid nutzt die offizielle Bungie API für Charakterdaten, Ausrüstung und Live-Aktivitäten, abgesichert unter anderem mit Cloudflare Turnstile.", importance: 4 },

  { content: "StudyForge ist eine KI-gestützte Lernplattform mit PDF-Upload, automatischen Zusammenfassungen, Erkennung wichtiger Begriffe, Quizfragen und Mock-Klausuren.", importance: 6 },

  { content: "Cho Time – Work & Fun ist eine modulare Callcenter-Management-Suite mit Dashboard, Leaderboard, Live-Performance, Wissensdatenbank, Schichtplanung und Incentive-System.", importance: 5 },
  { content: "Cho Time ist bewusst modular aufgebaut, damit einzelne Bereiche für unterschiedliche Unternehmen angepasst oder ersetzt werden können.", importance: 4 },

  { content: "TENSA. ist Issas Streetwear-Marke mit einem Zipper-Hoodie und Bootcut-Jogger, gestaltet mit echten produktionsfähigen Vektordateien (keine einfachen Bildumwandlungen) und einem Elefantenkopf-Logo.", importance: 5 },

  { content: "Issa hat ein KI-gestütztes TikTok-Affiliate-Projekt umgesetzt, das nach eigenen Angaben rund 1,8 Millionen Aufrufe und über 100 Verkäufe erzielte.", importance: 6 },

  { content: "Issa nutzt React, JavaScript/TypeScript, Tailwind CSS, GSAP, PostgreSQL, OAuth2, Next.js und moderne KI-Chatbot-/Voice-Technologien.", importance: 6 },
  { content: "Issa arbeitet unter anderem mit Railway, Render, Vercel und Replit als Hosting-Plattformen.", importance: 4 },
  { content: "Issa nutzt KI aktiv als Entwicklungswerkzeug: für Architektur, Code, Fehleranalyse, Prototyping und Automatisierung — nicht nur zum Text erzeugen.", importance: 5 },

  { content: "Issa bietet Leistungen wie moderne Unternehmenswebseiten, Local SEO, KI-Chatbots, Voice Interfaces, cinematic Web-Erlebnisse und API-/Datenbankintegrationen an.", importance: 6 },
  { content: "Issa baut außerdem Telefon- und Support-KI-Agenten: Sprachassistenten, die in Echtzeit zuhören und im Millisekundenbereich antworten, mit natürlicher Gesprächsführung statt starrem Skript-Bot — wahlweise per Chat oder direkt am Telefon, ideal für Kundensupport, Terminvereinbarung oder Erstberatung rund um die Uhr.", importance: 7 },
  { content: "Issa interessiert sich für Destiny 2, Gaming allgemein und Musik von Juice WRLD.", importance: 4 },
  { content: "Issa sieht eine Ausbildung oder Berufserfahrung als Absicherung, sein eigentliches Ziel bleibt aber der Aufbau eigener digitaler Projekte.", importance: 5 },
];

export async function seedPublicFactsOnce(): Promise<void> {
  try {
    let created = 0;
    for (const fact of PUBLIC_FACTS) {
      const [existing] = await db
        .select({ id: memoriesTable.id })
        .from(memoriesTable)
        .where(eq(memoriesTable.content, fact.content))
        .limit(1);
      if (existing) continue;
      await db.insert(memoriesTable).values({
        content: fact.content,
        category: "public",
        importance: fact.importance,
      });
      created++;
    }
    if (created > 0) {
      logger.info({ created }, "Öffentliche Projekt-Fakten importiert");
      recordDebugEvent("seed-public-facts", `${created} neue öffentliche Fakten importiert (${PUBLIC_FACTS.length} insgesamt geprüft).`);
    }
  } catch (err) {
    logger.error({ err }, "Public-Facts-Seed fehlgeschlagen");
    recordDebugEvent("seed-public-facts", err);
  }
}
