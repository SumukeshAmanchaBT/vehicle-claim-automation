import { cn } from "@/lib/utils";
import type { DamageAssessmentDisplayStatus } from "@/models/damageAssessmentCards";

const STATUS_LABELS: Record<DamageAssessmentDisplayStatus, string> = {
  clear: "Clear",
  warning: "Warning",
  critical: "Critical",
  info: "Info",
  partial: "Incomplete",
  failed: "Failed",
};

type Props = {
  status: DamageAssessmentDisplayStatus;
  className?: string;
};

/**
 * Backend display status → restrained chip styling (not aggressive).
 * `info` ≠ all clear; `partial` = incomplete evidence; `failed` = safe error signal.
 */
export function DamageAssessmentStatusChip({ status, className }: Props) {
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span
      aria-label={`Assessment status: ${label}`}
      className={cn(
        "inline-flex shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold tracking-tight",
        status === "clear" &&
          "border-emerald-500/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
        status === "warning" &&
          "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100",
        status === "critical" &&
          "border-destructive/40 bg-destructive/10 text-destructive",
        status === "info" &&
          "border-sky-500/35 bg-sky-500/10 text-sky-900 dark:text-sky-100",
        status === "partial" &&
          "border-muted-foreground/40 bg-muted/80 text-muted-foreground",
        status === "failed" &&
          "border-destructive/50 bg-destructive/15 text-destructive",
        className
      )}
    >
      {label}
    </span>
  );
}
