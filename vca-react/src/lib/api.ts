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
    data: { fnol },
  });
}

/** POST /api/process-claim/ - Process claim and get assessment */
export async function processClaim(fnol: FnolPayload): Promise<ProcessClaimResponse> {
  return fetchApi<ProcessClaimResponse>("/process-claim/", {
    method: "POST",
    data: { fnol },
  });
}

