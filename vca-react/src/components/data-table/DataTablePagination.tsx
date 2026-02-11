import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const ROWS_PER_PAGE_OPTIONS = [5, 10, 20, 50, 100];

export interface DataTablePaginationProps {
  /** Total number of items across all pages */
  totalCount: number;
  /** Current page (1-based) */
  page: number;
  /** Items per page */
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  /** Optional label for the entity (e.g. "users", "claims") */
  itemLabel?: string;
  className?: string;
}

export function DataTablePagination({
  totalCount,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  itemLabel = "items",
  className,
}: DataTablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const start = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);

  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between px-4 py-3 border-t bg-muted/30",
        className,
      )}
    >
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          Rows per page:
        </span>
        <Select
          value={String(pageSize)}
          onValueChange={(v) => onPageSizeChange(Number(v))}
        >
          <SelectTrigger className="w-[70px] h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROWS_PER_PAGE_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          Showing {start} to {end} of {totalCount} {itemLabel}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-1">
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => {
              if (totalPages <= 7) return true;
              if (p === 1 || p === totalPages) return true;
              if (Math.abs(p - page) <= 1) return true;
              return false;
            })
            .map((p, idx, arr) => {
              const showEllipsisBefore = idx > 0 && p - arr[idx - 1] > 1;
              return (
                <span key={p} className="flex items-center gap-1">
                  {showEllipsisBefore && (
                    <span className="px-1 text-muted-foreground">…</span>
                  )}
                  <Button
                    variant={page === p ? "default" : "outline"}
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onPageChange(p)}
                  >
                    {p}
                  </Button>
                </span>
              );
            })}
        </div>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
