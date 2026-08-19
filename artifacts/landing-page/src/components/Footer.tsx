import { ArrowUp } from "lucide-react";

import { brand, nav, services } from "@/content/site";

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative border-t border-white/8 px-4 pt-16 pb-8 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-glow-cyan via-glow-blue to-glow-violet">
                <span className="size-3 rounded-[3px] bg-ink-900" />
              </span>
              <span className="font-semibold tracking-tight">{brand.name}</span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-ash">
              {brand.claim} für Websites, die schnell laden, klar führen und
              messbar arbeiten.
            </p>
          </div>

          <FooterColumn
            title="Seite"
            links={nav.map((item) => ({ label: item.label, href: item.href }))}
          />
          <FooterColumn
            title="Leistungen"
            links={services.items.map((item) => ({
              label: item.title,
              href: "#leistungen",
            }))}
          />
          <FooterColumn
            title="Kontakt"
            links={[
              { label: brand.email, href: `mailto:${brand.email}` },
              ...brand.socials.map((social) => ({
                label: social.label,
                href: social.href,
              })),
            ]}
          />
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-white/8 pt-6 text-xs text-ash sm:flex-row">
          <p>
            © {year} {brand.name}. Alle Rechte vorbehalten.
          </p>
          <div className="flex items-center gap-5">
            <a href="#" className="transition-colors hover:text-chalk">
              Impressum
            </a>
            <a href="#" className="transition-colors hover:text-chalk">
              Datenschutz
            </a>
            <a
              href="#start"
              aria-label="Zurück nach oben"
              className="grid size-9 place-items-center rounded-full border border-white/10 transition-colors hover:border-white/25 hover:text-chalk"
            >
              <ArrowUp className="size-4" strokeWidth={1.6} aria-hidden />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: ReadonlyArray<{ label: string; href: string }>;
}) {
  return (
    <div>
      <h3 className="text-xs tracking-[0.18em] text-mist uppercase">{title}</h3>
      <ul className="mt-4 space-y-2.5">
        {links.map((link) => (
          <li key={link.label}>
            <a
              href={link.href}
              className="text-sm text-ash transition-colors hover:text-chalk"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
