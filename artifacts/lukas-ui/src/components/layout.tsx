import { Link, useLocation } from "wouter";
import { useHealthCheck } from "@workspace/api-client-react";
import {
  Activity,
  Brain,
  Target,
  BookOpen,
  MessageSquare,
  Film,
  TerminalSquare,
  LogOut,
  AlertTriangle
} from "lucide-react";

function handleLogout() {
  localStorage.removeItem("lukas_token");
  window.location.reload();
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: health } = useHealthCheck();
  
  const navItems = [
    { href: "/", label: "Dashboard", icon: Activity },
    { href: "/chat", label: "Comm Link", icon: MessageSquare },
    { href: "/studio", label: "Studio", icon: Film },
    { href: "/memory", label: "Memory Bank", icon: Brain },
    { href: "/goals", label: "Directives", icon: Target },
    { href: "/diary", label: "Logs", icon: BookOpen },
    { href: "/diagnostics", label: "Diagnose", icon: AlertTriangle },
  ];

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-border bg-card flex flex-col">
        <div className="p-6 border-b border-border flex items-center gap-3">
          <TerminalSquare className="w-6 h-6 text-primary" />
          <div className="flex flex-col">
            <span className="font-mono font-bold tracking-tight">LUKAS</span>
            <span className="text-xs text-muted-foreground flex items-center gap-2">
              SYS.STATUS: 
              <span className={`inline-block w-2 h-2 rounded-full ${health?.status === 'ok' ? 'bg-green-500' : 'bg-red-500'} animate-pulse`} />
            </span>
          </div>
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
                <item.icon className="w-4 h-4" />
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
            <LogOut className="w-4 h-4" />
            Abmelden
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <div className="absolute inset-0 pointer-events-none opacity-[0.02] bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjZmZmIiAvPgo8cmVjdCB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSIjMDAwIiAvPgo8L3N2Zz4=')]"></div>
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
