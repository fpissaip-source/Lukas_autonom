import { ArrowUpRight } from "lucide-react";

import { work } from "@/content/site";
import { Reveal, SectionHeading } from "@/components/primitives";
import { MockScreen, type Accent, type MockKind } from "@/components/MockScreen";

export function Work() {
  return (
    <section id="arbeiten" className="relative px-4 py-24 sm:px-6 lg:py-32">
      <div className="mx-auto max-w-6xl">
        <SectionHeading label={work.label} title={work.title} body={work.body} />

        <div className="mt-14 grid gap-5 md:grid-cols-2">
          {work.items.map((item, index) => (
            <Reveal key={item.title} delay={(index % 2) * 0.08}>
              <article className="surface group h-full overflow-hidden p-0">
                {/* Vorschau: abstraktes Interface statt Foto */}
                <div className="relative border-b border-white/8">
                  <MockScreen
                    kind={item.mock as MockKind}
                    accent={item.accent as Accent}
                    className="aspect-16/10 transition-transform duration-700 group-hover:scale-[1.03]"
                  />
                </div>

                <div className="p-7">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[0.7rem] tracking-[0.16em] text-ash uppercase">
                        {item.category}
                      </p>
                      <h3 className="mt-2 text-xl font-semibold">{item.title}</h3>
                    </div>
                    <ArrowUpRight
                      className="size-5 shrink-0 text-ash transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-chalk"
                      strokeWidth={1.6}
                      aria-hidden
                    />
                  </div>
                  <p className="mt-2.5 text-sm leading-relaxed text-mist">
                    {item.body}
                  </p>
                  <ul className="mt-6 flex flex-wrap gap-2">
                    {item.tags.map((tag) => (
                      <li
                        key={tag}
                        className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-ash"
                      >
                        {tag}
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
