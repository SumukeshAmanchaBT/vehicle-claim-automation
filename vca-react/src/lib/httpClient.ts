import axios, {
  type AxiosRequestConfig,
  type AxiosRequestHeaders,
  type AxiosResponse,
} from "axios";
import { VCA_SESSION_EXPIRED_EVENT } from "@/lib/authEvents";

const rawBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
export const API_BASE_URL = rawBase.replace(/\/$/, "");
export const API_MEDIA_URL = (import.meta.env.VITE_API_MEDIA_URL as string | undefined)?.trim() ?? "";

if (import.meta.env.DEV && !API_BASE_URL) {
  console.error(
    "[vca-react] VITE_API_BASE_URL is missing. Create .env (see .env.example) and restart Vite."
  );
}

type RequestMeta = {
  requestId: string;
  startedAt: number;
  timeoutMs: number;
};

type VcaAxiosConfig = AxiosRequestConfig & {
  metadata?: RequestMeta;
};

export type ApiErrorSummary = {
  userMessage: string;
  developerMessage: string;
  statusCode: number | null;
  requestId: string | null;
  responseTimeMs: number | null;
  timeoutMs: number | null;
  method: string | null;
  path: string | null;
  isTimeout: boolean;
  isNetworkError: boolean;
};

const envTimeout = Number(
  (import.meta.env as { VITE_API_TIMEOUT_MS?: string }).VITE_API_TIMEOUT_MS
);
/**
 * Default axios timeout. Reduced to 20 s so failures are visible quickly.
 * Remote-MySQL deployments typically respond in <5 s; the 20 s ceiling leaves
 * room for cold connections while surfacing genuine outages fast.
 * Override via VITE_API_TIMEOUT_MS (min 5000 ms).
 */
export const DEFAULT_TIMEOUT_MS =
  Number.isFinite(envTimeout) && envTimeout >= 5_000 ? envTimeout : 20_000;

/**
 * Assessment POSTs (image fraud, detailed damage / part breakdown) run YOLO + optional vision LLM per photo.
 * They routinely exceed 25s on local dev; override with VITE_API_LONG_TIMEOUT_MS (milliseconds, min 30000).
 */
const envLong = Number(
  (import.meta.env as { VITE_API_LONG_TIMEOUT_MS?: string }).VITE_API_LONG_TIMEOUT_MS
);
export const LONG_REQUEST_TIMEOUT_MS =
  Number.isFinite(envLong) && envLong >= 30_000 ? envLong : 180_000;

const envSlowRequestMs = Number(
  (import.meta.env as { VITE_API_SLOW_REQUEST_MS?: string }).VITE_API_SLOW_REQUEST_MS
);
const SLOW_REQUEST_MS =
  Number.isFinite(envSlowRequestMs) && envSlowRequestMs >= 500
    ? envSlowRequestMs
    : 2_000;

export const httpClient = axios.create({
  baseURL: API_BASE_URL || undefined,
  timeout: DEFAULT_TIMEOUT_MS,
  headers: {
    "Content-Type": "application/json",
  },
});

function createRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function getResponseTimeMs(
  source: Pick<AxiosResponse, "headers" | "config"> | undefined
): number | null {
  const headerValue = source?.headers?.["x-response-time-ms"];
  const parsed = Number(headerValue);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  const metadata = (source?.config as VcaAxiosConfig | undefined)?.metadata;
  if (!metadata) {
    return null;
  }
  return Math.max(0, Math.round(performance.now() - metadata.startedAt));
}

function getRequestMeta(config: AxiosRequestConfig | undefined): RequestMeta | undefined {
  return (config as VcaAxiosConfig | undefined)?.metadata;
}

// Attach auth token (from login) to every request
httpClient.interceptors.request.use((config) => {
  const startedAt = performance.now();
  const timeoutMs = Math.max(1, config.timeout ?? DEFAULT_TIMEOUT_MS);
  const requestId = createRequestId();
  (config as VcaAxiosConfig).metadata = {
    requestId,
    startedAt,
    timeoutMs,
  };
  const token = localStorage.getItem("vca_token");
  const headers = (config.headers ?? {}) as AxiosRequestHeaders & {
    Authorization?: string;
    "X-Client-Request-ID"?: string;
  };
  headers["X-Client-Request-ID"] = requestId;
  if (token) {
    headers.Authorization = `Token ${token}`;
  }
  config.headers = headers;
  return config;
});

// Clear stale session when the API rejects the token (do not treat login POST 401 as session expiry).
httpClient.interceptors.response.use(
  (response) => {
    if (import.meta.env.DEV) {
      const durationMs = getResponseTimeMs(response);
      const method = (response.config.method || "get").toUpperCase();
      const path = response.config.url || "";
      if ((durationMs ?? 0) >= SLOW_REQUEST_MS) {
        console.warn("[api-slow]", {
          method,
          path,
          durationMs,
          requestId: response.headers["x-request-id"] ?? getRequestMeta(response.config)?.requestId,
          statusCode: response.status,
        });
      }
    }
    return response;
  },
  (error) => {
    if (!axios.isAxiosError(error) || error.response?.status !== 401) {
      if (axios.isAxiosError(error) && import.meta.env.DEV) {
        const summary = getApiErrorSummary(error);
        console.error("[api-error]", summary);
      }
      return Promise.reject(error);
    }
    const method = (error.config?.method || "").toLowerCase();
    const url = String(error.config?.url || "");
    const isLoginAttempt =
      method === "post" && (url.endsWith("/login") || url.includes("/login"));
    if (isLoginAttempt) {
      return Promise.reject(error);
    }
    localStorage.removeItem("vca_token");
    localStorage.removeItem("vca_user");
    window.dispatchEvent(new Event(VCA_SESSION_EXPIRED_EVENT));
    return Promise.reject(error);
  }
);

