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
import Roles from "./pages/Roles";
import RolePermissions from "./pages/RolePermissions";
import MasterData from "./pages/MasterData";
import Reports from "./pages/Reports";
import Fraud from "./pages/Fraud";
import DamageDetection from "./pages/DamageDetection";
import Settings from "./pages/Settings";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ChangePassword from "./pages/ChangePassword";
import NotFound from "./pages/NotFound";
import { AuthProvider } from "./contexts/AuthContext";
import { RequireAuth } from "./components/auth/RequireAuth";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public auth routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/change-password" element={<ChangePassword />} />

            {/* Protected application routes */}
            <Route
              path="/"
              element={
                <RequireAuth>
                  <Index />
                </RequireAuth>
              }
            />
            <Route
              path="/claims"
              element={
                <RequireAuth>
                  <Claims />
                </RequireAuth>
              }
            />
            <Route
              path="/claims/new"
              element={
                <RequireAuth>
                  <ClaimIntake />
                </RequireAuth>
              }
            />
            <Route
              path="/claims/:id"
              element={
                <RequireAuth>
                  <ClaimDetail />
                </RequireAuth>
              }
            />
            <Route
              path="/users"
              element={
                <RequireAuth>
                  <Users />
                </RequireAuth>
              }
            />
            <Route
              path="/roles"
              element={
                <RequireAuth>
                  <Roles />
                </RequireAuth>
              }
            />
            <Route
              path="/roles/permissions"
              element={
                <RequireAuth>
                  <RolePermissions />
                </RequireAuth>
              }
            />
            <Route
              path="/master-data"
              element={
                <RequireAuth>
                  <MasterData />
                </RequireAuth>
              }
            />
            <Route
              path="/reports"
              element={
                <RequireAuth>
                  <Reports />
                </RequireAuth>
              }
            />
            <Route
              path="/fraud"
              element={
                <RequireAuth>
                  <Fraud />
                </RequireAuth>
              }
            />
            <Route
              path="/damage-detection"
              element={
                <RequireAuth>
                  <DamageDetection />
                </RequireAuth>
              }
            />
            <Route
              path="/settings"
              element={
                <RequireAuth>
                  <Settings />
                </RequireAuth>
              }
            />

            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
