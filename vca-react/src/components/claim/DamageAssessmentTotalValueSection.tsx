import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatThbCurrency } from "@/lib/formatThbCurrency";
import type {
  DamagePartAssessmentItem,
  DetailedDamageAssessmentResponse,
  TotalValueResponse,
} from "@/lib/api";

type DamageAssessmentFinancialSummaryProps = {
  totalValue: TotalValueResponse | null;
  insightsLoading: boolean;
  /**
   * When GET total-value omits `breakdown` (older API), pass merged DA row count so
   * "Affected parts" matches the part-level table.
   */
  affectedPartsCount?: number;
};

/**
 * Financial summary for the Damage Assessment tab — all figures from GET …/total-value only.
 */
export function DamageAssessmentFinancialSummary({
  totalValue,
  insightsLoading,
  affectedPartsCount,
}: DamageAssessmentFinancialSummaryProps) {
  if (insightsLoading && !totalValue) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 px-3.5 py-4 text-sm text-muted-foreground lg:col-span-7">
        Loading valuation totals…
      </div>
    );
  }

  if (!totalValue) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 px-3.5 py-4 text-sm text-muted-foreground lg:col-span-7">
        Valuation totals are not available for this claim yet.
      </div>
    );
  }

  const gross = totalValue.gross_estimate ?? 0;
  const breakdown = totalValue.breakdown ?? [];
  const noStructuralDamage = gross === 0 && breakdown.length === 0;

  if (noStructuralDamage) {
    return (
      <div className="lg:col-span-7">
        <Alert
          variant="default"
          className="border-warning/40 bg-warning/10 text-foreground [&>svg]:text-warning"
        >
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>No Structural Damage Detected</AlertTitle>
          <AlertDescription className="text-sm text-foreground/90">
            Damage assessment did not produce billable part lines. Review photos and policy before
            proceeding.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const affectedParts =
    typeof affectedPartsCount === "number" ? affectedPartsCount : breakdown.length;
  const excess = totalValue.excess_amount ?? 0;
  const net = totalValue.net_payable ?? 0;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:col-span-7 lg:grid-cols-4">
      <div className="rounded-lg border border-border/50 bg-muted/15 p-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/55">
          Gross Estimate
        </p>
        <p className="mt-1.5 text-base font-semibold tabular-nums text-foreground">
          {formatThbCurrency(gross)}
        </p>
      </div>
      <div className="rounded-lg border border-border/50 bg-muted/15 p-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/55">
          Excess Amount
        </p>
        <p className="mt-1.5 text-base font-semibold tabular-nums text-foreground">
          {formatThbCurrency(excess)}
        </p>
      </div>
      <div className="rounded-lg border border-border/50 bg-muted/15 p-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/55">
          Net Payable
        </p>
        <p className="mt-1.5 text-base font-semibold tabular-nums text-foreground">
          {formatThbCurrency(net)}
        </p>
      </div>
      <div className="rounded-lg border border-border/50 bg-muted/15 p-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/55">
          Affected Parts
        </p>
        <p className="mt-1.5 text-base font-semibold tabular-nums text-foreground">
          {affectedParts}
        </p>
      </div>
    </div>
  );
}

type DamageAssessmentPartBreakdownTableProps = {
  rows: DamagePartAssessmentItem[];
  className?: string;
};

export function DamageAssessmentPartBreakdownTable({
  rows,
  className,
}: DamageAssessmentPartBreakdownTableProps) {
  if (rows.length === 0) {
    return (
      <p className={cn("px-5 py-4 text-sm text-muted-foreground sm:px-6", className)}>
        No part-level damage breakdown is available for this claim.
      </p>
    );
  }

  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/60">
            <th className="rounded-tl-lg px-4 py-3 pl-5 sm:pl-6">Part</th>
            <th className="px-4 py-3">Damage</th>
            <th className="px-4 py-3 text-right">Part damage score (0–100)</th>
            <th className="px-4 py-3">Repair action</th>
            <th className="rounded-tr-lg px-4 py-3 pr-5 text-right sm:pr-6">Est. amount</th>
          </tr>
        </thead>
        <tbody className="text-[13px]">
          {rows.map((item, index) => (
            <tr
              key={`${item.part_name}-${item.damage_type}-${index}`}
              className={cn(
                "border-b border-border/30 transition-colors hover:bg-muted/15",
                index % 2 === 1 && "bg-muted/5"
              )}
            >
              <td className="px-4 py-3 pl-5 font-semibold text-foreground sm:pl-6">
                {item.part_name}
              </td>
              <td className="max-w-[12rem] px-4 py-3 text-muted-foreground">{item.damage_type}</td>
              <td className="px-4 py-3 text-right tabular-nums text-foreground/90">
                {item.severity_percent}%
              </td>
              <td className="px-4 py-3 text-muted-foreground">{item.repair_action}</td>
              <td className="px-4 py-3 pr-5 text-right text-sm font-semibold tabular-nums text-foreground sm:pr-6">
                {formatThbCurrency(item.estimated_amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Part rows for the DA tab table: prefer GET …/total-value `breakdown`, else persisted
 * GET …/damage-assessment-detailed `part_breakdown` (older servers omitted breakdown on total-value).
 */
export function selectPartBreakdownRows(
  totalValue: TotalValueResponse | null,
  detailedDamageAssessment?: DetailedDamageAssessmentResponse | null
): DamagePartAssessmentItem[] {
  const fromValuation = totalValue?.breakdown ?? [];
  if (fromValuation.length > 0) {
    return fromValuation;
  }
  return detailedDamageAssessment?.part_breakdown ?? [];
}

export function shouldShowPartBreakdownTable(
  totalValue: TotalValueResponse | null,
  detailedDamageAssessment?: DetailedDamageAssessmentResponse | null
): boolean {
  if (!totalValue) return false;
  const gross = totalValue.gross_estimate ?? 0;
  const rowCount = selectPartBreakdownRows(totalValue, detailedDamageAssessment).length;
  if (gross === 0 && rowCount === 0) {
    return false;
  }
  return gross > 0;
}
