import type { AxiosRequestConfig } from "axios";
import { httpClient, LONG_REQUEST_TIMEOUT_MS } from "./httpClient";
import type {
  ClaimWorkflowSnapshot,
  FnolPayload,
  FnolResponse,
  FraudRuleResult,
  ProcessClaimResponse,
} from "../models/fnol";
import type {
  DamageAssessmentCardDetails,
  DamageAssessmentCardsResponse,
} from "../models/damageAssessmentCards";
import {
  assertDamageAssessmentCardDetailsShape,
  assertDamageAssessmentCardsResponse,
  normalizeDamageAssessmentCardDetails,
} from "./damageAssessmentContract";

export type {
  ClaimWorkflowSnapshot,
  FnolPayload,
  FnolResponse,
  FraudRuleResult,
  ProcessClaimResponse,
};
export type {
  DamageAssessmentCardDetails,
  DamageAssessmentCardSummary,
  DamageAssessmentCardsResponse,
  DamageAssessmentDisplayStatus,
  DamageAssessmentMetric,
  DamageAssessmentNarrative,
} from "../models/damageAssessmentCards";

async function fetchApi<T>(
  path: string,
  options?: AxiosRequestConfig
): Promise<T> {
  const response = await httpClient.request<T>({
    url: path,
    ...options,
  });
  return response.data;
}

/** ****************************
 * FNOL / Claim processing APIs
 * **************************** */

/** GET /api/fnol/ - List all FNOL responses */
export async function getFnolList(): Promise<FnolResponse[]> {
  return fetchApi<FnolResponse[]>("/fnol");
}

/** GET /api/fnol/:id/ - Get single FNOL by complaint_id (trailing slash required by Django route) */
export async function getFnolById(id: string): Promise<FnolResponse> {
  return fetchApi<FnolResponse>(`/fnol/${encodeURIComponent(id)}/`);
}

export interface DeleteFnolResponse {
  message: string;
  complaint_id: string;
  deleted_counts: Record<string, number>;
}

export interface BulkDeleteFnolResponse {
  message: string;
  requested_count: number;
  deleted_count: number;
  deleted_ids: string[];
  not_found_ids: string[];
  deleted_rows: number;
  deleted_counts_by_claim: Record<string, Record<string, number>>;
}

/** DELETE /api/fnol/:id/ - Delete a single FNOL claim plus its persisted analysis rows */
export async function deleteFnol(id: string): Promise<DeleteFnolResponse> {
  return fetchApi<DeleteFnolResponse>(`/fnol/${encodeURIComponent(id)}/`, {
    method: "DELETE",
  });
}

/** POST /api/fnol/bulk-delete - Delete multiple FNOL claims in one request */
export async function bulkDeleteFnol(
  complaintIds: string[]
): Promise<BulkDeleteFnolResponse> {
  return fetchApi<BulkDeleteFnolResponse>("/fnol/bulk-delete", {
    method: "POST",
    data: { complaint_ids: complaintIds },
  });
}

export interface SaveFnolResponse {
  message: string;
  id: string;
  /** Present when an existing claim had persisted DA/evaluation artifacts cleared. */
  reset_processing_artifacts?: Record<string, number>;
}

/** Use after `saveFnol` when wiring reset-to-FNOL: if true, run the same refetch/cache purge as other workflow mutations. */
export function saveFnolResetProcessingArtifactsApplied(
  response: SaveFnolResponse
): boolean {
  const rows = response.reset_processing_artifacts;
  if (!rows) return false;
  return Object.values(rows).some((count) => typeof count === "number" && count > 0);
}

/** POST /api/save-fnol/ - Save FNOL payload to fnol_claims + fnol_damage_photos */
export async function saveFnol(fnol: FnolPayload): Promise<SaveFnolResponse> {
  return fetchApi<SaveFnolResponse>("/save-fnol", {
    method: "POST",
    data: { fnol },
  });
}

/** POST /api/process-claim/ - Process claim and get assessment */
export async function processClaim(
  fnol: FnolPayload
): Promise<ProcessClaimResponse> {
  return fetchApi<ProcessClaimResponse>("/process-claim", {
    method: "POST",
    data: { fnol },
  });
}

export interface FraudClaimItem {
  complaint_id: string;
  claimNumber: string;
  customer: string;
  riskScore: number;
  reason: string;
  amount: number;
  status: "under_review" | "confirmed" | "cleared";
  detectedAt: string | null;
  indicators: string[];
  /** 1 = re-opened claim, show Reopen button in Fraud Detection actions; 0 = new/fetched */
  re_open?: number;
  /** Number of times this claim was processed (rows in claim_evaluation_response) */
  times_processed?: number;
  /** Latest claim_status from claim_evaluation_response (is_latest=True row) */
  latest_claim_status?: string;
  /** All evaluation records for this claim (complaint_id, threshold_value, claim_status, reason) */
  evaluation_records?: {
    complaint_id: string;
    version: number;
    threshold_value: number | null;
    claim_status: string;
    reason: string;
  }[];
}

