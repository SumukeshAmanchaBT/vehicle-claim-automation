export type ClaimStatusBadgeVariant =
  | "approved"
  | "pending"
  | "rejected"
  | "processing"
  | "default";

export type ClaimStatusKey =
  | "auto_approved"
  | "fraudulent"
  | "manual_review"
  | "open"
  | "pending"
  | "pending_damage_detection";

export const CLAIM_STATUS_META: Record<
  ClaimStatusKey,
  { label: string; badge: ClaimStatusBadgeVariant }
> = {
  auto_approved: { label: "Recommendation shared", badge: "approved" },
  fraudulent: { label: "Business Rule Validation-fail", badge: "rejected" },
  manual_review: { label: "Recommendation shared", badge: "pending" },
  open: { label: "FNOL", badge: "processing" },
  pending: { label: "Pending", badge: "pending" },
  pending_damage_detection: {
    label: "Business Rule Validation-pass",
    badge: "pending",
  },
};

const CLAIM_STATUS_ALIASES: Record<string, ClaimStatusKey> = {
  "recommendation shared": "auto_approved",
  "closed damage detection": "auto_approved",
  "business rule validation-fail": "fraudulent",
  fraudulent: "fraudulent",
  "manual review": "manual_review",
  manual_review: "manual_review",
  fnol: "open",
  open: "open",
  "open-fnol": "open",
  "open to fnol": "open",
  "business rule validation-pass": "pending_damage_detection",
  "pending damage detection": "pending_damage_detection",
  pending_damage_detection: "pending_damage_detection",
};

const PENDING_REVIEW_STATUSES = new Set<ClaimStatusKey>([
  "open",
  "pending",
  "pending_damage_detection",
]);

const MANUAL_PROCESSING_STATUSES = new Set<ClaimStatusKey>([
  "fraudulent",
  "manual_review",
]);

export function normalizeClaimStatus(raw?: string | null): ClaimStatusKey {
  const value = (raw ?? "").trim().toLowerCase();
  return CLAIM_STATUS_ALIASES[value] ?? "pending";
}

export function isClaimPendingReviewStatus(statusKey: ClaimStatusKey): boolean {
  return PENDING_REVIEW_STATUSES.has(statusKey);
}

export function isClaimRejectedStatus(statusKey: ClaimStatusKey): boolean {
  return statusKey === "fraudulent";
}

export function isClaimAutoApprovedStatus(statusKey: ClaimStatusKey): boolean {
  return statusKey === "auto_approved";
}

export function isClaimManualProcessingStatus(
  statusKey: ClaimStatusKey
): boolean {
  return MANUAL_PROCESSING_STATUSES.has(statusKey);
}

export function isClaimResolvedStatus(statusKey: ClaimStatusKey): boolean {
  return (
    isClaimAutoApprovedStatus(statusKey) ||
    isClaimManualProcessingStatus(statusKey)
  );
}
