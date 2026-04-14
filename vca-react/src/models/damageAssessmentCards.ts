/**
 * Frozen backend contract: FNOL damage-assessment card APIs.
 * @see vca-python/claims/DAMAGE_ASSESSMENT_CARD_CONTRACT.md
 */

export type DamageAssessmentDisplayStatus =
  | "clear"
  | "warning"
  | "critical"
  | "info"
  | "partial"
  | "failed";

export type DamageAssessmentMetric = {
  label: string;
  value: unknown;
};

export type DamageAssessmentCardSummary = {
  card_key: string;
  title: string;
  headline: string;
  status: DamageAssessmentDisplayStatus;
  primary_metric: DamageAssessmentMetric;
  secondary_metrics: DamageAssessmentMetric[];
  view_details_enabled: boolean;
  last_generated_at: string | null;
  caveats: string[];
};

export type DamageAssessmentCardsResponse = {
  complaint_id: string;
  cards: DamageAssessmentCardSummary[];
};

export type DamageAssessmentConfidence = {
  label: string;
  score: number | null;
};

export type DamageAssessmentClaimContext = {
  registration: string | null;
  vin: string | null;
  make_model_year: string | null;
  policy_number: string | null;
  claim_reported_context: string | null;
  overlap_summary: string | null;
};

export type DamageAssessmentEvidenceItem = {
  type?: string;
  label?: string;
  detail?: string;
  source?: string;
  confidence?: string;
};

export type DamageAssessmentNarrative = {
  summary: string;
  why_it_matters: string[];
  key_takeaways: string[];
  recommended_attention: string;
};

export type DamageAssessmentInsightMeta = {
  id?: number;
  generated_at?: string | null;
  source_snapshot_hash?: string | null;
  persisted_status?: string;
  persisted_error?: Record<string, unknown>;
};

export function isDamageAssessmentNarrative(
  n: unknown
): n is DamageAssessmentNarrative {
  if (!n || typeof n !== "object") return false;
  const o = n as Record<string, unknown>;
  return (
    typeof o.summary === "string" &&
    Array.isArray(o.why_it_matters) &&
    Array.isArray(o.key_takeaways) &&
    typeof o.recommended_attention === "string"
  );
}

export type DamageAssessmentCardDetails = {
  complaint_id: string;
  card_key: string;
  title: string;
  headline: string;
  status: DamageAssessmentDisplayStatus;
  confidence: DamageAssessmentConfidence;
  claim_context: DamageAssessmentClaimContext;
  metrics: DamageAssessmentMetric[];
  evidence: DamageAssessmentEvidenceItem[];
  caveats: string[];
  unsupported_fields: string[];
  raw_evidence_bundle: Record<string, unknown>;
  narrative: DamageAssessmentNarrative | Record<string, unknown>;
  source_snapshot_hash: string | null;
  insight: DamageAssessmentInsightMeta | null;
};
