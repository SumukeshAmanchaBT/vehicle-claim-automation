import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatThbCurrency } from "@/lib/formatThbCurrency";
import type { ClaimEvaluationResponse } from "@/lib/api";

/** Same default as backend `MAJOR_CLAIM_THRESHOLD` (phase1_runtime / seed_phase1_config). */
const CLAIM_EVALUATION_MAJOR_THRESHOLD_THB = 50_000;

type ClaimEvaluationTabContentProps = {
  evaluation: ClaimEvaluationResponse;
};

function grossFromEvaluation(ev: ClaimEvaluationResponse): number | null {
  const g = ev.gross_estimate ?? ev.estimated_repair;
  if (g == null) return null;
  return typeof g === "number" ? g : null;
}

/**
 * Amount compared to the major threshold — mirrors backend: DA gross first, then net, then FNOL estimate.
 */
function amountUsedForClaimTypeClassification(ev: ClaimEvaluationResponse): number {
  if (
    typeof ev.claim_complexity_amount === "number" &&
    Number.isFinite(ev.claim_complexity_amount) &&
    ev.claim_complexity_amount >= 0
  ) {
    return ev.claim_complexity_amount;
  }
  const gross = grossFromEvaluation(ev);
  if (gross != null && gross > 0) return gross;
  const net = ev.claim_amount;
  if (net != null && net > 0) return net;
  const est = ev.estimated_amount;
  if (est != null && est > 0 && typeof est === "number") return est;
  return 0;
}

function claimTypeClassificationLabel(ev: ClaimEvaluationResponse): "Simple Claim" | "Major Claim" {
  const amount = amountUsedForClaimTypeClassification(ev);
  return amount >= CLAIM_EVALUATION_MAJOR_THRESHOLD_THB ? "Major Claim" : "Simple Claim";
}

function approvalBadgeClasses(
  state: string | null | undefined
): { label: string; className: string } | null {
  switch (state) {
    case "straight_through_eligible":
      return {
        label: "Straight-Through Approved",
        className: "border-success/40 bg-success/10 text-success",
      };
    case "manual_review_required":
      return {
        label: "Manual Review Required",
        className:
          "border-warning/40 bg-warning/15 text-amber-900 dark:text-amber-100",
      };
    case "pending_damage_assessment":
      return {
        label: "Manual Review Required",
        className:
          "border-warning/40 bg-warning/15 text-amber-900 dark:text-amber-100",
      };
    case "rejected":
      return {
        label: "Rejected",
        className: "border-destructive/40 bg-destructive/10 text-destructive",
      };
    default:
      return null;
  }
}

/**
 * Claim Evaluation tab body — financial figures from GET /evaluation, Simple vs Major
 * classification (fixed ฿50,000 threshold), and approval badge when evaluation is complete.
 */
export function ClaimEvaluationTabContent({ evaluation }: ClaimEvaluationTabContentProps) {
  const ws = evaluation.workflow_snapshot;
  const ce = ws?.claim_evaluation;
  const da = ws?.damage_assessment;
  const financialsReady = ce?.financials_ready === true;
  const claimEvalCompleted = ce?.completed === true;
  const partCount = da?.part_count ?? 0;

  const approvalState = evaluation.decision_summary?.approval_state ?? null;
  const badge =
    claimEvalCompleted && financialsReady ? approvalBadgeClasses(approvalState) : null;

  if (!financialsReady) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center leading-relaxed">
        Claim financials are not available yet. Damage Assessment must produce valid repair cost data
        before evaluation can be finalized.
      </p>
    );
  }

  const gross = grossFromEvaluation(evaluation);
  const excess = evaluation.excess_amount;
  const net = evaluation.net_payable ?? evaluation.claim_amount;
  const claimAmt = evaluation.claim_amount;

  const grossNum = gross ?? 0;
  const excessNum = excess ?? 0;
  const inconsistent = excessNum > grossNum;

  const partLine =
    partCount === 0 ? (
      <p className="rounded-md border border-warning/35 bg-warning/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-50">
        0 parts – incomplete DA
      </p>
    ) : (
      <p className="text-sm text-muted-foreground">
        {partCount} part{partCount === 1 ? "" : "s"} assessed
      </p>
    );

  const claimTypeLabel = claimTypeClassificationLabel(evaluation);

  return (
    <div className="space-y-6">
      {inconsistent ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Financial inconsistency detected</AlertTitle>
          <AlertDescription>
            Financial inconsistency detected – contact support.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div
            data-testid="claim-type-classification-card"
            className={cn(
              "rounded-lg border-2 p-4 sm:col-span-2",
              claimTypeLabel === "Major Claim"
                ? "border-warning/40 bg-warning/10"
                : "border-success/35 bg-success/5"
            )}
          >
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                  claimTypeLabel === "Major Claim" ? "bg-warning/20" : "bg-success/20"
                )}
              >
                <Layers
                  className={cn(
                    "h-5 w-5",
                    claimTypeLabel === "Major Claim" ? "text-warning" : "text-success"
                  )}
                  aria-hidden
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Claim type classification</p>
                <p
                  className={cn(
                    "text-xl font-bold",
                    claimTypeLabel === "Major Claim" ? "text-warning" : "text-success"
                  )}
                >
                  {claimTypeLabel}
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-border/50 bg-muted/15 p-4 sm:col-span-2">
            <p className="text-xs text-muted-foreground">Gross Repair Estimate</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
              {gross != null ? formatThbCurrency(gross) : "—"}
            </p>
          </div>
          <div className="rounded-lg border border-border/50 bg-muted/15 p-4 sm:col-span-2">
            <p className="text-xs text-muted-foreground">Policy Excess / Deductible</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
              {excess != null ? formatThbCurrency(excess) : "—"}
            </p>
          </div>
          <div className="rounded-lg border border-primary/25 bg-primary/5 p-4 sm:col-span-2">
            <p className="text-xs text-muted-foreground">Net Claim Payable</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-foreground">
              {net != null ? formatThbCurrency(net) : "—"}
            </p>
          </div>
          <div className="rounded-lg border border-border/50 bg-muted/15 p-4 sm:col-span-2">
            <p className="text-xs text-muted-foreground">Claim Amount</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
              {claimAmt != null ? formatThbCurrency(claimAmt) : "—"}
            </p>
          </div>
        </div>
      )}

      {!inconsistent && badge ? (
        <div
          className={cn(
            "inline-flex rounded-full border px-3 py-1 text-xs font-semibold",
            badge.className
          )}
        >
          {badge.label}
        </div>
      ) : null}

      {partLine}
    </div>
  );
}
