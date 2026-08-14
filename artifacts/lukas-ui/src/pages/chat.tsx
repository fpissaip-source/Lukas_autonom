import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
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
import {
  Plus, Trash2, ArrowUp, MessageSquare, Loader2, ArrowLeft,
  Paperclip, X, FileText, Film, ImageIcon, File as FileIcon, ArrowDown, Square,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { takeCompleteLines, parseSseData } from "@/lib/sse";
import { VoicePanel } from "@/components/voice-panel";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Attachment = {
  id: number;
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

function chatTime(iso: string) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} ${time}`;
}

function relativeDay(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (days === 0) return "Heute";
  if (days === 1) return "Gestern";
  if (days < 7) return `vor ${days} Tagen`;
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function renderWithLinks(text: string) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 break-all hover:opacity-80">
        {part}
      </a>
    ) : <span key={i}>{part}</span>,
  );
}

function Avatar({ who }: { who: "lukas" | "issa" }) {
  return who === "lukas" ? (
    <div className="w-7 h-7 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center text-[11px] font-semibold text-primary shrink-0">L</div>
  ) : (
    <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-[11px] font-semibold text-muted-foreground shrink-0">I</div>
  );
}

export default function Chat() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [pending, setPending] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [optimisticMsg, setOptimisticMsg] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [sentAttachments, setSentAttachments] = useState<Attachment[]>([]);
  const [atBottom, setAtBottom] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { data: convos = [], isLoading: loadingConvos } = useListAnthropicConversations();
  const { data: activeConv } = useGetAnthropicConversation(activeId!, {
    query: {
      queryKey: getGetAnthropicConversationQueryKey(activeId!),
      enabled: activeId !== null,
    },
  });
  const createConvo = useCreateAnthropicConversation();
  const deleteConvo = useDeleteAnthropicConversation();

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }, []);

  useLayoutEffect(() => {
    if (atBottom) scrollToBottom("auto");
  }, [activeConv?.messages, optimisticMsg, streamContent, streaming, atBottom, scrollToBottom]);

  useLayoutEffect(() => {
    setAtBottom(true);
    scrollToBottom("auto");
  }, [activeId, scrollToBottom]);

  useEffect(() => {
    if (!activeId) return void setSentAttachments([]);
    const token = localStorage.getItem("lukas_token");
    fetch(`${BASE}/api/attachments/${activeId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Attachment[]) => setSentAttachments(rows))
      .catch(() => setSentAttachments([]));
  }, [activeId, activeConv?.messages?.length, streaming]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const handleNew = async () => {
    const res = await createConvo.mutateAsync({ data: { title: `Chat ${new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}` } });
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
      const res = await fetch(`${BASE}/api/attachments/${activeId}`, { method: "POST", headers: authHeaders(), body: form });
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
    await fetch(`${BASE}/api/attachments/file/${id}`, { method: "DELETE", headers: authHeaders() }).catch(() => {});
  };

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setStreamContent("");
    setOptimisticMsg(null);
    if (activeId) qc.invalidateQueries({ queryKey: getGetAnthropicConversationQueryKey(activeId) });
  }, [activeId, qc]);

  const handleSend = useCallback(async () => {
    if ((!input.trim() && pending.length === 0) || !activeId || streaming) return;
    const msg = input.trim() || "(Datei angehängt)";
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    setInput("");
    setPending([]);
    setOptimisticMsg(msg);
    setStreaming(true);
    setStreamContent("");
    setStreamError(null);
    setAtBottom(true);

    try {
      const token = localStorage.getItem("lukas_token");
      const response = await fetch(`${BASE}/api/anthropic/conversations/${activeId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ content: msg }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Chat fehlgeschlagen (${response.status})`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();

      // Warum gepuffert wird, steht in lib/sse.ts — es war der Grund für die
      // sporadisch ausbleibenden Antworten.
      let puffer = "";
      let done = false;
      while (!done && !controller.signal.aborted) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) done = true;
        if (value) puffer += decoder.decode(value, { stream: true });

        const { zeilen, rest } = takeCompleteLines(puffer);
        puffer = rest;

        for (const zeile of zeilen) {
          const parsed = parseSseData(zeile);
          if (!parsed) continue;
          if (parsed.content) setStreamContent((prev) => prev + String(parsed.content));
          if (parsed.tool) setStreamContent((prev) => `${prev}\n[⚙ ${String(parsed.tool)}]\n`);
          // Ein Fehler gehört sichtbar in den Chat, nicht in die Konsole.
          if (parsed.error) setStreamError(String(parsed.error));
          if (parsed.done) done = true;
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Vom Stopp-Knopf — kein Fehler.
      } else {
        setStreamError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setStreaming(false);
      setStreamContent("");
      setOptimisticMsg(null);
      qc.invalidateQueries({ queryKey: getGetAnthropicConversationQueryKey(activeId) });
    }
  }, [input, activeId, streaming, qc, pending.length]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
        {showList && (
          <div className="w-full md:w-72 border-r border-border flex flex-col shrink-0">
            <div className="p-3">
              <Button onClick={handleNew} variant="outline" className="w-full justify-start gap-2 h-10" disabled={createConvo.isPending}>
                <Plus className="w-4 h-4" /> Neuer Chat
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
              {loadingConvos && <div className="text-sm text-muted-foreground px-3 py-2">Lädt…</div>}
              {convos.map((c) => (
                <div key={c.id} onClick={() => setActiveId(c.id)} className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${activeId === c.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"}`}>
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm">{c.title}</div>
                    <div className="text-xs text-muted-foreground/70 mt-0.5">{relativeDay(c.createdAt)}</div>
                  </div>
                  <button onClick={(e) => handleDelete(c.id, e)} className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1 -m-1" aria-label={`${c.title} löschen`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {!loadingConvos && convos.length === 0 && <p className="text-sm text-muted-foreground px-3 py-2">Noch keine Gespräche.</p>}
            </div>
          </div>
        )}

        {showChat && (
          <div className="flex-1 flex flex-col min-w-0 relative">
            {activeId ? (
              <>
                <div className="h-14 border-b border-border px-4 flex items-center gap-3 shrink-0">
                  {isMobile && (
                    <button onClick={() => setActiveId(null)} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Zurück zur Liste" data-testid="button-back-to-list">
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                  )}
                  <span className="truncate font-medium">{activeConv?.title ?? "…"}</span>
                </div>

                <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden">
                  <div className="max-w-3xl mx-auto px-4 py-6 space-y-6 sm:px-6">
                    {allMessages.map((m) => {
                      const own = m.role === "user";
                      const files = sentAttachments.filter((a) => a.messageId === m.id);
                      return (
                        <div key={m.id} className={`flex gap-3 min-w-0 ${own ? "justify-end" : ""}`}>
                          {!own && <Avatar who="lukas" />}
                          <div className={`min-w-0 ${own ? "max-w-[85%]" : "flex-1"}`}>
                            <div className={own ? "bg-secondary rounded-2xl rounded-tr-md px-4 py-3" : ""}>
                              <div className="text-[15px] leading-7 whitespace-pre-wrap break-words">{renderWithLinks(m.content)}</div>
                              {files.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {files.map((a) => {
                                    const Icon = attachmentIcon(a.kind);
                                    return a.kind === "image" ? (
                                      <a key={a.id} href={`${BASE}${a.url}`} target="_blank" rel="noreferrer">
                                        <img src={`${BASE}${a.url}`} alt={a.filename} className="max-h-52 rounded-xl border border-border" />
                                      </a>
                                    ) : (
                                      <a key={a.id} href={`${BASE}${a.url}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:border-primary/40 transition-colors">
                                        <Icon className="w-4 h-4 text-primary shrink-0" />
                                        <span className="truncate max-w-[180px]">{a.filename}</span>
                                        <span className="text-muted-foreground text-xs">{formatSize(a.sizeBytes)}</span>
                                      </a>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                            <div className={`text-xs text-muted-foreground/60 mt-1.5 ${own ? "text-right" : ""}`}>{chatTime(m.createdAt)}</div>
                          </div>
                          {own && <Avatar who="issa" />}
                        </div>
                      );
                    })}

                    {optimisticMsg && (
                      <div className="flex gap-3 justify-end min-w-0">
                        <div className="min-w-0 max-w-[85%]">
                          <div className="bg-secondary/60 rounded-2xl rounded-tr-md px-4 py-3">
                            <div className="text-[15px] leading-7 whitespace-pre-wrap break-words">{renderWithLinks(optimisticMsg)}</div>
                          </div>
                          <div className="text-xs text-muted-foreground/60 mt-1.5 text-right flex items-center justify-end gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> senden…</div>
                        </div>
                        <Avatar who="issa" />
                      </div>
                    )}

                    {streaming && (
                      <div className="flex gap-3 min-w-0">
                        <Avatar who="lukas" />
                        <div className="flex-1 min-w-0">
                          {streamContent ? (
                            <div className="text-[15px] leading-7 whitespace-pre-wrap break-words">{streamContent}<span className="animate-pulse">▌</span></div>
                          ) : (
                            <div className="flex items-center gap-1.5 py-2" aria-label="Lukas schreibt">
                              <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
                              <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
                              <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Ein Fehler bleibt stehen, bis die naechste Nachricht raus geht. */}
                    {streamError && !streaming && (
                      <div className="flex gap-3 min-w-0">
                        <Avatar who="lukas" />
                        <div className="flex-1 min-w-0 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
                          <div className="text-sm font-medium text-destructive mb-1">
                            Die Antwort ist nicht angekommen
                          </div>
                          <div className="text-xs text-muted-foreground break-words">{streamError}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {!atBottom && (
                  <button onClick={() => { setAtBottom(true); scrollToBottom(); }} className="absolute bottom-32 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs shadow-lg hover:border-primary/40 transition-colors">
                    <ArrowDown className="w-3.5 h-3.5" /> Neueste
                  </button>
                )}

                <div className="px-4 pb-4 pt-2 sm:px-6 shrink-0" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}>
                  <div className="max-w-3xl mx-auto">
                    {(pending.length > 0 || uploading || uploadError) && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {pending.map((a) => {
                          const Icon = attachmentIcon(a.kind);
                          return (
                            <div key={a.id} className="flex items-center gap-2 bg-card border border-border rounded-xl pl-2 pr-1 py-1.5 max-w-[240px]">
                              {a.kind === "image" ? <img src={`${BASE}${a.url}`} alt={a.filename} className="w-8 h-8 rounded-lg object-cover shrink-0" /> : <Icon className="w-4 h-4 text-primary shrink-0" />}
                              <div className="min-w-0"><div className="text-xs truncate">{a.filename}</div><div className="text-[10px] text-muted-foreground">{formatSize(a.sizeBytes)}</div></div>
                              <button onClick={() => removePending(a.id)} className="text-muted-foreground hover:text-destructive shrink-0 p-1" aria-label={`${a.filename} entfernen`}><X className="w-3.5 h-3.5" /></button>
                            </div>
                          );
                        })}
                        {uploading && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" /> lädt hoch…</div>}
                        {uploadError && <div className="text-xs text-destructive">{uploadError}</div>}
                      </div>
                    )}

                    <div className="flex items-end gap-2 rounded-2xl border border-border bg-card px-2 py-2 focus-within:border-primary/40 transition-colors">
                      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
                      <button onClick={() => fileInputRef.current?.click()} disabled={streaming || uploading} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40 shrink-0" aria-label="Datei anhängen" data-testid="button-attach">
                        <Paperclip className="w-5 h-5" />
                      </button>
                      <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="Schreibe Lukas…" rows={1} disabled={streaming} className="flex-1 bg-transparent resize-none py-2 text-[15px] leading-6 outline-none placeholder:text-muted-foreground/60 disabled:opacity-50 max-h-[200px]" />
                      {streaming ? (
                        <button onClick={handleCancel} className="p-2 rounded-lg bg-primary text-primary-foreground transition-colors shrink-0 hover:opacity-90" aria-label="Antwort stoppen" data-testid="button-stop-response">
                          <Square className="w-5 h-5 fill-current" />
                        </button>
                      ) : (
                        <button onClick={handleSend} disabled={(!input.trim() && pending.length === 0)} className="p-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-30 disabled:bg-secondary disabled:text-muted-foreground transition-colors shrink-0" aria-label="Senden">
                          <ArrowUp className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground/60 mt-2 text-center hidden sm:block">Enter zum Senden · Shift+Enter für eine neue Zeile</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                <MessageSquare className="w-12 h-12 text-muted-foreground/25 mb-5" />
                <h2 className="text-lg font-semibold mb-1.5">Womit fangen wir an?</h2>
                <p className="text-muted-foreground text-sm mb-6 max-w-sm">Starte ein neues Gespräch — Lukas erinnert sich an alles, was ihr besprecht.</p>
                <Button onClick={handleNew} className="gap-2" disabled={createConvo.isPending}><Plus className="w-4 h-4" /> Neuer Chat</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
