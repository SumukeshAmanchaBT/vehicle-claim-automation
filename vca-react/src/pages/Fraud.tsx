import React, { useState, useEffect } from "react";
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
  RotateCcw,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { getFraudClaims, type FraudClaimItem } from "@/lib/api";

const getStatusInfo = (status: string) => {
  const map = {
    under_review: { label: "Under Review", variant: "pending" as const, icon: Clock },
    cleared: { label: "Cleared", variant: "approved" as const, icon: CheckCircle2 },
    confirmed: { label: "Business Validation Failed", variant: "rejected" as const, icon: XCircle },
  };
  return map[status as keyof typeof map] || map.under_review;
};

export default function Fraud() {
  const [fraudCases, setFraudCases] = useState<FraudClaimItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
      title="Business Rule Validation"
      subtitle="Business rule validation and claim risk analysis"
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
                  <p className="text-xs text-muted-foreground">Validation Failed</p>
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

        {/* Business Validation Results Table */}
        <Card className="card-elevated overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Re-Open Claims
            </CardTitle>
            {!loading && (
              <p className="text-sm text-muted-foreground">
                Record count: <span className="font-medium text-foreground">{fraudCases.length}</span>
                {fraudCases.length === 1 ? " record" : " records"}
              </p>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="mt-4 text-sm text-muted-foreground">Loading validation results...</p>
              </div>
            ) : fraudCases.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                No business validation results yet. Run Business Rule Validation on claims to see them here.
              </div>
            ) : (
            <Table>
              <TableHeader className="table-header-bg">
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-10 pl-4 pr-0" />
                  <TableHead className="pl-4">Claim #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-6 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fraudCases.map((fraudCase) => {
                  const statusInfo = getStatusInfo(fraudCase.status);
                  const StatusIcon = statusInfo.icon;
                  const isExpanded = expandedId === fraudCase.complaint_id;
                  const timesProcessed = fraudCase.times_processed ?? 0;
                  return (
                    <React.Fragment key={fraudCase.complaint_id}>
                      <TableRow
                        className="group cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedId(isExpanded ? null : fraudCase.complaint_id)}
                      >
                        <TableCell
                          className="w-10 pl-4 pr-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="flex items-center justify-center p-1 rounded hover:bg-muted"
                            aria-label={isExpanded ? "Collapse" : "Expand"}
                            onClick={() => setExpandedId(isExpanded ? null : fraudCase.complaint_id)}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                          </button>
                        </TableCell>
                        <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
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
                          <p className="text-sm font-medium" title="Latest from claim_evaluation_response">
                            {fraudCase.latest_claim_status ?? statusInfo.label}
                          </p>
                        </TableCell>
                        <TableCell className="pr-6 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            <Button variant="outline" size="sm" asChild>
                              <Link to={`/claims/${fraudCase.complaint_id}`}>
                                <Eye className="h-4 w-4 mr-1" />
                                Review
                              </Link>
                            </Button>
                            {fraudCase.re_open === 1 && (
                              <Button variant="outline" size="sm" asChild>
                                <Link to={`/claims/${fraudCase.complaint_id}?reopen=1`}>
                                  <RotateCcw className="h-4 w-4 mr-1" />
                                  Reopen
                                </Link>
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={5} className="pl-12 pr-6 py-4">
                            <p className="text-sm font-medium text-foreground mb-3">
                              Evaluation records ({timesProcessed} record{timesProcessed !== 1 ? "s" : ""})
                            </p>
                            {(fraudCase.evaluation_records && fraudCase.evaluation_records.length > 0) ? (
                              <div className="overflow-x-auto rounded-md border border-border">
                                <Table>
                                  <TableHeader>
                                    <TableRow className="bg-muted/50">
                                      <TableHead className="text-xs">#</TableHead>
                                      <TableHead className="text-xs">Complaint ID</TableHead>
                                      <TableHead className="text-xs">Threshold value</TableHead>
                                      <TableHead className="text-xs">Claim status</TableHead>
                                      <TableHead className="text-xs min-w-[180px]">Reason</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {fraudCase.evaluation_records.map((rec, idx) => (
                                      <TableRow key={idx} className="border-border">
                                        <TableCell className="text-xs py-2">{rec.version}</TableCell>
                                        <TableCell className="text-xs py-2">{rec.complaint_id}</TableCell>
                                        <TableCell className="text-xs py-2">{rec.threshold_value ?? "—"}</TableCell>
                                        <TableCell className="text-xs py-2">{rec.claim_status}</TableCell>
                                        <TableCell className="text-xs py-2 max-w-[280px] break-words">{rec.reason}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">No evaluation records.</p>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
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