import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Progress } from "@/components/ui/progress";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ShieldAlert,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
  Loader2,
} from "lucide-react";
import { getFraudClaims, type FraudClaimItem } from "@/lib/api";

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  }).format(amount);
};

const getStatusInfo = (status: string) => {
  const map = {
    under_review: { label: "Under Review", variant: "pending" as const, icon: Clock },
    cleared: { label: "Cleared", variant: "approved" as const, icon: CheckCircle2 },
    confirmed: { label: "Fraud Confirmed", variant: "rejected" as const, icon: XCircle },
  };
  return map[status as keyof typeof map] || map.under_review;
};

export default function Fraud() {
  const [fraudCases, setFraudCases] = useState<FraudClaimItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getFraudClaims()
      .then((data) => {
        if (!cancelled) setFraudCases(data || []);
      })
      .catch(() => {
        if (!cancelled) setFraudCases([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const underReview = fraudCases.filter((c) => c.status === "under_review").length;
  const confirmed = fraudCases.filter((c) => c.status === "confirmed").length;
  const cleared = fraudCases.filter((c) => c.status === "cleared").length;
  const detectionRate = fraudCases.length > 0
    ? Math.round((confirmed / fraudCases.length) * 100)
    : 0;

  return (
    <AppLayout
      title="Fraud Detection"
      subtitle="AI-powered fraud risk analysis and investigation"
    >
      <div className="space-y-6 animate-fade-in">
        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="card-elevated border-l-4 border-l-warning">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/10">
                  <Clock className="h-5 w-5 text-warning" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Under Review</p>
                  <p className="text-2xl font-bold">{underReview}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="card-elevated border-l-4 border-l-destructive">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10">
                  <ShieldAlert className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Confirmed Fraud</p>
                  <p className="text-2xl font-bold">{confirmed}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="card-elevated border-l-4 border-l-success">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
                  <CheckCircle2 className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Cleared</p>
                  <p className="text-2xl font-bold">{cleared}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="card-elevated border-l-4 border-l-primary">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <TrendingUp className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Detection Rate</p>
                  <p className="text-2xl font-bold">{detectionRate}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Fraud Cases Table */}
        <Card className="card-elevated overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Flagged Claims
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="mt-4 text-sm text-muted-foreground">Loading fraud claims...</p>
              </div>
            ) : fraudCases.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                No fraud detection results yet. Run Fraud Detection on claims to see them here.
              </div>
            ) : (
            <Table>
              <TableHeader className="table-header-bg">
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="pl-6">Claim #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Risk Score</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Indicators</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-6 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fraudCases.map((fraudCase) => {
                  const statusInfo = getStatusInfo(fraudCase.status);
                  const StatusIcon = statusInfo.icon;
                  return (
                    <TableRow key={fraudCase.complaint_id} className="group">
                      <TableCell className="pl-6">
                        <Link
                          to={`/claims/${fraudCase.complaint_id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {fraudCase.claimNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="font-medium">
                        {fraudCase.customer}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3 w-32">
                          <Progress
                            value={fraudCase.riskScore}
                            className={`h-2 ${
                              fraudCase.riskScore >= 70
                                ? "[&>div]:bg-destructive"
                                : fraudCase.riskScore >= 50
                                ? "[&>div]:bg-warning"
                                : "[&>div]:bg-success"
                            }`}
                          />
                          <span
                            className={`text-sm font-medium ${
                              fraudCase.riskScore >= 70
                                ? "text-destructive"
                                : fraudCase.riskScore >= 50
                                ? "text-warning"
                                : "text-success"
                            }`}
                          >
                            {fraudCase.riskScore}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        <p className="text-sm text-muted-foreground truncate">
                          {fraudCase.reason}
                        </p>
                      </TableCell>
                      <TableCell className="font-medium">
                        {formatCurrency(fraudCase.amount)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {fraudCase.indicators.slice(0, 2).map((indicator) => (
                            <span
                              key={indicator}
                              className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive"
                            >
                              {indicator}
                            </span>
                          ))}
                          {fraudCase.indicators.length > 2 && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              +{fraudCase.indicators.length - 2}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={statusInfo.variant}>
                          <StatusIcon className="h-3 w-3 mr-1" />
                          {statusInfo.label}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          asChild
                        >
                          <Link to={`/claims/${fraudCase.complaint_id}`}>
                            <Eye className="h-4 w-4 mr-1" />
                            Review
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}