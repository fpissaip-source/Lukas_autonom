import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plug, RefreshCw, Plus, Trash2, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type McpTool = { name: string; description?: string };

type McpServer = {
  id: number;
  slug: string;
  name: string;
  url: string;
  status: "new" | "awaiting_auth" | "connected" | "error";
  lastError: string | null;
  tools: McpTool[];
  toolsUpdatedAt: string | null;
  selectedTools: string[];
  riskTier: "R1" | "R2" | "R3";
  enabled: boolean;
  authorized: boolean;
};

const STATUS: Record<McpServer["status"], { label: string; cls: string }> = {
  new: { label: "NICHT VERBUNDEN", cls: "bg-secondary text-muted-foreground" },
  awaiting_auth: { label: "WARTET AUF ANMELDUNG", cls: "bg-amber-500/15 text-amber-300" },
  connected: { label: "VERBUNDEN", cls: "bg-emerald-500/15 text-emerald-300" },
  error: { label: "FEHLER", cls: "bg-red-500/15 text-red-300" },
};

const RISK_HINT: Record<McpServer["riskTier"], string> = {
  R1: "Läuft ohne Rückfrage — nur für Server, denen du wirklich vertraust.",
  R2: "Jeder Aufruf braucht deine Freigabe unter „Freigaben“.",
  R3: "Wie R2, für besonders heikle Server.",
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("lukas_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}/api/lukas/mcp${path}`, {
    ...init,
    headers: { ...authHeaders(), "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

function ServerCard({ server, onChange }: { server: McpServer; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api(`/${server.id}/connect`, { method: "POST" });
      if (r.status === "authorize" && r.authorizationUrl) {
        // Anmeldung beim Anbieter passiert im Browser — danach kommt er über
        // den Callback zurück und die Seite zeigt den neuen Stand.
        window.location.href = r.authorizationUrl;
        return;
      }
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setBusy(false);
    }
  };

  const toggleTool = (name: string) => {
    const current = proposalSelection();
    const next = current.includes(name) ? current.filter((n) => n !== name) : [...current, name];
    patch({ selectedTools: next });
  };
  // Leere Auswahl = "die ersten paar automatisch". Fuer die Anzeige machen wir
  // daraus die tatsaechlich wirksame Liste, sonst sieht man keine Haken.
  const proposalSelection = () =>
    server.selectedTools.length ? server.selectedTools : server.tools.slice(0, 12).map((t) => t.name);

  const patch = async (values: Partial<Pick<McpServer, "riskTier" | "enabled" | "selectedTools">>) => {
    setBusy(true);
    try {
      await api(`/${server.id}`, { method: "PATCH", body: JSON.stringify(values) });
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`„${server.name}“ wirklich entfernen? Die Anmeldung geht dabei verloren.`)) return;
    setBusy(true);
    try {
      await api(`/${server.id}`, { method: "DELETE" });
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
      setBusy(false);
    }
  };

  const s = STATUS[server.status];

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3" data-testid={`mcp-${server.id}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{server.name}</span>
            <span className={`text-[11px] px-1.5 py-0.5 rounded ${s.cls}`}>{s.label}</span>
            {!server.enabled && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                AUS
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1 break-all">{server.url}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" disabled={busy} onClick={connect} className="gap-1.5">
            <ExternalLink className="w-4 h-4" />
            {server.authorized ? "Neu verbinden" : "Verbinden"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={remove}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {server.lastError && server.status === "error" && (
        <pre className="text-xs text-destructive bg-background/60 border border-border rounded-md p-2 whitespace-pre-wrap break-words">
          {server.lastError}
        </pre>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {server.tools.length > 0 && (
        <div>
          <button
            onClick={() => setShowTools((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {showTools ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {proposalSelection().length} von {server.tools.length} Werkzeugen aktiv
          </button>
          {showTools && (
            <ul className="mt-2 space-y-1">
              {server.tools.map((t) => {
                const an = proposalSelection().includes(t.name);
                return (
                  <li key={t.name} className="text-xs border border-border rounded px-2 py-1.5">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={an}
                        disabled={busy}
                        onChange={() => toggleTool(t.name)}
                        className="mt-0.5 shrink-0"
                      />
                      <span className="min-w-0">
                        <span className={`font-mono ${an ? "" : "text-muted-foreground"}`}>{t.name}</span>
                        {t.description && (
                          <p className="text-muted-foreground mt-0.5 break-words">{t.description}</p>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="border-t border-border pt-3 flex items-center gap-3 flex-wrap">
        <label className="text-xs text-muted-foreground">
          Freigabe:{" "}
          <select
            value={server.riskTier}
            disabled={busy}
            onChange={(e) => patch({ riskTier: e.target.value as McpServer["riskTier"] })}
            className="bg-background border border-border rounded px-2 py-1 text-xs ml-1"
          >
            <option value="R1">R1 — ohne Rückfrage</option>
            <option value="R2">R2 — Freigabe nötig</option>
            <option value="R3">R3 — Freigabe nötig</option>
          </select>
        </label>
        <label className="text-xs text-muted-foreground flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={server.enabled}
            disabled={busy}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          aktiv
        </label>
      </div>
      <p className="text-[11px] text-muted-foreground">{RISK_HINT[server.riskTier]}</p>
    </div>
  );
}

export default function Mcp() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [callback, setCallback] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api("");
      setServers(data.servers);
      setCallback(data.callbackUrl);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    if (!name.trim() || !url.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await api("", { method: "POST", body: JSON.stringify({ name: name.trim(), url: url.trim() }) });
      setName("");
      setUrl("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={Plug}
        title="MCP"
        subtitle="Fremde Werkzeuge, die Lukas mitbenutzen darf"
        actions={
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="w-4 h-4" /> Aktualisieren
          </Button>
        }
      />

      <ScrollArea className="flex-1 p-5 sm:p-6">
        <div className="max-w-3xl space-y-6">
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <h2 className="text-sm text-muted-foreground">SERVER HINZUFÜGEN</h2>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name, z.B. Kalender"
                className="flex-1 text-sm bg-background border border-border rounded-md px-3 py-2"
                data-testid="input-mcp-name"
              />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…/mcp"
                className="flex-[2] text-sm bg-background border border-border rounded-md px-3 py-2"
                data-testid="input-mcp-url"
              />
              <Button onClick={add} disabled={adding || !name.trim() || !url.trim()} className="gap-1.5">
                <Plus className="w-4 h-4" /> Anlegen
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Nach dem Anlegen auf „Verbinden“ — du wirst zum Anbieter geschickt, meldest dich dort
              an, und landest wieder hier. Danach kennt Lukas dessen Werkzeuge.
            </p>
            {callback && (
              <p className="text-[11px] text-muted-foreground break-all">
                Falls ein Anbieter nach einer Redirect-URL fragt:{" "}
                <span className="font-mono">{callback}</span>
              </p>
            )}
          </div>

          {error && <div className="text-destructive text-sm">{error}</div>}
          {loading && servers.length === 0 && (
            <div className="text-center text-muted-foreground py-12">Lädt…</div>
          )}

          {!loading && servers.length === 0 && (
            <div className="text-center py-10">
              <Plug className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                Noch kein MCP-Server eingetragen.
              </p>
            </div>
          )}

          {servers.map((s) => (
            <ServerCard key={s.id} server={s} onChange={load} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