/**
 * Build a browser URL for a damage photo path returned by the API.
 * Handles full URLs, `media/...` prefixes, `vehicle_damage/...`, and plain basenames
 * without doubling `media/vehicle_damage/` when VITE_API_MEDIA_URL already includes it.
 */
export function resolveDamagePhotoUrl(raw: string): string {
  const u = (raw || "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  const path = u.replace(/^\/+/, "");
  const origin = API_BASE_URL ? new URL(API_BASE_URL).origin : "";
  if (path.startsWith("media/")) {
    return `${origin}/${path}`;
  }
  const base = (API_MEDIA_URL || "").replace(/\/$/, "");
  const tail = path.replace(/^vehicle_damage\//, "").replace(/^media\/vehicle_damage\//, "");
  return `${base}/${tail}`;
}

export function resolveClaimVideoUrl(raw: string): string {
  const u = (raw || "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  const path = u.replace(/^\/+/, "");
  const origin = API_BASE_URL ? new URL(API_BASE_URL).origin : "";
  if (path.startsWith("media/")) {
    return `${origin}/${path}`;
  }
  return `${origin}/media/${path}`;
}

export function getApiErrorDetail(err: unknown): string {
  return getApiErrorSummary(err).userMessage;
}

export function getApiErrorSummary(err: unknown): ApiErrorSummary {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as {
      detail?: string;
      error?: string;
      message?: string;
      developer_message?: string;
      request_id?: string;
    } | undefined;
    const serverErrorCode =
      typeof data?.error === "string" && data.error.trim() ? data.error.trim() : null;
    const meta = getRequestMeta(err.config);
    const statusCode = err.response?.status ?? null;
    const responseTimeMs = getResponseTimeMs(err.response) ?? (
      meta ? Math.max(0, Math.round(performance.now() - meta.startedAt)) : null
    );
    const requestId =
      (typeof data?.request_id === "string" && data.request_id.trim()) ||
      err.response?.headers?.["x-request-id"] ||
      meta?.requestId ||
      null;
    const method = (err.config?.method || "get").toUpperCase();
    const path = err.config?.url || null;
    // Cover all Axios timeout/abort codes across versions (1.x uses ERR_CANCELED for signal-aborts,
    // ECONNABORTED for classic timeout config, ETIMEDOUT for TCP-level timeouts).
    const isTimeout =
      err.code === "ECONNABORTED" ||
      err.code === "ERR_CANCELED" ||
      err.code === "ETIMEDOUT" ||
      /timeout/i.test(err.message || "");
    const isNetworkError = !err.response;
    const primaryMessage =
      data?.message || data?.detail || err.message || "Request failed";
    const developerBits = [
      serverErrorCode ? `error=${serverErrorCode}` : null,
      statusCode ? `status=${statusCode}` : null,
      method ? `method=${method}` : null,
      path ? `path=${path}` : null,
      requestId ? `requestId=${requestId}` : null,
      responseTimeMs != null ? `duration=${responseTimeMs}ms` : null,
      meta?.timeoutMs ? `timeout=${meta.timeoutMs}ms` : null,
      data?.developer_message || null,
    ].filter(Boolean);

    let userMessage = primaryMessage;
    if (isTimeout) {
      userMessage = `The request took longer than ${Math.round(
        (meta?.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000
      )} seconds and timed out.`;
    } else if (isNetworkError) {
      userMessage = "Could not reach the backend service.";
    } else if (statusCode === 401) {
      userMessage = "Your session has expired. Please sign in again.";
    } else if (statusCode === 404) {
      userMessage = "The requested resource was not found.";
    } else if (statusCode === 400) {
      userMessage = primaryMessage || "The request was rejected by the server.";
    } else if (statusCode != null && statusCode >= 500) {
      userMessage = primaryMessage || "The server could not complete the request.";
    }

    return {
      userMessage,
      developerMessage: developerBits.join(" | "),
      statusCode,
      requestId,
      responseTimeMs,
      timeoutMs: meta?.timeoutMs ?? null,
      method,
      path,
      isTimeout,
      isNetworkError,
    };
  }

  if (err instanceof Error) {
    return {
      userMessage: err.message,
      developerMessage: err.stack || err.message,
      statusCode: null,
      requestId: null,
      responseTimeMs: null,
      timeoutMs: null,
      method: null,
      path: null,
      isTimeout: false,
      isNetworkError: false,
    };
  }

  return {
    userMessage: "An unexpected error occurred.",
    developerMessage: "",
    statusCode: null,
    requestId: null,
    responseTimeMs: null,
    timeoutMs: null,
    method: null,
    path: null,
    isTimeout: false,
    isNetworkError: false,
  };
}

export default API_MEDIA_URL;
