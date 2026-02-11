import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface TableToolbarProps {
  /** Placeholder for search input */
  searchPlaceholder?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  /** Optional filter dropdowns (e.g. Role, Status) - render Select or custom UI */
  filters?: React.ReactNode;
  /** Primary action (e.g. "+ Add New User") */
  primaryAction?: React.ReactNode;
  className?: string;
}

export function TableToolbar({
  searchPlaceholder = "Search...",
  searchValue,
  onSearchChange,
  filters,
  primaryAction,
  className,
}: TableToolbarProps) {
  return (
    <Card className={cn("card-elevated border-none", className)}>
      <CardContent className="p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={searchPlaceholder}
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                className="pl-9"
              />
            </div>
            {filters}
          </div>
          {primaryAction && (
            <div className="flex shrink-0 items-center gap-2">
              {primaryAction}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
