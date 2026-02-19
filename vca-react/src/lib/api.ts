import type { AxiosRequestConfig } from "axios";
import { httpClient } from "./httpClient";
import type {
  FnolPayload,
  FnolResponse,
  ProcessClaimResponse,
} from "../models/fnol";

export type { FnolPayload, FnolResponse, ProcessClaimResponse };

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

/** GET /api/fnol/:id/ - Get single FNOL by complaint_id */
export async function getFnolById(id: string): Promise<FnolResponse> {
  return fetchApi<FnolResponse>(`/fnol/${encodeURIComponent(id)}`);
}

/** POST /api/save-fnol/ - Save FNOL payload to fnol_claims + fnol_damage_photos */
export async function saveFnol(
  fnol: FnolPayload
): Promise<{ message: string; id: string }> {
  return fetchApi<{ message: string; id: string }>("/save-fnol", {
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

export interface DamageAssessmentResponse {
  damages: string[];
  severity: string;
}

/** POST /api/llm/damage_assessment - Run damage assessment with claim ID and images */
export async function runDamageAssessment(
  claimId: string,
  images: string[]
): Promise<DamageAssessmentResponse> {
  return fetchApi<DamageAssessmentResponse>("/llm/damage_assessment", {
    method: "POST",
    data: { claim_id: claimId, images },
  });
}

export interface ClaimEvaluationResponse {
  complaint_id: string;
  damage_confidence: number;
  estimated_amount: number;
  claim_amount: number;
  excess_amount: number;
  estimated_repair: number;
  threshold_value: number;
  claim_type: string;
  decision: string;
  claim_status: string;
  reason: string | null;
  llm_damages: string[] | null;
  llm_severity: string | null;
  created_date: string | null;
  updated_date: string | null;
}

/** GET /api/fnol/:complaintId/evaluation - Get claim evaluation response */
export async function getClaimEvaluation(
  complaintId: string
): Promise<ClaimEvaluationResponse> {
  return fetchApi<ClaimEvaluationResponse>(
    `/fnol/${encodeURIComponent(complaintId)}/evaluation`
  );
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
  payload: Pick<ClaimTypeMaster, "claim_type_name" | "risk_percentage" | "is_active">
): Promise<ClaimTypeMaster> {
  return fetchApi<ClaimTypeMaster>("/masters/claim-types", {
    method: "POST",
    data: payload,
  });
}

export async function updateClaimType(
  id: number,
  payload: Partial<
    Pick<ClaimTypeMaster, "claim_type_name" | "risk_percentage" | "is_active">
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

