import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Pencil } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTablePagination, TableToolbar } from "@/components/data-table";
import { TablePageSkeleton, StatusWrapper } from "@/components/ui/status-wrapper";
import { listInvoiceHistory, type InvoiceHistoryItem } from "@/lib/api";
import { getApiErrorSummary } from "@/lib/httpClient";

export default function InvoiceHistory() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [items, setItems] = useState<InvoiceHistoryItem[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const loadList = useCallback(
    (search: string) => {
      let cancelled = false;
      setLoading(true);
      setError(null);
      listInvoiceHistory({ q: search })
        .then((res) => {
          if (!cancelled) {
            setItems(res.items || []);
            setPage(1);
          }
        })
        .catch((err) => {
          if (!cancelled) setError(err);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => { cancelled = true; };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reloadToken],
  );

  useEffect(() => {
    return loadList(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken]);

  const errorSummary = error ? getApiErrorSummary(error) : null;

  const paginatedItems = useMemo(() => {
    const filtered = items.filter((inv) =>
      !q ||
      inv.claim_number?.toLowerCase().includes(q.toLowerCase()) ||
      inv.vehicle_number?.toLowerCase().includes(q.toLowerCase())
    );
    const start = (page - 1) * pageSize;
    return { list: filtered.slice(start, start + pageSize), total: filtered.length };
  }, [items, page, pageSize, q]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(paginatedItems.total / pageSize));
    if (page > totalPages) setPage(totalPages);
  }, [paginatedItems.total, page, pageSize]);

  return (
    <AppLayout title="Invoice History" subtitle="Processed invoices">
      <div className="space-y-4 animate-fade-in">
        <TableToolbar
          searchPlaceholder="Search claims, vehicles..."
          searchValue={q}
          onSearchChange={(v) => setQ(v)}
          className="shadow-sm"
        />

        <StatusWrapper
          status={loading ? "loading" : errorSummary ? "error" : "success"}
          loading={<TablePageSkeleton rows={8} />}
          loadingTitle="Loading invoice history"
          loadingDescription="Fetching processed invoices and digitized claim documents."
          errorTitle="Could not load invoice history"
          error={errorSummary}
          onRetry={() => setReloadToken((t) => t + 1)}
        >
          <div className="overflow-hidden rounded-md border bg-background shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Claim Number</TableHead>
                  <TableHead>Vehicle Number</TableHead>
                  <TableHead>Engine</TableHead>
                  <TableHead>Chassis</TableHead>
                  <TableHead>Make</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead className="w-28 text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedItems.list.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                      No invoices found.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedItems.list.map((inv) => (
                    <TableRow key={inv.claim_number}>
                      <TableCell className="font-semibold">{inv.claim_number}</TableCell>
                      <TableCell>{inv.vehicle_number ?? "—"}</TableCell>
                      <TableCell>{inv.engine_number ?? "—"}</TableCell>
                      <TableCell>{inv.chassis_number ?? "—"}</TableCell>
                      <TableCell>{inv.make ?? "—"}</TableCell>
                      <TableCell>{inv.model_number ?? "—"}</TableCell>
                      <TableCell>{inv.amount ?? "—"}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              navigate(`/invoice-history/${encodeURIComponent(inv.claim_number)}/view`)
                            }
                            title="View"
                          >
                            <Eye className="h-4 w-4 text-blue-600" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              navigate(`/Claim-Digitization?editClaim=${encodeURIComponent(inv.claim_number)}`)
                            }
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4 text-blue-600" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <DataTablePagination
              totalCount={paginatedItems.total}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              itemLabel="invoices"
            />
          </div>
        </StatusWrapper>
      </div>
    </AppLayout>
  );
}
