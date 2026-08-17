import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { Network, Download, Loader2, Search, X } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Knoten = {
  id: string;
  art: string;
  titel: string;
  gewicht: number;
  text: string;
  daten: Record<string, string | number | boolean>;
  datei: string;
  ordner: string;
};
type Kante = { von: string; nach: string; art: string; gewicht: number };
type Gehirn = { stand: string; knoten: Knoten[]; kanten: Kante[]; zahlen: Record<string, number> };

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("lukas_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/*
 * Farben nach Art. Nicht Dekoration: der Graph hat vierzehn Arten von Knoten,
 * und ohne Farbe ist er eine graue Wolke, in der man nur noch Groesse sieht.
 */
const FARBEN: Record<string, string> = {
  identitaet: "#f5f5f5",
  gefuehl: "#f472b6",
  ziel: "#fbbf24",
  erinnerung: "#60a5fa",
  kategorie: "#38bdf8",
  thema: "#34d399",
  agent: "#c084fc",
  subjekt: "#a3e635",
  aussage: "#94a3b8",
  episode: "#fb923c",
  episodenart: "#fdba74",
  strategie: "#facc15",
  mitarbeiter: "#2dd4bf",
  tagebuch: "#818cf8",
  meldung: "#ef4444",
};

const WORT: Record<string, string> = {
  identitaet: "Er selbst",
  gefuehl: "Gefühle",
  ziel: "Ziele",
  erinnerung: "Erinnerungen",
  kategorie: "Kategorien",
  thema: "Themen",
  agent: "Agenten",
  subjekt: "Subjekte",
  aussage: "Aussagen",
  episode: "Episoden",
  episodenart: "Episodenarten",
  strategie: "Strategien",
  mitarbeiter: "Team",
  tagebuch: "Tagebuch",
  meldung: "Meldungen",
};

type Punkt = { x: number; y: number };

/*
 * Kraefte-Layout (Fruchterman-Reingold).
 *
 * Kanten ziehen, Knoten stossen sich ab — was zusammengehoert, rueckt
 * zusammen. Die Abstossung wird ueber ein Gitter genaehert: jeder Knoten sieht
 * nur die neun Zellen um sich herum. Ohne das waeren es bei 600 Knoten
 * 360.000 Paare pro Schritt, und der Browser stuende sekundenlang.
 *
 * Gerechnet wird EINMAL, nicht in jedem Bild. Ein Graph, der ewig
 * weiterzappelt, sieht lebendig aus und ist zum Lesen unbrauchbar.
 */
function lege(knoten: Knoten[], kanten: Kante[], schritte = 300): Map<string, Punkt> {
  const n = knoten.length;
  const flaeche = 1_000_000;
  const k = Math.sqrt(flaeche / Math.max(n, 1));
  const idx = new Map(knoten.map((kn, i) => [kn.id, i]));
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);

  // Startlage auf einer Spirale mit goldenem Winkel: gleichmässig verteilt und
  // bei gleichen Daten immer gleich — sonst sähe der Graph bei jedem Laden
  // anders aus.
  for (let i = 0; i < n; i++) {
    const r = k * 0.6 * Math.sqrt(i + 1);
    const w = i * 2.39996;
    px[i] = Math.cos(w) * r;
    py[i] = Math.sin(w) * r;
  }

  const paare = kanten
    .map((e) => [idx.get(e.von), idx.get(e.nach), e.gewicht] as [number, number, number])
    .filter((p) => p[0] !== undefined && p[1] !== undefined);

  const zelle = k * 2;
  let temperatur = k * 1.2;

  for (let s = 0; s < schritte; s++) {
    vx.fill(0);
    vy.fill(0);

    // Abstossung, nur in der Nachbarschaft
    const gitter = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const schluessel = `${Math.floor(px[i] / zelle)},${Math.floor(py[i] / zelle)}`;
      const l = gitter.get(schluessel);
      if (l) l.push(i);
      else gitter.set(schluessel, [i]);
    }
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(px[i] / zelle);
      const cy = Math.floor(py[i] / zelle);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const j of gitter.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (i === j) continue;
            let ex = px[i] - px[j];
            let ey = py[i] - py[j];
            let d2 = ex * ex + ey * ey;
            if (d2 < 0.01) {
              // Exakt aufeinander: minimal auseinanderschubsen, sonst teilt
              // man gleich durch null.
              ex = (i % 7) - 3;
              ey = (j % 7) - 3;
              d2 = ex * ex + ey * ey || 1;
            }
            const kraft = (k * k) / d2;
            vx[i] += ex * kraft;
            vy[i] += ey * kraft;
          }
        }
      }
    }

    // Anziehung entlang der Kanten
    for (const [a, b, g] of paare) {
      const ex = px[a] - px[b];
      const ey = py[a] - py[b];
      const d = Math.sqrt(ex * ex + ey * ey) || 0.01;
      const kraft = ((d * d) / k) * (0.4 + g * 0.6);
      const fx = (ex / d) * kraft;
      const fy = (ey / d) * kraft;
      vx[a] -= fx;
      vy[a] -= fy;
      vx[b] += fx;
      vy[b] += fy;
    }

    // Leichte Schwerkraft zur Mitte, damit einzelne Inseln nicht davonfliegen
    for (let i = 0; i < n; i++) {
      vx[i] -= px[i] * 0.012;
      vy[i] -= py[i] * 0.012;
    }

    for (let i = 0; i < n; i++) {
      const d = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]) || 1;
      const schritt = Math.min(d, temperatur);
      px[i] += (vx[i] / d) * schritt;
      py[i] += (vy[i] / d) * schritt;
    }
    temperatur *= 0.975;
  }

  const lage = new Map<string, Punkt>();
  knoten.forEach((kn, i) => lage.set(kn.id, { x: px[i], y: py[i] }));
  return lage;
}