/** GET /api/fraud-claims - List claims that have been through fraud detection */
export async function getFraudClaims(): Promise<FraudClaimItem[]> {
  return fetchApi<FraudClaimItem[]>("/fraud-claims");
}

/** POST /api/fnol/:complaintId/run-fraud-detection - Run fraud detection and save to claim_evaluation_response */
export async function runFraudDetection(
  complaintId: string
): Promise<ProcessClaimResponse> {
  return fetchApi<ProcessClaimResponse>(
    `/fnol/${encodeURIComponent(complaintId)}/run-fraud-detection`,
    { method: "POST" }
  );
}

/** Persisted lifecycle from GET /fnol (backend `claims.workflow_state.compute_claim_workflow_state`). */
export type ClaimWorkflowState =
  | "NOT_STARTED"
  | "BUSINESS_RULE_VALIDATION_IN_PROGRESS"
  | "BUSINESS_RULE_VALIDATION_COMPLETED"
  | "DAMAGE_ASSESSMENT_IN_PROGRESS"
  | "DAMAGE_ASSESSMENT_COMPLETED";

export interface ClaimEvaluationResponse {
  complaint_id: string;
  /** True when no claim_evaluation_response row exists yet (GET returns 200, not 404). */
  not_started?: boolean;
  workflow_state?: ClaimWorkflowState;
  workflow_snapshot?: ClaimWorkflowSnapshot;
  damage_confidence: number | null;
  estimated_amount: number | null;
  /** DA gross repair total (ClaimPhase1Valuation); same source as estimated_repair when present. */
  gross_estimate?: number | null;
  claim_amount: number | null;
  /** Same source as claim_amount when present: unified net from ClaimPhase1Valuation. */
  net_payable?: number | null;
  excess_amount: number | null;
  estimated_repair: number | null;
  threshold_value: number | null;
  claim_type: string | null;
  /**
   * Binary claim complexity classification driven by MAJOR_CLAIM_THRESHOLD PricingConfig.
   * "Simple Claim" when gross_estimate < threshold; "Major Claim" when >= threshold.
   */
  claim_complexity: "Simple Claim" | "Major Claim" | null;
  /** The active threshold value (from MAJOR_CLAIM_THRESHOLD PricingConfig) used for classification. */
  claim_complexity_threshold: number | null;
  /** The gross repair estimate used for the classification (DA value or BRV fallback). */
  claim_complexity_amount: number | null;
  /** Severity from claim type: SIMPLE=minor, MEDIUM=moderate, COMPLEX=severe */
  severity: string | null;
  decision: string | null;
  claim_status: string | null;
  reason: string | null;
  fraud_score?: string | null;
  fraud_rule_results?: FraudRuleResult[];
  decision_summary?: ClaimDecisionSummary | null;
  llm_damages: string[] | null;
  llm_severity: string | null;
  created_date: string | null;
  updated_date: string | null;
}

export interface ClaimDecisionInsight {
  code: string;
  severity: "critical" | "warning" | "info" | "success";
  title: string;
  detail: string;
  blocking: boolean;
  source: string;
}

export interface ClaimDecisionSummarySignals {
  fraud_band?: string | null;
  failed_business_rule_count: number;
  max_image_fraud_score?: number | null;
  high_risk_image_count: number;
  duplicate_candidate_count: number;
  top_duplicate_candidate?: {
    other_complaint_id: string;
    similarity_percent: number;
    match_reason: string;
  } | null;
  severity?: string | null;
  part_count: number;
  has_structured_damage: boolean;
  assessment_ready: boolean;
  allowed_severities: string[];
  stp_max_image_fraud_score: number;
  /** Canonical image-risk category codes (backend decisioning.py). */
  image_risk_codes?: string[];
  blocking_image_risk_codes?: string[];
  image_risk_category_count?: number;
  image_risk_photo_count?: number;
}

/** One normalized image-risk category from persisted ImageFraudResult + duplicate screening (backend). */
export interface ImageRiskCategorySummary {
  code: string;
  label: string;
  title: string;
  tone: string;
  severity: string;
  blocking: boolean;
  source: string;
  count?: number;
  count_label?: string;
}

export interface ImageRiskSummaryCard {
  title: string;
  headline: string;
  detail: string;
  tone: "critical" | "warning" | "info" | "success";
}

/**
 * Aggregated image-risk block for top-of-page summary (claims/decisioning.py).
 * Categories are de-duplicated per photo; cross-claim reuse is included when duplicates exist.
 */
