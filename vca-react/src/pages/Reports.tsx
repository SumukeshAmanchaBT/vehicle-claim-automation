import { useState, useEffect, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
} from "recharts";
import { Download, Calendar, TrendingUp, DollarSign, Clock, Target, Loader2 } from "lucide-react";
import { getFnolList, type FnolResponse } from "@/lib/api";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type DateRangeKey = "7d" | "30d" | "3m" | "6m" | "1y";

function normalizeStatus(raw?: string | null): string {
  const value = (raw || "").trim().toLowerCase();
  if (value === "recommendation shared" || value === "closed damage detection") return "auto_approved";
  if (value === "business rule validation-fail" || value === "fraudulent") return "fraudulent";
  if (value === "business rule validation-pass" || value === "pending damage detection" || value === "pending_damage_detection") return "pending_damage_detection";
  if (value === "fnol" || value === "open" || value === "open to fnol" || value === "pending") return "open";
  return "open";
}

function getRangeStart(range: DateRangeKey): Date {
  const now = new Date();
  const d = new Date(now);
  if (range === "7d") d.setDate(d.getDate() - 7);
  else if (range === "30d") d.setDate(d.getDate() - 30);
  else if (range === "3m") d.setMonth(d.getMonth() - 3);
  else if (range === "6m") d.setMonth(d.getMonth() - 6);
  else if (range === "1y") d.setFullYear(d.getFullYear() - 1);
  return d;
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const processingTimePlaceholder = [
  { week: "W1", manual: 72, automated: 4 },
  { week: "W2", manual: 68, automated: 3.8 },
  { week: "W3", manual: 65, automated: 4.2 },
  { week: "W4", manual: 62, automated: 3.5 },
  { week: "W5", manual: 58, automated: 3.2 },
  { week: "W6", manual: 55, automated: 3.0 },
];

export default function Reports() {
  const [claims, setClaims] = useState<FnolResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRangeKey>("6m");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getFnolList()
      .then((data) => {
        if (!cancelled) setClaims(data || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load reports");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const rangeStart = useMemo(() => getRangeStart(dateRange), [dateRange]);

  const filteredClaims = useMemo(() => {
    return claims.filter((c) => {
      const raw = c.created_date || c.incident_date_time;
      if (!raw) return false;
      const d = new Date(raw);
      return d >= rangeStart;
    });
  }, [claims, rangeStart]);

  const stats = useMemo(() => {
    const total = filteredClaims.length;
    const autoApproved = filteredClaims.filter((c) => normalizeStatus(c.status) === "auto_approved").length;
    const rejected = filteredClaims.filter((c) => normalizeStatus(c.status) === "fraudulent").length;
    const settlementValue = filteredClaims.reduce(
      (sum, c) => sum + (typeof c.claim_amount === "number" ? c.claim_amount : c.estimated_amount ?? 0),
      0
    );
    const automationRate = total > 0 ? Math.round((autoApproved / total) * 100) : 0;
    return {
      totalClaims: total,
      automationRate,
      totalSettlements: settlementValue,
      approved: autoApproved,
      rejected,
    };
  }, [filteredClaims]);

  const monthlyData = useMemo(() => {
    const byMonth: Record<string, { claims: number; approved: number; rejected: number; settlements: number }> = {};
    filteredClaims.forEach((c) => {
      const raw = c.created_date || c.incident_date_time;
      const date = raw ? new Date(raw) : new Date();
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const monthLabel = MONTH_NAMES[date.getMonth()];
      if (!byMonth[key]) byMonth[key] = { claims: 0, approved: 0, rejected: 0, settlements: 0 };
      byMonth[key].claims += 1;
      const status = normalizeStatus(c.status);
      if (status === "auto_approved") byMonth[key].approved += 1;
      else if (status === "fraudulent") byMonth[key].rejected += 1;
      const amt = typeof c.claim_amount === "number" ? c.claim_amount : c.estimated_amount ?? 0;
      byMonth[key].settlements += amt;
    });
    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([key, v]) => ({
        month: MONTH_NAMES[parseInt(key.split("-")[1], 10) - 1] + " " + key.split("-")[0].slice(2),
        ...v,
      }));
  }, [filteredClaims]);

  const rangeLabel = useMemo(() => {
    const labels: Record<DateRangeKey, string> = {
      "7d": "Last 7 Days",
      "30d": "Last 30 Days",
      "3m": "Last 3 Months",
      "6m": "Last 6 Months",
      "1y": "Last Year",
    };
    return labels[dateRange];
  }, [dateRange]);

  const handleExport = () => {
    const csv = [
      ["Period", dateRange, rangeLabel].join(","),
      ["Total Claims", stats.totalClaims].join(","),
      ["Automation Rate (%)", stats.automationRate].join(","),
      ["Total Settlements (THB)", stats.totalSettlements].join(","),
      "",
      "Month,Claims,Approved,Rejected,Settlements",
      ...monthlyData.map((r) => [r.month, r.claims, r.approved, r.rejected, r.settlements].join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reports-${dateRange}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <AppLayout title="Reports & Analytics" subtitle="Claims performance metrics and insights">
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="mt-4 text-sm text-muted-foreground">Loading reports...</p>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout title="Reports & Analytics" subtitle="Claims performance metrics and insights">
        <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title="Reports & Analytics"
      subtitle="Claims performance metrics and insights"
    >
      <div className="space-y-6 animate-fade-in">
        {/* Filters */}
        <Card className="card-elevated">
          <CardContent className="p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRangeKey)}>
                  <SelectTrigger className="w-[180px]">
                    <Calendar className="mr-2 h-4 w-4" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7d">Last 7 Days</SelectItem>
                    <SelectItem value="30d">Last 30 Days</SelectItem>
                    <SelectItem value="3m">Last 3 Months</SelectItem>
                    <SelectItem value="6m">Last 6 Months</SelectItem>
                    <SelectItem value="1y">Last Year</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" onClick={handleExport}>
                <Download className="mr-2 h-4 w-4" />
                Export Report
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="card-elevated">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <TrendingUp className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Claims</p>
                  <p className="text-2xl font-bold">{stats.totalClaims.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{rangeLabel}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="card-elevated">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
                  <Target className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Automation Rate</p>
                  <p className="text-2xl font-bold">{stats.automationRate}%</p>
                  <p className="text-xs text-muted-foreground">Recommendation shared</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="card-elevated">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-info/10">
                  <Clock className="h-5 w-5 text-info" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Avg. Process Time</p>
                  <p className="text-2xl font-bold">4.2 hrs</p>
                  <p className="text-xs text-muted-foreground">Target: 24–48 hr settlement</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="card-elevated">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/10">
                  <DollarSign className="h-5 w-5 text-warning" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Settlements</p>
                  <p className="text-2xl font-bold">{formatCurrency(stats.totalSettlements)}</p>
                  <p className="text-xs text-muted-foreground">{rangeLabel}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="card-elevated">
            <CardHeader>
              <CardTitle className="text-base">Claims Volume</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgb(var(--border))"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: "rgb(var(--muted-foreground))", fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: "rgb(var(--muted-foreground))", fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "rgb(var(--card))",
                        border: `1px solid rgb(var(--border))`,
                        borderRadius: "8px",
                      }}
                    />
                    <Legend />
                    <Bar
                      dataKey="approved"
                      name="Approved"
                      fill="rgb(var(--chart-2))"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="rejected"
                      name="Business Validation Failed"
                      fill="rgb(var(--chart-5))"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="card-elevated">
            <CardHeader>
              <CardTitle className="text-base">Processing Time (Hours)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={processingTimePlaceholder}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgb(var(--border))"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="week"
                      tick={{ fill: "rgb(var(--muted-foreground))", fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: "rgb(var(--muted-foreground))", fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "rgb(var(--card))",
                        border: `1px solid rgb(var(--border))`,
                        borderRadius: "8px",
                      }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="manual"
                      name="Manual Processing"
                      stroke="rgb(var(--chart-3))"
                      strokeWidth={2}
                      dot={{ fill: "rgb(var(--chart-3))" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="automated"
                      name="Automated (STP)"
                      stroke="rgb(var(--chart-2))"
                      strokeWidth={2}
                      dot={{ fill: "rgb(var(--chart-2))" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Settlement Summary */}
        <Card className="card-elevated">
          <CardHeader>
            <CardTitle className="text-base">Monthly Settlement Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgb(var(--border))"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "rgb(var(--muted-foreground))", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "rgb(var(--muted-foreground))", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => `฿${(value / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgb(var(--card))",
                      border: `1px solid rgb(var(--border))`,
                      borderRadius: "8px",
                    }}
                    formatter={(value: number) => [formatCurrency(value), "Settlements"]}
                  />
                    <Bar
                      dataKey="settlements"
                      name="Settlement Amount"
                      fill="rgb(var(--chart-1))"
                      radius={[4, 4, 0, 0]}
                    />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}