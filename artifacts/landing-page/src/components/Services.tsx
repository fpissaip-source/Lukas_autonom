import { ArrowUpRight } from "lucide-react";

import { services } from "@/content/site";
import { Icon, Reveal, SectionHeading } from "@/components/primitives";

export function Services() {
  return (
    <section id="leistungen" className="relative px-4 py-24 sm:px-6 lg:py-32">
      {/* Lichtstreifen hinter dem Block */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/4 -z-10 h-96 bg-[radial-gradient(ellipse_at_center,rgba(79,125,255,.12),transparent_70%)] blur-2xl"
      />

      <div className="mx-auto max-w-6xl">
        <SectionHeading
          label={services.label}
          title={services.title}
          body={services.body}
        />

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {services.items.map((service, index) => (
            <Reveal key={service.title} delay={(index % 3) * 0.08}>
              <article className="surface group relative h-full overflow-hidden p-7">
                {/* Schimmer, der beim Hovern von links nach rechts laeuft */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/[0.06] to-transparent transition-transform duration-[1200ms] group-hover:translate-x-full"
                />

                <div className="flex items-start justify-between gap-4">
                  <span className="grid size-11 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-glow-cyan">
                    <Icon name={service.icon} className="size-5" />
                  </span>
                  <ArrowUpRight
                    className="size-5 text-ash transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-chalk"
                    strokeWidth={1.6}
                    aria-hidden
                  />
                </div>

                <h3 className="mt-6 text-lg font-semibold">{service.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-mist">
                  {service.body}
                </p>

                <ul className="mt-6 space-y-2 border-t border-white/8 pt-5">
                  {service.points.map((point) => (
                    <li
                      key={point}
                      className="flex items-center gap-2.5 text-sm text-ash"
                    >
                      <span className="size-1 rounded-full bg-glow-cyan" />
                      {point}
                    </li>
                  ))}
                </ul>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
