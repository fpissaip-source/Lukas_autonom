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
  TerminalSquare,
  LogOut,
  AlertTriangle,
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
    { href: "/", label: "Dashboard", icon: Activity },
    { href: "/chat", label: "Comm Link", icon: MessageSquare },
    { href: "/studio", label: "Studio", icon: Film },
    { href: "/memory", label: "Memory Bank", icon: Brain },
    { href: "/goals", label: "Directives", icon: Target },
    { href: "/diary", label: "Logs", icon: BookOpen },
    { href: "/diagnostics", label: "Diagnose", icon: AlertTriangle },
  ];

  const sidebarContent = (
    <>
      <div className="p-6 border-b border-border flex items-center gap-3">
        <TerminalSquare className="w-6 h-6 text-primary shrink-0" />
        <div className="flex flex-col min-w-0">
          <span className="font-mono font-bold tracking-tight">LUKAS</span>
          <span className="text-xs text-muted-foreground flex items-center gap-2">
            SYS.STATUS:
            <span className={`inline-block w-2 h-2 rounded-full ${health?.status === 'ok' ? 'bg-green-500' : 'bg-red-500'} animate-pulse`} />
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

      <nav className="flex-1 overflow-y-auto p-4 space-y-1">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors duration-200 ${
                isActive
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
              }`}
            >
              <item.icon className="w-4 h-4 shrink-0" />
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
            <span className="font-mono font-bold tracking-tight">LUKAS</span>
            <span className={`inline-block w-2 h-2 rounded-full ml-auto ${health?.status === 'ok' ? 'bg-green-500' : 'bg-red-500'} animate-pulse`} />
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
            <div className="absolute inset-0 pointer-events-none opacity-[0.02] bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjZmZmIiAvPgo8cmVjdCB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSIjMDAwIiAvPgo8L3N2Zz4=')]"></div>
            <div className="flex-1 min-w-0 overflow-y-auto">{children}</div>
          </main>
        </>
      )}
    </div>
  );
}
