import { useState } from "react";
import {
  useGetLukasStatus,
  useGetMemories,
  useCreateMemory,
  useDeleteMemory,
  getGetMemoriesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Search, Brain, Star } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import { ScrollArea } from "@/components/ui/scroll-area";

const CATEGORIES = ["personal", "preference", "goal", "project", "finance", "gaming", "health", "learning", "trading", "work", "other"];

const CATEGORY_COLORS: Record<string, string> = {
  personal: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  preference: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  goal: "bg-green-500/10 text-green-400 border-green-500/20",
  project: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  finance: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  gaming: "bg-red-500/10 text-red-400 border-red-500/20",
  health: "bg-teal-500/10 text-teal-400 border-teal-500/20",
  learning: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  trading: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  work: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
};

export default function Memory() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("kuratiert");
  const [open, setOpen] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [newCat, setNewCat] = useState("personal");
  const [newImportance, setNewImportance] = useState("5");
  const [newTags, setNewTags] = useState("");

  /*
   * Standardmaessig OHNE Chatverlauf.
   *
   * Jede Nachricht wird als niedrig gewichtete "conversation"-Erinnerung
   * abgelegt, damit Lukas alte Formulierungen wiederfindet. Fuer die Suche ist
   * das richtig — fuer diese Uebersicht nicht: sonst bestehen die 100
   * geladenen Eintraege fast nur aus Gespraechsschnipseln, und die kuratierten
   * Fakten sind zwischen ihnen nicht mehr zu finden.
   */
  const { data: memories = [], isLoading } = useGetMemories({
    search: search || undefined,
    category: category !== "all" && category !== "kuratiert" ? category : undefined,
    exclude: category === "kuratiert" ? "conversation" : undefined,
    limit: 100,
  });

  // Echter Bestand (COUNT(*)) — die Liste selbst ist auf 100 gedeckelt.
  const { data: uebersicht } = useGetLukasStatus();
  const gesamt = uebersicht?.memoriesCount;

  const createMemory = useCreateMemory();
  const deleteMemory = useDeleteMemory();

  const handleCreate = async () => {
    if (!newContent.trim()) return;
    await createMemory.mutateAsync({
      data: {
        content: newContent,
        category: newCat,
        importance: parseInt(newImportance),
        tags: newTags.split(",").map((t) => t.trim()).filter(Boolean),
      },
    });
    qc.invalidateQueries({ queryKey: getGetMemoriesQueryKey() });
    setOpen(false);
    setNewContent("");
    setNewTags("");
  };

  const handleDelete = async (id: number) => {
    await deleteMemory.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getGetMemoriesQueryKey() });
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={Brain}
        title="Gedächtnis"
        /*
         * memories.length war die SEITENGROESSE, nicht der Bestand: die Liste
         * wird mit limit 100 geholt, also stand dort bei jedem groesseren
         * Gedaechtnis exakt "100 Erinnerungen gespeichert". Der echte Wert
         * kommt als COUNT(*) aus dem Dashboard-Endpunkt.
         */
        subtitle={
          gesamt !== undefined
            ? `${memories.length} von ${gesamt} geladen`
            : `${memories.length} geladen`
        }
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="w-4 h-4" /> Neue Erinnerung</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Erinnerung speichern</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <Textarea
                  placeholder="Was soll Lukas wissen?"
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="min-h-[100px] text-sm"
                />
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Kategorie</label>
                    <Select value={newCat} onValueChange={setNewCat}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Wichtigkeit (1–10)</label>
                    <Input type="number" min="1" max="10" value={newImportance} onChange={(e) => setNewImportance(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Schlagworte (kommagetrennt)</label>
                  <Input placeholder="ki, projekt, wichtig" value={newTags} onChange={(e) => setNewTags(e.target.value)} className="text-sm" />
                </div>
                <Button onClick={handleCreate} className="w-full" disabled={!newContent.trim() || createMemory.isPending}>
                  Speichern
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      >
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Erinnerungen durchsuchen..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 text-sm"
            />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-full sm:w-40 text-sm"><SelectValue placeholder="Kategorie" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="kuratiert">Ohne Chatverlauf</SelectItem>
              <SelectItem value="all">Alle</SelectItem>
              {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </PageHeader>

      <ScrollArea className="flex-1 p-5 sm:p-6">
        {isLoading && (
          <div className="text-center text-muted-foreground py-12">Erinnerungen werden geladen…</div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-5xl">
          {memories.map((m) => (
            <div key={m.id} className="group bg-card border border-border rounded-lg p-4 hover:border-primary/30 transition-colors">
              <div className="flex items-start justify-between gap-3">
                {/*
                 * min-w-0 ist hier nicht kosmetisch: ein Flex-Kind schrumpft
                 * sonst nicht unter seine Inhaltsbreite, und ein einzelner
                 * langer Block ohne Leerzeichen — ein SHA-256-Hash etwa —
                 * sprengt damit die ganze Karte nach rechts aus dem Bild.
                 */}
                <p className="text-sm leading-relaxed flex-1 min-w-0 break-words whitespace-pre-wrap">
                  {m.content}
                </p>
                <button
                  onClick={() => handleDelete(m.id)}
                  aria-label="Erinnerung löschen"
                  /*
                   * Auf dem Handy gibt es kein Hover. Mit opacity-0 war der
                   * Knopf dort schlicht nie erreichbar — sichtbar erst ab sm,
                   * wo es einen Zeiger gibt.
                   */
                  className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0 mt-0.5"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[m.category] ?? "bg-secondary text-secondary-foreground"}`}>
                  {m.category}
                </span>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Star className="w-3 h-3" />
                  {m.importance}/10
                </div>
                {m.tags?.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0">#{tag}</Badge>
                ))}
                <span className="text-xs text-muted-foreground ml-auto">
                  {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true, locale: de })}
                </span>
              </div>
            </div>
          ))}
          {!isLoading && memories.length === 0 && (
            <div className="col-span-2 text-center py-16">
              <Brain className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground">Noch keine Erinnerungen</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
