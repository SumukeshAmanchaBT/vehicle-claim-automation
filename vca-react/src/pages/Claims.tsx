import { useState, useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { TableToolbar, DataTablePagination, SortableTableHead, type SortDirection } from "@/components/data-table";
import { Loader2, ZoomIn, Plus } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { getFnolList, saveFnol, type FnolResponse } from "@/lib/api";
import type { FnolPayload } from "@/models/fnol";

type BadgeVariant = "approved" | "pending" | "rejected" | "processing" | "default";

type ClaimStatusKey =
  | "auto_approved"
  | "fraudulent"
  | "manual_review"
  | "open"
  | "pending"
  | "pending_damage_detection";

const CLAIM_STATUS_META: Record<
  ClaimStatusKey,
  { label: string; badge: BadgeVariant }
> = {
  auto_approved: { label: "Closed Damage Detection", badge: "approved" },
  fraudulent: { label: "Fraudulent", badge: "rejected" },
  manual_review: { label: "Manual Review", badge: "pending" },
  open: { label: "Open", badge: "processing" },
  pending: { label: "Pending", badge: "pending" },
  pending_damage_detection: {
    label: "Pending Damage Detection",
    badge: "pending",
  },
};

/** Build one mock FNOL payload with a dynamic claim_id (used once per "Fetch FNOL Data" click). */
function getMockFnolPayload(claimId: string): FnolPayload {
  const now = new Date();
  const policyNum = `POL${claimId.replace(/[^0-9]/g, "").padStart(6, "0") || "100001"}`;
  return {
    claim_id: claimId,
    policy: {
      policy_number: policyNum,
      policy_status: "Active",
      coverage_type: "Comprehensive",
      policy_start_date: "2025-01-01",
      policy_end_date: "2026-12-31",
    },
    vehicle: {
      registration_number: "KA01AB1234",
      make: "Hyundai",
      model: "Creta",
      year: 2023,
    },
    incident: {
      date_time_of_loss: now.toISOString(),
      loss_description: "Own damage - bumper and left fender",
      claim_type: "Own Damage",
      estimated_amount: 45000,
    },
    claimant: {
      driver_name: "Ravi Kumars",
      driving_license_number: "DL-001-2020",
      license_valid_till: "2028-05-15",
    },
    documents: {
      rc_copy_uploaded: true,
      dl_copy_uploaded: true,
      photos_uploaded: true,
      fir_uploaded: true,
      photos: ["/uploads/damage1.jpg"],
    },
    history: { previous_claims_last_12_months: 0 },
  };
}

/** Derive next claim ID from existing claims (e.g. CLM-0001, CLM-0002, ...). */
function getNextClaimId(claims: FnolResponse[]): string {
  const prefix = "CLM-";
  const numbers = claims
    .map((c) => {
      const id = c.complaint_id || "";
      if (!id.startsWith(prefix)) return 0;
      const num = parseInt(id.slice(prefix.length), 10);
      return Number.isNaN(num) ? 0 : num;
    })
    .filter((n) => n > 0);
  const nextNum = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  return `${prefix}${String(nextNum).padStart(4, "0")}`;
}

function normalizeStatus(raw?: string | null): ClaimStatusKey {
  const value = (raw || "").trim().toLowerCase();

  console.log("Normalizing status:", { raw, value });
  if (value === "closed damage detection") {
    return "auto_approved";
  }
  if (value === "fraudulent") {
    return "fraudulent";
  }
  if (value === "manual review" || value === "manual_review") {
    return "manual_review";
  }
  if (value === "open") {
    return "open";
  }
  if (value === "pending damage detection" || value === "pending_damage_detection") {
    return "pending_damage_detection";
  }
  // Fallback
  return "pending";
}

function fnolToDisplay(fnol: FnolResponse) {
  const r = fnol.raw_response;
  const vehicle = r?.vehicle
    ? `${r.vehicle.year} ${r.vehicle.make} ${r.vehicle.model}`
    : fnol.vehicle_name && fnol.vehicle_model && fnol.vehicle_year
      ? `${fnol.vehicle_year} ${fnol.vehicle_name} ${fnol.vehicle_model}`
      : "—";
  const normalizedStatus = normalizeStatus((fnol as { status?: string }).status);

  return {
    id: fnol.complaint_id,
    claimNumber: r?.claim_id || fnol.complaint_id || `FNOL-${fnol.id}`,
    policyNumber: r?.policy?.policy_number || fnol.policy_number || "—",
    customerName: r?.claimant?.driver_name || fnol.policy_holder_name || "—",
    vehicleInfo: vehicle,
    incidentDate: r?.incident?.date_time_of_loss || fnol.incident_date_time || fnol.created_date,
    claimType: r?.incident?.claim_type || fnol.claim_type || "—",
    estimatedAmount: r?.incident?.estimated_amount ?? 0,
    statusKey: normalizedStatus,
  };
}

export default function Claims() {
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get("status") || "all";
  const [search, setSearch] = useState("");
  const [claims, setClaims] = useState<FnolResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchFnolLoading, setFetchFnolLoading] = useState(false);

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

  const displayClaims = useMemo(() => claims.map(fnolToDisplay), [claims]);

  type ClaimSortKey = "claimNumber" | "policy" | "customer" | "type" | "date" | "status";
  const [sortKey, setSortKey] = useState<ClaimSortKey | null>("date");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const filteredClaims = useMemo(() => {
    let list = displayClaims.filter((claim) => {
      const term = search.toLowerCase();
      const matchesSearch =
        claim.claimNumber.toLowerCase().includes(term) ||
        claim.customerName.toLowerCase().includes(term) ||
        claim.policyNumber.toLowerCase().includes(term);
      const matchesStatus =
        statusFilter === "all" ||
        claim.statusKey === (statusFilter as ClaimStatusKey);
      return matchesSearch && matchesStatus;
    });
    if (sortKey) {
      list = [...list].sort((a, b) => {
        let cmp = 0;
        switch (sortKey) {
          case "claimNumber":
            cmp = a.claimNumber.localeCompare(b.claimNumber);
            break;
          case "policy":
            cmp = a.policyNumber.localeCompare(b.policyNumber);
            break;
          case "customer":
            cmp = a.customerName.localeCompare(b.customerName);
            break;
          case "type":
            cmp = a.claimType.localeCompare(b.claimType);
            break;
          case "date":
            cmp = new Date(a.incidentDate).getTime() - new Date(b.incidentDate).getTime();
            break;
          case "status":
            cmp = a.statusKey.localeCompare(b.statusKey);
            break;
          default:
            break;
        }
        return sortDir === "desc" ? -cmp : cmp;
      });
    }
    return list;
  }, [displayClaims, search, statusFilter, sortKey, sortDir]);

  const paginatedClaims = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredClaims.slice(start, start + pageSize);
  }, [filteredClaims, page, pageSize]);

  const handleSort = (key: string) => {
    const k = key as ClaimSortKey;
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "date" ? "desc" : "asc");
    }
    setPage(1);
  };

  const handleStatusChange = (value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === "all") next.delete("status");
      else next.set("status", value);
      return next;
    });
  };

  const handleFetchFnolData = async () => {
    setFetchFnolLoading(true);
    try {
      const claimId = getNextClaimId(claims);
      const payload = getMockFnolPayload(claimId);
      await saveFnol(payload);
      const data = await getFnolList();
      setClaims(data);
      setError(null);
      toast({
        title: "FNOL data saved",
        description: `Claim ${claimId} saved to fnol_claims. List refreshed.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save FNOL data";
      toast({
        variant: "destructive",
        title: "Fetch FNOL Data failed",
        description: message,
      });
    } finally {
      setFetchFnolLoading(false);
    }
  };

  return (
    <AppLayout title="Claims List" subtitle="Manage and process insurance claims">
      <div className="space-y-6 animate-fade-in">
        <TableToolbar
          searchPlaceholder="Search claims, policies, customers..."
          searchValue={search}
          onSearchChange={(v) => { setSearch(v); setPage(1); }}
          // filters={
          //   <Select value={statusFilter} onValueChange={(v) => { handleStatusChange(v); setPage(1); }}>
          //     <SelectTrigger className="w-[180px]">
          //       <SelectValue placeholder="Status" />
          //     </SelectTrigger>
          //     <SelectContent>
          //       <SelectItem value="all">All Status</SelectItem>
          //       <SelectItem value="open">Open</SelectItem>
          //       <SelectItem value="pending">Pending</SelectItem>
          //       <SelectItem value="fraudulent">Fraudulent</SelectItem>
          //       <SelectItem value="pending_damage_detection">
          //         Pending Damage Detection
          //       </SelectItem>
          //       <SelectItem value="manual_review">Manual Review</SelectItem>
                
                
          //     </SelectContent>
          //   </Select>
          //}
          // primaryAction={(
          //   <Button asChild>
          //     <Link to="/claims/new">
          //       <Plus className="mr-2 h-4 w-4" />
          //       FNOL Response
          //     </Link>
          //   </Button>
          // )}

          primaryAction={(
            <Button
              onClick={handleFetchFnolData}
              disabled={fetchFnolLoading}
            >
              {fetchFnolLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Fetch FNOL Data
            </Button>
          )}
        />

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
            <>
              <Table>
                <TableHeader className="table-header-bg">
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <SortableTableHead sortKey="claimNumber" currentSortKey={sortKey} direction={sortDir} onSort={handleSort} className="pl-6">Claim No #</SortableTableHead>
                    <SortableTableHead sortKey="policy" currentSortKey={sortKey} direction={sortDir} onSort={handleSort}>Policy No</SortableTableHead>
                    <SortableTableHead sortKey="customer" currentSortKey={sortKey} direction={sortDir} onSort={handleSort}>Insured /Customer</SortableTableHead>
                    <SortableTableHead sortKey="type" currentSortKey={sortKey} direction={sortDir} onSort={handleSort}>Incident Type</SortableTableHead>
                    <SortableTableHead sortKey="date" currentSortKey={sortKey} direction={sortDir} onSort={handleSort}>Date of Accident</SortableTableHead>
                    <SortableTableHead sortKey="status" currentSortKey={sortKey} direction={sortDir} onSort={handleSort}>Claim Stage</SortableTableHead>
                    <TableHead className="pr-6 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredClaims.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                        No claims found.{" "}
                        <Link to="/claims/new" className="text-primary hover:underline">
                          Submit a new claim
                        </Link>
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedClaims.map((claim) => (
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
                        {/* <TableCell className="font-medium">
                          {formatCurrency(claim.estimatedAmount)}
                        </TableCell> */}
                        <TableCell>
                          <StatusBadge status={CLAIM_STATUS_META[claim.statusKey].badge}>
                            {CLAIM_STATUS_META[claim.statusKey].label}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="pr-6 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" asChild>
                              <Link to={`/claims/${claim.id}`} title="View claim">
                                <ZoomIn className="h-4 w-4" />
                              </Link>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              <DataTablePagination
                totalCount={filteredClaims.length}
                page={page}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
                itemLabel="claims"
              />
            </>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}
