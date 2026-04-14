import type { FnolResponse } from "@/models/fnol";

/**
 * Canonical coverage label for claim UI.
 *
 * Single source of truth order:
 * 1. `coverage_type` on the FNOL row (GET /fnol returns this from `fnol_claims.coverage_type`)
 * 2. Legacy / partial saves: nested `raw_response.policy.coverage_type` only when the column was empty
 *
 * No product-code → display-name mapping here: the backend stores the insurer-facing string as received.
 */
export function getCoverageTypeDisplay(
  fnol: Pick<FnolResponse, "coverage_type" | "raw_response">
): string {
  const raw = fnol.coverage_type?.trim();
  if (raw) return raw;
  const nested = fnol.raw_response?.policy?.coverage_type?.trim();
  if (nested) return nested;
  return "—";
}