export default function GehirnSeite() {
  const [daten, setDaten] = useState<Gehirn | null>(null);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [lade, setLade] = useState(false);
  const [gewaehlt, setGewaehlt] = useState<Knoten | null>(null);
  const [suche, setSuche] = useState("");
  const [aus, setAus] = useState<Set<string>>(new Set());

  const leinwand = useRef<HTMLCanvasElement | null>(null);
  const sicht = useRef({ zoom: 1, x: 0, y: 0 });
  const zieht = useRef<{ x: number; y: number; bewegt: boolean } | null>(null);

  useEffect(() => {
    fetch(`${BASE}/api/lukas/gehirn`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setDaten)
      .catch((e) => setFehler(e instanceof Error ? e.message : String(e)))
      .finally(() => setLaedt(false));
  }, []);

  const lage = useMemo(
    () => (daten ? lege(daten.knoten, daten.kanten) : new Map<string, Punkt>()),
    [daten],
  );

  const sichtbar = useMemo(() => {
    if (!daten) return new Set<string>();
    return new Set(daten.knoten.filter((k) => !aus.has(k.art)).map((k) => k.id));
  }, [daten, aus]);

  const nachbarn = useMemo(() => {
    if (!daten || !gewaehlt) return new Set<string>();
    const s = new Set<string>([gewaehlt.id]);
    for (const e of daten.kanten) {
      if (e.von === gewaehlt.id) s.add(e.nach);
      if (e.nach === gewaehlt.id) s.add(e.von);
    }
    return s;
  }, [daten, gewaehlt]);

  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase();
    if (!q || !daten) return null;
    return new Set(
      daten.knoten.filter((k) => `${k.titel} ${k.text}`.toLowerCase().includes(q)).map((k) => k.id),
    );
  }, [suche, daten]);

  // ── Zeichnen ──────────────────────────────────────────────────────────────
  const zeichne = useCallback(() => {
    const c = leinwand.current;
    if (!c || !daten) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const b = c.getBoundingClientRect();
    if (c.width !== Math.round(b.width * dpr) || c.height !== Math.round(b.height * dpr)) {
      c.width = Math.round(b.width * dpr);
      c.height = Math.round(b.height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, b.width, b.height);

    const { zoom, x, y } = sicht.current;
    const wx = (p: Punkt) => p.x * zoom + b.width / 2 + x;
    const wy = (p: Punkt) => p.y * zoom + b.height / 2 + y;

    // Kanten zuerst, damit die Knoten obenauf liegen
    ctx.lineWidth = 1;
    for (const e of daten.kanten) {
      if (!sichtbar.has(e.von) || !sichtbar.has(e.nach)) continue;
      const a = lage.get(e.von);
      const z = lage.get(e.nach);
      if (!a || !z) continue;
      const hell = gewaehlt ? nachbarn.has(e.von) && nachbarn.has(e.nach) : true;
      ctx.strokeStyle = hell ? "rgba(148,163,184,0.35)" : "rgba(148,163,184,0.07)";
      ctx.beginPath();
      ctx.moveTo(wx(a), wy(a));
      ctx.lineTo(wx(z), wy(z));
      ctx.stroke();
    }

    for (const k of daten.knoten) {
      if (!sichtbar.has(k.id)) continue;
      const p = lage.get(k.id);
      if (!p) continue;
      const r = (3 + k.gewicht * 8) * Math.min(Math.max(zoom, 0.6), 1.6);
      const gedimmt = (gewaehlt && !nachbarn.has(k.id)) || (treffer && !treffer.has(k.id));
      ctx.globalAlpha = gedimmt ? 0.15 : 1;
      ctx.fillStyle = FARBEN[k.art] ?? "#94a3b8";
      ctx.beginPath();
      ctx.arc(wx(p), wy(p), r, 0, Math.PI * 2);
      ctx.fill();
      if (gewaehlt?.id === k.id) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Beschriftung nur, wo sie lesbar bleibt — sonst ist der Graph ein
      // Textteppich.
      const zeigen = k.art === "identitaet" || k.gewicht > 0.75 || zoom > 1.5 || gewaehlt?.id === k.id;
      if (zeigen && !gedimmt) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = "rgba(226,232,240,0.9)";
        ctx.font = `${k.art === "identitaet" ? 13 : 11}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillText(k.titel.slice(0, 34), wx(p) + r + 4, wy(p) + 4);
      }
      ctx.globalAlpha = 1;
    }
  }, [daten, lage, sichtbar, gewaehlt, nachbarn, treffer]);

  useEffect(() => {
    zeichne();
    const beiGroesse = () => zeichne();
    window.addEventListener("resize", beiGroesse);
    return () => window.removeEventListener("resize", beiGroesse);
  }, [zeichne]);

  // Beim ersten Laden so einpassen, dass alles im Bild ist.
  useEffect(() => {
    const c = leinwand.current;
    if (!daten || !c || lage.size === 0) return;
    let maxR = 1;
    for (const p of lage.values()) maxR = Math.max(maxR, Math.hypot(p.x, p.y));
    const b = c.getBoundingClientRect();
    sicht.current = { zoom: (Math.min(b.width, b.height) / 2 / maxR) * 0.9, x: 0, y: 0 };
    zeichne();
  }, [daten, lage, zeichne]);

  const knotenBei = (klientX: number, klientY: number): Knoten | null => {
    const c = leinwand.current;
    if (!c || !daten) return null;
    const b = c.getBoundingClientRect();
    const { zoom, x, y } = sicht.current;
    const zx = (klientX - b.left - b.width / 2 - x) / zoom;
    const zy = (klientY - b.top - b.height / 2 - y) / zoom;
    let beste: Knoten | null = null;
    let bestD = Infinity;
    for (const k of daten.knoten) {
      if (!sichtbar.has(k.id)) continue;
      const p = lage.get(k.id);
      if (!p) continue;
      const d = Math.hypot(p.x - zx, p.y - zy);
      const r = (3 + k.gewicht * 8) / zoom + 6 / zoom;
      if (d < r && d < bestD) {
        beste = k;
        bestD = d;
      }
    }
    return beste;
  };

  const vaultLaden = async () => {
    setLade(true);
    try {
      const r = await fetch(`${BASE}/api/lukas/gehirn/vault.zip`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lukas-gehirn-${(daten?.stand ?? new Date().toISOString()).slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    } finally {
      setLade(false);
    }
  };

  const arten = useMemo(() => {
    if (!daten) return [] as [string, number][];
    return Object.entries(daten.zahlen)
      .filter(([a]) => a !== "knoten" && a !== "kanten")
      .sort((a, b) => b[1] - a[1]) as [string, number][];
  }, [daten]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        icon={Network}
        title="Gehirn"
        subtitle={
          daten
            ? `${daten.zahlen.knoten} Knoten · ${daten.zahlen.kanten} Kanten · Stand ${daten.stand.slice(0, 16).replace("T", " ")}`
            : "Knoten und Kanten seines Gedächtnisses"
        }
        actions={
          <Button onClick={vaultLaden} disabled={!daten || lade} size="sm" className="gap-2">
            {lade ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Obsidian-Vault
          </Button>
        }
      />

      <div className="px-5 sm:px-6 pt-4 space-y-3">
        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder="Im Gehirn suchen…"
            className="w-full h-9 pl-9 pr-3 rounded-xl bg-secondary/60 border border-border text-sm outline-none focus:border-primary/50"
          />
        </div>

        {/* Legende und Filter in einem: ein Klick blendet eine Art aus. */}
        <div className="flex flex-wrap gap-1.5">
          {arten.map(([art, anzahl]) => {
            const an = !aus.has(art);
            return (
              <button
                key={art}
                onClick={() =>
                  setAus((v) => {
                    const n = new Set(v);
                    if (n.has(art)) n.delete(art);
                    else n.add(art);
                    return n;
                  })
                }
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs transition-all ${
                  an ? "border-border bg-secondary/50" : "border-border/50 opacity-40"
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: FARBEN[art] ?? "#94a3b8" }}
                />
                {WORT[art] ?? art}
                <span className="text-muted-foreground">{anzahl}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative flex-1 min-h-[420px] m-5 sm:m-6 mt-4 rounded-2xl border border-border overflow-hidden bg-[radial-gradient(circle_at_50%_40%,color-mix(in_oklch,var(--primary)_7%,transparent),transparent_65%)]">
        {laedt && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}
        {fehler && !laedt && (
          <div className="absolute inset-0 grid place-items-center text-sm text-red-400 px-6 text-center">
            Der Graph kam nicht durch: {fehler}
          </div>
        )}

        <canvas
          ref={leinwand}
          className="w-full h-full touch-none cursor-grab active:cursor-grabbing"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            zieht.current = { x: e.clientX, y: e.clientY, bewegt: false };
          }}
          onPointerMove={(e) => {
            if (!zieht.current) return;
            const dx = e.clientX - zieht.current.x;
            const dy = e.clientY - zieht.current.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) zieht.current.bewegt = true;
            sicht.current.x += dx;
            sicht.current.y += dy;
            zieht.current.x = e.clientX;
            zieht.current.y = e.clientY;
            zeichne();
          }}
          onPointerUp={(e) => {
            // Ein Klick ist ein Klick, kein kurzes Schieben — sonst springt
            // beim Verschieben ständig das Panel auf.
            if (zieht.current && !zieht.current.bewegt) {
              const k = knotenBei(e.clientX, e.clientY);
              setGewaehlt(k);
            }
            zieht.current = null;
          }}
          onWheel={(e) => {
            const c = leinwand.current;
            if (!c) return;
            const b = c.getBoundingClientRect();
            const faktor = Math.exp(-e.deltaY * 0.0015);
            const neu = Math.min(Math.max(sicht.current.zoom * faktor, 0.05), 12);
            // Auf den Mauszeiger zoomen, nicht auf die Bildmitte.
            const mx = e.clientX - b.left - b.width / 2 - sicht.current.x;
            const my = e.clientY - b.top - b.height / 2 - sicht.current.y;
            const s = neu / sicht.current.zoom;
            sicht.current.x -= mx * (s - 1);
            sicht.current.y -= my * (s - 1);
            sicht.current.zoom = neu;
            zeichne();
          }}
        />

        {gewaehlt && (
          <div className="absolute right-3 top-3 bottom-3 w-80 max-w-[85%] card-soft rise p-4 overflow-y-auto">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: FARBEN[gewaehlt.art] ?? "#94a3b8" }}
                />
                {WORT[gewaehlt.art] ?? gewaehlt.art}
              </div>
              <button
                onClick={() => setGewaehlt(null)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Schliessen"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <h3 className="mt-2 font-medium text-pretty leading-snug">{gewaehlt.titel}</h3>

            {gewaehlt.text && (
              <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap text-pretty leading-relaxed">
                {gewaehlt.text}
              </p>
            )}

            {Object.keys(gewaehlt.daten).length > 0 && (
              <dl className="mt-3 space-y-1 text-xs">
                {Object.entries(gewaehlt.daten).map(([f, v]) => (
                  <div key={f} className="flex gap-2">
                    <dt className="text-muted-foreground shrink-0">{f}</dt>
                    <dd className="ml-auto text-right break-words">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            )}

            {daten && (
              <div className="mt-4">
                <div className="text-xs text-muted-foreground mb-1.5">Verbindungen</div>
                <div className="space-y-1">
                  {daten.kanten
                    .filter((e) => e.von === gewaehlt.id || e.nach === gewaehlt.id)
                    .slice(0, 40)
                    .map((e, i) => {
                      const anderer = daten.knoten.find(
                        (k) => k.id === (e.von === gewaehlt.id ? e.nach : e.von),
                      );
                      if (!anderer) return null;
                      return (
                        <button
                          key={i}
                          onClick={() => setGewaehlt(anderer)}
                          className="w-full text-left text-xs px-2 py-1.5 rounded-lg hover:bg-secondary/70 flex items-center gap-2"
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ background: FARBEN[anderer.art] ?? "#94a3b8" }}
                          />
                          <span className="text-muted-foreground shrink-0">{e.art}</span>
                          <span className="truncate">{anderer.titel}</span>
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
