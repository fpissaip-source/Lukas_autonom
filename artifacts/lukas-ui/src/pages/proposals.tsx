import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Lightbulb, RefreshCw, Check, X, Undo2, ChevronDown, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ProposalFile = { path: string; content: string };

type Proposal = {
  id: number;
  repo: string;
  title: string;
  summary: string;
  reasoning: string;
  files: ProposalFile[];
  status: "pending" | "accepted" | "rejected" | "revision";
  comment: string | null;
  appliedResult: string | null;
  targetBranch: string | null;
  createdAt: string;
  decidedAt: string | null;
};

const STATUS_LABEL: Record<Proposal["status"], string> = {
  pending: "OFFEN",
  accepted: "ÜBERNOMMEN",
  rejected: "ABGELEHNT",
  revision: "ZURÜCKGESCHICKT",
};

const STATUS_STYLE: Record<Proposal["status"], string> = {
  pending: "bg-amber-500/15 text-amber-300",
  accepted: "bg-emerald-500/15 text-emerald-300",
  rejected: "bg-red-500/15 text-red-300",
  revision: "bg-sky-500/15 text-sky-300",
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("lukas_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Eine offene Karte: was passiert, welche Dateien, drei Knöpfe. */
function OpenProposal({
  proposal,
  onDone,
}: {
  proposal: Proposal;
  onDone: () => void;
}) {
  const [showFiles, setShowFiles] = useState(false);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (action: "accept" | "reject" | "revise") => {
    if (action === "revise" && !comment.trim()) {
      setError("Schreib kurz dazu, was Lukas anders machen soll.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/lukas/proposals/${proposal.id}/${action}`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(comment.trim() ? { comment: comment.trim() } : {}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="bg-card border border-amber-500/25 rounded-lg p-4 sm:p-5 space-y-4"
      data-testid={`proposal-${proposal.id}`}
    >
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <Lightbulb className="w-4 h-4 text-amber-300 shrink-0" />
          <span className="font-medium">{proposal.title}</span>
          <span className="text-[11px] font-mono text-muted-foreground">#{proposal.id}</span>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">
          {proposal.repo} ·{" "}
          {new Date(proposal.createdAt).toLocaleString("de-DE", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-xs font-mono text-muted-foreground mb-1">WAS PASSIERT</h3>
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {proposal.summary}
          </p>
        </div>
        {proposal.reasoning && (
          <div>
            <h3 className="text-xs font-mono text-muted-foreground mb-1">WARUM</h3>
            <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
              {proposal.reasoning}
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-border pt-3">
        <button
          onClick={() => setShowFiles((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-foreground"
        >
          {showFiles ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          {proposal.files.length} {proposal.files.length === 1 ? "DATEI" : "DATEIEN"}
          {!showFiles && " — ansehen"}
        </button>

        {showFiles && (
          <div className="mt-2 space-y-1.5">
            {proposal.files.map((f) => (
              <div key={f.path} className="border border-border rounded-md overflow-hidden">
                <button
                  onClick={() => setOpenFile(openFile === f.path ? null : f.path)}
                  className="w-full text-left px-3 py-2 text-xs font-mono hover:bg-secondary/50 flex items-center justify-between gap-2"
                >
                  <span className="truncate">{f.path}</span>
                  <span className="text-muted-foreground shrink-0">
                    {f.content.split("\n").length} Zeilen
                  </span>
                </button>
                {openFile === f.path && (
                  <pre className="text-[11px] bg-background/60 border-t border-border p-3 overflow-x-auto max-h-80 overflow-y-auto">
                    {f.content}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Kommentar (nötig zum Zurückschicken, sonst optional)…"
          rows={2}
          className="w-full text-sm bg-background border border-border rounded-md px-3 py-2 resize-y focus:outline-none focus:ring-1 focus:ring-primary"
          data-testid={`proposal-comment-${proposal.id}`}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => decide("accept")} className="gap-1.5">
            <Check className="w-4 h-4" /> Annehmen
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => decide("revise")}
            className="gap-1.5"
          >
            <Undo2 className="w-4 h-4" /> Mit Kommentar zurück
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => decide("reject")}
            className="gap-1.5"
          >
            <X className="w-4 h-4" /> Ablehnen
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {proposal.targetBranch ? (
            <>
              Beim Annehmen geht die Änderung direkt auf{" "}
              <span className="font-mono">{proposal.targetBranch}</span> — den Branch, den Railway
              baut. Sie ist damit ein paar Minuten später live. Vorher passiert nichts.
            </>
          ) : (
            <>
              Erst beim Annehmen wird die Änderung geschrieben. Achtung: es ist kein Deploy-Branch
              gesetzt, sie landet auf dem Default-Branch und wird nicht ausgeliefert.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

export default function Proposals() {
  const [rows, setRows] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/lukas/proposals`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRows(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Lukas kann jederzeit etwas vorschlagen, auch während man hier draufschaut.
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const open = rows.filter((r) => r.status === "pending");
  const rest = rows.filter((r) => r.status !== "pending");

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={Lightbulb}
        title="VORSCHLÄGE"
        subtitle="Änderungen, die Lukas an seinem eigenen Code vornehmen möchte"
        actions={
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="w-4 h-4" /> Aktualisieren
          </Button>
        }
      />

      <ScrollArea className="flex-1 p-5 sm:p-6">
        <div className="max-w-3xl space-y-6">
          {loading && rows.length === 0 && (
            <div className="text-center text-muted-foreground font-mono py-12">LADE…</div>
          )}
          {error && <div className="text-destructive font-mono text-sm">Fehler beim Laden: {error}</div>}

          {!loading && open.length === 0 && (
            <div className="text-center py-10">
              <Lightbulb className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                Nichts offen — Lukas hat gerade keinen Vorschlag für dich.
              </p>
            </div>
          )}

          {open.map((p) => (
            <OpenProposal key={p.id} proposal={p} onDone={load} />
          ))}

          {rest.length > 0 && (
            <div className="space-y-2 pt-2">
              <h2 className="text-sm font-mono text-muted-foreground">VERLAUF</h2>
              {rest.map((r) => (
                <div key={r.id} className="bg-card/50 border border-border rounded-md px-3 py-2.5 space-y-1">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">{r.title}</span>
                    <span
                      className={`text-[11px] font-mono px-1.5 py-0.5 rounded shrink-0 ${STATUS_STYLE[r.status]}`}
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                  </div>
                  {r.comment && (
                    <p className="text-xs text-muted-foreground break-words">Dein Kommentar: {r.comment}</p>
                  )}
                  {r.appliedResult && (
                    <p className="text-xs text-muted-foreground break-words">{r.appliedResult}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
