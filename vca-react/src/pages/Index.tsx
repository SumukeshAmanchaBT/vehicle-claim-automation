import { useState, useEffect, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { MetricCard } from "@/components/ui/metric-card";
import { ClaimsTrendChart } from "@/components/dashboard/ClaimsTrendChart";
import { ClaimsByTypeChart } from "@/components/dashboard/ClaimsByTypeChart";
import { RecentClaimsTable } from "@/components/dashboard/RecentClaimsTable";
import { FraudAlerts } from "@/components/dashboard/FraudAlerts";
import { AutomationStats } from "@/components/dashboard/AutomationStats";
import { getFnolList, getFraudClaims, type FnolResponse, type FraudClaimItem } from "@/lib/api";
import {
  FileText,
  Clock,
  CheckCircle2,
  AlertTriangle,
  DollarSign,
  Loader2,
} from "lucide-react";

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

type StatusKey =
  | "auto_approved"
  | "fraudulent"
  | "manual_review"
  | "open"
  | "pending"
  | "pending_damage_detection";

function normalizeStatus(raw?: string | null): StatusKey {
  const value = (raw || "").trim().toLowerCase();
  if (value === "recommendation shared" || value === "closed damage detection") return "auto_approved";
  if (value === "business rule validation-fail" || value === "fraudulent") return "fraudulent";
  if (value === "manual review" || value === "manual_review") return "manual_review";
  if (value === "fnol" || value === "open" || value === "open-fnol" || value === "open to fnol") return "open";
  if (value === "business rule validation-pass" || value === "pending damage detection" || value === "pending_damage_detection") return "pending_damage_detection";
  return "pending";
}

function fnolToDisplayRow(fnol: FnolResponse) {
  const r = fnol.raw_response;
  const vehicle = r?.vehicle
    ? `${r.vehicle.year} ${r.vehicle.make} ${r.vehicle.model}`
    : fnol.vehicle_make && fnol.vehicle_model && fnol.vehicle_year
      ? `${fnol.vehicle_year} ${fnol.vehicle_make} ${fnol.vehicle_model}`
      : "—";
  const statusKey = normalizeStatus((fnol as { status?: string }).status);
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getFnolList(), getFraudClaims()])
      .then(([fnolData, fraudData]) => {
        if (!cancelled) {
          setClaims(fnolData || []);
          setFraudClaims(fraudData || []);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load dashboard");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const displayClaims = useMemo(() => claims.map(fnolToDisplayRow), [claims]);

  const stats = useMemo(() => {
    const total = claims.length;
    const pendingReview = displayClaims.filter(
      (c) => c.statusKey === "open" || c.statusKey === "pending_damage_detection" || c.statusKey === "pending"
    ).length;
    const autoApproved = displayClaims.filter((c) => c.statusKey === "auto_approved").length;
    const businessValidationFailed = displayClaims.filter((c) => c.statusKey === "fraudulent").length;
    const settlementValue = claims.reduce(
      (sum, c) => sum + (typeof c.claim_amount === "number" ? c.claim_amount : c.estimated_amount ?? 0),
      0
    );
    const stpRate = total > 0 ? Math.round((autoApproved / total) * 100) : 0;
    const automationRate = total > 0 ? Math.round(((autoApproved + pendingReview) / total) * 100) : 0;
    return {
      totalClaims: total,
      pendingReview,
      approvedToday: autoApproved,
      businessValidationFailed,
      settlementValue,
      stpRate,
      automationRate,
    };
  }, [claims, displayClaims]);

  const trendData = useMemo(() => {
    const byDate: Record<string, { total: number; approved: number }> = {};
    claims.forEach((c) => {
      const raw = c.created_date || c.incident_date_time;
      const dateStr = raw ? new Date(raw).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : "Unknown";
      if (!byDate[dateStr]) byDate[dateStr] = { total: 0, approved: 0 };
      byDate[dateStr].total += 1;
      if (normalizeStatus((c as { status?: string }).status) === "auto_approved") byDate[dateStr].approved += 1;
    });
    return Object.entries(byDate)
      .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
      .slice(-10)
      .map(([date, v]) => ({ date, claims: v.total, approved: v.approved }));
  }, [claims]);

  const byTypeData = useMemo(() => {
    const map: Record<string, number> = {};
    displayClaims.forEach((c) => {
      const t = c.claimType || "Other";
      map[t] = (map[t] || 0) + 1;
    });
    const total = displayClaims.length;
    return Object.entries(map).map(([type, count]) => ({
      type,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
    }));
  }, [displayClaims]);

  const recentClaims = useMemo(() => displayClaims.slice(0, 5), [displayClaims]);

  const validationAlerts = useMemo(
    () => fraudClaims.filter((c) => c.status === "under_review" || c.status === "confirmed").slice(0, 5),
    [fraudClaims]
  );

  if (loading) {
    return (
      <AppLayout title="Dashboard" subtitle="Claims processing overview and analytics">
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="mt-4 text-sm text-muted-foreground">Loading dashboard...</p>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout title="Dashboard" subtitle="Claims processing overview and analytics">
        <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title="Dashboard"
      subtitle="Claims processing overview and analytics"
    >
      <div className="space-y-6 animate-fade-in">
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
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ClaimsTrendChart data={trendData} />
          </div>
          <ClaimsByTypeChart data={byTypeData} />
        </div>

        {/* Bottom Section */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RecentClaimsTable claims={recentClaims} />
          </div>
          <div className="space-y-6">
            {/* <AutomationStats stpRate={stats.stpRate} automationRate={stats.automationRate} /> */}
            <FraudAlerts alerts={validationAlerts} />
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Index;
