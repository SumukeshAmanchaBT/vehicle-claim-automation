import { useState, useEffect } from "react";
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
  Loader2,
  ZoomIn,
} from "lucide-react";
import { getFnolList, type FnolResponse } from "@/lib/api";

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
  }).format(amount);
};

function fnolToDisplay(fnol: FnolResponse) {
  const r = fnol.raw_response;
  const vehicle = r.vehicle ? `${r.vehicle.year} ${r.vehicle.make} ${r.vehicle.model}` : "—";
  return {
    id: String(fnol.id),
    claimNumber: r.claim_id || `FNOL-${fnol.id}`,
    policyNumber: r.policy?.policy_number || "—",
    customerName: r.claimant?.driver_name || "—",
    vehicleInfo: vehicle,
    incidentDate: r.incident?.date_time_of_loss || fnol.created_date,
    claimType: r.incident?.claim_type || "—",
    estimatedAmount: r.incident?.estimated_amount ?? 0,
  };
}

export default function Claims() {
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get("status") || "all";
  const [search, setSearch] = useState("");
  const [claims, setClaims] = useState<FnolResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getFnolList()
      .then((data) => {
        console.log("Fetched claims:", data);
        if (!cancelled) setClaims(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load claims");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const displayClaims = claims.map(fnolToDisplay);
  const filteredClaims = displayClaims.filter((claim) => {
    const matchesSearch =
      claim.claimNumber.toLowerCase().includes(search.toLowerCase()) ||
      claim.customerName.toLowerCase().includes(search.toLowerCase()) ||
      claim.policyNumber.toLowerCase().includes(search.toLowerCase());
    return matchesSearch;
  });

  const handleStatusChange = (value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === "all") next.delete("status");
      else next.set("status", value);
      return next;
    });
  };

  return (
    <AppLayout title="Claims" subtitle="Manage and process insurance claims">
      <div className="space-y-6 animate-fade-in">
        {/* Filters */}
        <Card className="card-elevated border-none">
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
                <Select value={statusFilter} onValueChange={handleStatusChange}>
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
                {/* <Button variant="outline" size="sm">
                  <Download className="mr-2 h-4 w-4" />
                  Export
                </Button> */}
                {/* <Button size="sm" asChild>
                  <Link to="/claims/new">
                    <Plus className="mr-2 h-4 w-4" />
                   Fletch a Claim
                  </Link>
                </Button> */}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Claims Table */}
        <Card className="card-elevated overflow-hidden border-none">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="py-16 text-center">
              <p className="text-destructive">{error}</p>
              <p className="text-sm text-muted-foreground mt-2">
                Ensure the backend is running 
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader className="table-header-bg">
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="pl-6">Claim #</TableHead>
                  <TableHead>Policy</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Incident Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-6 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredClaims.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                      No claims found.{" "}
                      <Link to="/claims/new" className="text-primary hover:underline">
                        Submit a new claim
                      </Link>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredClaims.map((claim) => (
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
                        <StatusBadge status="pending">Pending</StatusBadge>
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                          <Button variant="default" size="icon" asChild>
                            <Link to={`/claims/${claim.id}`}>
                              <ZoomIn className="h-4 w-4" />
                            </Link>
                          </Button>
                          {/* <DropdownMenu>
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
                          </DropdownMenu> */}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}
