import { useState, type FormEvent } from "react";
import { Check, ChevronDown, Mail, MapPin, Phone } from "lucide-react";

import { brand, finalCta } from "@/content/site";
import { Reveal, SectionHeading } from "@/components/primitives";

const budgets = [
  "unter 2.000 €",
  "2.000 – 5.000 €",
  "5.000 – 10.000 €",
  "über 10.000 €",
  "noch offen",
];

/**
 * Das Formular hat bewusst kein Backend: Beim Absenden wird eine vorbefuellte
 * E-Mail geoeffnet. Sobald ein Endpunkt existiert, ersetzt ein fetch() an
 * dieser Stelle den mailto-Aufruf.
 */
export function Contact() {
  const [sent, setSent] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "");
    const budget = String(data.get("budget") ?? "");
    const message = String(data.get("message") ?? "");
    const from = String(data.get("email") ?? "");

    const subject = `Projektanfrage von ${name}`;
    const body = [
      `Name: ${name}`,
      `E-Mail: ${from}`,
      `Budget: ${budget}`,
      "",
      message,
    ].join("\n");

    window.location.href = `mailto:${brand.email}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;
    setSent(true);
  }

  return (
    <section id="kontakt" className="relative px-4 py-24 sm:px-6 lg:py-32">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-full bg-[radial-gradient(ellipse_at_50%_0%,rgba(46,230,255,.12),transparent_60%)]"
      />

      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
        <div>
          <SectionHeading
            label={finalCta.label}
            title={finalCta.title}
            body={finalCta.body}
            align="left"
          />

          <ul className="mt-8 space-y-3">
            {finalCta.bullets.map((bullet) => (
              <Reveal key={bullet}>
                <li className="flex items-center gap-3 text-sm text-mist">
                  <span className="grid size-5 place-items-center rounded-full bg-glow-cyan/15 text-glow-cyan">
                    <Check className="size-3" strokeWidth={2.4} aria-hidden />
                  </span>
                  {bullet}
                </li>
              </Reveal>
            ))}
          </ul>

          <Reveal delay={0.1}>
            <div className="mt-10 space-y-3 border-t border-white/8 pt-8 text-sm text-mist">
              <a
                href={`mailto:${brand.email}`}
                className="flex items-center gap-3 transition-colors hover:text-chalk"
              >
                <Mail className="size-4 text-glow-cyan" strokeWidth={1.6} aria-hidden />
                {brand.email}
              </a>
              <a
                href={`tel:${brand.phone.replace(/[^\d+]/g, "")}`}
                className="flex items-center gap-3 transition-colors hover:text-chalk"
              >
                <Phone className="size-4 text-glow-cyan" strokeWidth={1.6} aria-hidden />
                {brand.phone}
              </a>
              <p className="flex items-center gap-3">
                <MapPin className="size-4 text-glow-cyan" strokeWidth={1.6} aria-hidden />
                {brand.location}
              </p>
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.12}>
          <form
            onSubmit={onSubmit}
            className="surface surface-lit space-y-5 p-7 sm:p-9"
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Name" name="name" placeholder="Vor- und Nachname" />
              <Field
                label="E-Mail"
                name="email"
                type="email"
                placeholder="name@firma.de"
              />
            </div>

            <label className="block">
              <span className="text-xs tracking-wide text-ash uppercase">
                Budgetrahmen
              </span>
              <div className="relative mt-2">
                <select
                  name="budget"
                  defaultValue={budgets[1]}
                  className="w-full appearance-none rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 pr-10 text-sm text-chalk outline-none transition-colors focus:border-glow-cyan/50"
                >
                  {budgets.map((budget) => (
                    <option key={budget} value={budget} className="bg-ink-800">
                      {budget}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-ash"
                  strokeWidth={1.8}
                  aria-hidden
                />
              </div>
            </label>

            <label className="block">
              <span className="text-xs tracking-wide text-ash uppercase">
                Worum geht es?
              </span>
              <textarea
                name="message"
                rows={5}
                required
                placeholder="Zwei Sätze reichen: Was soll die Seite können und bis wann?"
                className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-chalk placeholder:text-ash/70 outline-none transition-colors focus:border-glow-cyan/50"
              />
            </label>

            <button
              type="submit"
              className="w-full rounded-full bg-chalk px-6 py-3.5 text-sm font-medium text-ink-900 transition-shadow duration-300 hover:shadow-[0_18px_50px_-16px_rgba(46,230,255,.7)]"
            >
              Anfrage senden
            </button>

            <p className="text-center text-xs text-ash" aria-live="polite">
              {sent
                ? "Dein E-Mail-Programm wurde mit der fertigen Anfrage geöffnet."
                : "Antwort innerhalb von 24 Stunden — unverbindlich."}
            </p>
          </form>
        </Reveal>
      </div>
    </section>
  );
}

function Field({
  label,
  name,
  type = "text",
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs tracking-wide text-ash uppercase">{label}</span>
      <input
        type={type}
        name={name}
        required
        placeholder={placeholder}
        className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-chalk placeholder:text-ash/70 outline-none transition-colors focus:border-glow-cyan/50"
      />
    </label>
  );
}
