import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { RequireAuth } from "./components/auth/RequireAuth";

const Index = lazy(() => import("./pages/Index"));
const Claims = lazy(() => import("./pages/Claims"));
const ClaimDetail = lazy(() => import("./pages/ClaimDetail"));
const ClaimIntake = lazy(() => import("./pages/ClaimIntake"));
const Users = lazy(() => import("./pages/Users"));
const Roles = lazy(() => import("./pages/Roles"));
const RolePermissions = lazy(() => import("./pages/RolePermissions"));
const MasterData = lazy(() => import("./pages/MasterData"));
const Reports = lazy(() => import("./pages/Reports"));
const Fraud = lazy(() => import("./pages/Fraud"));
const Settings = lazy(() => import("./pages/Settings"));
const Login = lazy(() => import("./pages/Login"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ChangePassword = lazy(() => import("./pages/ChangePassword"));
const NotFound = lazy(() => import("./pages/NotFound"));
const ClaimDigitization = lazy(() => import("./pages/ClaimDigitization"));
const InvoiceHistory = lazy(() => import("./pages/InvoiceHistory"));
const InvoiceEdit = lazy(() => import("./pages/InvoiceEdit"));
const InvoiceView = lazy(() => import("./pages/InvoiceView"));
const InvoiceFilesSummary = lazy(() => import("./pages/InvoiceFilesSummary"));

const queryClient = new QueryClient();

function RouteFallback() {
  return (
    <div
      className="flex min-h-[40vh] w-full items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
        aria-hidden
      />
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <AuthProvider>
          <Suspense fallback={<RouteFallback />}>
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
                path="/claim-digitization"
                element={
                  <RequireAuth>
                    <ClaimDigitization />
                  </RequireAuth>
                }
              />
              <Route
                path="/invoice-history"
                element={
                  <RequireAuth>
                    <InvoiceHistory />
                  </RequireAuth>
                }
              />
              <Route
                path="/invoice-history/:claimNumber/edit"
                element={
                  <RequireAuth>
                    <InvoiceEdit />
                  </RequireAuth>
                }
              />
              <Route
                path="/invoice-history/:claimNumber/view"
                element={
                  <RequireAuth>
                    <InvoiceView />
                  </RequireAuth>
                }
              />
              <Route
                path="/invoice-files-summary"
                element={
                  <RequireAuth>
                    <InvoiceFilesSummary />
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
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
