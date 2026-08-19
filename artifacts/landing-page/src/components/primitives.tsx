import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useInView, type Variants } from "framer-motion";
import {
  ArrowRight,
  Code2,
  Layers,
  Monitor,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

const icons: Record<string, LucideIcon> = {
  zap: Zap,
  layers: Layers,
  search: Search,
  monitor: Monitor,
  code: Code2,
  rocket: Rocket,
  sparkles: Sparkles,
  shield: ShieldCheck,
};

export function Icon({ name, className }: { name: string; className?: string }) {
  const Component = icons[name] ?? Sparkles;
  return <Component className={className} strokeWidth={1.6} aria-hidden />;
}

const revealVariants: Variants = {
  hidden: { opacity: 0, y: 26 },
  shown: { opacity: 1, y: 0 },
};

/** Blendet Inhalte beim Scrollen einmalig ein. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      variants={revealVariants}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function Pill({
  children,
  className,
  dot = true,
}: {
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span className={cn("pill", className)}>
      {dot ? (
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-pulse-ring rounded-full bg-glow-cyan" />
          <span className="relative inline-flex size-1.5 rounded-full bg-glow-cyan" />
        </span>
      ) : null}
      {children}
    </span>
  );
}

/** Ueberschriftenblock: Label, Titel, optionaler Fliesstext — mittig oder links. */
export function SectionHeading({
  label,
  title,
  body,
  align = "center",
  className,
}: {
  label: string;
  title: ReactNode;
  body?: string;
  align?: "center" | "left";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-5",
        align === "center" ? "items-center text-center" : "items-start",
        className,
      )}
    >
      <Reveal>
        <Pill>{label}</Pill>
      </Reveal>
      <Reveal delay={0.05}>
        <h2
          className={cn(
            "max-w-3xl text-3xl font-semibold sm:text-4xl lg:text-[2.9rem] lg:leading-[1.08]",
            align === "center" && "mx-auto",
          )}
        >
          {title}
        </h2>
      </Reveal>
      {body ? (
        <Reveal delay={0.1}>
          <p
            className={cn(
              "max-w-2xl text-base leading-relaxed text-mist",
              align === "center" && "mx-auto",
            )}
          >
            {body}
          </p>
        </Reveal>
      ) : null}
    </div>
  );
}

type ButtonVariant = "primary" | "ghost";

export function ButtonLink({
  href,
  children,
  variant = "primary",
  className,
  withArrow = true,
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  className?: string;
  withArrow?: boolean;
}) {
  const base =
    "group inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-glow-cyan";

  const styles: Record<ButtonVariant, string> = {
    primary:
      "bg-chalk text-ink-900 hover:bg-white hover:shadow-[0_16px_44px_-14px_rgba(46,230,255,.65)]",
    ghost:
      "border border-white/12 bg-white/[0.03] text-chalk hover:border-white/25 hover:bg-white/[0.07]",
  };

  return (
    <a href={href} className={cn(base, styles[variant], className)}>
      {children}
      {withArrow ? (
        <ArrowRight
          className="size-4 transition-transform duration-300 group-hover:translate-x-1"
          strokeWidth={1.8}
          aria-hidden
        />
      ) : null}
    </a>
  );
}

/** Zaehlt beim Sichtbarwerden von 0 auf den Zielwert hoch. */
export function Counter({
  value,
  suffix,
  decimals = 0,
}: {
  value: number;
  suffix?: string;
  decimals?: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (reduceMotion) {
      setDisplay(value);
      return;
    }

    const duration = 1400;
    const start = performance.now();
    let frame = 0;

    function tick(now: number): void {
      const progress = Math.min(1, (now - start) / duration);
      // ease-out-quint, damit die Zahl weich einrastet
      const eased = 1 - Math.pow(1 - progress, 5);
      setDisplay(value * eased);
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, value]);

  const shown = display.toLocaleString("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span ref={ref}>
      {shown}
      {suffix ? <span className="text-glow-cyan">{suffix}</span> : null}
    </span>
  );
}
