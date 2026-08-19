import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";

import { brand, nav } from "@/content/site";
import { cn } from "@/lib/utils";

function Logo() {
  return (
    <a href="#start" className="flex items-center gap-2.5">
      <span className="relative grid size-8 place-items-center rounded-lg bg-gradient-to-br from-glow-cyan via-glow-blue to-glow-violet">
        <span className="size-3 rounded-[3px] bg-ink-900" />
      </span>
      <span className="text-[0.95rem] font-semibold tracking-tight">
        {brand.name}
      </span>
    </a>
  );
}

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>(nav[0].href);

  useEffect(() => {
    function onScroll(): void {
      setScrolled(window.scrollY > 24);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Markiert den Navigationspunkt, dessen Sektion gerade im Blick ist.
  useEffect(() => {
    const sections = nav
      .map((item) => document.querySelector(item.href))
      .filter((el): el is Element => el !== null);

    const observer = new IntersectionObserver(
      (entries) => {
        const shown = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (shown) setActive(`#${shown.target.id}`);
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.25, 0.5, 1] },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  // Kein Scrollen im Hintergrund, solange das Mobilmenue offen ist.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-4 pt-4 sm:px-6">
      <motion.div
        initial={{ y: -28, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          "mx-auto flex max-w-6xl items-center justify-between rounded-full px-4 py-2.5 transition-all duration-500 sm:px-5",
          scrolled
            ? "border border-white/10 bg-ink-900/70 shadow-[0_18px_50px_-24px_rgba(0,0,0,.9)] backdrop-blur-xl"
            : "border border-transparent",
        )}
      >
        <Logo />

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Hauptnavigation">
          {nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-full px-3.5 py-2 text-sm transition-colors",
                active === item.href
                  ? "bg-white/[0.07] text-chalk"
                  : "text-mist hover:text-chalk",
              )}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href="#kontakt"
            className="hidden rounded-full bg-chalk px-5 py-2.5 text-sm font-medium text-ink-900 transition-shadow duration-300 hover:shadow-[0_14px_40px_-14px_rgba(46,230,255,.7)] sm:inline-flex"
          >
            Projekt starten
          </a>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? "Menü schließen" : "Menü öffnen"}
            aria-expanded={open}
            className="grid size-10 place-items-center rounded-full border border-white/10 text-chalk lg:hidden"
          >
            {open ? (
              <X className="size-5" strokeWidth={1.6} />
            ) : (
              <Menu className="size-5" strokeWidth={1.6} />
            )}
          </button>
        </div>
      </motion.div>

      <AnimatePresence>
        {open ? (
          <motion.nav
            key="mobile"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            aria-label="Mobile Navigation"
            className="mx-auto mt-2 max-w-6xl rounded-3xl border border-white/10 bg-ink-800/95 p-3 backdrop-blur-xl lg:hidden"
          >
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="block rounded-2xl px-4 py-3 text-base text-mist transition-colors hover:bg-white/[0.05] hover:text-chalk"
              >
                {item.label}
              </a>
            ))}
            <a
              href="#kontakt"
              onClick={() => setOpen(false)}
              className="mt-2 block rounded-2xl bg-chalk px-4 py-3 text-center text-base font-medium text-ink-900"
            >
              Projekt starten
            </a>
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
