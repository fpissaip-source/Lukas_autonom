import type { ReactElement } from "react";

/**
 * Abstrakte Interface-Vorschauen fuer die Projekt- und Studio-Karten.
 *
 * Bewusst aus reinem Markup gebaut statt aus Screenshots: nichts wird
 * nachgeladen, es bleibt in jeder Aufloesung scharf und es gibt keine
 * Bildrechte zu klaeren. Sobald echte Projektbilder vorliegen, ersetzt ein
 * <img> hier einfach das jeweilige Mockup.
 */

export type MockKind = "site" | "shop" | "video" | "dashboard";
export type Accent = "cyan" | "blue" | "violet";

const accentBg: Record<Accent, string> = {
  cyan: "bg-glow-cyan",
  blue: "bg-glow-blue",
  violet: "bg-glow-violet",
};

const accentGlow: Record<Accent, string> = {
  cyan: "from-glow-cyan/25 via-glow-blue/10",
  blue: "from-glow-blue/25 via-glow-violet/10",
  violet: "from-glow-violet/25 via-glow-blue/10",
};

function Bar({ w, dim = false }: { w: string; dim?: boolean }) {
  return (
    <div
      className={`h-2 rounded-full ${dim ? "bg-white/10" : "bg-white/22"}`}
      style={{ width: w }}
    />
  );
}

function SiteMock({ accent }: { accent: Accent }) {
  return (
    <div className="flex h-full flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <div className={`size-4 rounded ${accentBg[accent]}`} />
        <div className="flex gap-2">
          <Bar w="28px" dim />
          <Bar w="22px" dim />
          <Bar w="26px" dim />
        </div>
      </div>
      <div className="mt-3 space-y-2">
        <Bar w="62%" />
        <Bar w="44%" />
      </div>
      <div className="mt-1 flex gap-2">
        <div className={`h-5 w-20 rounded-full ${accentBg[accent]} opacity-80`} />
        <div className="h-5 w-16 rounded-full border border-white/15" />
      </div>
      <div className="mt-3 flex-1 rounded-lg border border-white/10 bg-white/[0.035]" />
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-12 rounded-lg border border-white/10 bg-white/[0.05]"
          />
        ))}
      </div>
    </div>
  );
}

function ShopMock({ accent }: { accent: Accent }) {
  return (
    <div className="flex h-full flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <Bar w="34%" />
        <div className="flex gap-1.5">
          <div className="size-4 rounded-full border border-white/15" />
          <div className={`size-4 rounded-full ${accentBg[accent]} opacity-70`} />
        </div>
      </div>
      <div className="grid flex-1 grid-cols-3 gap-2.5">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`rounded-lg border border-white/10 ${
              i === 1 ? "bg-white/[0.09]" : "bg-white/[0.04]"
            }`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between">
        <Bar w="30%" dim />
        <div className={`h-5 w-14 rounded-full ${accentBg[accent]} opacity-80`} />
      </div>
    </div>
  );
}

function VideoMock({ accent }: { accent: Accent }) {
  return (
    <div className="flex h-full items-center justify-center gap-5 p-5">
      <div className="flex-1 space-y-2">
        <Bar w="70%" />
        <Bar w="52%" dim />
        <Bar w="60%" dim />
        <div className="mt-4 flex items-end gap-1">
          {[8, 16, 11, 22, 14, 26, 12, 19, 9, 24, 13].map((h, i) => (
            <div
              key={i}
              className={`w-1.5 rounded-full ${accentBg[accent]} opacity-70`}
              style={{ height: `${h}px` }}
            />
          ))}
        </div>
      </div>
      <div className="relative h-full max-h-40 w-24 shrink-0 rounded-xl border border-white/12 bg-white/[0.05]">
        <div
          className={`absolute inset-x-0 top-0 h-1 rounded-t-xl ${accentBg[accent]}`}
        />
        <div className="grid h-full place-items-center">
          <div className="grid size-9 place-items-center rounded-full border border-white/20 bg-ink-900/60">
            <div className="ml-1 size-0 border-y-6 border-l-9 border-y-transparent border-l-white/70" />
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardMock({ accent }: { accent: Accent }) {
  return (
    <div className="flex h-full gap-3 p-5">
      <div className="w-14 shrink-0 space-y-2">
        <div className={`size-4 rounded ${accentBg[accent]}`} />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-2 rounded-full bg-white/10" />
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-2.5">
        <div className="flex gap-2.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex-1 rounded-lg border border-white/10 bg-white/[0.05] p-2"
            >
              <div className="h-1.5 w-8 rounded-full bg-white/20" />
              <div className="mt-1.5 h-2.5 w-10 rounded-full bg-white/30" />
            </div>
          ))}
        </div>
        <div className="flex flex-1 items-end gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          {[30, 52, 38, 66, 46, 78, 58, 88].map((h, i) => (
            <div
              key={i}
              className={`flex-1 rounded-sm ${accentBg[accent]}`}
              style={{ height: `${h}%`, opacity: 0.35 + i * 0.08 }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const mocks: Record<MockKind, (props: { accent: Accent }) => ReactElement> = {
  site: SiteMock,
  shop: ShopMock,
  video: VideoMock,
  dashboard: DashboardMock,
};

export function MockScreen({
  kind,
  accent,
  className,
}: {
  kind: MockKind;
  accent: Accent;
  className?: string;
}) {
  const Mock = mocks[kind];

  return (
    <div className={`relative overflow-hidden ${className ?? ""}`}>
      <div
        className={`absolute inset-0 bg-gradient-to-br to-transparent ${accentGlow[accent]}`}
      />
      <div className="absolute inset-0 bg-grid opacity-25" />

      {/* Fensterrahmen, damit die Flaeche als Interface lesbar wird */}
      <div className="absolute inset-4 rounded-xl border border-white/10 bg-ink-900/55 backdrop-blur-sm sm:inset-6">
        <div className="flex items-center gap-1.5 border-b border-white/8 px-4 py-2.5">
          <span className="size-1.5 rounded-full bg-white/20" />
          <span className="size-1.5 rounded-full bg-white/20" />
          <span className="size-1.5 rounded-full bg-white/20" />
          <span className="ml-3 h-3 w-24 rounded-full bg-white/[0.07]" />
        </div>
        <div className="h-[calc(100%-2.6rem)]">
          <Mock accent={accent} />
        </div>
      </div>
    </div>
  );
}
