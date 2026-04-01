import { useEffect, useMemo, useState } from "react";
import { Eye, Pencil } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTablePagination, TableToolbar } from "@/components/data-table";
import { listInvoiceHistory, type InvoiceHistoryItem } from "@/lib/api";
import { useToast } from "@/components/ui/use-toast";
import type { AxiosError } from "axios";

export default function InvoiceHistory() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [items, setItems] = useState<InvoiceHistoryItem[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const loadList = async (search?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await listInvoiceHistory({ q: search || "" });
      setItems(res.items || []);
      setPage(1);
    } catch (e) {
      const err = e as AxiosError<any>;
      const msg = err?.response?.data?.error || "Failed to load invoice history.";
      setError(msg);
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadList("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paginatedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    if (page > totalPages) setPage(totalPages);
  }, [items.length, page, pageSize]);

  return (
    <AppLayout title="Invoice History" subtitle="Processed invoices">
      <div className="space-y-4 animate-fade-in">
        {error && <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

        <TableToolbar
          searchPlaceholder="Search claims, vehicles..."
          searchValue={q}
          onSearchChange={(v) => {
            setQ(v);
            loadList(v);
          }}
          className="shadow-sm"
        />

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
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-sm text-muted-foreground">
                      {loading ? "Loading..." : "No invoices found."}
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedItems.map((inv) => (
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
              totalCount={items.length}
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
      </div>
    </AppLayout>
  );
}

