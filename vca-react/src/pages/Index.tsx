import { AppLayout } from "@/components/layout/AppLayout";
import { MetricCard } from "@/components/ui/metric-card";
import { ClaimsTrendChart } from "@/components/dashboard/ClaimsTrendChart";
import { ClaimsByTypeChart } from "@/components/dashboard/ClaimsByTypeChart";
import { RecentClaimsTable } from "@/components/dashboard/RecentClaimsTable";
import { FraudAlerts } from "@/components/dashboard/FraudAlerts";
import { AutomationStats } from "@/components/dashboard/AutomationStats";
import { mockDashboardStats } from "@/lib/mock-data";
import {
  FileText,
  Clock,
  CheckCircle2,
  AlertTriangle,
  DollarSign,
} from "lucide-react";

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const Index = () => {
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
            value={mockDashboardStats.totalClaims.toLocaleString()}
            subtitle="All time"
            icon={FileText}
            trend={{ value: 12, label: "vs last month" }}
            variant="default"
          />
          <MetricCard
            title="Pending Review"
            value={mockDashboardStats.pendingReview}
            subtitle="Requires attention"
            icon={Clock}
            variant="warning"
          />
          <MetricCard
            title="Approved Today"
            value={mockDashboardStats.approvedToday}
            subtitle="Auto + Manual"
            icon={CheckCircle2}
            trend={{ value: 8, label: "vs yesterday" }}
            variant="success"
          />
          <MetricCard
            title="Fraud Flagged"
            value={mockDashboardStats.fraudFlagged}
            subtitle="High risk alerts"
            icon={AlertTriangle}
            variant="destructive"
          />
          <MetricCard
            title="Settlement Value"
            value={formatCurrency(mockDashboardStats.totalSettlementValue)}
            subtitle="This month"
            icon={DollarSign}
            trend={{ value: 15, label: "vs last month" }}
            variant="info"
          />
        </div>

        {/* Charts Row */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ClaimsTrendChart />
          </div>
          <ClaimsByTypeChart />
        </div>

        {/* Bottom Section */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RecentClaimsTable />
          </div>
          <div className="space-y-6">
            <AutomationStats />
            <FraudAlerts />
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Index;
