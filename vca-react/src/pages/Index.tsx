import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { MetricCard } from "@/components/ui/metric-card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { DashboardSkeleton, StatusWrapper } from "@/components/ui/status-wrapper";
import { ClaimsTrendChart } from "@/components/dashboard/ClaimsTrendChart";
import { RecentClaimsTable } from "@/components/dashboard/RecentClaimsTable";
import { FraudAlerts } from "@/components/dashboard/FraudAlerts";
import { getFnolList, getFraudClaims, type FnolResponse, type FraudClaimItem } from "@/lib/api";
import {
  isClaimAutoApprovedStatus,
  isClaimPendingReviewStatus,
  isClaimRejectedStatus,
  normalizeClaimStatus,
} from "@/lib/claimStatus";
import { getApiErrorSummary } from "@/lib/httpClient";
import { formatCurrency } from "@/lib/market";
import {
  AlertCircle,
  FileText,
  Clock,
  CheckCircle2,
  AlertTriangle,
  DollarSign,
} from "lucide-react";

function fnolToDisplayRow(fnol: FnolResponse) {
  const r = fnol.raw_response;
  const vehicle = r?.vehicle
    ? `${r.vehicle.year} ${r.vehicle.make} ${r.vehicle.model}`
    : fnol.vehicle_make && fnol.vehicle_model && fnol.vehicle_year
      ? `${fnol.vehicle_year} ${fnol.vehicle_make} ${fnol.vehicle_model}`
      : "—";
  const statusKey = normalizeClaimStatus((fnol as { status?: string }).status);
  const amount = fnol.claim_amount ?? fnol.estimated_amount ?? 0;
  return {
    id: fnol.complaint_id,
    claimNumber: r?.claim_id || fnol.complaint_id || `FNOL-${fnol.id}`,
    customerName: r?.claimant?.driver_name || fnol.policy_holder_name || "—",
    vehicleInfo: vehicle,
    claimType: r?.incident?.claim_type || fnol.incident_type || "—",
    estimatedAmount: typeof amount === "number" ? amount : 0,
    statusKey,
    aiConfidence: 0,
  };
}

