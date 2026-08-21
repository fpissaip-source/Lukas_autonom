import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Phone, PhoneIncoming, PhoneOutgoing, Plus, Trash2, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Stufe = "privat" | "oeffentlich" | "gesperrt";

type Nummer = {
  id: number;
  nummer: string;
  name: string;
  stufe: Stufe;
  darfAngerufenWerden: boolean;
  notiz: string;
  zuletztGesehen: string | null;
};

type Anruf = {
  id: number;
  richtung: "eingehend" | "ausgehend";
  nummer: string;
  ergebnis: string;
  stufe: string;
  anlass: string;
  createdAt: string;
};

type Antwort = {
  nummern: Nummer[];
  anrufe: Anruf[];
  bereit: { webhook: boolean; anrufen: boolean };
};

const STUFE: Record<Stufe, { label: string; cls: string; hilfe: string }> = {
  privat: {
    label: "PRIVAT",
    cls: "bg-emerald-500/15 text-emerald-300",
    hilfe: "Voller Lukas mit Gedächtnis, Zielen und Tagebuch. Nur für dich.",
  },
  oeffentlich: {
    label: "ÖFFENTLICH",
    cls: "bg-secondary text-muted-foreground",
    hilfe: "Derselbe Lukas wie auf der Webseite. Nichts Privates.",
  },
  gesperrt: {
    label: "GESPERRT",
    cls: "bg-red-500/15 text-red-300",
    hilfe: "Wird abgewiesen, bevor überhaupt eine Sitzung entsteht.",
  },
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("lukas_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}/api/lukas/telefon${path}`, {
    ...init,
    headers: { ...authHeaders(), "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

/** +49 151 12345678 — nur zur Anzeige, gespeichert sind reine Ziffern. */
function zeigeNummer(ziffern: string): string {
  if (ziffern.length < 7) return "+" + ziffern;
  return `+${ziffern.slice(0, 2)} ${ziffern.slice(2, 5)} ${ziffern.slice(5)}`;
}

function NummerZeile({ eintrag, onChange }: { eintrag: Nummer; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const patch = async (werte: Partial<Nummer>) => {
    setBusy(true);
    setFehler(null);
    try {
      await api(`/${eintrag.id}`, { method: "PATCH", body: JSON.stringify(werte) });
      onChange();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Fehler");
    } finally {
      setBusy(false);
    }
  };

  const loeschen = async () => {
    if (!confirm(`${eintrag.name || zeigeNummer(eintrag.nummer)} wirklich aus der Liste entfernen?`)) return;
    setBusy(true);
    try {
      await api(`/${eintrag.id}`, { method: "DELETE" });
      onChange();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Fehler");
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{eintrag.name || "Ohne Namen"}</span>
            <span className={`rounded px-2 py-0.5 text-[0.65rem] tracking-wide ${STUFE[eintrag.stufe].cls}`}>
              {STUFE[eintrag.stufe].label}
            </span>
          </div>
          <div className="mt-1 font-mono text-sm text-muted-foreground">{zeigeNummer(eintrag.nummer)}</div>
          {eintrag.notiz && <div className="mt-1 text-sm text-muted-foreground">{eintrag.notiz}</div>}
        </div>
        <Button variant="ghost" size="icon" onClick={loeschen} disabled={busy} aria-label="Entfernen">
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(Object.keys(STUFE) as Stufe[]).map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => patch({ stufe: s })}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              eintrag.stufe === s ? STUFE[s].cls : "bg-secondary/50 text-muted-foreground hover:bg-secondary"
            }`}
          >
            {STUFE[s].label}
          </button>
        ))}

        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={eintrag.darfAngerufenWerden}
            disabled={busy}
            onChange={(e) => patch({ darfAngerufenWerden: e.target.checked })}
          />
          Lukas darf hier anrufen
        </label>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">{STUFE[eintrag.stufe].hilfe}</p>
      {fehler && <p className="mt-2 text-xs text-red-400">{fehler}</p>}
    </div>
  );
}

export default function Telefon() {
  const [daten, setDaten] = useState<Antwort | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [neu, setNeu] = useState({ nummer: "", name: "", stufe: "privat" as Stufe });
  const [busy, setBusy] = useState(false);

  const laden = useCallback(async () => {
    try {
      setDaten(await api(""));
      setFehler(null);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Laden fehlgeschlagen");
    }
  }, []);

  useEffect(() => {
    void laden();
  }, [laden]);

  const hinzufuegen = async () => {
    if (!neu.nummer.trim()) return;
    setBusy(true);
    setFehler(null);
    try {
      await api("", { method: "POST", body: JSON.stringify(neu) });
      setNeu({ nummer: "", name: "", stufe: "privat" });
      await laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Fehler");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={Phone} title="Telefon" subtitle="Wer mit Lukas sprechen darf — und wen er anrufen darf" />

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl space-y-6 p-4 pb-16">
          {/* Was noch fehlt, gehoert sichtbar hierher — sonst passiert schlicht nichts. */}
          {daten && !daten.bereit.webhook && (
            <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
              <div>
                <p className="font-medium text-amber-200">Anrufe kommen noch nicht an</p>
                <p className="mt-1 text-muted-foreground">
                  Es fehlt <code>OPENAI_WEBHOOK_SECRET</code>. Ohne geprüfte Signatur wird jeder
                  eingehende Anruf abgewiesen — das ist Absicht.
                </p>
              </div>
            </div>
          )}
          {daten && daten.bereit.webhook && !daten.bereit.anrufen && (
            <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
              Eingehende Anrufe funktionieren. Damit Lukas selbst anrufen kann, fehlen noch
              <code className="mx-1">TWILIO_ACCOUNT_SID</code>,<code className="mx-1">TWILIO_AUTH_TOKEN</code>,
              <code className="mx-1">TWILIO_NUMMER</code> und <code className="mx-1">OPENAI_PROJECT_ID</code>.
            </div>
          )}

          <div className="rounded-lg border border-border p-4">
            <h2 className="mb-3 flex items-center gap-2 font-medium">
              <Plus className="size-4" /> Nummer hinzufügen
            </h2>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={neu.nummer}
                onChange={(e) => setNeu({ ...neu, nummer: e.target.value })}
                placeholder="+49 151 12345678"
                className="flex-1 rounded-md border border-border bg-transparent px-3 py-2 text-sm"
              />
              <input
                value={neu.name}
                onChange={(e) => setNeu({ ...neu, name: e.target.value })}
                placeholder="Name"
                className="rounded-md border border-border bg-transparent px-3 py-2 text-sm sm:w-40"
              />
              <select
                value={neu.stufe}
                onChange={(e) => setNeu({ ...neu, stufe: e.target.value as Stufe })}
                className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
              >
                <option value="privat">Privat</option>
                <option value="oeffentlich">Öffentlich</option>
                <option value="gesperrt">Gesperrt</option>
              </select>
              <Button onClick={hinzufuegen} disabled={busy || !neu.nummer.trim()}>
                Hinzufügen
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Nicht eingetragene Nummern bekommen automatisch den öffentlichen Lukas — den von der
              Webseite, ohne alles Private.
            </p>
          </div>

          {fehler && <p className="text-sm text-red-400">{fehler}</p>}

          <div className="space-y-3">
            {daten?.nummern.map((n) => (
              <NummerZeile key={n.id} eintrag={n} onChange={laden} />
            ))}
            {daten?.nummern.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Noch keine Nummer eingetragen. Trag deine eigene als „Privat" ein, damit Lukas dich
                am Telefon erkennt.
              </p>
            )}
          </div>

          {daten && daten.anrufe.length > 0 && (
            <div>
              <h2 className="mb-3 font-medium">Letzte Anrufe</h2>
              <div className="space-y-1">
                {daten.anrufe.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-secondary/40">
                    {a.richtung === "eingehend" ? (
                      <PhoneIncoming className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <PhoneOutgoing className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="font-mono">{zeigeNummer(a.nummer)}</span>
                    <span className="text-muted-foreground">{a.ergebnis}</span>
                    {a.anlass && <span className="truncate text-muted-foreground">— {a.anlass}</span>}
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {new Date(a.createdAt).toLocaleString("de-DE")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
