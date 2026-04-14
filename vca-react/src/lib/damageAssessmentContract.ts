/**
 * Lightweight runtime checks for the frozen FNOL damage-assessment card API contract.
 * @see vca-python/claims/DAMAGE_ASSESSMENT_CARD_CONTRACT.md
 */

import type {
  DamageAssessmentCardDetails,
  DamageAssessmentCardsResponse,
  DamageAssessmentClaimContext,
  DamageAssessmentConfidence,
  DamageAssessmentDisplayStatus,
} from "@/models/damageAssessmentCards";

const DISPLAY_STATUSES: DamageAssessmentDisplayStatus[] = [
  "clear",
  "warning",
  "critical",
  "info",
  "partial",
  "failed",
];

function isDisplayStatus(v: unknown): v is DamageAssessmentDisplayStatus {
  return typeof v === "string" && (DISPLAY_STATUSES as string[]).includes(v);
}

/** Empty claim context — all fields nullable per contract. */
const EMPTY_CLAIM_CONTEXT: DamageAssessmentClaimContext = {
  registration: null,
  vin: null,
  make_model_year: null,
  policy_number: null,
  claim_reported_context: null,
  overlap_summary: null,
};

const EMPTY_CONFIDENCE: DamageAssessmentConfidence = {
  label: "—",
  score: null,
};

/**
 * Coerce API payloads into safe shapes for rendering (arrays/objects non-null).
 * Does not invent business facts — only structural defaults.
 */
export function normalizeDamageAssessmentCardDetails(
  raw: DamageAssessmentCardDetails
): DamageAssessmentCardDetails {
  const ctx =
    raw.claim_context && typeof raw.claim_context === "object"
      ? { ...EMPTY_CLAIM_CONTEXT, ...raw.claim_context }
      : { ...EMPTY_CLAIM_CONTEXT };

  const confidence =
    raw.confidence && typeof raw.confidence === "object"
      ? {
          label:
            typeof raw.confidence.label === "string"
              ? raw.confidence.label
              : EMPTY_CONFIDENCE.label,
          score:
            raw.confidence.score == null || Number.isFinite(raw.confidence.score)
              ? raw.confidence.score
              : null,
        }
      : { ...EMPTY_CONFIDENCE };

  return {
    ...raw,
    complaint_id:
      typeof raw.complaint_id === "string" ? raw.complaint_id : String(raw.complaint_id ?? ""),
    card_key: typeof raw.card_key === "string" ? raw.card_key : String(raw.card_key ?? ""),
    title: typeof raw.title === "string" ? raw.title : "",
    headline: typeof raw.headline === "string" ? raw.headline : "",
    status: isDisplayStatus(raw.status) ? raw.status : "failed",
    claim_context: ctx,
    confidence,
    metrics: Array.isArray(raw.metrics) ? raw.metrics : [],
    evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
    caveats: Array.isArray(raw.caveats) ? raw.caveats : [],
    unsupported_fields: Array.isArray(raw.unsupported_fields)
      ? raw.unsupported_fields
      : [],
    raw_evidence_bundle:
      raw.raw_evidence_bundle && typeof raw.raw_evidence_bundle === "object"
        ? raw.raw_evidence_bundle
        : {},
    narrative: raw.narrative ?? {},
    insight: raw.insight ?? null,
    source_snapshot_hash:
      raw.source_snapshot_hash == null ? null : String(raw.source_snapshot_hash),
  };
}

/**
 * Throws if the summary list response drifts from the contract (for tests / dev diagnostics).
 */
export function assertDamageAssessmentCardsResponse(
  data: unknown
): asserts data is DamageAssessmentCardsResponse {
  if (!data || typeof data !== "object") {
    throw new Error("damage-assessment cards: expected object root");
  }
  const o = data as Record<string, unknown>;
  if (typeof o.complaint_id !== "string") {
    throw new Error("damage-assessment cards: complaint_id must be string");
  }
  if (!Array.isArray(o.cards)) {
    throw new Error("damage-assessment cards: cards must be array");
  }
  for (const c of o.cards) {
    if (!c || typeof c !== "object") {
      throw new Error("damage-assessment cards: each card must be object");
    }
    const card = c as Record<string, unknown>;
    if (typeof card.card_key !== "string" || !card.card_key) {
      throw new Error("damage-assessment cards: card_key required");
    }
    if (typeof card.title !== "string") {
      throw new Error("damage-assessment cards: title must be string");
    }
    if (typeof card.headline !== "string") {
      throw new Error("damage-assessment cards: headline must be string");
    }
    if (!isDisplayStatus(card.status)) {
      throw new Error(
        `damage-assessment cards: invalid status on ${card.card_key}`
      );
    }
    if (!card.primary_metric || typeof card.primary_metric !== "object") {
      throw new Error("damage-assessment cards: primary_metric required");
    }
    if (!Array.isArray(card.secondary_metrics)) {
      throw new Error("damage-assessment cards: secondary_metrics must be array");
    }
    if (typeof card.view_details_enabled !== "boolean") {
      throw new Error("damage-assessment cards: view_details_enabled must be boolean");
    }
    if (!Array.isArray(card.caveats)) {
      throw new Error("damage-assessment cards: caveats must be array");
    }
  }
}

/**
 * Throws if detail payload is missing required top-level contract fields.
 */
export function assertDamageAssessmentCardDetailsShape(
  data: unknown
): asserts data is DamageAssessmentCardDetails {
  if (!data || typeof data !== "object") {
    throw new Error("damage-assessment detail: expected object root");
  }
  const o = data as Record<string, unknown>;
  const keys = [
    "complaint_id",
    "card_key",
    "title",
    "headline",
    "status",
    "confidence",
    "claim_context",
    "metrics",
    "evidence",
    "caveats",
    "unsupported_fields",
    "raw_evidence_bundle",
    "narrative",
    "source_snapshot_hash",
    "insight",
  ] as const;
  for (const k of keys) {
    if (!(k in o)) {
      throw new Error(`damage-assessment detail: missing field "${k}"`);
    }
  }
  if (!isDisplayStatus(o.status)) {
    throw new Error("damage-assessment detail: invalid status");
  }
}
