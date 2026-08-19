import { Rocket } from "lucide-react";

import { about } from "@/content/site";
import { MockScreen } from "@/components/MockScreen";
import { ButtonLink, Counter, Reveal, SectionHeading } from "@/components/primitives";

/**
 * Bildersatz fuer den Studio-Block: ein grosses Interface-Mockup mit zwei
 * ueberlappenden Karten davor — dieselbe Bildidee wie im Referenzdesign,
 * nur ohne Fotomaterial.
 */
function StudioVisual() {
  return (
    <div className="relative pb-16 pl-0 sm:pb-20 sm:pl-10">
      <MockScreen
        kind="site"
        accent="cyan"
        className="surface aspect-4/5 sm:aspect-square lg:aspect-4/5"
      />

      {/* Kennzahl-Karte, die aus dem Bild herausragt */}
      <div className="surface surface-lit absolute bottom-4 left-0 w-56 p-5 sm:bottom-6 sm:w-64">
        <div className="flex items-center justify-between">
          <span className="text-xs tracking-wide text-ash uppercase">
            PageSpeed
          </span>
          <span className="size-2 rounded-full bg-glow-cyan" />
        </div>
        <div className="mt-3 text-3xl font-semibold">
          98<span className="text-base text-ash">/100</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-[98%] rounded-full bg-gradient-to-r from-glow-cyan to-glow-blue" />
        </div>
      </div>

      {/* Kleines Status-Schild oben rechts */}
      <div className="surface absolute top-1/3 -right-3 flex items-center gap-2 px-4 py-2.5 sm:-right-6">
        <Rocket className="size-4 text-glow-cyan" strokeWidth={1.6} aria-hidden />
        <span className="text-xs font-medium">Live in 3 Wochen</span>
      </div>
    </div>
  );
}

export function About() {
  return (
    <section id="studio" className="relative px-4 py-24 sm:px-6 lg:py-32">
      <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-2 lg:gap-16">
        <Reveal className="order-2 lg:order-1">
          <StudioVisual />
        </Reveal>

        <div className="order-1 lg:order-2">
          <SectionHeading
            label={about.label}
            title={about.title}
            align="left"
          />

          <div className="mt-6 space-y-4">
            {about.body.map((paragraph, index) => (
              <Reveal key={paragraph} delay={0.05 + index * 0.05}>
                <p className="text-base leading-relaxed text-mist">{paragraph}</p>
              </Reveal>
            ))}
          </div>

          <div className="mt-10 grid grid-cols-2 gap-x-6 gap-y-8">
            {about.stats.map((stat, index) => (
              <Reveal key={stat.label} delay={index * 0.07}>
                <div>
                  <div className="text-3xl font-semibold sm:text-4xl">
                    <Counter
                      value={stat.value}
                      suffix={stat.suffix}
                      decimals={Number.isInteger(stat.value) ? 0 : 1}
                    />
                  </div>
                  <div className="mt-2 text-sm text-ash">{stat.label}</div>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.1}>
            <ButtonLink href={about.cta.href} variant="ghost" className="mt-10">
              {about.cta.label}
            </ButtonLink>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
