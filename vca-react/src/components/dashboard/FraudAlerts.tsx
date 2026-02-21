import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { mockFraudAlerts } from "@/lib/mock-data";
import { Link } from "react-router-dom";
import type { FraudClaimItem } from "@/lib/api";

interface FraudAlertsProps {
  /** Business validation alerts (under_review or confirmed). When provided, uses API data; otherwise mock. */
  alerts?: FraudClaimItem[] | null;
}

export function FraudAlerts({ alerts: alertsProp }: FraudAlertsProps) {
  const useMock = !alertsProp || alertsProp.length === 0;
  const alerts = useMock ? mockFraudAlerts : alertsProp;
  const displayAlerts = useMock
    ? mockFraudAlerts
    : alertsProp!.map((a) => ({
        id: a.complaint_id,
        claimNumber: a.claimNumber,
        riskScore: a.riskScore,
        reason: a.reason,
      }));

  return (
    <Card className="card-elevated border-l-4 border-l-destructive">
      <CardHeader className="flex flex-row items-center gap-3 pb-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/10">
          <AlertTriangle className="h-4 w-4 text-destructive" />
        </div>
        <div className="flex-1">
          <CardTitle className="text-base font-semibold">
            Business Validation Alerts
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {displayAlerts.length} claims require attention
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/fraud">View All</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {displayAlerts.map((alert) => (
          <div
            key={alert.id ?? alert.claimNumber}
            className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
          >
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{alert.claimNumber}</span>
                <StatusBadge
                  status={alert.riskScore >= 70 ? "rejected" : "pending"}
                >
                  Risk: {alert.riskScore}%
                </StatusBadge>
              </div>
              <p className="text-xs text-muted-foreground">{alert.reason}</p>
            </div>
            <Button variant="ghost" size="icon" className="shrink-0" asChild>
              <Link to={`/claims/${alert.id}`}>
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}