import { useState } from "react";
import {
  useGetGoals,
  useCreateGoal,
  useUpdateGoal,
  useDeleteGoal,
  getGetGoalsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, CheckCircle2, Target, Clock, AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { formatDistanceToNow } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-500/10 text-red-400 border-red-500/20",
  medium: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  low: "bg-green-500/10 text-green-400 border-green-500/20",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  active: <Clock className="w-4 h-4 text-blue-400" />,
  completed: <CheckCircle2 className="w-4 h-4 text-green-400" />,
  failed: <AlertCircle className="w-4 h-4 text-red-400" />,
};

export default function Goals() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("high");
  const [filter, setFilter] = useState("all");

  const { data: goals = [], isLoading } = useGetGoals();
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();
  const deleteGoal = useDeleteGoal();

  const filtered = filter === "all" ? goals : goals.filter((g) => g.status === filter);

  const handleCreate = async () => {
    if (!title.trim() || !description.trim()) return;
    await createGoal.mutateAsync({ data: { title, description, priority } });
    qc.invalidateQueries({ queryKey: getGetGoalsQueryKey() });
    setOpen(false);
    setTitle("");
    setDescription("");
  };

  const handleStatusChange = async (id: number, status: string) => {
    await updateGoal.mutateAsync({ id, data: { status } });
    qc.invalidateQueries({ queryKey: getGetGoalsQueryKey() });
  };

  const handleDelete = async (id: number) => {
    await deleteGoal.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getGetGoalsQueryKey() });
  };

  const activeCount = goals.filter((g) => g.status === "active").length;
  const completedCount = goals.filter((g) => g.status === "completed").length;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={Target}
        title="ACTIVE_DIRECTIVES"
        subtitle={`${activeCount} aktiv — ${completedCount} abgeschlossen`}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 font-mono"><Plus className="w-4 h-4" /> NEUE_DIREKTIVE</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-mono">DIREKTIVE_DEFINIEREN</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <Input placeholder="Ziel-Titel" value={title} onChange={(e) => setTitle(e.target.value)} className="font-mono" />
                <Textarea
                  placeholder="Was genau ist das Ziel? Warum ist es wichtig?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-[100px] font-mono text-sm"
                />
                <div className="space-y-2">
                  <label className="text-xs font-mono text-muted-foreground">PRIORITÄT</label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="high">HIGH</SelectItem>
                      <SelectItem value="medium">MEDIUM</SelectItem>
                      <SelectItem value="low">LOW</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleCreate} className="w-full" disabled={!title.trim() || !description.trim() || createGoal.isPending}>
                  Direktive aktivieren
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      >
        <div className="flex flex-wrap gap-2">
          {["all", "active", "completed", "failed"].map((s) => (
            <Button
              key={s}
              variant={filter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(s)}
              className="font-mono text-xs"
            >
              {s.toUpperCase()}
            </Button>
          ))}
        </div>
      </PageHeader>

      <ScrollArea className="flex-1 p-5 sm:p-6">
        {isLoading && <div className="text-center text-muted-foreground font-mono py-12">LOADING...</div>}
        <div className="space-y-4 max-w-3xl">
          {filtered.map((g) => (
            <div key={g.id} className="group bg-card border border-border rounded-lg p-5 hover:border-primary/30 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1">
                  <div className="mt-0.5">{STATUS_ICONS[g.status] ?? <Clock className="w-4 h-4" />}</div>
                  <div className="flex-1">
                    <h3 className="font-semibold">{g.title}</h3>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{g.description}</p>
                    <div className="mt-3 p-3 bg-background rounded border border-border/50">
                      <div className="text-xs font-mono text-muted-foreground mb-1">FORTSCHRITT:</div>
                      <div className="text-sm font-mono">{g.progress}</div>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <button
                    onClick={() => handleDelete(g.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-mono ${PRIORITY_COLORS[g.priority] ?? ""}`}>
                    {g.priority}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-4 pt-3 border-t border-border/50">
                {g.status === "active" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => handleStatusChange(g.id, "completed")} className="gap-1 text-xs font-mono text-green-400 border-green-400/20 hover:bg-green-400/10">
                      <CheckCircle2 className="w-3 h-3" /> COMPLETE
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleStatusChange(g.id, "failed")} className="gap-1 text-xs font-mono text-red-400 border-red-400/20 hover:bg-red-400/10">
                      <AlertCircle className="w-3 h-3" /> FAIL
                    </Button>
                  </>
                )}
                {g.status !== "active" && (
                  <Button size="sm" variant="outline" onClick={() => handleStatusChange(g.id, "active")} className="gap-1 text-xs font-mono">
                    REAKTIVIEREN
                  </Button>
                )}
                <span className="text-xs text-muted-foreground font-mono ml-auto">
                  {formatDistanceToNow(new Date(g.createdAt), { addSuffix: true })}
                </span>
              </div>
            </div>
          ))}
          {!isLoading && filtered.length === 0 && (
            <div className="text-center py-16">
              <Target className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground font-mono">KEINE_DIREKTIVEN</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
