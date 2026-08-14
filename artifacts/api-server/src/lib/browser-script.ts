/*
 * Das Skript, das IM Browser-Container laeuft.
 *
 * Es steht hier als String, weil es nicht auf Railway ausgefuehrt wird, sondern
 * per docker exec auf Issas Droplet — dort, wo der Browser installiert ist.
 * Der Umweg ueber eine Datei waere ein zweiter Ort, an dem dasselbe steht.
 *
 * Was es leistet, und warum jedes Stueck davon noetig ist:
 *
 *  - Es wartet, bis die Seite fertig gebaut ist. Genau daran ist fetch_url
 *    gescheitert: Higgsfield liefert roh nur eine leere Huelle, der Inhalt
 *    entsteht erst im Browser.
 *  - Es scrollt. Viele Seiten laden erst beim Scrollen nach ("unendliche
 *    Liste"); ohne Scrollen sieht man die ersten paar Kacheln und denkt, das
 *    sei alles.
 *  - Es folgt einer "Mehr laden"-Schaltflaeche, solange es eine gibt. Das ist
 *    das Blaettern, das Issa meint.
 *  - Es gibt nicht nur Text zurueck, sondern auch Links und Bild-/Video-
 *    Adressen. Bei einer Galerie ist genau das der Inhalt — reiner Text waere
 *    dort fast leer.
 */
export const BROWSER_SCRIPT = String.raw`
const { chromium } = require('playwright');

const url = process.argv[2];
const scrolls = Number(process.argv[3] || 12);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
    locale: 'de-DE',
  });
  const page = await ctx.newPage();

  const konsole = [];
  page.on('console', (m) => { if (m.type() === 'error' && konsole.length < 5) konsole.push(m.text().slice(0, 200)); });

  const antwort = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}

  // Nachladen ausloesen: scrollen, und wenn es einen "Mehr"-Knopf gibt, druecken.
  let mehrGeklickt = 0;
  let letzteHoehe = 0;
  for (let i = 0; i < scrolls; i++) {
    const hoehe = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      return document.body.scrollHeight;
    });
    try { await page.waitForLoadState('networkidle', { timeout: 4000 }); } catch {}
    await page.waitForTimeout(400);

    if (hoehe === letzteHoehe) {
      const knopf = page.locator(
        'button:has-text("Mehr"), button:has-text("More"), button:has-text("Load"), button:has-text("Weitere"), a:has-text("Weiter"), [aria-label*="next" i]',
      ).first();
      if (mehrGeklickt < 5 && (await knopf.count()) && (await knopf.isVisible().catch(() => false))) {
        await knopf.click({ timeout: 3000 }).catch(() => {});
        mehrGeklickt++;
        await page.waitForTimeout(1200);
        continue;
      }
      break; // nichts waechst mehr und es gibt nichts zu druecken
    }
    letzteHoehe = hoehe;
  }

  const daten = await page.evaluate(() => {
    for (const weg of document.querySelectorAll('script,style,noscript,svg')) weg.remove();
    const text = (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').trim();

    const einmalig = (liste) => [...new Set(liste.filter(Boolean))];
    const links = einmalig(
      [...document.querySelectorAll('a[href]')]
        .map((a) => {
          const t = (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80);
          return t ? t + ' -> ' + a.href : a.href;
        }),
    ).slice(0, 200);

    const medien = einmalig([
      ...[...document.querySelectorAll('img[src]')].map((i) => i.currentSrc || i.src),
      ...[...document.querySelectorAll('video[src]')].map((v) => v.src),
      ...[...document.querySelectorAll('video source[src]')].map((s) => s.src),
    ].filter((u) => u && !u.startsWith('data:'))).slice(0, 100);

    return { titel: document.title, text, links, medien };
  });

  console.log(JSON.stringify({
    ok: true,
    status: antwort ? antwort.status() : null,
    url: page.url(),
    mehrGeklickt,
    konsole,
    ...daten,
  }));

  await browser.close();
})().catch((err) => {
  console.log(JSON.stringify({ ok: false, fehler: String((err && err.message) || err) }));
  process.exit(0);
});
`;
