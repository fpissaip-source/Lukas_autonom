import { useGetDiaryEntries } from "@workspace/api-client-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { BookOpen } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { format } from "date-fns";
import { de } from "date-fns/locale";

const MOOD_COLORS: Record<string, string> = {
  curious: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  focused: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  energized: "bg-green-500/10 text-green-400 border-green-500/20",
  frustrated: "bg-red-500/10 text-red-400 border-red-500/20",
  cold: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  scattered: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  suspicious: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  inspired: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  neutral: "bg-secondary text-secondary-foreground",
};

const ENERGY_COLORS: Record<string, string> = {
  high: "text-green-400",
  normal: "text-yellow-400",
  low: "text-red-400",
};

export default function Diary() {
  const { data: entries = [], isLoading } = useGetDiaryEntries({ limit: 50 });

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={BookOpen}
        title="Tagebuch"
        subtitle="Lukas' persönliche Tagebucheinträge und Reflexionen"
      />

      <ScrollArea className="flex-1 p-5 sm:p-6">
        {isLoading && <div className="text-center text-muted-foreground py-12">Lädt…</div>}
        <div className="max-w-3xl space-y-6">
          {entries.map((entry, idx) => (
            <article key={entry.id} className="relative">
              {idx < entries.length - 1 && (
                <div className="absolute left-4 top-12 bottom-[-24px] w-px bg-border/50" />
              )}
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 z-10">
                  <BookOpen className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="flex-1 bg-card border border-border rounded-lg p-5 hover:border-primary/20 transition-colors">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(entry.createdAt), "PPpp", { locale: de })}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${MOOD_COLORS[entry.mood] ?? MOOD_COLORS.neutral}`}>
                      {entry.mood}
                    </span>
                    <span className={`text-xs ${ENERGY_COLORS[entry.energy] ?? "text-muted-foreground"}`}>
                      Energie: {entry.energy}
                    </span>
                  </div>
                  <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                    {entry.content}
                  </div>
                </div>
              </div>
            </article>
          ))}
          {!isLoading && entries.length === 0 && (
            <div className="text-center py-16">
              <BookOpen className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground">Keine Einträge</p>
              <p className="text-xs text-muted-foreground mt-2">Lukas schreibt nach jeder Konversation einen Tagebucheintrag.</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
