import { useGetLukasDashboard } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  Brain,
  Target,
  Film,
  BookOpen,
  Clock,
  Heart,
  TrendingUp,
  TrendingDown,
  Minus,
  type LucideIcon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import { PageHeader } from "@/components/page-header";
import { WartetAufDich } from "@/components/wartet-auf-dich";

/*
 * Ein Abschnitt der Uebersicht.
 *
 * Vorher hatte jede Ueberschrift eine Linie darunter — das ergab optisch ein
 * gegliedertes Dokument, kein Produkt. Die Trennung machen jetzt Abstand und
 * die Karten selbst.
 */
function Abschnitt({
  icon: Icon,
  titel,
  verzoegerung = 0,
  children,
}: {
  icon: LucideIcon;
  titel: string;
  verzoegerung?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rise" style={{ animationDelay: `${verzoegerung}ms` }}>
      <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
        <Icon className="w-4 h-4" /> {titel}
      </h2>
      {children}
    </section>
  );
}

function Kennzahl({
  icon: Icon,
  label,
  wert,
  zusatz,
  verzoegerung = 0,
}: {
  icon: LucideIcon;
  label: string;
  wert: string;
  zusatz?: string;
  verzoegerung?: number;
}) {
  return (
    <div className="card-soft rise p-5" style={{ animationDelay: `${verzoegerung}ms` }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
          <Icon className="w-4 h-4 text-primary" />
        </span>
      </div>
      <div className="text-2xl font-semibold tracking-tight leading-tight text-balance">{wert}</div>
      {zusatz && <p className="text-xs text-muted-foreground mt-1.5">{zusatz}</p>}
    </div>
  );
}

/** Leerer Zustand — sagt, was fehlt, nicht "No data". */
function Leer({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground text-center text-pretty">
      {text}
    </div>
  );
}

export default function Dashboard() {
  const { data, isLoading } = useGetLukasDashboard();

  if (isLoading || !data) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader icon={Activity} title="Übersicht" subtitle="Lädt…" />
        <div className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-3 gap-5">
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-32 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  const { status, activeGoals, recentDiary, mediaJobs, recentEmotions, character } = data;

  /*
   * Gefuehle mit Richtung statt mit ASCII-Zeichen.
   *
   * Dort standen ▲ ▼ ◆ — genau die Sorte Zeichen, die eine Oberflaeche nach
   * Terminal aussehen laesst. Ein Pfeil-Icon sagt dasselbe und gehoert in eine
   * Anwendung.
   */
  const stimmung = (v: number) =>
    v >= 0.3
      ? { Icon: TrendingUp, farbe: "text-emerald-400", hg: "bg-emerald-400/10" }
      : v <= -0.3
        ? { Icon: TrendingDown, farbe: "text-red-400", hg: "bg-red-400/10" }
        : { Icon: Minus, farbe: "text-amber-300", hg: "bg-amber-300/10" };

  const zustandText: Record<string, string> = {
    active: "läuft",
    paused: "pausiert",
    done: "erledigt",
    completed: "erledigt",
    pending: "wartet",
    processing: "läuft",
    failed: "fehlgeschlagen",
  };

  return (
    <div>
      <PageHeader
        icon={Activity}
        title="Übersicht"
        subtitle="Wie es Lukas gerade geht und woran er arbeitet"
        actions={
          <div className="text-xs text-muted-foreground">
            Zuletzt aktiv:{" "}
            {status.lastActive
              ? formatDistanceToNow(new Date(status.lastActive), { addSuffix: true, locale: de })
              : "unbekannt"}
          </div>
        }
      />

      <div className="p-5 sm:p-6 space-y-8 max-w-6xl">
        {/* Ganz oben, vor allem anderen: was von Issa gebraucht wird. Alles
            Übrige auf dieser Seite ist Information, nur das hier ist eine
            Aufgabe. */}
        <WartetAufDich />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Kennzahl
            icon={Activity}
            label="Stimmung"
            wert={status.mood}
            zusatz={status.note ? status.note : `Energie: ${status.energy}`}
          />
          <Kennzahl
            icon={Target}
            label="Beschäftigt ihn"
            wert={status.obsession || "Nichts Bestimmtes"}
            verzoegerung={60}
          />
          <Kennzahl
            icon={Brain}
            label="Gedächtnis"
            wert={`${status.memoriesCount} Erinnerungen`}
            zusatz={`${status.activeGoalsCount} aktive Ziele`}
            verzoegerung={120}
          />
        </div>

        <Abschnitt icon={Heart} titel="Gefühlslage" verzoegerung={180}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2.5">
              {recentEmotions.length > 0 ? (
                recentEmotions.map((e, i) => {
                  const { Icon, farbe, hg } = stimmung(e.valence);
                  return (
                    <div
                      key={e.id}
                      className="card-soft rise p-3.5 flex items-start gap-3"
                      style={{ animationDelay: `${200 + i * 50}ms` }}
                    >
                      <span
                        className={`w-8 h-8 rounded-xl ${hg} flex items-center justify-center shrink-0`}
                      >
                        <Icon className={`w-4 h-4 ${farbe}`} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-medium capitalize">{e.emotion}</span>
                          <span className="text-xs text-muted-foreground flex-none">
                            {formatDistanceToNow(new Date(e.createdAt), {
                              addSuffix: true,
                              locale: de,
                            })}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground mt-0.5 text-pretty">
                          {e.cause}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <Leer text="Noch keine Gefühle festgehalten — das beginnt mit dem ersten Gespräch." />
              )}
            </div>

            {character ? (
              <div className="card-soft p-5 space-y-4 self-start">
                <div className="text-sm text-muted-foreground">Gewachsener Charakter</div>
                {character.selfImage && (
                  <p className="text-sm leading-relaxed text-pretty">„{character.selfImage}"</p>
                )}
                <div className="space-y-2.5">
                  {(
                    [
                      ["Selbstvertrauen", character.traits.confidence],
                      ["Wärme", character.traits.warmth],
                      ["Vorsicht", character.traits.guardedness],
                      ["Verspieltheit", character.traits.playfulness],
                      ["Ehrgeiz", character.traits.ambition],
                    ] as const
                  ).map(([label, value], i) => (
                    <div key={label} className="flex items-center gap-3">
                      <span className="text-xs w-28 flex-none text-muted-foreground">{label}</span>
                      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary transition-[width] duration-700 ease-out"
                          style={{
                            width: `${Math.round(value * 100)}%`,
                            transitionDelay: `${300 + i * 80}ms`,
                          }}
                        />
                      </div>
                      <span className="text-xs w-8 text-right text-muted-foreground tabular-nums">
                        {Math.round(value * 100)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <Leer text="Sein Charakter formt sich mit der ersten Reflexion." />
            )}
          </div>
        </Abschnitt>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-8">
            <Abschnitt icon={BookOpen} titel="Zuletzt im Tagebuch" verzoegerung={240}>
              {recentDiary.length > 0 ? (
                <div className="card-soft p-5 text-sm leading-relaxed text-pretty">
                  {recentDiary[0].content}
                  <div className="mt-3 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(recentDiary[0].createdAt), {
                      addSuffix: true,
                      locale: de,
                    })}
                  </div>
                </div>
              ) : (
                <Leer text="Noch kein Eintrag." />
              )}
            </Abschnitt>

            <Abschnitt icon={Target} titel="Aktive Ziele" verzoegerung={280}>
              <div className="space-y-2.5">
                {activeGoals.slice(0, 3).map((goal) => (
                  <div
                    key={goal.id}
                    className="card-soft p-4 flex justify-between items-center gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{goal.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Priorität {goal.priority}
                      </div>
                    </div>
                    <span className="text-xs px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground shrink-0">
                      {zustandText[goal.status] ?? goal.status}
                    </span>
                  </div>
                ))}
                {activeGoals.length === 0 && <Leer text="Keine aktiven Ziele." />}
              </div>
            </Abschnitt>
          </div>

          <Abschnitt icon={Film} titel="Medien-Aufträge" verzoegerung={320}>
            <div className="space-y-2.5">
              {mediaJobs.slice(0, 4).map((job) => (
                <div key={job.id} className="card-soft p-4 space-y-2">
                  <div className="flex justify-between items-start gap-3">
                    <div className="text-sm font-medium line-clamp-2 flex-1">
                      {job.vision || job.prompt}
                    </div>
                    <span className="text-xs px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground shrink-0">
                      {zustandText[job.status] ?? job.status}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs text-muted-foreground">
                    <span>{job.mediaType === "video" ? "Video" : "Bild"}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDistanceToNow(new Date(job.createdAt), {
                        addSuffix: true,
                        locale: de,
                      })}
                    </span>
                  </div>
                </div>
              ))}
              {mediaJobs.length === 0 && <Leer text="Noch keine Medien-Aufträge." />}
            </div>
          </Abschnitt>
        </div>
      </div>
    </div>
  );
}
