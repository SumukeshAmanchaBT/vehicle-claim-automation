import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Claims from "./pages/Claims";
import ClaimDetail from "./pages/ClaimDetail";
import ClaimIntake from "./pages/ClaimIntake";
import Users from "./pages/Users";
import MasterData from "./pages/MasterData";
import Reports from "./pages/Reports";
import Fraud from "./pages/Fraud";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/claims" element={<Claims />} />
          <Route path="/claims/new" element={<ClaimIntake />} />
          <Route path="/claims/:id" element={<ClaimDetail />} />
          <Route path="/users" element={<Users />} />
          <Route path="/master-data" element={<MasterData />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/fraud" element={<Fraud />} />
          <Route path="/settings" element={<Settings />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
