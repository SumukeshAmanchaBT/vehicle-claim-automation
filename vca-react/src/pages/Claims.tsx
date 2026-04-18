import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2, FileDown, Plus, RefreshCw, Trash2, ZoomIn } from "lucide-react";

import { TableToolbar, DataTablePagination, SortableTableHead, type SortDirection } from "@/components/data-table";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ClaimsListSkeleton, StatusWrapper } from "@/components/ui/status-wrapper";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import {
  bulkDeleteFnol,
  deleteFnol,
  getFnolList,
  getRecommendationReportPdf,
  saveFnol,
  type FnolResponse,
} from "@/lib/api";
import {
  claimListShowReportPdf,
  claimListStageSortRank,
  claimMatchesListStageFilter,
  normalizeClaimListStageFilter,
} from "@/lib/claimListWorkflowBadge";
import { ClaimListWorkflowBadges } from "@/components/claim/ClaimListWorkflowBadges";
import type { ClaimWorkflowSnapshot } from "@/models/fnol";
import { getApiErrorSummary } from "@/lib/httpClient";
import { formatDate } from "@/lib/utils";
import { useGlobalPreloader } from "@/components/ui/GlobalPreloader";
import {
  claimScopedQueryDefaults,
  fnolListQueryKey,
} from "@/lib/claimScopedCache";

type DisplayClaim = {
  id: string;
  claimNumber: string;
  policyNumber: string;
  customerName: string;
  vehicleInfo: string;
  claimRequestedDate?: string | null;
  claimType: string;
  statusLabel?: string | null;
  workflowSnapshot: ClaimWorkflowSnapshot | null;
  stageSortRank: number;
  showReportPdf: boolean;
};