export interface ImageRiskSummaryBlock {
  status_tone: string;
  title: string;
  detail: string;
  analyzed_photo_count?: number;
  material_photo_count?: number;
  blocking_category_count?: number;
  critical_category_count?: number;
  /** Current BRV lifecycle; use for gating image-risk UI (0 = no surfaced categories). */
  categories_surfaced?: number;
  photos_flagged?: number;
  /** Truly blocking authenticity signals in this lifecycle. */
  blocking_signals?: number;
  highest_fraud_score?: number;
  stp_threshold?: number;
  categories: ImageRiskCategorySummary[];
  additional_category_count: number;
  summary_card?: ImageRiskSummaryCard | null;
  highlights?: ClaimDecisionInsight[];
}

export interface BusinessRuleSummaryBlock {
  status_tone: "critical" | "warning" | "info" | "success";
  title: string;
  headline: string;
  detail: string;
  fraud_band?: string | null;
  failed_rule_count: number;
  validation_passed: boolean | null;
}

export interface ClaimDecisionSummary {
  approval_state:
    | "rejected"
    | "manual_review_required"
    | "pending_damage_assessment"
    | "straight_through_eligible";
  decision: string | null;
  stp_eligible: boolean;
  status_tone: "critical" | "warning" | "info" | "success";
  status_title: string;
  status_detail: string;
  risk_level: "high" | "warning" | "low" | "info";
  risk_label: string;
  business_rule_validation_passed: boolean | null;
  business_rule_summary?: BusinessRuleSummaryBlock | null;
  blocking_insights: ClaimDecisionInsight[];
  top_insights: ClaimDecisionInsight[];
  /** Canonical image-risk highlights (labels, duplicate reuse) for compact top UI. */
  image_risk_summary?: ImageRiskSummaryBlock | null;
  signals: ClaimDecisionSummarySignals;
}

/** GET /api/fnol/:complaintId/evaluation - Get claim evaluation response */
export async function getClaimEvaluation(
  complaintId: string
): Promise<ClaimEvaluationResponse> {
  return fetchApi<ClaimEvaluationResponse>(
    `/fnol/${encodeURIComponent(complaintId)}/evaluation`
  );
}

export interface ImageFraudResultItem {
  id?: number;
  photo_path: string;
  fraud_score: number;
  ela_score: number | null;
  p_hash?: string;
  d_hash?: string;
  a_hash?: string;
  exif_json?: {
    warnings?: string[];
    exif_present?: boolean;
    software?: string | null;
  } | null;
  exif_present?: boolean;
  signals_json?: Record<string, unknown> | null;
  llm_notes?: string;
  created_at?: string | null;
  status?: string;
  error?: string;
  authenticity_labels?: ImageAuthenticityLabel[];
}

export interface ImageFraudResultsResponse {
  complaint_id: string;
  results_count: number;
  results: ImageFraudResultItem[];
}

export interface ImageAuthenticityLabel {
  code: string;
  label: string;
  tone:
    | "green"
    | "amber"
    | "violet"
    | "sky"
    | "slate"
    | "rose"
    | "yellow";
}

export interface DuplicateCandidateItem {
  other_complaint_id: string;
  /** Raw 0-1 similarity used in DB (legacy field). Prefer similarity_percent for display. */
  similarity_score: number;
  /** 0-100 percentage for display, returned by the duplicate-candidates API. */
  similarity_percent?: number;
  match_reason: string;
  evidence?: Record<string, unknown> | null;
  created_at?: string | null;
}

export interface DuplicateDetectionSettings {
  phash_threshold?: number;
  dhash_threshold?: number;
  require_both_non_exact?: boolean;
  phash_threshold_percent?: number;
  dhash_threshold_percent?: number;
  sensitivity_label?: string;
  match_policy_label?: string;
  reviewer_summary?: string;
  exact_match_policy?: string;
}

export interface DuplicateCandidatesResponse {
  complaint_id: string;
  candidate_count: number;
  duplicate_detection?: DuplicateDetectionSettings;
  candidates: DuplicateCandidateItem[];
}

export interface DamagePartAssessmentItem {
  part_name: string;
  damage_type: string;
  severity_percent: number;
  repair_action: string;
  estimated_amount: number;
}

export interface MarketContext {
  country: string;
  city: string;
  currency_code: string;
  locale: string;
  market_label: string;
  accident_location: string;
}

/** Transparency data from the LangGraph agentic pricing pipeline (optional, additive). */
export interface PipelineMetadata {
  pipeline: "langgraph_agentic" | "vision_llm_direct" | string;
  nodes_executed?: string[];
  pricing_source: "web_search" | "training_knowledge" | "mixed" | "vision_llm_initial" | string;
  confidence_level: "high" | "medium" | "low";
  cost_range: { low: number; high: number } | null;
  web_search_used: boolean;
  parts_searched?: string[];
  reasoning_summary: string;
  regional_context?: string;
  currency_code?: string;
  part_level_ranges?: Array<{
    part: string;
    estimated_cost: number;
    cost_range_low: number;
    cost_range_high: number;
    pricing_basis: string;
  }>;
}

