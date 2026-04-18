import { StatusBadge } from "@/components/ui/status-badge";
import type { ClaimWorkflowSnapshot } from "@/models/fnol";
import {
  getClaimListWorkflowPrimaryBadgeForClaim,
} from "@/lib/claimListWorkflowBadge";
import { cn } from "@/lib/utils";

type Props = {
  workflowSnapshot?: ClaimWorkflowSnapshot | null;
  statusLabel?: string | null;
  className?: string;
};

/**
 * Claim list row badges are snapshot-led, with a narrow recommendation-status
 * fallback only once the snapshot already shows DA-ready financials.
 * Business Rule Validation Failed takes precedence; primary workflow badge is hidden when failed.
 * "Evaluation Ready" is a secondary teal badge when claim evaluation is visible.
 */
export function ClaimListWorkflowBadges({
  workflowSnapshot,
  statusLabel,
  className,
}: Props) {
  const brvFailed = workflowSnapshot?.business_rule_validation?.passed === false;
  const evaluationReady =
    !brvFailed && workflowSnapshot?.claim_evaluation?.visible === true;
  const primary = getClaimListWorkflowPrimaryBadgeForClaim(
    workflowSnapshot,
    statusLabel
  );

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {brvFailed ? (
        <StatusBadge status="rejected">Business Rule Validation Failed</StatusBadge>
      ) : (
        <StatusBadge status={primary.variant}>{primary.label}</StatusBadge>
      )}
      {evaluationReady ? (
        <StatusBadge status="evaluation_ready">Evaluation Ready</StatusBadge>
      ) : null}
    </div>
  );
}
