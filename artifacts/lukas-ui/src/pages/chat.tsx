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
import { Plus, Trash2, Send, MessageSquare, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function Chat() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: convos = [], isLoading: loadingConvos } = useListAnthropicConversations();
  const { data: activeConv } = useGetAnthropicConversation(activeId!, {
    query: { enabled: activeId !== null },
  });
  const createConvo = useCreateAnthropicConversation();
  const deleteConvo = useDeleteAnthropicConversation();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConv?.messages, streamContent]);

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

  const handleSend = useCallback(async () => {
    if (!input.trim() || !activeId || streaming) return;
    const msg = input.trim();
    setInput("");
    setStreaming(true);
    setStreamContent("");

    try {
      const response = await fetch(`${BASE}/api/anthropic/conversations/${activeId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
  }, [input, activeId, streaming, qc]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSend();
  };

  const allMessages = activeConv?.messages ?? [];

  return (
    <div className="flex h-full">
      {/* Conversations sidebar */}
      <div className="w-64 border-r border-border flex flex-col bg-card/30">
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

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeId ? (
          <>
            <div className="border-b border-border p-4 font-mono text-sm text-muted-foreground">
              COMM_LINK: {activeConv?.title ?? "..."}
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
            <div className="border-t border-border p-4">
              <div className="max-w-3xl mx-auto flex gap-3 items-end">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Schreibe Lukas... (Ctrl+Enter zum Senden)"
                  className="resize-none min-h-[80px] font-mono text-sm bg-card border-border"
                  disabled={streaming}
                />
                <Button onClick={handleSend} disabled={!input.trim() || streaming} className="shrink-0 gap-2">
                  {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
              <div className="max-w-3xl mx-auto mt-2 text-xs text-muted-foreground font-mono">Ctrl+Enter = SEND</div>
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
    </div>
  );
}