export interface DetailedDamageAssessmentResponse {
  complaint_id: string;
  total_parts: number;
  total_estimated_cost: number;
  currency_code?: string;
  market_context?: MarketContext;
  part_breakdown: DamagePartAssessmentItem[];
  /** Present only when the LangGraph agentic pipeline successfully ran. */
  pipeline_metadata?: PipelineMetadata;
}

export interface TotalValueResponse {
  complaint_id: string;
  gross_estimate: number;
  excess_amount: number;
  excess_from_fnol: number | null;
  net_payable: number;
  currency_code: string;
  market_context?: MarketContext;
  part_count: number;
  /** Sum of part line estimates; should match gross_estimate when data is consistent */
  parts_total_cross_check?: number;
  /** Line items aligned with DA part costs; authoritative for UI breakdown when present. */
  breakdown?: DamagePartAssessmentItem[];
}

export async function runImageFraudAnalysis(
  complaintId: string
): Promise<ImageFraudResultsResponse> {
  return fetchApi<ImageFraudResultsResponse>(
    `/fnol/${encodeURIComponent(complaintId)}/image-fraud-analysis`,
    { method: "POST", timeout: LONG_REQUEST_TIMEOUT_MS }
  );
}

export async function getImageFraudResults(
  complaintId: string
): Promise<ImageFraudResultsResponse> {
  return fetchApi<ImageFraudResultsResponse>(
    `/fnol/${encodeURIComponent(complaintId)}/image-fraud-results`
  );
}

export async function getDuplicateCandidates(
  complaintId: string
): Promise<DuplicateCandidatesResponse> {
  return fetchApi<DuplicateCandidatesResponse>(
    `/fnol/${encodeURIComponent(complaintId)}/duplicate-candidates`
  );
}

export async function runDetailedDamageAssessment(
  complaintId: string
): Promise<DetailedDamageAssessmentResponse> {
  return fetchApi<DetailedDamageAssessmentResponse>(
    `/fnol/${encodeURIComponent(complaintId)}/damage-assessment-detailed`,
    { method: "POST", timeout: LONG_REQUEST_TIMEOUT_MS }
  );
}

export async function getDetailedDamageAssessment(
  complaintId: string
): Promise<DetailedDamageAssessmentResponse> {
  return fetchApi<DetailedDamageAssessmentResponse>(
    `/fnol/${encodeURIComponent(complaintId)}/damage-assessment-detailed`
  );
}

export async function getTotalValue(
  complaintId: string
): Promise<TotalValueResponse> {
  return fetchApi<TotalValueResponse>(
    `/fnol/${encodeURIComponent(complaintId)}/total-value`
  );
}

export interface ClaimPricingExplanationPart {
  part_name: string;
  estimated_amount: number;
  damage_type?: string;
  repair_action?: string;
  severity_percent?: number;
  pricing_basis?: string;
  source_image_url?: string;
}

export interface ClaimPricingExplanationResponse {
  complaint_id: string;
  pricing_source: string;
  confidence_level: string;
  reasoning_summary: string;
  currency_code: string;
  gross_estimate: number;
  net_payable: number;
  market_context?: MarketContext;
  explanation: {
    highlights: string[];
    parts: ClaimPricingExplanationPart[];
    pricing_rule_snapshot?: Record<string, unknown>;
    cost_range?: {
      low?: number | null;
      high?: number | null;
    } | null;
  };
}

export interface InvoiceAnalysisResponse {
  analysis_id: number;
  complaint_id: string;
  status: string;
  invoice_total: number | null;
  valuation_total: number | null;
  discrepancy_amount: number | null;
  requires_manual_review: boolean;
  summary_text: string;
  extracted_payload_json: Record<string, unknown>;
  discrepancy: {
    amount_delta: number | null;
    amount_delta_percent: number | null;
    parts_delta_count: number;
    valuation_part_count: number;
    invoice_part_count: number;
    flags: string[];
  };
}

export interface ClaimReasoningSummaryResponse {
  complaint_id: string;
  summary: string;
  evaluation: {
    decision: string | null;
    claim_status: string | null;
    claim_type: string | null;
    severity: string | null;
    estimated_amount: number | null;
    claim_amount: number | null;
  };
  evidence: {
    pricing_source?: string | null;
    confidence_level?: string | null;
    duplicate_candidate_count: number;
    image_fraud_result_count: number;
    damage_part_count: number;
    invoice_analysis_status?: string | null;
    video_analysis_status?: string | null;
  };
}

