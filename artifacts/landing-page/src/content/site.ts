/**
 * Einzige Quelle für alle Texte der Landingpage.
 *
 * Alles, was auf der Seite steht, steht hier — die Komponenten enthalten
 * keine Inhalte. Zum Anpassen also nur diese Datei bearbeiten.
 *
 * ACHTUNG: Zahlen, Referenzen und Kontaktdaten sind Platzhalter und müssen
 * vor dem Livegang durch echte Werte ersetzt werden.
 */

export const brand = {
  name: "Issa Studio",
  claim: "Digital Studio",
  email: "hallo@issa.studio",
  phone: "+49 (0) 000 000 000",
  location: "Deutschland — remote für Kunden weltweit",
  socials: [
    { label: "Instagram", href: "#" },
    { label: "TikTok", href: "#" },
    { label: "LinkedIn", href: "#" },
    { label: "GitHub", href: "#" },
  ],
} as const;

export const nav = [
  { label: "Start", href: "#start" },
  { label: "Studio", href: "#studio" },
  { label: "Leistungen", href: "#leistungen" },
  { label: "Arbeiten", href: "#arbeiten" },
  { label: "Ablauf", href: "#ablauf" },
  { label: "Kontakt", href: "#kontakt" },
] as const;

export const hero = {
  eyebrow: "Verfügbar für neue Projekte",
  titleLines: ["Schnell. Klar.", "Gebaut zum"],
  titleAccent: "Verkaufen.",
  body: "Wir gestalten und entwickeln Websites, die messbar arbeiten: kurze Ladezeiten, klare Führung, sauberer Code. Damit aus Besuchern Anfragen werden — nicht nur Klicks.",
  primaryCta: { label: "Kostenloses Erstgespräch", href: "#kontakt" },
  secondaryCta: { label: "Arbeiten ansehen", href: "#arbeiten" },
  chips: [
    "Ladezeit unter 1s",
    "Individuell oder CMS",
    "SEO von Anfang an",
    "Betreuung nach Launch",
  ],
} as const;

export const marquee = [
  "Webdesign",
  "Landingpages",
  "Webentwicklung",
  "SEO",
  "Performance",
  "Branding",
  "Content",
  "E-Commerce",
  "Wartung",
] as const;

export const why = {
  label: "Warum wir",
  title: "Warum Issa Studio die richtige Wahl für deine Website ist",
  body: "Tempo, Individualität und Betreuung in einem. Deine Seite sieht nicht nur gut aus — sie läuft auch dann noch sauber, wenn der erste Launch-Hype vorbei ist.",
  cards: [
    {
      icon: "zap",
      title: "Schnell & optimiert",
      body: "Jede Seite wird auf Ladezeit, Core Web Vitals und mobile Nutzung getrimmt. Kein aufgeblähter Baukasten, kein Plugin-Friedhof.",
    },
    {
      icon: "layers",
      title: "Individuell oder CMS",
      body: "Komplett handgebaut oder mit CMS, damit du Inhalte selbst pflegen kannst. Du entscheidest, wir bauen es passend.",
    },
    {
      icon: "search",
      title: "SEO & Conversion",
      body: "Saubere Struktur, echte Inhalte, klare Handlungsaufforderungen. Sichtbar bei Google und überzeugend beim Menschen davor.",
    },
  ],
} as const;

export const about = {
  label: "Über uns",
  title: "Ein Studio, kein Baukasten",
  body: [
    "Issa Studio gestaltet und entwickelt performante Websites für Marken, die wachsen wollen. Wir verbinden Design, Technik und Reichweite — statt drei Dienstleister zu koordinieren, hast du einen Ansprechpartner.",
    "Wir arbeiten in kurzen, schnellen Schleifen: Du siehst früh etwas Echtes, wir korrigieren gemeinsam, und am Ende steht eine Seite, die du selbst betreiben kannst.",
  ],
  stats: [
    { value: 1.8, suffix: "M+", label: "Organische Views generiert" },
    { value: 40, suffix: "+", label: "Umgesetzte Projekte" },
    { value: 98, suffix: "/100", label: "Ø PageSpeed-Score" },
    { value: 100, suffix: "%", label: "Projekte mit Betreuung danach" },
  ],
  cta: { label: "Leistungen ansehen", href: "#leistungen" },
} as const;

