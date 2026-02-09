/**
 * API client for Vehicle Claim Automation backend.
 * Base URL: http://localhost:8000/api
 */

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000/api";

export interface FnolPayload {
  claim_id: string;
  policy: {
    policy_number: string;
    policy_status: string;
    coverage_type: string;
    policy_start_date: string;
    policy_end_date: string;
  };
  vehicle: {
    registration_number: string;
    make: string;
    model: string;
    year: number;
  };
  incident: {
    date_time_of_loss: string;
    location: string;
    loss_description: string;
    claim_type: string;
    estimated_amount: number;
  };
  claimant: {
    driver_name: string;
    driving_license_number: string;
    license_valid_till: string;
  };
  documents: {
    rc_copy_uploaded: boolean;
    dl_copy_uploaded: boolean;
    photos_uploaded: boolean;
    fir_uploaded: boolean;
  };
  history: {
    previous_claims_last_12_months: number;
  };
}

export interface FnolResponse {
  id: number;
  raw_response: FnolPayload;
  created_date: string;
  created_by: string;
  updated_date: string;
  updated_by: string;
}

export interface ProcessClaimResponse {
  claim_id?: string;
  damage_confidence?: number;
  fraud_score?: string;
  evaluation_score?: number;
  threshold?: number;
  claim_type?: string;
  decision?: string;
  claim_status?: string;
  reason?: string;
}

async function fetchApi<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

/** GET /api/fnol/ - List all FNOL responses */
export async function getFnolList(): Promise<FnolResponse[]> {
  return fetchApi<FnolResponse[]>("/fnol/");
}

/** GET /api/fnol/:id/ - Get single FNOL by ID */
export async function getFnolById(id: string | number): Promise<FnolResponse> {
  return fetchApi<FnolResponse>(`/fnol/${id}/`);
}

/** POST /api/save-fnol/ - Save FNOL payload */
export async function saveFnol(fnol: FnolPayload): Promise<{ message: string; id: number }> {
  return fetchApi<{ message: string; id: number }>("/save-fnol/", {
    method: "POST",
    body: JSON.stringify({ fnol }),
  });
}

/** POST /api/process-claim/ - Process claim and get assessment */
export async function processClaim(fnol: FnolPayload): Promise<ProcessClaimResponse> {
  return fetchApi<ProcessClaimResponse>("/process-claim/", {
    method: "POST",
    body: JSON.stringify({ fnol }),
  });
}