export interface ClaimVideoKeyframe {
  frame_index: number;
  timestamp_seconds: number;
  label: string;
}

export interface ClaimVideoTimelineEvent {
  timestamp_seconds: number;
  title: string;
  detail: string;
  severity?: string;
}

export interface ClaimVideoAnalysisResponse {
  analysis_id?: number;
  complaint_id: string;
  status: string;
  summary_text: string;
  keyframes: ClaimVideoKeyframe[];
  timeline: ClaimVideoTimelineEvent[];
  metrics: Record<string, unknown>;
}

export interface BatchValidateClaimsResponse {
  requested_count: number;
  processed_count: number;
  results: Array<{
    complaint_id: string;
    status: "completed" | "skipped" | "error";
    detail: string;
    video_analysis_status?: string | null;
    damage_part_count?: number;
    has_valuation?: boolean;
  }>;
}

export async function getPricingExplanation(
  complaintId: string
): Promise<ClaimPricingExplanationResponse> {
  return fetchApi<ClaimPricingExplanationResponse>(
    `/claims/${encodeURIComponent(complaintId)}/pricing/explain`
  );
}

export async function analyzeInvoiceForClaim(params: {
  complaintId: string;
  documentId?: number;
}): Promise<InvoiceAnalysisResponse> {
  return fetchApi<InvoiceAnalysisResponse>(
    `/claims/${encodeURIComponent(params.complaintId)}/invoice/analyze`,
    {
      method: "POST",
      data: {
        document_id: params.documentId ?? null,
      },
      timeout: LONG_REQUEST_TIMEOUT_MS,
    }
  );
}

export async function getReasoningSummary(
  complaintId: string
): Promise<ClaimReasoningSummaryResponse> {
  return fetchApi<ClaimReasoningSummaryResponse>(
    `/claims/${encodeURIComponent(complaintId)}/reasoning/summary`,
    {
      method: "POST",
      data: {},
      timeout: LONG_REQUEST_TIMEOUT_MS,
    }
  );
}

export async function analyzeClaimVideo(params: {
  complaintId: string;
  sourcePath?: string;
  sourceType?: "dashcam" | "cctv" | "upload";
  originalFilename?: string;
}): Promise<ClaimVideoAnalysisResponse> {
  return fetchApi<ClaimVideoAnalysisResponse>(
    `/claims/${encodeURIComponent(params.complaintId)}/video/analyze`,
    {
      method: "POST",
      data: {
        source_path: params.sourcePath ?? null,
        source_type: params.sourceType ?? null,
        original_filename: params.originalFilename ?? null,
      },
      timeout: LONG_REQUEST_TIMEOUT_MS,
    }
  );
}

export async function getClaimVideoTimeline(
  complaintId: string
): Promise<ClaimVideoAnalysisResponse> {
  return fetchApi<ClaimVideoAnalysisResponse>(
    `/claims/${encodeURIComponent(complaintId)}/timeline`
  );
}

export async function batchValidateClaims(
  complaintIds: string[]
): Promise<BatchValidateClaimsResponse> {
  return fetchApi<BatchValidateClaimsResponse>("/batch/validate", {
    method: "POST",
    data: { complaint_ids: complaintIds },
    timeout: LONG_REQUEST_TIMEOUT_MS,
  });
}

/** GET /api/fnol/:id/damage-assessment/cards — grounded summary row per card (no LLM). */
export async function getDamageAssessmentCards(
  complaintId: string
): Promise<DamageAssessmentCardsResponse> {
  const data = await fetchApi<DamageAssessmentCardsResponse>(
    `/fnol/${encodeURIComponent(complaintId)}/damage-assessment/cards`
  );
  if (import.meta.env.DEV) {
    try {
      assertDamageAssessmentCardsResponse(data);
    } catch (e) {
      console.warn("[vca] damage-assessment cards contract check failed:", e);
    }
  }
  return data;
}

/** GET /api/fnol/:id/damage-assessment/cards/:cardKey/details */
export async function getDamageAssessmentCardDetails(
  complaintId: string,
  cardKey: string
): Promise<DamageAssessmentCardDetails> {
  const key = encodeURIComponent(cardKey);
  const data = await fetchApi<DamageAssessmentCardDetails>(
    `/fnol/${encodeURIComponent(complaintId)}/damage-assessment/cards/${key}/details`
  );
  if (import.meta.env.DEV) {
    try {
      assertDamageAssessmentCardDetailsShape(data);
    } catch (e) {
      console.warn("[vca] damage-assessment detail contract check failed:", e);
    }
  }
  return normalizeDamageAssessmentCardDetails(data);
}

