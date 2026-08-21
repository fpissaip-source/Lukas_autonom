import { marquee } from "@/content/site";

/**
 * Endlos laufendes Band mit den Leistungen. Der Inhalt steht doppelt im DOM,
 * damit die Schleife bei -50% nahtlos zurueckspringt.
 */
export function Marquee() {
  const items = [...marquee, ...marquee];

  return (
    <section
      aria-hidden
      className="relative border-y border-white/8 bg-white/[0.015] py-5"
    >
      <div className="mask-fade-x flex overflow-hidden">
        <div className="flex shrink-0 animate-marquee items-center gap-10 pr-10">
          {items.map((item, index) => (
            <span
              key={`${item}-${index}`}
              className="flex items-center gap-10 text-sm font-medium tracking-[0.2em] whitespace-nowrap text-ash uppercase"
            >
              {item}
              <span className="size-1 rounded-full bg-glow-cyan/60" />
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
