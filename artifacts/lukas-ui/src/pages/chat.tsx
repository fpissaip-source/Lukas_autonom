import { useState, useRef, useEffect, useCallback } from "react";
import {
  useListAnthropicConversations,
  useCreateAnthropicConversation,
  useDeleteAnthropicConversation,
  useGetAnthropicConversation,
  getListAnthropicConversationsQueryKey,
  getGetAnthropicConversationQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus, Trash2, Send, MessageSquare, Loader2, ArrowLeft,
  Paperclip, X, FileText, Film, ImageIcon, File as FileIcon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import { VoicePanel } from "@/components/voice-panel";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Attachment = {
  id: number;
  /** null solange die Nachricht noch nicht abgeschickt wurde */
  messageId: number | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "pdf" | "text" | "video" | "other";
  url: string;
};

function attachmentIcon(kind: Attachment["kind"]) {
  if (kind === "image") return ImageIcon;
  if (kind === "video") return Film;
  if (kind === "pdf" || kind === "text") return FileText;
  return FileIcon;
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function Chat() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Bereits hochgeladene, aber noch nicht abgeschickte Anhaenge.
  const [pending, setPending] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { data: convos = [], isLoading: loadingConvos } = useListAnthropicConversations();
  const { data: activeConv } = useGetAnthropicConversation(activeId!, {
    query: {
      queryKey: getGetAnthropicConversationQueryKey(activeId!),
      enabled: activeId !== null,
    },
  });
  const createConvo = useCreateAnthropicConversation();
  const deleteConvo = useDeleteAnthropicConversation();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConv?.messages, streamContent]);

  // Bereits gesendete Anhaenge der Konversation laden, um sie in den
  // Nachrichtenblasen anzuzeigen. Neu laden, sobald Nachrichten dazukommen.
  const [sentAttachments, setSentAttachments] = useState<Attachment[]>([]);
  useEffect(() => {
    if (!activeId) return void setSentAttachments([]);
    const token = localStorage.getItem("lukas_token");
    fetch(`${BASE}/api/attachments/${activeId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Attachment[]) => setSentAttachments(rows))
      .catch(() => setSentAttachments([]));
  }, [activeId, activeConv?.messages?.length, streaming]);

  const handleNew = async () => {
    const res = await createConvo.mutateAsync({ data: { title: `Chat ${new Date().toLocaleTimeString("de-DE")}` } });
    setActiveId(res.id);
    qc.invalidateQueries({ queryKey: getListAnthropicConversationsQueryKey() });
  };

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteConvo.mutateAsync({ id });
    if (activeId === id) setActiveId(null);
    qc.invalidateQueries({ queryKey: getListAnthropicConversationsQueryKey() });
  };

  const authHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("lukas_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !activeId) return;
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      Array.from(files).forEach((f) => form.append("files", f));
      const res = await fetch(`${BASE}/api/attachments/${activeId}`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || body?.error || `Upload fehlgeschlagen (${res.status})`);
      }
      const uploaded = (await res.json()) as Attachment[];
      setPending((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload fehlgeschlagen");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removePending = async (id: number) => {
    setPending((prev) => prev.filter((a) => a.id !== id));
    await fetch(`${BASE}/api/attachments/file/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).catch(() => {});
  };

  const handleSend = useCallback(async () => {
    // Mit Anhang darf die Nachricht auch ohne Text rausgehen ("schau dir das an").
    if ((!input.trim() && pending.length === 0) || !activeId || streaming) return;
    // Der Server verlangt ein nicht-leeres content-Feld; bei reinem
    // Datei-Upload ohne Text steht dort ein neutraler Platzhalter.
    const msg = input.trim() || "(Datei angehängt)";
    setInput("");
    setPending([]); // Anhaenge sind ab jetzt Teil der Nachricht
    setStreaming(true);
    setStreamContent("");

    try {
      const token = localStorage.getItem("lukas_token");
      const response = await fetch(`${BASE}/api/anthropic/conversations/${activeId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ content: msg }),
      });

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();

      let done = false;
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: !done });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const parsed = JSON.parse(line.slice(6));
                if (parsed.content) setStreamContent(prev => prev + parsed.content);
                if (parsed.tool) setStreamContent(prev => `${prev}\n[⚙ ${parsed.tool}]\n`);
                if (parsed.done) done = true;
              } catch {}
            }
          }
        }
      }
    } catch (err) {
      console.error("Stream error:", err);
    } finally {
      setStreaming(false);
      setStreamContent("");
      qc.invalidateQueries({ queryKey: getGetAnthropicConversationQueryKey(activeId) });
    }
  }, [input, activeId, streaming, qc, pending.length]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter sendet (wie in den meisten Chat-Apps), Shift+Enter macht einen
    // Zeilenumbruch. Ctrl/Cmd+Enter bleibt zusaetzlich als Alt-Shortcut.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const autoVoice = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("voice") === "auto";
  const allMessages = activeConv?.messages ?? [];
  const isMobile = useIsMobile();
  const showList = !isMobile || activeId === null;
  const showChat = !isMobile || activeId !== null;

  return (
    <div className="flex flex-col h-full min-w-0">
      <VoicePanel autoStart={autoVoice} />
      <div className="flex flex-1 min-h-0 min-w-0">
      {/* Conversations sidebar */}
      {showList && (
        <div className="w-full md:w-64 border-r border-border flex flex-col bg-card/30 shrink-0">
          <div className="p-4 border-b border-border">
            <Button onClick={handleNew} size="sm" className="w-full font-mono gap-2" disabled={createConvo.isPending}>
              <Plus className="w-4 h-4" /> NEW_THREAD
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {loadingConvos && <div className="text-xs text-muted-foreground p-2 font-mono">LOADING...</div>}
              {convos.map((c) => (
                <div
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className={`group flex items-center justify-between px-3 py-2.5 rounded-md cursor-pointer text-sm transition-colors ${
                    activeId === c.id ? "bg-primary text-primary-foreground" : "hover:bg-secondary text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{c.title}</div>
                    <div className={`text-xs font-mono mt-0.5 ${activeId === c.id ? "text-primary-foreground/70" : "text-muted-foreground/60"}`}>
                      {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(c.id, e)}
                    className={`ml-2 opacity-0 group-hover:opacity-100 transition-opacity ${activeId === c.id ? "text-primary-foreground/70 hover:text-primary-foreground" : "text-muted-foreground hover:text-destructive"}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {!loadingConvos && convos.length === 0 && (
                <div className="text-xs text-muted-foreground p-4 text-center font-mono">NO_THREADS</div>
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Chat area */}
      {showChat && (
      <div className="flex-1 flex flex-col min-w-0">
        {activeId ? (
          <>
            <div className="border-b border-border p-4 font-mono text-sm text-muted-foreground flex items-center gap-3">
              {isMobile && (
                <button
                  onClick={() => setActiveId(null)}
                  className="text-foreground shrink-0"
                  aria-label="Zurück zur Liste"
                  data-testid="button-back-to-list"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              <span className="truncate">COMM_LINK: {activeConv?.title ?? "..."}</span>
            </div>
            <ScrollArea className="flex-1 p-6">
              <div className="space-y-6 max-w-3xl mx-auto">
                {allMessages.map((m) => (
                  <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    {m.role === "assistant" && (
                      <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-primary-foreground mr-3 mt-1 shrink-0">L</div>
                    )}
                    <div className={`max-w-[80%] rounded-lg px-4 py-3 text-sm leading-relaxed ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-card border border-border rounded-bl-sm"
                    }`}>
                      <div className="whitespace-pre-wrap">{m.content}</div>
                      {/* Anhaenge dieser Nachricht */}
                      {sentAttachments.filter((a) => a.messageId === m.id).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {sentAttachments
                            .filter((a) => a.messageId === m.id)
                            .map((a) => {
                              const Icon = attachmentIcon(a.kind);
                              return a.kind === "image" ? (
                                <a key={a.id} href={`${BASE}${a.url}`} target="_blank" rel="noreferrer">
                                  <img
                                    src={`${BASE}${a.url}`}
                                    alt={a.filename}
                                    className="max-h-40 rounded-md border border-black/10"
                                  />
                                </a>
                              ) : (
                                <a
                                  key={a.id}
                                  href={`${BASE}${a.url}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
                                    m.role === "user" ? "bg-black/15" : "bg-secondary"
                                  }`}
                                >
                                  <Icon className="w-3.5 h-3.5 shrink-0" />
                                  <span className="truncate max-w-[160px]">{a.filename}</span>
                                  <span className="opacity-60 font-mono">{formatSize(a.sizeBytes)}</span>
                                </a>
                              );
                            })}
                        </div>
                      )}
                      <div className={`text-xs mt-2 ${m.role === "user" ? "text-primary-foreground/60" : "text-muted-foreground"} font-mono`}>
                        {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}
                      </div>
                    </div>
                    {m.role === "user" && (
                      <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-xs font-bold ml-3 mt-1 shrink-0">I</div>
                    )}
                  </div>
                ))}
                {streaming && (
                  <div className="flex justify-start">
                    <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-primary-foreground mr-3 mt-1 shrink-0">L</div>
                    <div className="max-w-[80%] rounded-lg rounded-bl-sm px-4 py-3 text-sm bg-card border border-border">
                      {streamContent ? (
                        <div className="whitespace-pre-wrap">{streamContent}<span className="animate-pulse">|</span></div>
                      ) : (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span className="font-mono text-xs">PROCESSING...</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>
            <div
              className="border-t border-border p-4"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFiles(e.dataTransfer.files);
              }}
            >
              {/* Ausgewaehlte, noch nicht abgeschickte Anhaenge */}
              {(pending.length > 0 || uploading || uploadError) && (
                <div className="max-w-3xl mx-auto mb-3 flex flex-wrap gap-2">
                  {pending.map((a) => {
                    const Icon = attachmentIcon(a.kind);
                    return (
                      <div
                        key={a.id}
                        className="flex items-center gap-2 bg-card border border-border rounded-lg pl-2 pr-1 py-1.5 max-w-[240px]"
                      >
                        {a.kind === "image" ? (
                          <img
                            src={`${BASE}${a.url}`}
                            alt={a.filename}
                            className="w-8 h-8 rounded object-cover shrink-0"
                          />
                        ) : (
                          <Icon className="w-4 h-4 text-primary shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="text-xs truncate">{a.filename}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            {formatSize(a.sizeBytes)}
                            {a.kind === "video" && " · kann Lukas nicht ansehen"}
                          </div>
                        </div>
                        <button
                          onClick={() => removePending(a.id)}
                          className="text-muted-foreground hover:text-destructive shrink-0 p-1"
                          aria-label={`${a.filename} entfernen`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                  {uploading && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> lädt hoch…
                    </div>
                  )}
                  {uploadError && (
                    <div className="text-xs text-destructive font-mono">{uploadError}</div>
                  )}
                </div>
              )}

              <div className="max-w-3xl mx-auto flex gap-2 sm:gap-3 items-end">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFiles(e.target.files)}
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={streaming || uploading}
                  className="shrink-0"
                  aria-label="Datei anhängen"
                  data-testid="button-attach"
                >
                  <Paperclip className="w-4 h-4" />
                </Button>
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Schreibe Lukas..."
                  className="resize-none min-h-[80px] font-mono text-sm bg-card border-border"
                  disabled={streaming}
                />
                <Button
                  onClick={handleSend}
                  disabled={(!input.trim() && pending.length === 0) || streaming}
                  className="shrink-0 gap-2"
                >
                  {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
              <div className="max-w-3xl mx-auto mt-2 text-xs text-muted-foreground font-mono hidden sm:block">
                Enter = SEND, Shift+Enter = Zeilenumbruch · Dateien per Klick auf 📎 oder Drag &amp; Drop
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <MessageSquare className="w-16 h-16 text-muted-foreground/30 mb-6" />
            <h2 className="text-xl font-mono font-bold mb-2">COMM_LINK OFFLINE</h2>
            <p className="text-muted-foreground text-sm mb-6">Starte einen neuen Thread um mit Lukas zu kommunizieren.</p>
            <Button onClick={handleNew} className="gap-2" disabled={createConvo.isPending}>
              <Plus className="w-4 h-4" /> NEW_THREAD
            </Button>
          </div>
        )}
      </div>
      )}
      </div>
    </div>
  );
}
