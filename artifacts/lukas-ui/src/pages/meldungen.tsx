import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { Inbox, AlertTriangle, Check, Loader2, Send } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Meldung = {
  id: number;
  betreff: string;
  text: string;
  dringend: boolean;
  status: "offen" | "erledigt";
  antwort: string | null;
  createdAt: string;
  erledigtAt: string | null;
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("lukas_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/*
 * Was Lukas von Issa braucht.
 *
 * Bewusst eine eigene Seite und kein Chat-Verlauf: eine Meldung hat einen
 * Zustand. Sie ist OFFEN, bis Issa geantwortet hat — und genau das soll man
 * sehen, ohne zu suchen. Im Chat ginge sie zwischen den Nachrichten unter.
 *
 * Die Antwort ist Pflicht und nicht Zierde: sie geht an Lukas zurueck und ist
 * der Grund, warum er wieder weiterarbeiten kann. Deshalb steht das Feld direkt
 * an der offenen Meldung und nicht hinter einem Klick.
 */
export default function Meldungen() {
  const [rows, setRows] = useState<Meldung[]>([]);
  const [laedt, setLaedt] = useState(true);
  const [entwuerfe, setEntwuerfe] = useState<Record<number, string>>({});
  const [sendet, setSendet] = useState<number | null>(null);

  const laden = useCallback(() => {
    fetch(`${BASE}/api/lukas/meldungen`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Meldung[]) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]))
      .finally(() => setLaedt(false));
  }, []);

  useEffect(() => {
    laden();
    // Er meldet sich auch, während man hinsieht — alle 30 Sekunden nachfassen.
    const t = setInterval(laden, 30000);
    return () => clearInterval(t);
  }, [laden]);

  const antworten = async (id: number) => {
    const antwort = (entwuerfe[id] ?? "").trim();
    if (!antwort) return;
    setSendet(id);
    try {
      await fetch(`${BASE}/api/lukas/meldungen/${id}/antwort`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ antwort }),
      });
      setEntwuerfe((v) => ({ ...v, [id]: "" }));
      laden();
    } finally {
      setSendet(null);
    }
  };

  const offen = rows.filter((m) => m.status === "offen");
  const erledigt = rows.filter((m) => m.status !== "offen");

  return (
    <div>
      <PageHeader
        icon={Inbox}
        title="Meldungen"
        subtitle="Was Lukas von dir braucht, um weiterzuarbeiten"
        actions={
          <div className="text-xs text-muted-foreground">
            {offen.length > 0 ? `${offen.length} offen` : "nichts offen"}
          </div>
        }
      />

      <div className="p-5 sm:p-6 space-y-8 max-w-3xl">
        {laedt && <div className="text-sm text-muted-foreground">Lädt…</div>}

        {!laedt && rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-border/70 px-4 py-10 text-sm text-muted-foreground text-center text-pretty">
            Lukas hat sich noch nicht gemeldet. Hier landet, was er von dir braucht, um
            weiterzukommen — eine Entscheidung, ein Zugang, eine Antwort.
          </div>
        )}

        {offen.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              Wartet auf dich ({offen.length})
            </h2>
            {offen.map((m, i) => (
              <div
                key={m.id}
                className={`card-soft rise p-5 space-y-3 ${m.dringend ? "border-amber-400/40" : ""}`}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className="space-y-1">
                  <div className="font-medium flex items-start gap-2">
                    {m.dringend && (
                      <AlertTriangle
                        className="w-4 h-4 text-amber-400 shrink-0 mt-1"
                        aria-label="dringend"
                      />
                    )}
                    {/* Kein truncate: der Betreff ist die wichtigste Zeile der
                        ganzen Seite und darf umbrechen statt zu verschwinden. */}
                    <span className="text-pretty">{m.betreff}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true, locale: de })}
                  </div>
                </div>

                <p className="text-sm leading-relaxed whitespace-pre-wrap text-pretty">{m.text}</p>

                <div className="space-y-2 pt-1">
                  <Textarea
                    value={entwuerfe[m.id] ?? ""}
                    onChange={(e) => setEntwuerfe((v) => ({ ...v, [m.id]: e.target.value }))}
                    placeholder="Deine Antwort — ein Satz reicht meistens."
                    className="min-h-[80px] text-sm resize-none"
                  />
                  <div className="flex justify-end">
                    <Button
                      onClick={() => antworten(m.id)}
                      disabled={!(entwuerfe[m.id] ?? "").trim() || sendet === m.id}
                      className="gap-2"
                      size="sm"
                    >
                      {sendet === m.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      Antworten
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </section>
        )}

        {erledigt.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">Erledigt</h2>
            {erledigt.map((m) => (
              <div key={m.id} className="card-soft p-4 space-y-2 opacity-80">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-medium flex items-start gap-2 min-w-0">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-1" />
                    <span className="text-pretty">{m.betreff}</span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {m.erledigtAt
                      ? formatDistanceToNow(new Date(m.erledigtAt), { addSuffix: true, locale: de })
                      : ""}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{m.text}</p>
                {m.antwort && (
                  <div className="text-sm rounded-lg bg-primary/10 border border-primary/20 px-3 py-2 whitespace-pre-wrap">
                    <span className="text-xs text-muted-foreground block mb-0.5">Deine Antwort</span>
                    {m.antwort}
                  </div>
                )}
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
