import { motion } from "framer-motion";
import { Check } from "lucide-react";

import { hero } from "@/content/site";
import { ButtonLink, Pill } from "@/components/primitives";
import { NeuralWave } from "@/components/NeuralWave";

const rise = {
  hidden: { opacity: 0, y: 30 },
  shown: { opacity: 1, y: 0 },
};

export function Hero() {
  return (
    <section
      id="start"
      className="relative isolate overflow-hidden px-4 pt-36 pb-20 sm:px-6 lg:pt-44 lg:pb-28"
    >
      {/* Hintergrund: Raster, Lichtkegel von oben, sanftes Ausblenden */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid mask-fade-y opacity-60" />
        <div className="absolute -top-40 left-1/2 h-[38rem] w-[70rem] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(79,125,255,.20),transparent_65%)] blur-2xl" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-ink-900" />
      </div>

      <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8">
        <motion.div
          initial="hidden"
          animate="shown"
          transition={{ staggerChildren: 0.09, delayChildren: 0.1 }}
          className="flex flex-col items-start gap-7"
        >
          <motion.div variants={rise} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
            <Pill>{hero.eyebrow}</Pill>
          </motion.div>

          <motion.h1
            variants={rise}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="text-[2.6rem] leading-[1.04] font-semibold sm:text-6xl lg:text-[4.1rem]"
          >
            {hero.titleLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
            <span className="block text-gradient">{hero.titleAccent}</span>
          </motion.h1>

          <motion.p
            variants={rise}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-xl text-base leading-relaxed text-mist sm:text-lg"
          >
            {hero.body}
          </motion.p>

          <motion.div
            variants={rise}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-wrap items-center gap-3"
          >
            <ButtonLink href={hero.primaryCta.href}>
              {hero.primaryCta.label}
            </ButtonLink>
            <ButtonLink href={hero.secondaryCta.href} variant="ghost">
              {hero.secondaryCta.label}
            </ButtonLink>
          </motion.div>

          <motion.ul
            variants={rise}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-2"
          >
            {hero.chips.map((chip) => (
              <li key={chip} className="flex items-center gap-2 text-sm text-ash">
                <Check className="size-4 text-glow-cyan" strokeWidth={2} aria-hidden />
                {chip}
              </li>
            ))}
          </motion.ul>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.1, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="relative aspect-square w-full max-w-xl justify-self-center lg:max-w-none"
        >
          <NeuralWave className="absolute inset-0 animate-float" />
        </motion.div>
      </div>
    </section>
  );
}
