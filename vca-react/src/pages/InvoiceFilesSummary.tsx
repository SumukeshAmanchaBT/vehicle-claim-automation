import { useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCcw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTablePagination } from "@/components/data-table";
import { listInvoiceFilesSummary, type InvoiceFileSummaryItem } from "@/lib/api";
import { useToast } from "@/components/ui/use-toast";
import type { AxiosError } from "axios";

export default function InvoiceFilesSummary() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<InvoiceFileSummaryItem[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listInvoiceFilesSummary({ limit: 200 });
      setItems(res.items || []);
      setPage(1);
    } catch (e) {
      const err = e as AxiosError<any>;
      const msg = err?.response?.data?.error || "Failed to load invoice files summary.";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
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
    <AppLayout title="Invoice Files Summary" subtitle="Summary of files uploaded to S3">
      <div className="space-y-4 animate-fade-in">
        <Card className="card-elevated overflow-hidden border-none">
          <Table className="table-fixed">
            <TableHeader className="table-header-bg">
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-[120px] pl-6">Claim ID</TableHead>
                <TableHead className="w-[240px]">Filename</TableHead>
                <TableHead>Blob Link</TableHead>
                <TableHead className="w-[140px]">Upload Status</TableHead>
                <TableHead className="w-[150px]">Classification type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                    {loading ? (
                      <div className="flex items-center justify-center">
                        <div className="please-wait-spinner" aria-label="Loading">
                          <span className="dot" />
                          <span className="dot" />
                          <span className="dot" />
                          <span className="dot" />
                          <span className="dot" />
                          <span className="dot" />
                          <span className="dot" />
                          <span className="dot" />
                        </div>
                      </div>
                    ) : (
                      "No records found."
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                paginatedItems.map((row, idx) => (
                  <TableRow key={`${row.claim_id}-${row.filename}-${idx}`} className="group">
                    <TableCell className="pl-6 font-medium">{row.claim_id || "—"}</TableCell>
                    <TableCell className="max-w-[280px] truncate" title={row.filename}>
                      {row.filename || "—"}
                    </TableCell>
                    <TableCell className="whitespace-normal break-all">
                      {row.blob_url ? (
                        <a
                          href={row.blob_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex max-w-full items-start gap-1 text-primary hover:underline"
                        >
                          <span className="break-all">
                            {row.blob_key ? row.blob_key.split("/").slice(-2).join("/") : "Open"}
                          </span>
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>{row.upload_status || "—"}</TableCell>
                    <TableCell>{row.classification_type || "—"}</TableCell>
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
            itemLabel="files"
          />

          <div className="flex items-center justify-end gap-3 border-t bg-muted/30 px-4 py-3">
            <Button
              variant="destructive"
              onClick={() => navigate(-1)}
              disabled={loading}
              className="min-w-[110px]"
            >
              Exit
            </Button>
            <Button onClick={load} disabled={loading} className="min-w-[110px] bg-red-600 hover:bg-red-700">
              <RefreshCcw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}

