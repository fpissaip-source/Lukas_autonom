import { process } from "@/content/site";
import { Reveal, SectionHeading } from "@/components/primitives";

export function Process() {
  return (
    <section id="ablauf" className="relative px-4 py-24 sm:px-6 lg:py-32">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          label={process.label}
          title={process.title}
          body={process.body}
        />

        <div className="relative mt-16">
          {/* Verbindungslinie zwischen den Schritten (nur auf grossen Screens) */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-6 hidden h-px bg-gradient-to-r from-transparent via-white/15 to-transparent lg:block"
          />

          <ol className="grid gap-10 lg:grid-cols-4 lg:gap-6">
            {process.steps.map((step, index) => (
              <Reveal key={step.title} delay={index * 0.09}>
                <li className="relative">
                  <span className="relative z-10 grid size-12 place-items-center rounded-full border border-white/12 bg-ink-800 text-sm font-semibold text-glow-cyan">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-6 text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-mist">
                    {step.body}
                  </p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