const Index = () => {
  const [claims, setClaims] = useState<FnolResponse[]>([]);
  const [fraudClaims, setFraudClaims] = useState<FraudClaimItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimsError, setClaimsError] = useState<unknown>(null);
  const [fraudClaimsError, setFraudClaimsError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setClaimsError(null);
    setFraudClaimsError(null);
    Promise.allSettled([getFnolList(), getFraudClaims()])
      .then(([fnolResult, fraudResult]) => {
        if (cancelled) {
          return;
        }

        if (fnolResult.status === "fulfilled") {
          setClaims(fnolResult.value || []);
        } else {
          setClaims([]);
          setClaimsError(fnolResult.reason);
        }

        if (fraudResult.status === "fulfilled") {
          setFraudClaims(fraudResult.value || []);
        } else {
          setFraudClaims([]);
          setFraudClaimsError(fraudResult.reason);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const claimsErrorSummary = claimsError ? getApiErrorSummary(claimsError) : null;
  const fraudClaimsErrorSummary = fraudClaimsError
    ? getApiErrorSummary(fraudClaimsError)
    : null;

  const displayClaims = useMemo(() => claims.map(fnolToDisplayRow), [claims]);

  const stats = useMemo(() => {
    const total = claims.length;
    const pendingReview = displayClaims.filter((c) =>
      isClaimPendingReviewStatus(c.statusKey)
    ).length;
    const autoApproved = displayClaims.filter((c) =>
      isClaimAutoApprovedStatus(c.statusKey)
    ).length;
    const businessValidationFailed = displayClaims.filter((c) =>
      isClaimRejectedStatus(c.statusKey)
    ).length;
    const settlementValue = claims.reduce(
      (sum, c) => sum + (typeof c.claim_amount === "number" ? c.claim_amount : c.estimated_amount ?? 0),
      0
    );
    return {
      totalClaims: total,
      pendingReview,
      approvedToday: autoApproved,
      businessValidationFailed,
      settlementValue,
    };
  }, [claims, displayClaims]);

  const trendData = useMemo(() => {
    const byDate: Record<string, { total: number; approved: number }> = {};
    claims.forEach((c) => {
      const raw = c.created_date || c.incident_date_time;
      const dateStr = raw ? new Date(raw).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : "Unknown";
      if (!byDate[dateStr]) byDate[dateStr] = { total: 0, approved: 0 };
      byDate[dateStr].total += 1;
      if (
        isClaimAutoApprovedStatus(
          normalizeClaimStatus((c as { status?: string }).status)
        )
      ) {
        byDate[dateStr].approved += 1;
      }
    });
    return Object.entries(byDate)
      .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
      .slice(-10)
      .map(([date, v]) => ({ date, claims: v.total, approved: v.approved }));
  }, [claims]);

  const recentClaims = useMemo(() => displayClaims.slice(0, 5), [displayClaims]);

  const validationAlerts = useMemo(
    () => fraudClaims.filter((c) => c.status === "under_review" || c.status === "confirmed").slice(0, 5),
    [fraudClaims]
  );

  return (
    <AppLayout
      title="Dashboard"
      subtitle="Claims processing overview and analytics"
    >
      <StatusWrapper
        status={
          loading ? "loading" : claimsErrorSummary ? "error" : "success"
        }
        loading={<DashboardSkeleton />}
        loadingTitle="Loading dashboard"
        loadingDescription="Pulling live claim totals, recent claims, and validation alerts from the backend."
        errorTitle="Could not load dashboard"
        error={claimsErrorSummary}
        onRetry={() => setReloadToken((value) => value + 1)}
      >
      <div className="space-y-6 animate-fade-in">
        {fraudClaimsErrorSummary ? (
          <Alert className="border-warning/30 bg-warning/5">
            <AlertCircle className="h-4 w-4 text-warning" />
            <AlertTitle>Validation alerts are temporarily unavailable</AlertTitle>
            <AlertDescription>
              The core dashboard loaded, but the validation-alert feed could not be refreshed.
            </AlertDescription>
            <Accordion type="single" collapsible className="mt-2 rounded-md border bg-background/80 px-3">
              <AccordionItem value="fraud-feed" className="border-0">
                <AccordionTrigger className="py-2 text-sm font-medium hover:no-underline">
                  Show developer details
                </AccordionTrigger>
                <AccordionContent className="pb-2 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Developer details</p>
                  <p className="mt-2 break-words">
                    {fraudClaimsErrorSummary.developerMessage ||
                      "No additional diagnostics were provided."}
                  </p>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </Alert>
        ) : null}

        {/* Metrics Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <MetricCard
            title="Total Claims"
            value={stats.totalClaims.toLocaleString()}
            subtitle="All time"
            icon={FileText}
            variant="default"
          />
          <MetricCard
            title="Pending Review"
            value={String(stats.pendingReview)}
            subtitle="Requires attention"
            icon={Clock}
            variant="warning"
          />
          <MetricCard
            title="Approved"
            value={String(stats.approvedToday)}
            subtitle="Recommendation shared"
            icon={CheckCircle2}
            variant="success"
          />
          <MetricCard
            title="Business Validation Failed"
            value={String(stats.businessValidationFailed)}
            subtitle="Validation alerts"
            icon={AlertTriangle}
            variant="destructive"
          />
          <MetricCard
            title="Settlement Value"
            value={formatCurrency(stats.settlementValue)}
            subtitle="Total claim amount"
            icon={DollarSign}
            variant="info"
          />
        </div>

        {/* Charts Row */}
        <div className="grid gap-6">
          <div className="lg:col-span-2">
            <ClaimsTrendChart data={trendData} />
          </div>
        </div>

        {/* Bottom Section */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RecentClaimsTable claims={recentClaims} />
          </div>
          <div className="space-y-6">
            <FraudAlerts alerts={validationAlerts} />
          </div>
        </div>
      </div>
      </StatusWrapper>
    </AppLayout>
  );
};

export default Index;