/** POST /api/fnol/:id/damage-assessment/cards/:cardKey/refresh */
export async function refreshDamageAssessmentCard(
  complaintId: string,
  cardKey: string
): Promise<DamageAssessmentCardDetails> {
  const key = encodeURIComponent(cardKey);
  const data = await fetchApi<DamageAssessmentCardDetails>(
    `/fnol/${encodeURIComponent(complaintId)}/damage-assessment/cards/${key}/refresh`,
    { method: "POST", data: {} }
  );
  if (import.meta.env.DEV) {
    try {
      assertDamageAssessmentCardDetailsShape(data);
    } catch (e) {
      console.warn("[vca] damage-assessment refresh contract check failed:", e);
    }
  }
  return normalizeDamageAssessmentCardDetails(data);
}

/** GET /api/fnol/:complaintId/recommendation-report/ - Download MOTOR CLAIM RECOMMENDATION REPORT PDF (status must be Recommendation shared) */
export async function getRecommendationReportPdf(complaintId: string): Promise<Blob> {
  const response = await httpClient.get(
    `/fnol/${encodeURIComponent(complaintId)}/recommendation-report/`,
    { responseType: "blob" }
  );
  return response.data as Blob;
}

/** ****************************
 * Master data APIs
 * **************************** */

export interface DamageCodeMaster {
  damage_id: number;
  damage_type: string;
  severity_percentage: number;
  is_active: boolean;
  created_date: string;
  created_by: string | null;
}

export interface ClaimTypeMaster {
  claim_type_id: number;
  claim_type_name: string;
  risk_percentage: number;
  risk_min?: number;
  risk_max?: number;
  is_active: boolean;
  created_date: string;
  created_by: string | null;
}

export interface ClaimRuleMaster {
  rule_id: number;
  rule_type: string;
  rule_group: string;
  rule_description: string;
  rule_expression: string;
  is_active: boolean;
  created_date: string;
  created_by: string | null;
}

// Damage codes
export async function getDamageCodes(): Promise<DamageCodeMaster[]> {
  return fetchApi<DamageCodeMaster[]>("/masters/damage-codes");
}

export async function updateDamageCode(
  id: number,
  payload: Partial<
    Pick<DamageCodeMaster, "damage_type" | "severity_percentage" | "is_active">
  >
): Promise<DamageCodeMaster> {
  return fetchApi<DamageCodeMaster>(`/masters/damage-codes/${id}`, {
    method: "PATCH",
    data: payload,
  });
}

export async function createDamageCode(
  payload: Pick<
    DamageCodeMaster,
    "damage_type" | "severity_percentage" | "is_active"
  >
): Promise<DamageCodeMaster> {
  return fetchApi<DamageCodeMaster>("/masters/damage-codes", {
    method: "POST",
    data: payload,
  });
}

export async function deleteDamageCode(id: number): Promise<void> {
  await fetchApi<void>(`/masters/damage-codes/${id}`, { method: "DELETE" });
}

// Claim types (for thresholds tab)
export async function getClaimTypes(): Promise<ClaimTypeMaster[]> {
  return fetchApi<ClaimTypeMaster[]>("/masters/claim-types");
}

export async function createClaimType(
  payload: Pick<ClaimTypeMaster, "claim_type_name" | "risk_min" | "risk_max" | "is_active">
): Promise<ClaimTypeMaster> {
  return fetchApi<ClaimTypeMaster>("/masters/claim-types", {
    method: "POST",
    data: payload,
  });
}

export async function updateClaimType(
  id: number,
  payload: Partial<
    Pick<ClaimTypeMaster, "claim_type_name" | "risk_min" | "risk_max" | "is_active">
  >
): Promise<ClaimTypeMaster> {
  return fetchApi<ClaimTypeMaster>(`/masters/claim-types/${id}`, {
    method: "PATCH",
    data: payload,
  });
}

export async function deleteClaimType(id: number): Promise<void> {
  await fetchApi<void>(`/masters/claim-types/${id}`, { method: "DELETE" });
}

// Claim rules (for fraud rules tab)
export async function getClaimRules(): Promise<ClaimRuleMaster[]> {
  return fetchApi<ClaimRuleMaster[]>("/masters/claim-rules");
}

export async function createClaimRule(
  payload: Pick<
    ClaimRuleMaster,
    "rule_type" | "rule_group" | "rule_description" | "rule_expression" | "is_active"
  >
): Promise<ClaimRuleMaster> {
  return fetchApi<ClaimRuleMaster>("/masters/claim-rules", {
    method: "POST",
    data: payload,
  });
}

export async function updateClaimRule(
  id: number,
  payload: Partial<
    Pick<
      ClaimRuleMaster,
      | "rule_type"
      | "rule_group"
      | "rule_description"
      | "rule_expression"
      | "is_active"
    >
  >
): Promise<ClaimRuleMaster> {
  return fetchApi<ClaimRuleMaster>(`/masters/claim-rules/${id}`, {
    method: "PATCH",
    data: payload,
  });
}

