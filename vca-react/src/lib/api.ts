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
  /** Severity from claim type: SIMPLE=minor, MEDIUM=moderate, COMPLEX=severe */
  severity: string | null;
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

/** GET /api/fnol/:complaintId/recommendation-report/ - Download MOTOR CLAIM RECOMMENDATION REPORT PDF (status must be Recommendation shared) */
export async function getRecommendationReportPdf(complaintId: string): Promise<Blob> {
  const { httpClient } = await import("./httpClient");
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
}): Promise<{
  renamed_filename: string;
  saved_path: string;
  document_category: "repair" | "other";
}> {
  const formData = new FormData();
  formData.append("file", params.file);
  formData.append("document_category", params.documentCategory);
  formData.append("original_filename", params.originalFilename);

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
  }>(`/invoice-history/${encodeURIComponent(claimNumber)}`);
}