export const services = {
  label: "Leistungen",
  title: "Alles, was deine Website braucht — an einem Ort",
  body: "Von der ersten Skizze bis zur Betreuung nach dem Launch. Einzeln buchbar, am stärksten zusammen.",
  items: [
    {
      icon: "monitor",
      title: "Webdesign",
      body: "Individuelles Design, das zu deiner Marke passt — nicht zu einem Template.",
      points: ["UI/UX-Konzept", "Designsystem", "Klickbare Prototypen"],
    },
    {
      icon: "code",
      title: "Webentwicklung",
      body: "Sauber gebaut mit modernem Stack, wartbar und schnell.",
      points: ["React & TypeScript", "Headless CMS", "Barrierearme Umsetzung"],
    },
    {
      icon: "rocket",
      title: "Landingpages",
      body: "Eine Seite, ein Ziel: Anfragen, Verkäufe oder Anmeldungen.",
      points: ["Conversion-Texte", "A/B-fähiger Aufbau", "Tracking-Setup"],
    },
    {
      icon: "search",
      title: "SEO & Performance",
      body: "Gefunden werden und schnell bleiben — technisch wie inhaltlich.",
      points: ["Technisches SEO", "Core Web Vitals", "Content-Struktur"],
    },
    {
      icon: "sparkles",
      title: "Branding & Content",
      body: "Logo, Bildsprache und Social-Content, die dieselbe Sprache sprechen.",
      points: ["Visual Identity", "Social-Formate", "Foto- & Video-Regie"],
    },
    {
      icon: "shield",
      title: "Betreuung",
      body: "Updates, Monitoring und Verbesserungen, statt einmal abliefern und weg.",
      points: ["Wartung & Backups", "Monatliche Reports", "Schnelle Änderungen"],
    },
  ],
} as const;

export const work = {
  label: "Arbeiten",
  title: "Ausgewählte Projekte",
  body: "Ein Ausschnitt aus laufenden und abgeschlossenen Arbeiten.",
  items: [
    {
      title: "StudyForge",
      mock: "site",
      category: "Produkt · Web-App",
      body: "Lernplattform mit KI-gestützten Karteikarten. Design, Frontend und Onboarding-Flow.",
      tags: ["Produktdesign", "React", "Onboarding"],
      accent: "cyan",
    },
    {
      title: "Dailyraphood",
      mock: "shop",
      category: "Fashion · Shop",
      body: "Marke, Bildsprache und Shop-Auftritt für ein Streetwear-Label.",
      tags: ["Branding", "E-Commerce", "Content"],
      accent: "violet",
    },
    {
      title: "Creator-Kanal",
      mock: "video",
      category: "Social · Reichweite",
      body: "Content-System für Kurzvideo — von der Idee bis zum Schnitt. 1,8 Mio. organische Views.",
      tags: ["Strategie", "Video", "Wachstum"],
      accent: "blue",
    },
    {
      title: "Lukas",
      mock: "dashboard",
      category: "KI · System",
      body: "Dashboard und Oberfläche für ein autonomes KI-System mit eigener Infrastruktur.",
      tags: ["Dashboard", "Designsystem", "Echtzeit"],
      accent: "cyan",
    },
  ],
} as const;

