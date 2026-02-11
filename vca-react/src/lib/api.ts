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

/** GET /api/fnol/:id/ - Get single FNOL by ID */
export async function getFnolById(id: string | number): Promise<FnolResponse> {
  return fetchApi<FnolResponse>(`/fnol/${id}`);
}

/** POST /api/save-fnol/ - Save FNOL payload */
export async function saveFnol(
  fnol: FnolPayload
): Promise<{ message: string; id: number }> {
  return fetchApi<{ message: string; id: number }>("/save-fnol", {
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

