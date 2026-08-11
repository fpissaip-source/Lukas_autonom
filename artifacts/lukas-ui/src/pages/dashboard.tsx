import { useGetLukasDashboard } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Brain, Target, Film, BookOpen, Clock, Heart } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import { PageHeader } from "@/components/page-header";

export default function Dashboard() {
  const { data, isLoading } = useGetLukasDashboard();

  if (isLoading || !data) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader icon={Activity} title="Übersicht" subtitle="Lädt…" />
        <div className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-3 gap-5">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  const { status, activeGoals, recentDiary, recentMemories, mediaJobs, recentEmotions, character } = data;

  const valenceColor = (v: number) =>
    v >= 0.3 ? "text-emerald-400" : v <= -0.3 ? "text-red-400" : "text-amber-300";
  const valenceIcon = (v: number) => (v >= 0.3 ? "▲" : v <= -0.3 ? "▼" : "◆");

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        icon={Activity}
        title="Übersicht"
        subtitle="Wie es Lukas gerade geht und woran er arbeitet"
        actions={
          <div className="text-xs text-muted-foreground">
            Zuletzt: {status.lastActive ? formatDistanceToNow(new Date(status.lastActive), { addSuffix: true, locale: de }) : "unbekannt"}
          </div>
        }
      />

      <div className="p-5 sm:p-6 space-y-6">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Stimmung</CardTitle>
            <Activity className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">{status.mood}</div>
            <p className="text-xs text-muted-foreground mt-1">Energie: {status.energy}</p>
            {status.note && (
              <p className="text-xs text-muted-foreground mt-1 italic truncate" title={status.note}>
                {status.note}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Beschäftigt ihn</CardTitle>
            <Target className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-medium leading-tight">{status.obsession || 'None'}</div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Gedächtnis</CardTitle>
            <Brain className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status.memoriesCount} <span className="text-sm font-normal text-muted-foreground">Erinnerungen</span></div>
            <p className="text-xs text-muted-foreground mt-1">Aktive Ziele: {status.activeGoalsCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Gefühlslage: Emotionen mit Ursache + gewachsener Charakter */}
      <div>
        <h2 className="text-base font-semibold border-b border-border/50 pb-2 mb-4 flex items-center gap-2">
          <Heart className="w-4 h-4 text-muted-foreground" /> Gefühlslage
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-2">
            {recentEmotions.length > 0 ? (
              recentEmotions.map((e) => (
                <div key={e.id} className="bg-card p-3 rounded-md border border-border/50 flex items-start gap-3">
                  <span className={`text-sm ${valenceColor(e.valence)}`}>{valenceIcon(e.valence)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium capitalize">{e.emotion}</span>
                      <span className="text-xs text-muted-foreground flex-none">
                        {e.source} · {formatDistanceToNow(new Date(e.createdAt), { addSuffix: true, locale: de })}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{e.cause}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-muted-foreground italic">
                Noch keine emotionalen Ereignisse — Lukas' Gefühlsleben beginnt mit dem ersten Gespräch.
              </div>
            )}
          </div>
          <div>
            {character ? (
              <div className="bg-card p-4 rounded-md border border-border/50 space-y-3">
                <div className="text-xs text-muted-foreground">Gewachsener Charakter</div>
                {character.selfImage && (
                  <p className="text-sm leading-relaxed italic text-muted-foreground">"{character.selfImage}"</p>
                )}
                <div className="space-y-2">
                  {(
                    [
                      ["Selbstvertrauen", character.traits.confidence],
                      ["Wärme", character.traits.warmth],
                      ["Vorsicht", character.traits.guardedness],
                      ["Verspieltheit", character.traits.playfulness],
                      ["Ehrgeiz", character.traits.ambition],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className="text-xs w-28 flex-none text-muted-foreground">{label}</span>
                      <div className="flex-1 h-1.5 bg-secondary rounded overflow-hidden">
                        <div className="h-full bg-primary/70" style={{ width: `${Math.round(value * 100)}%` }} />
                      </div>
                      <span className="text-xs w-8 text-right text-muted-foreground">
                        {Math.round(value * 100)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic">
                Charakter formt sich mit der ersten Reflexion.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
          {/* Recent Thoughts/Diary */}
          <div>
            <h2 className="text-base font-semibold border-b border-border/50 pb-2 mb-4 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-muted-foreground" /> Zuletzt im Tagebuch
            </h2>
            {recentDiary.length > 0 ? (
              <div className="bg-card p-4 rounded-md border border-border/50 text-sm leading-relaxed text-muted-foreground">
                {recentDiary[0].content}
                <div className="mt-3 text-xs text-primary/60">
                  {formatDistanceToNow(new Date(recentDiary[0].createdAt), { addSuffix: true, locale: de })}
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic">No recent logs.</div>
            )}
          </div>

          {/* Active Goals */}
          <div>
            <h2 className="text-base font-semibold border-b border-border/50 pb-2 mb-4 flex items-center gap-2">
              <Target className="w-4 h-4 text-muted-foreground" /> Aktive Ziele
            </h2>
            <div className="space-y-3">
              {activeGoals.slice(0, 3).map(goal => (
                <div key={goal.id} className="bg-card p-3 rounded-md border border-border/50 flex justify-between items-center">
                  <div>
                    <div className="font-medium">{goal.title}</div>
                    <div className="text-xs text-muted-foreground mt-1">Priorität: {goal.priority}</div>
                  </div>
                  <div className="text-xs px-2 py-1 bg-secondary rounded text-secondary-foreground">
                    {goal.status}
                  </div>
                </div>
              ))}
              {activeGoals.length === 0 && (
                <div className="text-sm text-muted-foreground italic">No active directives.</div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {/* Media Jobs */}
          <div>
            <h2 className="text-base font-semibold border-b border-border/50 pb-2 mb-4 flex items-center gap-2">
              <Film className="w-4 h-4 text-muted-foreground" /> Medien-Aufträge
            </h2>
            <div className="space-y-3">
              {mediaJobs.slice(0, 4).map(job => (
                <div key={job.id} className="bg-card p-3 rounded-md border border-border/50 flex flex-col gap-2">
                  <div className="flex justify-between items-start">
                    <div className="text-sm font-medium line-clamp-1 flex-1 pr-4">{job.vision || job.prompt}</div>
                    <div className="text-xs px-2 py-1 bg-secondary rounded text-secondary-foreground uppercase shrink-0">
                      {job.status}
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-xs text-muted-foreground">
                    <span>TYPE: {job.mediaType}</span>
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {formatDistanceToNow(new Date(job.createdAt), { locale: de })} her</span>
                  </div>
                </div>
              ))}
              {mediaJobs.length === 0 && (
                <div className="text-sm text-muted-foreground italic">Noch keine Medien-Aufträge.</div>
              )}
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
