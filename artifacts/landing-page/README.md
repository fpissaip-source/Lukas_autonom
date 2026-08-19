# Landingpage

Eigenständige Marketing-Landingpage — getrennt vom Dashboard (`lukas-ui`) und
vom API-Server. Eigenes Vite-Projekt, eigener Build, eigenes Deployment.

## Starten

```bash
npm run dev:landing      # Entwicklungsserver auf http://localhost:5174
npm run build:landing    # Produktions-Build nach artifacts/landing-page/dist
```

`PORT` und `BASE_PATH` werden aus der Umgebung gelesen, falls gesetzt.
Das Ergebnis ist eine rein statische Seite — `dist/` kann auf jedem
Static-Host liegen (Netlify, Vercel, Cloudflare Pages, Nginx).

## Inhalte ändern

**Alle Texte stehen in `src/content/site.ts`.** Die Komponenten enthalten
keine Inhalte. Markenname, Navigation, Leistungen, Projekte, FAQ und
Kontaktdaten werden dort gepflegt.

Vor dem Livegang zu ersetzen:

- `brand.email`, `brand.phone`, `brand.socials` — aktuell Platzhalter
- `about.stats` — Zahlen prüfen und belegen
- `testimonials.items` — durchgehend Platzhalter, echte Referenzen einsetzen
- Impressum und Datenschutz im Footer verlinken (aktuell `#`)

## Design

Die Tokens (Farben, Schriften, Radien, Animationen) stehen gebündelt im
`@theme`-Block in `src/index.css`. Ein anderes Farbschema entsteht dort mit
drei geänderten Werten (`--color-glow-*`), ohne Eingriff in Komponenten.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `src/App.tsx` | Reihenfolge der Sektionen |
| `src/content/site.ts` | Sämtliche Texte |
| `src/index.css` | Design-Tokens und Basis-Utilities |
| `src/components/NeuralWave.tsx` | Animierte Punktwolke im Hero (Canvas) |
| `src/components/MockScreen.tsx` | Abstrakte Interface-Vorschauen der Karten |
| `src/components/*.tsx` | Je eine Datei pro Sektion |

Es werden keine externen Bilder geladen. Die Vorschauflächen sind aus Markup
gebaut; sobald echte Projektbilder vorliegen, ersetzt ein `<img>` in
`MockScreen.tsx` das jeweilige Mockup. Einzige externe Ressource sind die
Google Fonts im `index.html` — bei Bedarf lokal einbinden.

## Barrierefreiheit und Performance

- Sprungmarke „Zum Inhalt springen“, sichtbarer Fokus, beschriftete Bedienelemente
- `prefers-reduced-motion` schaltet Animationen ab, inklusive Canvas
- Canvas pausiert, sobald es aus dem Sichtbereich scrollt
