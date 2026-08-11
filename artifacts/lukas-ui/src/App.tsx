import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { AuthGate } from "@/components/auth-gate";
import NotFound from "@/pages/not-found";

import Dashboard from "@/pages/dashboard";
import Chat from "@/pages/chat";
import Memory from "@/pages/memory";
import Goals from "@/pages/goals";
import Diary from "@/pages/diary";
import Studio from "@/pages/studio";
import Diagnostics from "@/pages/diagnostics";
import Approvals from "@/pages/approvals";
import Proposals from "@/pages/proposals";
import Mcp from "@/pages/mcp";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/chat" component={Chat} />
        <Route path="/memory" component={Memory} />
        <Route path="/goals" component={Goals} />
        <Route path="/diary" component={Diary} />
        <Route path="/studio" component={Studio} />
        <Route path="/approvals" component={Approvals} />
        <Route path="/proposals" component={Proposals} />
        <Route path="/mcp" component={Mcp} />
        <Route path="/diagnostics" component={Diagnostics} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <AuthGate>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </AuthGate>
  );
}

export default App;
