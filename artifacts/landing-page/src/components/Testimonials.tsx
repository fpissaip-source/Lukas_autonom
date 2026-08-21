import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Quote, Star } from "lucide-react";

import { testimonials } from "@/content/site";
import { Reveal, SectionHeading } from "@/components/primitives";
import { cn } from "@/lib/utils";

const AUTOPLAY_MS = 7000;

/** Anfangsbuchstabe des Nachnamens fuer das Avatar-Kuerzel. */
function initialOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] ?? name).charAt(0).toUpperCase();
}

export function Testimonials() {
  const items = testimonials.items;
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);

  const go = useCallback(
    (step: number) => {
      setDirection(step);
      setIndex((current) => (current + step + items.length) % items.length);
    },
    [items.length],
  );

  // Wechselt von selbst weiter; jede manuelle Bedienung setzt den Takt zurueck.
  useEffect(() => {
    const timer = window.setInterval(() => go(1), AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [go, index]);

  const active = items[index];

  return (
    <section className="relative px-4 py-24 sm:px-6 lg:py-32">
      <div className="mx-auto max-w-4xl">
        <SectionHeading label={testimonials.label} title={testimonials.title} />

        <Reveal delay={0.08}>
          <div className="surface surface-lit relative mt-14 overflow-hidden px-7 py-10 sm:px-12 sm:py-14">
            <Quote
              className="absolute top-8 right-8 size-16 text-white/[0.04]"
              strokeWidth={1.2}
              aria-hidden
            />

            <div className="flex gap-1" aria-label="Fünf von fünf Sternen">
              {Array.from({ length: 5 }).map((_, star) => (
                <Star
                  key={star}
                  className="size-4 fill-glow-cyan text-glow-cyan"
                  strokeWidth={1}
                  aria-hidden
                />
              ))}
            </div>

            <div className="relative mt-6 min-h-44 sm:min-h-36">
              <AnimatePresence mode="wait" custom={direction}>
                <motion.blockquote
                  key={index}
                  initial={{ opacity: 0, x: direction * 28 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: direction * -28 }}
                  transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
                >
                  <p className="text-lg leading-relaxed text-chalk sm:text-xl">
                    „{active.quote}“
                  </p>
                  <footer className="mt-6 flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-full bg-gradient-to-br from-glow-cyan/30 to-glow-violet/30 text-sm font-semibold">
                      {initialOf(active.name)}
                    </span>
                    <span>
                      <span className="block text-sm font-medium">
                        {active.name}
                      </span>
                      <span className="block text-xs text-ash">{active.role}</span>
                    </span>
                  </footer>
                </motion.blockquote>
              </AnimatePresence>
            </div>

            <div className="mt-8 flex items-center justify-between border-t border-white/8 pt-6">
              <div className="flex gap-2">
                {items.map((item, dot) => (
                  <button
                    key={item.name}
                    type="button"
                    onClick={() => {
                      setDirection(dot > index ? 1 : -1);
                      setIndex(dot);
                    }}
                    aria-label={`Stimme ${dot + 1} anzeigen`}
                    aria-current={dot === index}
                    className={cn(
                      "h-1.5 rounded-full transition-all duration-300",
                      dot === index
                        ? "w-7 bg-glow-cyan"
                        : "w-1.5 bg-white/20 hover:bg-white/40",
                    )}
                  />
                ))}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => go(-1)}
                  aria-label="Vorherige Stimme"
                  className="grid size-10 place-items-center rounded-full border border-white/10 text-mist transition-colors hover:border-white/25 hover:text-chalk"
                >
                  <ChevronLeft className="size-4" strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  onClick={() => go(1)}
                  aria-label="Nächste Stimme"
                  className="grid size-10 place-items-center rounded-full border border-white/10 text-mist transition-colors hover:border-white/25 hover:text-chalk"
                >
                  <ChevronRight className="size-4" strokeWidth={1.8} />
                </button>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
