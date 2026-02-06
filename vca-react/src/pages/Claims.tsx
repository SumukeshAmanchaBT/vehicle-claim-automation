import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search,
  Filter,
  Eye,
  MoreHorizontal,
  Download,
  Plus,
} from "lucide-react";
import { mockClaims, type Claim } from "@/lib/mock-data";

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

export default function Claims() {
  const [searchParams] = useSearchParams();
  const statusFilter = searchParams.get("status") || "all";
  const [search, setSearch] = useState("");

  const filteredClaims = mockClaims.filter((claim) => {
    const matchesSearch =
      claim.claimNumber.toLowerCase().includes(search.toLowerCase()) ||
      claim.customerName.toLowerCase().includes(search.toLowerCase()) ||
      claim.policyNumber.toLowerCase().includes(search.toLowerCase());

    const matchesStatus =
      statusFilter === "all" || claim.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  return (
    <AppLayout title="Claims" subtitle="Manage and process insurance claims">
      <div className="space-y-6 animate-fade-in">
        {/* Filters */}
        <Card className="card-elevated">
          <CardContent className="p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-1 items-center gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search claims, policies, customers..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Select defaultValue={statusFilter}>
                  <SelectTrigger className="w-[150px]">
                    <Filter className="mr-2 h-4 w-4" />
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="processing">Processing</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="flagged">Flagged</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm">
                  <Download className="mr-2 h-4 w-4" />
                  Export
                </Button>
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  New Claim
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Claims Table */}
        <Card className="card-elevated overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="pl-6">Claim #</TableHead>
                <TableHead>Policy</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Incident Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>AI Score</TableHead>
                <TableHead>Fraud Risk</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead className="pr-6 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredClaims.map((claim) => (
                <TableRow key={claim.id} className="group">
                  <TableCell className="pl-6">
                    <Link
                      to={`/claims/${claim.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {claim.claimNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {claim.policyNumber}
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
                  <TableCell className="text-muted-foreground">
                    {new Date(claim.incidentDate).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="font-medium">
                    {formatCurrency(claim.estimatedAmount)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-12 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${claim.aiConfidence}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {claim.aiConfidence}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={
                        claim.fraudScore >= 50
                          ? "rejected"
                          : claim.fraudScore >= 30
                          ? "pending"
                          : "approved"
                      }
                    >
                      {claim.fraudScore}%
                    </StatusBadge>
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
                  <TableCell className="text-muted-foreground">
                    {claim.assignedTo || "—"}
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
        </Card>
      </div>
    </AppLayout>
  );
}