function ClaimReportPdfButton({ complaintId }: { complaintId: string }) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLoading(true);
    try {
      const blob = await getRecommendationReportPdf(complaintId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Motor_Claim_Recommendation_Report_${complaintId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast({
        title: "Report downloaded",
        description: "Recommendation report PDF has been downloaded.",
      });
    } catch {
      toast({
        title: "Download failed",
        description: "Could not generate recommendation report.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleDownload}
      disabled={loading}
      title="Generate Recommendation Report (PDF)"
      aria-label={`Download recommendation report for ${complaintId}`}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <FileDown className="h-4 w-4" />
      )}
    </Button>
  );
}

function fnolToDisplay(fnol: FnolResponse): DisplayClaim {
  const response = fnol.raw_response;
  const vehicle = response?.vehicle
    ? `${response.vehicle.year} ${response.vehicle.make} ${response.vehicle.model}`
    : fnol.vehicle_make && fnol.vehicle_model && fnol.vehicle_year
      ? `${fnol.vehicle_year} ${fnol.vehicle_make} ${fnol.vehicle_model}`
      : "—";
  const workflowSnapshot =
    fnol.workflow_snapshot ??
    (fnol.workflow_state
      ? ({ workflow_state: fnol.workflow_state } as ClaimWorkflowSnapshot)
      : null);

  return {
    id: fnol.complaint_id,
    claimNumber: response?.claim_id || fnol.complaint_id || `FNOL-${fnol.id}`,
    policyNumber: response?.policy?.policy_number || fnol.policy_number || "—",
    customerName:
      response?.claimant?.driver_name || fnol.policy_holder_name || "—",
    vehicleInfo: vehicle,
    claimRequestedDate:
      fnol.created_date ||
      fnol.incident_date_time ||
      response?.incident?.date_time_of_loss,
    claimType: response?.incident?.claim_type || fnol.incident_type || "—",
    statusLabel: fnol.status ?? null,
    workflowSnapshot,
    stageSortRank: claimListStageSortRank(workflowSnapshot, fnol.status),
    showReportPdf: claimListShowReportPdf(workflowSnapshot, fnol.status),
  };
}

function toggleSelection(current: string[], claimId: string, checked: boolean): string[] {
  if (checked) {
    return current.includes(claimId) ? current : [...current, claimId];
  }
  return current.filter((id) => id !== claimId);
}

export default function Claims() {
  const { toast } = useToast();
  const globalLoader = useGlobalPreloader();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const stageFilter = normalizeClaimListStageFilter(
    searchParams.get("stage") ?? searchParams.get("status")
  );
  const [search, setSearch] = useState("");
  const [selectedClaimIds, setSelectedClaimIds] = useState<string[]>([]);
  const [deleteTargetIds, setDeleteTargetIds] = useState<string[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);

  const claimsQuery = useQuery({
    queryKey: fnolListQueryKey,
    queryFn: getFnolList,
    ...claimScopedQueryDefaults,
  });

  const claims = claimsQuery.data ?? [];
  const loading = claimsQuery.isPending;
  const refreshing = claimsQuery.isFetching && !claimsQuery.isPending;
  const error = claimsQuery.error;

  type ClaimSortKey = "claimNumber" | "policy" | "customer" | "type" | "date" | "status";
  const [sortKey, setSortKey] = useState<ClaimSortKey | null>("date");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const loadClaims = useCallback(
    async ({
      manual = false,
      announceNewRecords = false,
    }: {
      manual?: boolean;
      announceNewRecords?: boolean;
    } = {}) => {
      const previousData =
        queryClient.getQueryData<FnolResponse[]>(fnolListQueryKey) ?? claims;
      const previousIds = new Set(previousData.map((claim) => claim.complaint_id));
      try {
        await queryClient.invalidateQueries({ queryKey: fnolListQueryKey });
        const data = await queryClient.fetchQuery({
          queryKey: fnolListQueryKey,
          queryFn: getFnolList,
          ...claimScopedQueryDefaults,
        });
        if (announceNewRecords) {
          const newClaims = data.filter(
            (claim) => !previousIds.has(claim.complaint_id)
          );
          if (newClaims.length > 0) {
            toast({
              title:
                newClaims.length === 1
                  ? "New FNOL fetched"
                  : "New FNOL claims fetched",
              description:
                newClaims.length === 1
                  ? `${newClaims[0].complaint_id} was added from the live FNOL records.`
                  : `${newClaims.length} fresh FNOL claims were added from the live FNOL records.`,
            });
          } else if (manual) {
            toast({
              title: "Claims refreshed",
              description:
                "No new FNOL records were found in the MySQL-backed claim list.",
            });
          }
        }
      } catch {
        // React Query records the error on the query; avoid throwing here.
      }
    },
    [claims, queryClient, toast]
  );

  const handleFetchFnolData = useCallback(async () => {
    const now = new Date();
    const defaultIncidentDescription =
      "Cracked windshield and damage to front bumper due to road impact.";
    const defaultPolicyStart = "2026-01-01";
    const defaultPolicyEnd = "2026-12-31";
    const defaultPhotos = ["glass_damage1.jpg", "glass_damage2.jpg"];

    const baseCandidates = (
      queryClient.getQueryData<FnolResponse[]>(fnolListQueryKey) ?? claims
    ).filter((item) => Boolean(item?.complaint_id));
    const source =
      baseCandidates.length > 0
        ? baseCandidates[Math.floor(Math.random() * baseCandidates.length)]
        : null;

    const extractClmNumber = (value: string | null | undefined): number | null => {
      if (!value) return null;
      const match = value.trim().toUpperCase().match(/^CLM-(\d{1,})$/);
      if (!match) return null;
      const parsed = Number(match[1]);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const maxClm =
      baseCandidates.reduce<number>((acc, item) => {
        const raw = item.raw_response?.claim_id ?? null;
        const parsed = extractClmNumber(raw);
        if (parsed == null) return acc;
        return Math.max(acc, parsed);
      }, 0) || 0;
    const nextClaimNumber = `CLM-${String(maxClm + 1).padStart(3, "0")}`;

    const sourcePolicyNumber =
      source?.raw_response?.policy?.policy_number ??
      source?.policy_number ??
      `POL-${Math.floor(Math.random() * 900000 + 100000)}`;
    const sourceCoverageType =
      source?.raw_response?.policy?.coverage_type ?? source?.coverage_type ?? "Type 1";
    const sourcePolicyStatus =
      source?.raw_response?.policy?.policy_status ?? source?.policy_status ?? "ACTIVE";
    const sourceCustomerName =
      source?.raw_response?.claimant?.driver_name ?? source?.policy_holder_name ?? "Dummy Customer";
    const sourceIncidentType =
      source?.raw_response?.incident?.claim_type ?? source?.incident_type ?? "Own Damage";
    const sourceVehicle = source?.raw_response?.vehicle ?? null;

    const stop = globalLoader.start("Fetching FNOL data...");
    try {
      await saveFnol({
        claim_id: nextClaimNumber,
        policy: {
          policy_number: sourcePolicyNumber,
          policy_status: sourcePolicyStatus,
          coverage_type: sourceCoverageType,
          policy_start_date: defaultPolicyStart,
          policy_end_date: defaultPolicyEnd,
        },
        vehicle: {
          registration_number:
            sourceVehicle?.registration_number ??
            source?.vehicle_registration_number ??
            "KA01AB1234",
          make: sourceVehicle?.make ?? source?.vehicle_make ?? "Hyundai",
          model: sourceVehicle?.model ?? source?.vehicle_model ?? "Creta",
          year: sourceVehicle?.year ?? source?.vehicle_year ?? 2023,
        },
        incident: {
          date_time_of_loss: now.toISOString(),
          loss_description: defaultIncidentDescription,
          claim_type: sourceIncidentType,
          estimated_amount: 0,
          accident_location: "—",
          liability_admission: false,
          dashcam_cctv_evidence: false,
          injury_indicator: false,
          commercial_vehicle: false,
          flood_coverage: false,
        },
        claimant: {
          driver_name: sourceCustomerName,
          driving_license_number: "DL-DUMMY-0001",
          license_valid_till: now.toISOString(),
        },
        documents: {
          rc_copy_uploaded: false,
          dl_copy_uploaded: false,
          photos_uploaded: true,
          fir_uploaded: false,
          photos: defaultPhotos,
        },
        history: {
          previous_claims_last_12_months: 0,
        },
      });

      await queryClient.invalidateQueries({ queryKey: fnolListQueryKey });
      await loadClaims({ manual: true, announceNewRecords: true });
      toast({
        title: `Claim No : ${nextClaimNumber} new fnol record added successfully`,
      });
    } catch (err) {
      toast({
        title: "Fetch FNOL Data failed",
        description: err instanceof Error ? err.message : "Could not save FNOL.",
        variant: "destructive",
      });
    } finally {
      stop();
    }
  }, [globalLoader, loadClaims, queryClient, toast]);

  const errorSummary = error ? getApiErrorSummary(error) : null;

  const displayClaims = useMemo(() => claims.map(fnolToDisplay), [claims]);
  const claimsById = useMemo(
    () => new Map(displayClaims.map((claim) => [claim.id, claim])),
    [displayClaims]
  );

  const filteredClaims = useMemo(() => {
    let list = displayClaims.filter((claim) => {
      const term = search.toLowerCase();
      const matchesSearch =
        claim.claimNumber.toLowerCase().includes(term) ||
        claim.customerName.toLowerCase().includes(term) ||
        claim.policyNumber.toLowerCase().includes(term);
      const matchesStage = claimMatchesListStageFilter(
        claim.workflowSnapshot,
        stageFilter,
        claim.statusLabel
      );
      return matchesSearch && matchesStage;
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
            cmp =
              new Date(a.claimRequestedDate || "").getTime() -
              new Date(b.claimRequestedDate || "").getTime();
            break;
          case "status":
            cmp = a.stageSortRank - b.stageSortRank;
            break;
          default:
            break;
        }
        return sortDir === "desc" ? -cmp : cmp;
      });
    }
    return list;
  }, [displayClaims, search, stageFilter, sortKey, sortDir]);

  const paginatedClaims = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredClaims.slice(start, start + pageSize);
  }, [filteredClaims, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredClaims.length / pageSize) || 1);
  const visibleClaimIds = useMemo(
    () => paginatedClaims.map((claim) => claim.id),
    [paginatedClaims]
  );
  const allVisibleSelected =
    visibleClaimIds.length > 0 &&
    visibleClaimIds.every((claimId) => selectedClaimIds.includes(claimId));
  const someVisibleSelected =
    visibleClaimIds.some((claimId) => selectedClaimIds.includes(claimId)) &&
    !allVisibleSelected;
  const deleteTargetClaims = useMemo(
    () =>
      deleteTargetIds
        .map((claimId) => claimsById.get(claimId))
        .filter((claim): claim is DisplayClaim => Boolean(claim)),
    [claimsById, deleteTargetIds]
  );

  useEffect(() => {
    setSelectedClaimIds((current) =>
      current.filter((claimId) => claimsById.has(claimId))
    );
  }, [claimsById]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const handleSort = (key: string) => {
    const nextKey = key as ClaimSortKey;
    if (sortKey === nextKey) {
      setSortDir((direction) => (direction === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(nextKey);
      setSortDir(nextKey === "date" ? "desc" : "asc");
    }
    setPage(1);
  };

  const openDeleteDialog = (claimIds: string[]) => {
    const normalizedIds = Array.from(
      new Set(
        claimIds
          .map((claimId) => claimId.trim())
          .filter((claimId) => claimsById.has(claimId))
      )
    );
    if (normalizedIds.length === 0) {
      return;
    }
    setDeleteTargetIds(normalizedIds);
    setDeleteDialogOpen(true);
  };

  const closeDeleteDialog = () => {
    if (deletePending) {
      return;
    }
    setDeleteDialogOpen(false);
    setDeleteTargetIds([]);
  };

  const handleToggleVisibleClaims = (checked: boolean | "indeterminate") => {
    if (checked === true) {
      setSelectedClaimIds((current) => {
        const next = new Set(current);
        visibleClaimIds.forEach((claimId) => next.add(claimId));
        return Array.from(next);
      });
      return;
    }
    setSelectedClaimIds((current) =>
      current.filter((claimId) => !visibleClaimIds.includes(claimId))
    );
  };

  const handleDelete = async () => {
    if (deleteTargetIds.length === 0) {
      return;
    }

    setDeletePending(true);
    try {
      const deletedIds =
        deleteTargetIds.length === 1
          ? [(await deleteFnol(deleteTargetIds[0])).complaint_id]
          : (await bulkDeleteFnol(deleteTargetIds)).deleted_ids;

      if (deletedIds.length === 0) {
        toast({
          title: "Nothing deleted",
          description: "The selected claims could not be found anymore.",
          variant: "destructive",
        });
      } else {
        queryClient.setQueryData<FnolResponse[]>(fnolListQueryKey, (current = []) =>
          current.filter((claim) => !deletedIds.includes(claim.complaint_id))
        );
        setSelectedClaimIds((current) =>
          current.filter((claimId) => !deletedIds.includes(claimId))
        );
        toast({
          title: deletedIds.length === 1 ? "Claim deleted" : "Claims deleted",
          description:
            deletedIds.length === 1
              ? "The claim and its saved analysis records were removed."
              : `${deletedIds.length} claims and their saved analysis records were removed.`,
        });
      }

      setDeleteDialogOpen(false);
      setDeleteTargetIds([]);
    } catch (err) {
      const description =
        err instanceof Error ? err.message : "Could not delete the selected claims.";
      toast({
        title: "Delete failed",
        description,
        variant: "destructive",
      });
    } finally {
      setDeletePending(false);
    }
  };

  const deleteDialogTitle =
    deleteTargetIds.length === 1 ? "Delete claim" : "Delete selected claims";
  const deleteDialogDescription =
    deleteTargetIds.length === 1
      ? `This will permanently remove ${deleteTargetClaims[0]?.claimNumber || "the selected claim"} and its saved evaluations, image screening, duplicate matches, damage breakdown, valuation, and supporting claim records.`
      : `This will permanently remove ${deleteTargetIds.length} selected claims and their saved evaluations, image screening, duplicate matches, damage breakdown, valuation, and supporting claim records.`;
  const deleteDialogActionLabel =
    deleteTargetIds.length === 1 ? "Delete claim" : "Delete claims";

  return (
    <AppLayout title="Claims List" subtitle="Manage and process insurance claims">
      <div className="space-y-6 animate-fade-in">
        <TableToolbar
          searchPlaceholder="Search claims, policies, customers..."
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          primaryAction={
            <>
              {selectedClaimIds.length > 0 ? (
                <Button
                  variant="destructive"
                  onClick={() => openDeleteDialog(selectedClaimIds)}
                  disabled={deletePending}
                >
                  {deletePending && deleteTargetIds.length > 1 ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Delete selected ({selectedClaimIds.length})
                </Button>
              ) : null}
              {/* Preserved for future manual-claim intake re-enable.
              <Button asChild>
                <Link to="/claims/new">
                  Submit FNOL
                </Link>
              </Button>
              */}
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleFetchFnolData()}
                disabled={loading || refreshing || deletePending}
              >
                <Plus className="mr-2 h-4 w-4" />
                Fetch FNOL Data
              </Button>
              <Button
                onClick={() =>
                  void loadClaims({ manual: true, announceNewRecords: true })
                }
                disabled={loading || refreshing || deletePending}
              >
                {refreshing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Fetch FNOL
              </Button>
            </>
          }
        />

        <Card className="card-elevated overflow-hidden border-none">
          <StatusWrapper
            status={loading ? "loading" : errorSummary ? "error" : "success"}
            loading={<ClaimsListSkeleton />}
            loadingTitle="Loading claims"
            loadingDescription="Fetching the claims table, latest evaluation state, and stored vehicle photos."
            errorTitle="Could not load claims"
            error={errorSummary}
            onRetry={() =>
              void loadClaims({ manual: true, announceNewRecords: true })
            }
          >
            <>
              <Table>
                <TableHeader className="table-header-bg">
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="w-12 pl-6">
                      <Checkbox
                        aria-label="Select all visible claims"
                        checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                        disabled={visibleClaimIds.length === 0 || deletePending}
                        onCheckedChange={handleToggleVisibleClaims}
                      />
                    </TableHead>
                    <SortableTableHead
                      sortKey="claimNumber"
                      currentSortKey={sortKey}
                      direction={sortDir}
                      onSort={handleSort}
                    >
                      Claim No #
                    </SortableTableHead>
                    <SortableTableHead
                      sortKey="policy"
                      currentSortKey={sortKey}
                      direction={sortDir}
                      onSort={handleSort}
                    >
                      Policy No
                    </SortableTableHead>
                    <SortableTableHead
                      sortKey="customer"
                      currentSortKey={sortKey}
                      direction={sortDir}
                      onSort={handleSort}
                    >
                      Insured /Customer
                    </SortableTableHead>
                    <SortableTableHead
                      sortKey="type"
                      currentSortKey={sortKey}
                      direction={sortDir}
                      onSort={handleSort}
                    >
                      Incident Type
                    </SortableTableHead>
                    <SortableTableHead
                      sortKey="date"
                      currentSortKey={sortKey}
                      direction={sortDir}
                      onSort={handleSort}
                    >
                      Notification Date
                    </SortableTableHead>
                    <SortableTableHead
                      sortKey="status"
                      currentSortKey={sortKey}
                      direction={sortDir}
                      onSort={handleSort}
                    >
                      Claim Stage
                    </SortableTableHead>
                    <TableHead className="pr-6 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredClaims.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                        No claims found.{" "}
                        {/* Preserved for future manual-claim intake re-enable.
                        <Link to="/claims/new" className="text-primary hover:underline">
                          Submit a new claim
                        </Link>
                        */}
                        <button
                          type="button"
                          className="text-primary hover:underline"
                          onClick={() =>
                            void loadClaims({
                              manual: true,
                              announceNewRecords: true,
                            })
                          }
                        >
                          Fetch latest FNOL records
                        </button>
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedClaims.map((claim) => {
                      const selected = selectedClaimIds.includes(claim.id);
                      return (
                        <TableRow key={claim.id} className="group" data-state={selected ? "selected" : undefined}>
                          <TableCell className="pl-6">
                            <Checkbox
                              aria-label={`Select claim ${claim.claimNumber}`}
                              checked={selected}
                              disabled={deletePending}
                              onCheckedChange={(checked) => {
                                setSelectedClaimIds((current) =>
                                  toggleSelection(current, claim.id, checked === true)
                                );
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <Link
                              to={`/claims/${claim.id}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {claim.claimNumber}
                            </Link>
                          </TableCell>
                          <TableCell className="text-sm tabular-nums text-foreground">
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
                            {formatDate(claim.claimRequestedDate) || "—"}
                          </TableCell>
                          <TableCell>
                            <ClaimListWorkflowBadges
                              workflowSnapshot={claim.workflowSnapshot}
                              statusLabel={claim.statusLabel}
                            />
                          </TableCell>
                          <TableCell className="pr-6 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {claim.showReportPdf ? (
                                <ClaimReportPdfButton complaintId={claim.id} />
                              ) : null}
                              <Button
                                variant="ghost"
                                size="icon"
                                title={`Delete claim ${claim.claimNumber}`}
                                aria-label={`Delete claim ${claim.claimNumber}`}
                                disabled={deletePending}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  openDeleteDialog([claim.id]);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" asChild>
                                <Link to={`/claims/${claim.id}`} title="View claim">
                                  <ZoomIn className="h-4 w-4" />
                                </Link>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
              <DataTablePagination
                totalCount={filteredClaims.length}
                page={page}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                itemLabel="claims"
              />
            </>
          </StatusWrapper>
        </Card>
      </div>

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setDeleteDialogOpen(true);
            return;
          }
          closeDeleteDialog();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteDialogDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteTargetClaims.length > 1 ? (
            <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Selected claims</p>
              <p>{deleteTargetClaims.map((claim) => claim.claimNumber).join(", ")}</p>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeDeleteDialog} disabled={deletePending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletePending}
            >
              {deletePending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                deleteDialogActionLabel
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
