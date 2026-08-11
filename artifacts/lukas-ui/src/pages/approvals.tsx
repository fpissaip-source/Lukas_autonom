import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShieldCheck, RefreshCw, Check, X, Clock } from "lucide-react";
import { PageHeader } from "@/components/page-header";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Approval = {
  id: number;
  conversationId: number | null;
  tool: string;
  riskTier: string;
  argumentsPreview: string;
  status: "pending" | "allowed" | "denied" | "used" | "expired";
  createdAt: string;
  decidedAt: string | null;
  expiresAt: string;
  expired: boolean;
};

const TIER_STYLE: Record<string, string> = {
  R0: "bg-secondary text-muted-foreground",
  R1: "bg-secondary text-muted-foreground",
  R2: "bg-amber-500/15 text-amber-300 border border-amber-500/25",
  R3: "bg-red-500/15 text-red-300 border border-red-500/25",
};

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-300",
  allowed: "bg-emerald-500/15 text-emerald-300",
  used: "bg-emerald-500/10 text-emerald-400/70",
  denied: "bg-red-500/15 text-red-300",
  expired: "bg-secondary text-muted-foreground",
};

export default function Approvals() {
  const [rows, setRows] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("lukas_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/lukas/approvals`, { headers: authHeaders() });
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
    // Offene Freigaben sollen zeitnah auftauchen, während Lukas wartet.
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const decide = async (id: number, action: "allow" | "deny") => {
    await fetch(`${BASE}/api/lukas/approvals/${id}/${action}`, {
      method: "POST",
      headers: authHeaders(),
    }).catch(() => {});
    load();
  };

  const pending = rows.filter((r) => r.status === "pending" && !r.expired);
  const rest = rows.filter((r) => !(r.status === "pending" && !r.expired));

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={ShieldCheck}
        title="Freigaben"
        subtitle="Aktionen, die Lukas nur mit deiner ausdrücklichen Zustimmung ausführen darf"
        actions={
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="w-4 h-4" /> Aktualisieren
          </Button>
        }
      />

      <ScrollArea className="flex-1 p-5 sm:p-6">
        <div className="max-w-3xl space-y-6">
          {loading && rows.length === 0 && (
            <div className="text-center text-muted-foreground py-12">Lädt…</div>
          )}
          {error && (
            <div className="text-destructive text-sm">Fehler beim Laden: {error}</div>
          )}

          {pending.length === 0 && !loading && (
            <div className="text-center py-10">
              <ShieldCheck className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                Nichts offen — Lukas wartet gerade auf keine Freigabe.
              </p>
            </div>
          )}

          {pending.map((r) => (
            <div
              key={r.id}
              className="bg-card border border-amber-500/25 rounded-lg p-4 space-y-3"
              data-testid={`approval-${r.id}`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-medium">{r.tool}</span>
                    <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${TIER_STYLE[r.riskTier] ?? ""}`}>
                      {r.riskTier}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    läuft ab {new Date(r.expiresAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" onClick={() => decide(r.id, "allow")} className="gap-1.5">
                    <Check className="w-4 h-4" /> Erlauben
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => decide(r.id, "deny")} className="gap-1.5">
                    <X className="w-4 h-4" /> Ablehnen
                  </Button>
                </div>
              </div>
              <pre className="text-xs bg-background/60 border border-border rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-words">
                {r.argumentsPreview}
              </pre>
              <p className="text-[11px] text-muted-foreground">
                Die Freigabe gilt nur für genau diese Argumente und nur einmal. Ändert Lukas
                etwas daran, braucht es eine neue Freigabe.
              </p>
            </div>
          ))}

          {rest.length > 0 && (
            <div className="space-y-2 pt-2">
              <h2 className="text-sm text-muted-foreground">Verlauf</h2>
              {rest.map((r) => (
                <div
                  key={r.id}
                  className="bg-card/50 border border-border rounded-md px-3 py-2 flex items-center justify-between gap-3 text-sm"
                >
                  <span className="font-mono truncate">{r.tool}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${TIER_STYLE[r.riskTier] ?? ""}`}>
                      {r.riskTier}
                    </span>
                    <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${STATUS_STYLE[r.expired && r.status === "pending" ? "expired" : r.status] ?? ""}`}>
                      {r.expired && r.status === "pending" ? "ABGELAUFEN" : r.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
