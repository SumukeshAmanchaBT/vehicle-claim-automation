import { TableHead } from "@/components/ui/table";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SortDirection = "asc" | "desc" | null;

export interface SortableTableHeadProps {
  children: React.ReactNode;
  sortKey?: string;
  currentSortKey?: string | null;
  direction?: SortDirection;
  onSort?: (key: string) => void;
  className?: string;
}

export function SortableTableHead({
  children,
  sortKey,
  currentSortKey,
  direction,
  onSort,
  className,
}: SortableTableHeadProps) {
  const isActive = sortKey != null && currentSortKey === sortKey;
  const canSort = sortKey != null && onSort;

  return (
    <TableHead
      className={cn(
        canSort && "cursor-pointer select-none hover:bg-muted/70",
        className,
      )}
      onClick={() => canSort && onSort(sortKey)}
    >
      <div className="flex items-center gap-1">
        {children}
        {canSort && (
          <span className="inline-flex text-muted-foreground">
            {!isActive && <ArrowUpDown className="h-4 w-4" />}
            {isActive && direction === "asc" && (
              <ArrowUp className="h-4 w-4" />
            )}
            {isActive && direction === "desc" && (
              <ArrowDown className="h-4 w-4" />
            )}
          </span>
        )}
      </div>
    </TableHead>
  );
}
