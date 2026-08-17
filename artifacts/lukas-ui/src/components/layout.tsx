import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useHealthCheck } from "@workspace/api-client-react";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Activity,
  Brain,
  Target,
  BookOpen,
  MessageSquare,
  Film,
  LogOut,
  AlertTriangle,
  ShieldCheck,
  Lightbulb,
  Plug,
  Inbox,
  Network,
  Menu,
  X
} from "lucide-react";

function handleLogout() {
  localStorage.removeItem("lukas_token");
  window.location.reload();
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: health } = useHealthCheck();
  const isMobile = useIsMobile();
  const [navOpen, setNavOpen] = useState(false);

  // Beim Wechseln der Seite (oder Wechsel Mobil/Desktop) die Drawer schliessen.
  useEffect(() => {
    setNavOpen(false);
  }, [location, isMobile]);

  const navItems = [
    { href: "/", label: "Übersicht", icon: Activity },
    { href: "/chat", label: "Chat", icon: MessageSquare },
    { href: "/studio", label: "Studio", icon: Film },
    { href: "/memory", label: "Gedächtnis", icon: Brain },
    { href: "/gehirn", label: "Gehirn", icon: Network },
    { href: "/goals", label: "Ziele", icon: Target },
    { href: "/diary", label: "Tagebuch", icon: BookOpen },
    { href: "/meldungen", label: "Meldungen", icon: Inbox },
    { href: "/proposals", label: "Vorschläge", icon: Lightbulb },
    { href: "/approvals", label: "Freigaben", icon: ShieldCheck },
    { href: "/mcp", label: "MCP", icon: Plug },
    { href: "/diagnostics", label: "Diagnose", icon: AlertTriangle },
  ];

  const sidebarContent = (
    <>
      <div className="h-16 px-5 border-b border-border flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
          <span className="text-sm font-semibold text-primary">L</span>
        </div>
        <div className="flex flex-col min-w-0">
          <span className="font-semibold tracking-tight leading-tight">Lukas</span>
          <span className="text-xs text-muted-foreground flex items-center gap-1.5 leading-tight">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${health?.status === 'ok' ? 'bg-emerald-400' : 'bg-red-400'}`} />
            {health?.status === 'ok' ? 'online' : 'offline'}
          </span>
        </div>
        {isMobile && (
          <button
            onClick={() => setNavOpen(false)}
            className="ml-auto text-muted-foreground hover:text-foreground"
            aria-label="Menü schliessen"
            data-testid="button-close-nav"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              /*
               * Der aktive Eintrag ist jetzt an einem farbigen Balken links zu
               * erkennen, nicht nur an einem grauen Kasten — und das Icon
               * nimmt die Akzentfarbe an. Ohne Farbe sah die Navigation aus
               * wie eine Dateiliste.
               */
              className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${
                isActive
                  ? "bg-primary/10 text-foreground font-medium"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              }`}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-primary" />
              )}
              <item.icon
                className={`w-4 h-4 shrink-0 transition-colors ${isActive ? "text-primary" : ""}`}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm w-full text-muted-foreground hover:bg-secondary hover:text-secondary-foreground transition-colors duration-200"
          data-testid="button-logout"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          Abmelden
        </button>
      </div>
    </>
  );

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden font-sans">
      {isMobile ? (
        <>
          {/* Mobile: schmale Top-Bar mit Menü-Button statt fixer Sidebar */}
          <div className="fixed inset-x-0 top-0 z-30 h-14 border-b border-border bg-card flex items-center gap-3 px-4">
            <button
              onClick={() => setNavOpen(true)}
              className="text-foreground"
              aria-label="Menü öffnen"
              data-testid="button-open-nav"
            >
              <Menu className="w-6 h-6" />
            </button>
            <span className="font-semibold tracking-tight">Lukas</span>
            <span className={`inline-block w-1.5 h-1.5 rounded-full ml-auto ${health?.status === 'ok' ? 'bg-emerald-400' : 'bg-red-400'}`} />
          </div>

          {navOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/60"
              onClick={() => setNavOpen(false)}
              data-testid="overlay-nav-backdrop"
            />
          )}
          <aside
            className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r border-border bg-card flex flex-col transition-transform duration-200 ${
              navOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            {sidebarContent}
          </aside>

          <main className="flex-1 min-w-0 flex flex-col h-full overflow-hidden relative pt-14">
            <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">{children}</div>
          </main>
        </>
      ) : (
        <>
          <aside className="w-64 flex-shrink-0 border-r border-border bg-card flex flex-col">
            {sidebarContent}
          </aside>

          <main className="flex-1 min-w-0 flex flex-col h-full overflow-hidden relative">
            <div className="flex-1 min-w-0 overflow-y-auto">{children}</div>
          </main>
        </>
      )}
    </div>
  );
}