export async function deleteClaimRule(id: number): Promise<void> {
  await fetchApi<void>(`/masters/claim-rules/${id}`, { method: "DELETE" });
}

// Pricing config
export interface PricingConfigMaster {
  config_id: number;
  config_key: string;
  config_name: string;
  config_value: string;
  config_type: string;
  description: string;
  is_active: boolean;
  created_date: string;
  created_by: string | null;
  updated_date: string;
  updated_by: string | null;
}

export async function getPricingConfigs(): Promise<PricingConfigMaster[]> {
  return fetchApi<PricingConfigMaster[]>("/masters/pricing-config");
}

export async function createPricingConfig(
  payload: Pick<
    PricingConfigMaster,
    "config_key" | "config_name" | "config_value" | "config_type" | "description" | "is_active"
  >
): Promise<PricingConfigMaster> {
  return fetchApi<PricingConfigMaster>("/masters/pricing-config", {
    method: "POST",
    data: payload,
  });
}

export async function updatePricingConfig(
  id: number,
  payload: Partial<
    Pick<
      PricingConfigMaster,
      "config_key" | "config_name" | "config_value" | "config_type" | "description" | "is_active"
    >
  >
): Promise<PricingConfigMaster> {
  return fetchApi<PricingConfigMaster>(`/masters/pricing-config/${id}`, {
    method: "PATCH",
    data: payload,
  });
}

export async function deletePricingConfig(id: number): Promise<void> {
  await fetchApi<void>(`/masters/pricing-config/${id}`, { method: "DELETE" });
}


/** ****************************
 * Claim Digitization APIs
 * **************************** */

export type DigitizationDocumentCategory = "repair" | "other" | "unclassified";

export interface DigitizationDocument {
  id: number;
  complaint_id: string;
  original_filename: string;
  file_url: string;
  document_category: DigitizationDocumentCategory;
  document_type: string;
  created_date?: string;
}

export interface DigitizationPartLine {
  description: string;
  quantity: string | null;
  unit_price: string | null;
  amount: string | null;
  line_index: number;
}

export interface DigitizationExtraction {
  status: string;
  error_message?: string | null;
  claim_number?: string | null;
  vehicle_number?: string | null;
  engine_number?: string | null;
  chassis_number?: string | null;
  make_model?: string | null;
  total_amount?: string | null;
  parts: DigitizationPartLine[];
}

export interface DigitizationDocumentWithExtraction {
  document_id: number;
  original_filename: string;
  file_url: string;
  document_category: DigitizationDocumentCategory;
  document_type: string;
  extraction: DigitizationExtraction | null;
}

export async function uploadDigitizationDocuments(params: {
  complaintId: string;
  files: File[];
}): Promise<{ documents: DigitizationDocument[] }> {
  const formData = new FormData();
  formData.append("complaint_id", params.complaintId);
  params.files.forEach((f) => formData.append("files", f));

  const response = await httpClient.request<{ documents: DigitizationDocument[] }>({
    url: "/digitization/upload",
    method: "POST",
    data: formData,
    headers: { "Content-Type": "multipart/form-data" },
  });

  return response.data;
}

export async function classifyDigitizationDocument(params: {
  documentId: number;
  documentCategory: DigitizationDocumentCategory;
  documentType: string;
}): Promise<DigitizationDocument> {
  return fetchApi<DigitizationDocument>("/digitization/classify", {
    method: "POST",
    data: {
      document_id: params.documentId,
      document_category: params.documentCategory,
      document_type: params.documentType,
    },
  });
}

export async function extractDigitization(params: {
  complaintId: string;
  documentIds?: number[];
}): Promise<{
  results: Array<{
    document_id: number;
    status: string;
    error?: string;
    parts_count?: number;
  }>;
}> {
  return fetchApi<{
    results: Array<{
      document_id: number;
      status: string;
      error?: string;
      parts_count?: number;
    }>;
  }>("/digitization/extract", {
    method: "POST",
    data: {
      complaint_id: params.complaintId,
      document_ids: params.documentIds ?? undefined,
    },
  });
}

export async function listDigitizationExtractions(params: {
  complaintId: string;
}): Promise<{ documents: DigitizationDocumentWithExtraction[] }> {
  return fetchApi<{ documents: DigitizationDocumentWithExtraction[] }>(
    `/digitization/list-extractions?complaint_id=${encodeURIComponent(params.complaintId)}`
  );
}

export async function extractDigitizationKv(documentId: number): Promise<{
  document_id: number;
  filename: string;
  key_value_json: Record<string, unknown>;
}> {
  return fetchApi<{
    document_id: number;
    filename: string;
    key_value_json: Record<string, unknown>;
  }>("/digitization/extract-kv", {
    method: "POST",
    data: { document_id: documentId },
  });
}

