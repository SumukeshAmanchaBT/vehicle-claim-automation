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
  Wrench,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
} from "lucide-react";

const damageCases = [
  {
    id: "1",
    claimNumber: "CLM-2024-0901",
    customer: "Michael Chen",
    damageScore: 92,
    severity: "Major front-end collision",
    amount: 28000,
    status: "estimation_pending",
    detectedAt: "2024-02-01T14:30:00",
    partsImpacted: ["Front bumper", "Hood", "Headlights"],
  },
  {
    id: "2",
    claimNumber: "CLM-2024-0898",
    customer: "Jessica Williams",
    damageScore: 68,
    severity: "Side panel and door damage",
    amount: 7800,
    status: "in_review",
    detectedAt: "2024-01-28T09:15:00",
    partsImpacted: ["Left doors", "Side panels"],
  },
  {
    id: "3",
    claimNumber: "CLM-2024-0890",
    customer: "David Lee",
    damageScore: 45,
    severity: "Minor bumper scratch",
    amount: 1200,
    status: "approved",
    detectedAt: "2024-01-25T11:45:00",
    partsImpacted: ["Rear bumper"],
  },
  {
    id: "4",
    claimNumber: "CLM-2024-0882",
    customer: "Sarah Johnson",
    damageScore: 81,
    severity: "Multi-panel damage",
    amount: 14500,
    status: "in_review",
    detectedAt: "2024-01-22T08:30:00",
    partsImpacted: ["Doors", "Quarter panel", "Rear bumper"],
  },
  {
    id: "5",
    claimNumber: "CLM-2024-0875",
    customer: "Robert Martinez",
    damageScore: 33,
    severity: "Cosmetic damage only",
    amount: 900,
    status: "approved",
    detectedAt: "2024-01-20T16:20:00",
    partsImpacted: ["Right fender"],
  },
];

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 0,
  }).format(amount);
};

const getStatusInfo = (status: string) => {
  const map = {
    estimation_pending: {
      label: "Estimation Pending",
      variant: "pending" as const,
      icon: Clock,
    },
    in_review: {
      label: "In Review",
      variant: "pending" as const,
      icon: AlertTriangle,
    },
    approved: {
      label: "Approved",
      variant: "approved" as const,
      icon: CheckCircle2,
    },
    rejected: {
      label: "Rejected",
      variant: "rejected" as const,
      icon: XCircle,
    },
  };
  return map[status as keyof typeof map] || map.estimation_pending;
};

export default function DamageDetection() {
  const pending = damageCases.filter((c) => c.status === "estimation_pending")
    .length;
  const inReview = damageCases.filter((c) => c.status === "in_review").length;
  const approved = damageCases.filter((c) => c.status === "approved").length;

  return (
    <AppLayout
      title="Damage Detection"
      subtitle="AI-powered vehicle damage analysis and repair estimation"
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
                  <p className="text-xs text-muted-foreground">
                    Estimation Pending
                  </p>
                  <p className="text-2xl font-bold">{pending}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="card-elevated border-l-4 border-l-primary">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <AlertTriangle className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">In Review</p>
                  <p className="text-2xl font-bold">{inReview}</p>
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
                  <p className="text-xs text-muted-foreground">Approved</p>
                  <p className="text-2xl font-bold">{approved}</p>
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
                  <p className="text-xs text-muted-foreground">
                    Auto-detection Coverage
                  </p>
                  <p className="text-2xl font-bold">89%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Damage Cases Table */}
        <Card className="card-elevated overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Wrench className="h-4 w-4 text-primary" />
              Detected Damage Assessments
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="table-header-bg">
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="pl-6">Claim #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Damage Score</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Estimated Amount</TableHead>
                  <TableHead>Parts Impacted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-6 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {damageCases.map((damageCase) => {
                  const statusInfo = getStatusInfo(damageCase.status);
                  const StatusIcon = statusInfo.icon;
                  return (
                    <TableRow key={damageCase.id} className="group">
                      <TableCell className="pl-6">
                        <Link
                          to={`/claims/${damageCase.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {damageCase.claimNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="font-medium">
                        {damageCase.customer}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3 w-32">
                          <Progress
                            value={damageCase.damageScore}
                            className={`h-2 ${
                              damageCase.damageScore >= 80
                                ? "[&>div]:bg-destructive"
                                : damageCase.damageScore >= 50
                                ? "[&>div]:bg-warning"
                                : "[&>div]:bg-success"
                            }`}
                          />
                          <span
                            className={`text-sm font-medium ${
                              damageCase.damageScore >= 80
                                ? "text-destructive"
                                : damageCase.damageScore >= 50
                                ? "text-warning"
                                : "text-success"
                            }`}
                          >
                            {damageCase.damageScore}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        <p className="text-sm text-muted-foreground truncate">
                          {damageCase.severity}
                        </p>
                      </TableCell>
                      <TableCell className="font-medium">
                        {formatCurrency(damageCase.amount)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {damageCase.partsImpacted.slice(0, 2).map((part) => (
                            <span
                              key={part}
                              className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                            >
                              {part}
                            </span>
                          ))}
                          {damageCase.partsImpacted.length > 2 && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              +{damageCase.partsImpacted.length - 2}
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
                          <Link to={`/claims/${damageCase.id}`}>
                            <Eye className="h-4 w-4 mr-1" />
                            View Assessment
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

