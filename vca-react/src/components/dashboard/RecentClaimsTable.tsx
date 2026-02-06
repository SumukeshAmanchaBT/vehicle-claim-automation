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
import { Eye, MoreHorizontal } from "lucide-react";
import { mockClaims, type Claim } from "@/lib/mock-data";
import { Link } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const getStatusVariant = (
  status: Claim["status"]
): "approved" | "pending" | "rejected" | "processing" => {
  const map = {
    approved: "approved" as const,
    pending: "pending" as const,
    rejected: "rejected" as const,
    processing: "processing" as const,
    flagged: "rejected" as const,
  };
  return map[status];
};

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  }).format(amount);
};

export function RecentClaimsTable() {
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
              <TableHead>AI Confidence</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-6 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mockClaims.slice(0, 5).map((claim) => (
              <TableRow key={claim.id} className="group">
                <TableCell className="pl-6 font-medium">
                  {claim.claimNumber}
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
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-16 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${claim.aiConfidence}%` }}
                      />
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {claim.aiConfidence}%
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge
                    status={getStatusVariant(claim.status)}
                    pulse={claim.status === "processing"}
                  >
                    {claim.status.charAt(0).toUpperCase() +
                      claim.status.slice(1)}
                  </StatusBadge>
                </TableCell>
                <TableCell className="pr-6 text-right">
                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" asChild>
                      <Link to={`/claims/${claim.id}`}>
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>Approve Claim</DropdownMenuItem>
                        <DropdownMenuItem>Request Documents</DropdownMenuItem>
                        <DropdownMenuItem>Assign Adjuster</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive">
                          Reject Claim
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}