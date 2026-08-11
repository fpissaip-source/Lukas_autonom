import { useCallback, useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { format } from "date-fns";
import { de } from "date-fns/locale";

interface DebugLogEntry {
  time: string;
  scope: string;
  message: string;
}

async function fetchDebugLog(): Promise<DebugLogEntry[]> {
  const token = localStorage.getItem("lukas_token");
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch("/api/lukas/debug-log", { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default function Diagnostics() {
  const [entries, setEntries] = useState<DebugLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchDebugLog()
      .then((data) => {
        setEntries(data);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={AlertTriangle}
        title="Diagnose"
        subtitle="Letzte Fehler aus Chat, Widget und ElevenLabs-Anbindung — aktualisiert alle 5s"
        actions={
          <Button variant="outline" size="sm" onClick={load} data-testid="button-refresh-debug-log">
            <RefreshCw className="w-4 h-4" />
            Aktualisieren
          </Button>
        }
      />

      <ScrollArea className="flex-1 p-5 sm:p-6">
        {loading && <div className="text-center text-muted-foreground py-12">Lädt…</div>}
        {error && (
          <div className="text-center text-destructive py-4">Fehler beim Laden: {error}</div>
        )}
        <div className="max-w-3xl space-y-3">
          {entries.map((entry, idx) => (
            <div
              key={`${entry.time}-${idx}`}
              className="bg-card border border-border rounded-lg p-4 flex gap-3"
              data-testid={`debug-entry-${idx}`}
            >
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <span>{format(new Date(entry.time), "PPpp", { locale: de })}</span>
                  <span className="px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                    {entry.scope}
                  </span>
                </div>
                <div className="text-sm font-mono break-words">{entry.message}</div>
              </div>
            </div>
          ))}
          {!loading && !error && entries.length === 0 && (
            <div className="text-center py-16">
              <AlertTriangle className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground">Keine Fehler</p>
              <p className="text-xs text-muted-foreground mt-2">
                Seit dem letzten Neustart des Servers ist nichts fehlgeschlagen.
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
