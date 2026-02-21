import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";
import { mockClaims, type Claim } from "@/lib/mock-data";
import { Link } from "react-router-dom";

export type DashboardClaimRow = {
  id: string;
  claimNumber: string;
  customerName: string;
  vehicleInfo: string;
  claimType: string;
  estimatedAmount: number;
  statusKey: string;
  aiConfidence?: number;
};

const getStatusVariant = (
  statusKey: string
): "approved" | "pending" | "rejected" | "processing" => {
  if (statusKey === "auto_approved") return "approved";
  if (statusKey === "fraudulent") return "rejected";
  if (statusKey === "open" || statusKey === "pending_damage_detection") return "processing";
  return "pending";
};

const getStatusLabel = (statusKey: string): string => {
  const labels: Record<string, string> = {
    auto_approved: "Recommendation shared",
    fraudulent: "Business Rule Validation-fail",
    pending_damage_detection: "Business Rule Validation-pass",
    open: "FNOL",
    pending: "Pending",
    manual_review: "Recommendation shared",
    approved: "Recommendation shared",
    rejected: "Business Rule Validation-fail",
    processing: "Processing",
    flagged: "Validation Failed",
  };
  return labels[statusKey] || statusKey;
};

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 0,
  }).format(amount);
};

interface RecentClaimsTableProps {
  claims?: DashboardClaimRow[] | null;
}

export function RecentClaimsTable({ claims: claimsProp }: RecentClaimsTableProps) {
  const useMock = !claimsProp || claimsProp.length === 0;
  const rows: DashboardClaimRow[] = useMock
    ? mockClaims.slice(0, 5).map((c) => ({
        id: c.id,
        claimNumber: c.claimNumber,
        customerName: c.customerName,
        vehicleInfo: c.vehicleInfo,
        claimType: c.claimType,
        estimatedAmount: c.estimatedAmount,
        statusKey: c.status,
        aiConfidence: c.aiConfidence,
      }))
    : claimsProp;

  return (
    <Card className="card-elevated">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-semibold">Recent Claims</CardTitle>
        <Button variant="outline" size="sm" asChild>
          <Link to="/claims">View All</Link>
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-6">Claim #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-6 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((claim) => (
              <TableRow key={claim.id} className="group">
                <TableCell className="pl-6 font-medium">
                  <Link to={`/claims/${claim.id}`} className="text-primary hover:underline">
                    {claim.claimNumber}
                  </Link>
                </TableCell>
                <TableCell>
                  <div>
                    <p className="font-medium">{claim.customerName}</p>
                    <p className="text-xs text-muted-foreground">
                      {claim.vehicleInfo}
                    </p>
                  </div>
                </TableCell>
                <TableCell>{claim.claimType}</TableCell>
                <TableCell className="font-medium">
                  {formatCurrency(claim.estimatedAmount)}
                </TableCell>
                <TableCell>
                  <StatusBadge
                    status={getStatusVariant(claim.statusKey)}
                    pulse={claim.statusKey === "open" || claim.statusKey === "pending_damage_detection"}
                  >
                    {getStatusLabel(claim.statusKey)}
                  </StatusBadge>
                </TableCell>
                <TableCell className="pr-6 text-right">
                  <Button variant="ghost" size="icon" asChild>
                    <Link to={`/claims/${claim.id}`} title="View claim">
                      <Eye className="h-4 w-4" />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}