import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";

import { faq } from "@/content/site";
import { Reveal, SectionHeading } from "@/components/primitives";
import { cn } from "@/lib/utils";

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="relative px-4 py-24 sm:px-6 lg:py-32">
      <div className="mx-auto max-w-3xl">
        <SectionHeading label={faq.label} title={faq.title} />

        <div className="mt-14 space-y-3">
          {faq.items.map((item, index) => {
            const isOpen = open === index;

            return (
              <Reveal key={item.q} delay={index * 0.05}>
                <div
                  className={cn(
                    "surface overflow-hidden transition-colors duration-300",
                    isOpen && "border-white/16 bg-white/[0.045]",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : index)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-6 px-6 py-5 text-left"
                  >
                    <span className="text-base font-medium sm:text-lg">
                      {item.q}
                    </span>
                    <Plus
                      className={cn(
                        "size-5 shrink-0 text-mist transition-transform duration-300",
                        isOpen && "rotate-45 text-glow-cyan",
                      )}
                      strokeWidth={1.6}
                      aria-hidden
                    />
                  </button>

                  <AnimatePresence initial={false}>
                    {isOpen ? (
                      <motion.div
                        key="body"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                      >
                        <p className="px-6 pb-6 text-sm leading-relaxed text-mist">
                          {item.a}
                        </p>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
