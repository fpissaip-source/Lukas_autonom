import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Mic, MicOff, Loader2, Volume2, Ear } from "lucide-react";

// Gleiche Technik wie im Portfolio-Widget (public/widget.js, data-voice="agent"):
// ElevenLabs Agents per WebRTC, Sub-Sekunden-Latenz, echtes Turn-Taking. Die
// signierte URL kommt von /api/public/voice-session (nutzt serverseitig
// ELEVENLABS_AGENT_ID). WICHTIG: Der Agent spricht mit Lukas' OEFFENTLICHER
// Persona (nur "public"-Erinnerungen, siehe Custom-LLM-Endpoint) — genau wie
// auf der Portfolio-Seite, nicht mit dem vollen privaten Gedächtnis des
// Comm-Link-Text-Chats.

type VoiceStatus = "idle" | "connecting" | "connected" | "speaking" | "listening" | "error";

interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
}

interface ElevenLabsConversation {
  endSession: () => Promise<void>;
}

interface ElevenLabsSdk {
  Conversation: { startSession: (o: Record<string, unknown>) => Promise<ElevenLabsConversation> };
}

let sdkPromise: Promise<ElevenLabsSdk> | null = null;
function loadElevenLabsSdk(): Promise<ElevenLabsSdk> {
  // CDN-ESM-Import ohne Typdeklarationen (wie im Portfolio-Widget, public/widget.js).
  // @ts-expect-error -- externe URL, kein lokales Modul, keine Typen verfuegbar
  sdkPromise ??= import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/@elevenlabs/client/+esm");
  return sdkPromise;
}

export function VoicePanel() {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const conversationRef = useRef<ElevenLabsConversation | null>(null);

  async function start() {
    setStatus("connecting");
    setErrorMsg(null);
    try {
      const [sdk, sessionRes] = await Promise.all([loadElevenLabsSdk(), fetch("/api/public/voice-session")]);
      const session = sessionRes.ok ? await sessionRes.json() : null;

      const opts: Record<string, unknown> = {
        onConnect: () => setStatus("connected"),
        onDisconnect: () => {
          setStatus("idle");
          conversationRef.current = null;
        },
        onError: () => {
          setStatus("error");
          setErrorMsg("Sprachverbindung fehlgeschlagen.");
          conversationRef.current = null;
        },
        onModeChange: (m: { mode?: string }) => setStatus(m?.mode === "speaking" ? "speaking" : "listening"),
        onMessage: (msg: { source?: string; message?: string }) => {
          if (!msg?.message) return;
          setTranscript((prev) => [...prev, { role: msg.source === "user" ? "user" : "assistant", text: msg.message! }]);
        },
      };
      if (session?.signedUrl) opts.signedUrl = session.signedUrl;
      else if (session?.agentId) opts.agentId = session.agentId;
      else throw new Error("Kein ElevenLabs-Agent konfiguriert (ELEVENLABS_AGENT_ID fehlt serverseitig)");

      conversationRef.current = await sdk.Conversation.startSession(opts);
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Unbekannter Fehler");
    }
  }

  async function stop() {
    const c = conversationRef.current;
    conversationRef.current = null;
    setStatus("idle");
    if (c) await c.endSession().catch(() => {});
  }

  const isActive = status === "connected" || status === "speaking" || status === "listening";
  const isBusy = status === "connecting";

  const statusLabel: Record<VoiceStatus, string> = {
    idle: "Sprachchat aus",
    connecting: "Verbinde…",
    connected: "Verbunden — sprich einfach",
    speaking: "Lukas spricht…",
    listening: "Lukas hört zu…",
    error: "Fehler",
  };

  return (
    <div className="border-b border-border bg-card/30" data-testid="panel-voice">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Button
          size="sm"
          variant={isActive ? "destructive" : "default"}
          onClick={isActive ? stop : start}
          disabled={isBusy}
          className="gap-2 shrink-0"
          data-testid={isActive ? "button-voice-stop" : "button-voice-start"}
        >
          {isBusy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : isActive ? (
            <MicOff className="w-4 h-4" />
          ) : (
            <Mic className="w-4 h-4" />
          )}
          {isActive ? "Beenden" : "Sprechen"}
        </Button>

        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground min-w-0">
          {status === "speaking" && <Volume2 className="w-3.5 h-3.5 shrink-0 text-primary animate-pulse" />}
          {status === "listening" && <Ear className="w-3.5 h-3.5 shrink-0 text-primary animate-pulse" />}
          <span className="truncate">{errorMsg ?? statusLabel[status]}</span>
        </div>
      </div>

      {(isActive || transcript.length > 0) && (
        <ScrollArea className="max-h-32 px-4 pb-2">
          <div className="space-y-1.5 text-xs">
            {transcript.map((t, i) => (
              <div key={i} className={t.role === "user" ? "text-foreground" : "text-muted-foreground"}>
                <span className="font-mono opacity-60">{t.role === "user" ? "DU: " : "LUKAS: "}</span>
                {t.text}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