export async function saveClassifiedDocumentLocal(params: {
  file: File;
  documentCategory: "repair" | "other";
  originalFilename: string;
  complaintId: string;
}): Promise<{
  renamed_filename: string;
  saved_path: string;
  document_category: "repair" | "other";
}> {
  const formData = new FormData();
  formData.append("file", params.file);
  formData.append("document_category", params.documentCategory);
  formData.append("original_filename", params.originalFilename);
  formData.append("complaint_id", params.complaintId);

  const response = await httpClient.request<{
    renamed_filename: string;
    saved_path: string;
    document_category: "repair" | "other";
  }>({
    url: "/digitization/save-classified-local",
    method: "POST",
    data: formData,
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

export async function saveInvoiceDetails(params: {
  claimNumber: string;
  sourceDocumentId?: number;
  coreDetails: {
    claimNumber: string;
    vehicleNumber: string;
    engineNumber: string;
    chassisNumber: string;
    make: string;
    modelNumber: string;
    total: string;
  };
  partsDetails: Array<{
    id?: number;
    description: string;
    quantity: string;
    unitPrice: string;
    amount: string;
  }>;
  removePartIds?: number[];
}): Promise<{ message: string; claim_number: string; parts_saved: number; parts: Array<{ id: number; description: string | null; quantity: number | null; unitPrice: string; amount: string }> }> {
  return fetchApi<{ message: string; claim_number: string; parts_saved: number; parts: Array<{ id: number; description: string | null; quantity: number | null; unitPrice: string; amount: string }> }>(
    "/digitization/save-invoice-details",
    {
      method: "POST",
      data: {
        claim_number: params.claimNumber,
        source_document_id: params.sourceDocumentId ?? null,
        core_details: params.coreDetails,
        parts_details: params.partsDetails,
        remove_part_ids: params.removePartIds ?? [],
      },
    }
  );
}

export async function verifyInvoiceParts(claimNumber: string): Promise<{
  parts: Array<{
    part_detail_id: number;
    part_name: string;
    verified: boolean;
    master_id: number | null;
  }>;
}> {
  return fetchApi<{
    parts: Array<{
      part_detail_id: number;
      part_name: string;
      verified: boolean;
      master_id: number | null;
    }>;
  }>("/digitization/verify-parts", {
    method: "POST",
    data: { claim_number: claimNumber },
  });
}

export async function addPartToMaster(partDetailId: number): Promise<{
  part_detail_id: number;
  part_name: string;
  verified: true;
  master_id: number;
  created_in_master: boolean;
}> {
  return fetchApi<{
    part_detail_id: number;
    part_name: string;
    verified: true;
    master_id: number;
    created_in_master: boolean;
  }>("/digitization/add-part-to-master", {
    method: "POST",
    data: { part_detail_id: partDetailId },
  });
}

export type InvoiceHistoryItem = {
  claim_number: string;
  vehicle_number: string | null;
  engine_number: string | null;
  chassis_number: string | null;
  make: string | null;
  model_number: string | null;
  amount: string | null;
  created_date?: string | null;
  updated_date?: string | null;
};

export async function listInvoiceHistory(params?: {
  q?: string;
}): Promise<{ items: InvoiceHistoryItem[] }> {
  const q = params?.q ? `?q=${encodeURIComponent(params.q)}` : "";
  return fetchApi<{ items: InvoiceHistoryItem[] }>(`/invoice-history${q}`);
}

export async function getInvoiceHistoryDetail(
  claimNumber: string
): Promise<{
  core: InvoiceHistoryItem;
  parts: Array<{
    id: number;
    description: string | null;
    quantity: number | null;
    unit_price: string | null;
    amount: string | null;
  }>;
  document?: {
    file_url: string;
    original_filename: string;
  };
}> {
  return fetchApi<{
    core: InvoiceHistoryItem;
    parts: Array<{
      id: number;
      description: string | null;
      quantity: number | null;
      unit_price: string | null;
      amount: string | null;
    }>;
    document?: {
      file_url: string;
      original_filename: string;
    };
  }>(`/invoice-history/${encodeURIComponent(claimNumber)}`);
}

export type InvoiceFileSummaryItem = {
  claim_id: string;
  filename: string;
  blob_key: string;
  blob_url: string;
  upload_status: string;
  classification_type: string;
  created_date?: string | null;
  last_modified?: string | null;
  size?: number | null;
};

export async function listInvoiceFilesSummary(params?: {
  limit?: number;
}): Promise<{ items: InvoiceFileSummaryItem[] }> {
  const q = params?.limit ? `?limit=${encodeURIComponent(String(params.limit))}` : "";
  return fetchApi<{ items: InvoiceFileSummaryItem[] }>(`/digitization/files-summary${q}`);
}
