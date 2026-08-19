import { why } from "@/content/site";
import { Icon, Reveal, SectionHeading } from "@/components/primitives";

export function WhyUs() {
  return (
    <section className="relative px-4 py-24 sm:px-6 lg:py-32">
      <div className="mx-auto max-w-6xl">
        <SectionHeading label={why.label} title={why.title} body={why.body} />

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {why.cards.map((card, index) => (
            <Reveal key={card.title} delay={index * 0.08}>
              <article className="surface surface-lit group h-full p-7 transition-colors duration-500 hover:border-white/18 hover:bg-white/[0.045]">
                <span className="grid size-11 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-glow-cyan transition-transform duration-500 group-hover:-translate-y-0.5">
                  <Icon name={card.icon} className="size-5" />
                </span>
                <h3 className="mt-6 text-xl font-semibold">{card.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-mist">
                  {card.body}
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
