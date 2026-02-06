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
} from "lucide-react";

const fraudCases = [
  {
    id: "1",
    claimNumber: "CLM-2024-0891",
    customer: "Michael Chen",
    riskScore: 78,
    reason: "Early claim filing (<30 days from policy start)",
    amount: 28000,
    status: "under_review",
    detectedAt: "2024-02-01T14:30:00",
    indicators: ["Early claim", "High value", "Theft claim"],
  },
  {
    id: "2",
    claimNumber: "CLM-2024-0888",
    customer: "Jessica Williams",
    riskScore: 65,
    reason: "Location mismatch detected",
    amount: 3200,
    status: "under_review",
    detectedAt: "2024-01-28T09:15:00",
    indicators: ["Location mismatch", "Unusual timing"],
  },
  {
    id: "3",
    claimNumber: "CLM-2024-0875",
    customer: "David Lee",
    riskScore: 58,
    reason: "Repeat repair shop usage pattern",
    amount: 4500,
    status: "cleared",
    detectedAt: "2024-01-25T11:45:00",
    indicators: ["Repeat shop"],
  },
  {
    id: "4",
    claimNumber: "CLM-2024-0862",
    customer: "Sarah Johnson",
    riskScore: 82,
    reason: "Multiple indicators triggered",
    amount: 15000,
    status: "confirmed",
    detectedAt: "2024-01-22T08:30:00",
    indicators: ["Blacklisted", "Document tampering", "Early claim"],
  },
  {
    id: "5",
    claimNumber: "CLM-2024-0850",
    customer: "Robert Martinez",
    riskScore: 45,
    reason: "Unusual claim pattern",
    amount: 2100,
    status: "cleared",
    detectedAt: "2024-01-20T16:20:00",
    indicators: ["Pattern anomaly"],
  },
];

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
  const underReview = fraudCases.filter((c) => c.status === "under_review").length;
  const confirmed = fraudCases.filter((c) => c.status === "confirmed").length;
  const cleared = fraudCases.filter((c) => c.status === "cleared").length;

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
                  <p className="text-2xl font-bold">94%</p>
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
            <Table>
              <TableHeader>
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
                    <TableRow key={fraudCase.id} className="group">
                      <TableCell className="pl-6">
                        <Link
                          to={`/claims/${fraudCase.id}`}
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
                          <Link to={`/claims/${fraudCase.id}`}>
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
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}