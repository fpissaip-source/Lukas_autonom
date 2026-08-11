import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/*
 * Gemeinsamer Seitenkopf. Vorher hat jede Seite ihren eigenen Header gebaut —
 * dashboard mit text-3xl/p-8, alle anderen mit text-2xl/p-6, teils mit und
 * teils ohne Untertitel. Das war der Hauptgrund, warum das Dashboard
 * zusammengewuerfelt statt wie ein Produkt wirkte.
 *
 * `actions` nimmt Buttons/Dialoge rechts im Kopf auf; auf schmalen Screens
 * rutschen sie unter die Ueberschrift statt sie zu zerquetschen.
 */
export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="border-b border-border px-5 py-5 sm:px-8 sm:py-6 space-y-4 shrink-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            {Icon && <Icon className="w-5 h-5 text-muted-foreground shrink-0" />}
            <h1 className="text-xl sm:text-[26px] font-semibold tracking-tight truncate">{title}</h1>
          </div>
          {subtitle && (
            <p className="text-muted-foreground text-sm mt-1.5 text-pretty leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
