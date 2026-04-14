import { useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCcw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTablePagination } from "@/components/data-table";
import { TablePageSkeleton, StatusWrapper } from "@/components/ui/status-wrapper";
import { listInvoiceFilesSummary, type InvoiceFileSummaryItem } from "@/lib/api";
import { getApiErrorSummary } from "@/lib/httpClient";

export default function InvoiceFilesSummary() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [items, setItems] = useState<InvoiceFileSummaryItem[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listInvoiceFilesSummary({ limit: 200 })
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
  }, [reloadToken]);

  const errorSummary = error ? getApiErrorSummary(error) : null;

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
        <StatusWrapper
          status={loading ? "loading" : errorSummary ? "error" : "success"}
          loading={<TablePageSkeleton rows={6} />}
          loadingTitle="Loading invoice files"
          loadingDescription="Fetching digitized invoice files and their S3 upload status."
          errorTitle="Could not load invoice files"
          error={errorSummary}
          onRetry={() => setReloadToken((t) => t + 1)}
        >
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
                      No records found.
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
                className="min-w-[110px]"
              >
                Exit
              </Button>
              <Button
                onClick={() => setReloadToken((t) => t + 1)}
                disabled={loading}
                className="min-w-[110px] bg-red-600 hover:bg-red-700"
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            </div>
          </Card>
        </StatusWrapper>
      </div>
    </AppLayout>
  );
}