export const process = {
  label: "Ablauf",
  title: "Vier Schritte, keine Überraschungen",
  body: "Du weißt zu jedem Zeitpunkt, woran wir arbeiten und was als Nächstes kommt.",
  steps: [
    {
      title: "Gespräch",
      body: "30 Minuten: Ziel, Zielgruppe, Budget. Danach weißt du, ob wir passen — kostenlos und unverbindlich.",
    },
    {
      title: "Konzept & Design",
      body: "Struktur, Texte und Design als klickbarer Entwurf. Feedback in Runden, nicht in Endlosschleifen.",
    },
    {
      title: "Umsetzung",
      body: "Entwicklung, Inhalte, Technik-Setup. Du bekommst früh einen Testlink und siehst den Fortschritt live.",
    },
    {
      title: "Launch & Wachstum",
      body: "Livegang, Messung, Feinschliff. Auf Wunsch laufende Betreuung mit monatlichem Report.",
    },
  ],
} as const;

export const testimonials = {
  label: "Stimmen",
  title: "Was Kundinnen und Kunden sagen",
  // PLATZHALTER — vor dem Livegang durch echte Referenzen ersetzen.
  items: [
    {
      quote:
        "Die neue Seite lädt sofort und wir bekommen deutlich mehr qualifizierte Anfragen. Die Zusammenarbeit war ruhig und klar strukturiert.",
      name: "M. Bauer",
      role: "Geschäftsführung, Handwerksbetrieb",
    },
    {
      quote:
        "Endlich jemand, der Design und Technik zusammen denkt. Wir mussten nichts übersetzen — es wurde einfach verstanden und gebaut.",
      name: "L. Hoffmann",
      role: "Marketing-Lead, SaaS",
    },
    {
      quote:
        "Vom ersten Entwurf bis zum Launch waren es drei Wochen. Und danach war der Ansprechpartner immer noch da.",
      name: "S. Yıldız",
      role: "Gründerin, Onlineshop",
    },
    {
      quote:
        "Unsere Landingpage konvertiert mehr als doppelt so gut wie vorher. Gleiches Budget, anderer Aufbau.",
      name: "T. Krüger",
      role: "Head of Growth, Agentur",
    },
  ],
} as const;

export const faq = {
  label: "Fragen",
  title: "Häufig gefragt",
  items: [
    {
      q: "Was kostet eine Website?",
      a: "Eine fokussierte Landingpage startet im niedrigen vierstelligen Bereich, eine mehrseitige Unternehmensseite liegt darüber. Den genauen Rahmen nennen wir nach dem Erstgespräch — als Festpreis, nicht als Schätzung.",
    },
    {
      q: "Wie lange dauert ein Projekt?",
      a: "Landingpage: etwa zwei bis drei Wochen. Größere Seiten: vier bis acht Wochen. Der Zeitplan hängt vor allem daran, wie schnell Inhalte und Feedback kommen.",
    },
    {
      q: "Kann ich die Inhalte selbst pflegen?",
      a: "Ja. Auf Wunsch bauen wir ein CMS ein, mit dem du Texte, Bilder und ganze Sektionen ohne Code änderst. Eine kurze Einweisung ist inklusive.",
    },
    {
      q: "Übernehmt ihr auch Texte und Bilder?",
      a: "Ja. Wir schreiben die Texte und übernehmen auf Wunsch Foto- und Video-Regie. Bestehendes Material binden wir selbstverständlich ein.",
    },
    {
      q: "Was passiert nach dem Launch?",
      a: "Auf Wunsch übernehmen wir Wartung, Updates und Monitoring und melden uns monatlich mit Zahlen und Verbesserungsvorschlägen. Ohne Betreuung bekommst du die Seite vollständig übergeben.",
    },
  ],
} as const;

export const finalCta = {
  label: "Kontakt",
  title: "Lass uns etwas bauen, das bleibt",
  body: "Erzähl uns in zwei Sätzen, worum es geht. Wir melden uns innerhalb von 24 Stunden mit einer ehrlichen Einschätzung — auch dann, wenn wir nicht die Richtigen sind.",
  bullets: [
    "Kostenloses 30-Minuten-Gespräch",
    "Festpreis statt Stundenzettel",
    "Antwort innerhalb von 24 Stunden",
  ],
} as const;
