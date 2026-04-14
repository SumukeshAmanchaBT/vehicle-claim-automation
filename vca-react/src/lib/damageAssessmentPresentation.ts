/**
 * Display-only helpers for damage-assessment cards/drawer.
 * Contract keys and raw metric labels stay unchanged in API data; we only transform for UI.
 */

import { formatCurrency, inferCurrencyLocale } from "@/lib/market";

/** Known analyzer metric `label` values → business-facing copy. */
export const DAMAGE_ASSESSMENT_METRIC_LABELS: Record<string, string> = {
  photos_on_file: "Photos on file",
  persisted_analysis_runs: "Analysis runs on file",
  max_fraud_score: "Highest fraud score",
  high_risk_images: "High-risk images",
  persisted_duplicate_candidates: "Stored duplicate candidates",
  image_hash_fingerprints_present: "Image fingerprints on file",
  same_policy_other_claims: "Other claims (same policy)",
  same_registration_other_claims: "Other claims (same registration)",
  gross_estimate: "Gross estimate",
  excess_amount: "Excess",
  net_payable: "Net payable",
  currency_code: "Currency",
  part_row_count: "Affected parts",
  valuation_source: "Valuation source",
  evaluation_estimated_amount: "Evaluation estimated amount",
  evaluation_claim_amount: "Evaluation claim amount",
  evaluation_threshold_value: "Decision threshold",
  evaluation_claim_type: "Claim type (evaluation)",
  total_estimated_cost_from_parts: "Estimated from parts",
  llm_damage_tag_count: "Tagged damages (evaluation)",
  parts_marked_replace: "Parts marked replace",
  parts_marked_repair: "Parts marked repair",
  not_available: "Not available",
  summary_build_error: "Summary unavailable",
  top_match: "Top match",
  similar_matches: "Similar matches",
};

const MONETARY_METRIC_LABELS = new Set([
  "gross_estimate",
  "excess_amount",
  "net_payable",
  "evaluation_estimated_amount",
  "evaluation_claim_amount",
  "evaluation_threshold_value",
  "total_estimated_cost_from_parts",
]);

const VALUATION_SOURCE_LABELS: Record<string, string> = {
  claim_phase1_valuation: "Stored claim valuation",
  calculated_from_parts: "Calculated from parts",
};

function humanizeSnakeCase(raw: string): string {
  return raw
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Normalize API or human-entered labels to snake_case for lookup. */
export function normalizeMetricLabelKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
}

export function formatMetricDisplayLabel(raw: string): string {
  if (!raw || typeof raw !== "string") return "—";
  const key = normalizeMetricLabelKey(raw);
  const mapped = DAMAGE_ASSESSMENT_METRIC_LABELS[key] ?? DAMAGE_ASSESSMENT_METRIC_LABELS[raw];
  if (mapped) return mapped;
  return humanizeSnakeCase(key);
}

export function extractCurrencyCodeFromMetrics(
  metrics: ReadonlyArray<{ label: string; value: unknown }>
): string | null {
  const row = metrics.find((m) => m.label === "currency_code");
  const v = row?.value;
  if (v == null || v === "") return null;
  const s = String(v).trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(s)) return s;
  return null;
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function formatPlainNumber(n: number): string {
  if (Number.isInteger(n)) {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 0,
    }).format(n);
  }
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Format a metric value for display. Pass the full metrics list so currency_code can be resolved.
 */
export function formatDamageAssessmentMetricDisplayValue(
  metricLabelRaw: string,
  value: unknown,
  allMetrics: ReadonlyArray<{ label: string; value: unknown }>
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (metricLabelRaw === "currency_code") {
    return String(value).trim().toUpperCase() || "—";
  }

  if (metricLabelRaw === "valuation_source") {
    const key = String(value).trim();
    return VALUATION_SOURCE_LABELS[key] ?? (key ? humanizeSnakeCase(key.replace(/\./g, "_")) : "—");
  }

  const cc = extractCurrencyCodeFromMetrics(allMetrics);
  const n = parseFiniteNumber(value);
  if (n != null && MONETARY_METRIC_LABELS.has(metricLabelRaw) && cc) {
    return formatCurrency(n, cc, inferCurrencyLocale(cc));
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^CLM-/i.test(trimmed) || /^[A-Z]{2,}[-_/]/i.test(trimmed)) {
      return value;
    }
    const asNum = parseFiniteNumber(trimmed);
    if (asNum != null && MONETARY_METRIC_LABELS.has(metricLabelRaw) && cc) {
      return formatCurrency(asNum, cc, inferCurrencyLocale(cc));
    }
    return value;
  }

  if (n != null) {
    return formatPlainNumber(n);
  }

  return String(value);
}

/**
 * Prettify analyzer headlines that embed raw floats or "THB" suffixes.
 */
export function prettifyDamageAssessmentHeadline(
  headline: string,
  allMetrics: ReadonlyArray<{ label: string; value: unknown }>
): string {
  if (!headline) return headline;
  const cc = extractCurrencyCodeFromMetrics(allMetrics);
  let h = headline.replace(/\b(\d+)\.0\b(?=\s|$|[;,])/g, (_, intStr: string) =>
    formatPlainNumber(Number(intStr))
  );
  h = h.replace(/\b(\d+(?:\.\d+)?)\s*THB\b/gi, (_, numStr: string) => {
    const n = Number(numStr);
    if (!Number.isFinite(n)) return `${numStr} THB`;
    return formatCurrency(n, "THB", inferCurrencyLocale("THB"));
  });
  if (cc) {
    const re = new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*${cc}\\b`, "gi");
    h = h.replace(re, (_, numStr: string) => {
      const n = Number(numStr);
      if (!Number.isFinite(n)) return `${numStr} ${cc}`;
      return formatCurrency(n, cc, inferCurrencyLocale(cc));
    });
  }
  h = h.replace(/\btotal estimated\s+(\d+(?:\.\d+)?)\b/gi, (_, numStr: string) => {
    const n = Number(numStr);
    if (!Number.isFinite(n)) return `total estimated ${numStr}`;
    if (cc) return `total estimated ${formatCurrency(n, cc, inferCurrencyLocale(cc))}`;
    return `total estimated ${formatPlainNumber(n)}`;
  });
  h = h.replace(/\bGross\s+(\d+(?:\.\d+)?)(?=\s|$)/gi, (_, numStr: string) => {
    const n = Number(numStr);
    if (!Number.isFinite(n)) return `Gross ${numStr}`;
    if (cc) return `Gross ${formatCurrency(n, cc, inferCurrencyLocale(cc))}`;
    return `Gross ${formatPlainNumber(n)}`;
  });
  return h;
}

const CONFIDENCE_LABEL_PHRASE: Record<string, string> = {
  grounded: "Aligned with stored records",
  limited: "Incomplete — some inputs are not on file yet",
  partial: "Partial — review context before deciding",
  medium: "Moderate — cross-check with evidence",
  high: "Strong — well supported by stored signals",
  low: "Limited supporting data on file",
  not_available: "Not scored from stored data",
};

function formatConfidenceScoreFragment(
  score: number,
  cardKey: string,
  metrics: ReadonlyArray<{ label: string; value: unknown }>
): string {
  const cc = extractCurrencyCodeFromMetrics(metrics);
  if (cardKey === "estimated_value" && cc && score >= 1) {
    return formatCurrency(score, cc, inferCurrencyLocale(cc));
  }
  if (cardKey === "damage_detection" && score >= 1000) {
    return formatPlainNumber(score);
  }
  if (score >= 0 && score <= 100) {
    return `${Math.round(score)}%`;
  }
  return formatPlainNumber(score);
}

/** Single line for drawer/header: keeps honesty without raw API jargon. */
export function formatDamageAssessmentConfidenceLine(
  conf: { label: string; score: number | null },
  cardKey: string,
  metrics: ReadonlyArray<{ label: string; value: unknown }>
): string {
  const raw = (conf.label || "").trim().toLowerCase();
  const friendly =
    CONFIDENCE_LABEL_PHRASE[raw] ??
    (raw ? humanizeSnakeCase(raw.replace(/\s+/g, "_")) : "—");

  if (conf.score == null || !Number.isFinite(conf.score)) {
    return `Confidence: ${friendly}`;
  }
  const suffix = formatConfidenceScoreFragment(conf.score, cardKey, metrics);
  return `Confidence: ${friendly} · ${suffix}`;
}

function normalizeForDedupe(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Drop takeaway lines that only repeat a metric label:value pair already shown in the table.
 */
export function filterRedundantKeyTakeaways(
  lines: string[],
  metrics: ReadonlyArray<{ label: string; value: unknown }>
): string[] {
  const pairs = new Set<string>();
  for (const m of metrics) {
    const dl = normalizeForDedupe(formatMetricDisplayLabel(m.label));
    const dv = normalizeForDedupe(
      formatDamageAssessmentMetricDisplayValue(m.label, m.value, metrics)
    );
    pairs.add(`${dl}:${dv}`);
    pairs.add(`${normalizeForDedupe(m.label)}:${dv}`);
  }

  return lines.filter((line) => {
    const t = line.trim();
    if (!t) return false;
    const sep = t.match(/^(.+?)\s*(?:[:–—]|\s-\s)\s*(.+)$/);
    if (sep) {
      const left = sep[1].trim();
      const right = sep[2].trim();
      const combined = `${normalizeForDedupe(left)}:${normalizeForDedupe(right)}`;
      if (pairs.has(combined)) return false;
      const snake = normalizeMetricLabelKey(left);
      const row = metrics.find(
        (m) => m.label === snake || formatMetricDisplayLabel(m.label) === left
      );
      if (row) {
        const formattedVal = normalizeForDedupe(
          formatDamageAssessmentMetricDisplayValue(row.label, row.value, metrics)
        );
        if (normalizeForDedupe(right) === formattedVal) return false;
      }
    }
    return true;
  });
}

/** Summary card: show at most this many secondary metric rows (executive summary). */
export const DAMAGE_ASSESSMENT_SUMMARY_SECONDARY_CAP = 1;

/** Evidence `type` values from analyzers → short business labels (not shown as raw ALL_CAPS). */
export const DAMAGE_ASSESSMENT_EVIDENCE_TYPE_LABELS: Record<string, string> = {
  exif_warning: "Metadata note",
  per_image_score: "Image score",
  evaluation_signal: "Evaluation signal",
  llm_authenticity_notes: "Authenticity note",
  policy_overlap: "Policy overlap",
  registration_overlap: "Registration overlap",
  duplicate_candidate: "Duplicate match",
  screening_configuration: "Screening settings",
  valuation_snapshot: "Valuation snapshot",
  evaluation_row: "Evaluation amounts",
  part_assessment: "Part assessment",
  llm_damage_list: "Damage tags",
  llm_severity: "Severity label",
  fnol_text: "Reported incident",
  image_hash: "Image fingerprint",
};

const EVIDENCE_DETAIL_KEY_LABELS: Record<string, string> = {
  damage_type: "Damage type",
  action: "Repair action",
  severity_percent: "Severity",
  "severity%": "Severity",
  estimated_amount: "Estimated amount",
  fraud_score: "Fraud score",
  exif_warnings: "EXIF",
  exif_warnings_preview: "EXIF preview",
  match_reason: "Match reason",
  similarity_score: "Similarity",
  claim_amount: "Claim amount",
  claim_type: "Claim type",
  decision: "Decision",
  threshold_value: "Threshold",
};

const SOURCE_DISPLAY: Record<string, string> = {
  damage_part_assessments: "Part assessments",
  claim_evaluation_response: "Latest evaluation",
  claim_duplicate_candidates: "Duplicate screening",
  image_fraud_results: "Image screening",
  "image_fraud_results.exif_json": "Image metadata",
  "image_fraud_results.llm_authenticity_notes": "Authenticity notes",
  fnol_claims: "Claim intake",
  "fnol_claims.incident_description": "Incident description",
  "fnol_claims.policy_number": "Policy data",
  "fnol_claims.vehicle_registration_number": "Vehicle registration",
  claim_phase1_valuation: "Valuation record",
  "pricing_config / django settings": "Pricing configuration",
};

export function formatEvidenceTypeLabel(type?: string): string {
  if (!type || typeof type !== "string") return "";
  const t = type.trim().toLowerCase();
  return DAMAGE_ASSESSMENT_EVIDENCE_TYPE_LABELS[t] ?? humanizeSnakeCase(t);
}

export function formatEvidenceSourceLine(source?: string): string {
  if (!source || !String(source).trim()) return "";
  const s = String(source).trim();
  return SOURCE_DISPLAY[s] ?? humanizeSnakeCase(s.replace(/\./g, "_"));
}

/** Drop exact duplicate evidence rows (same type, label, and detail) while preserving order. */
export function dedupeIdenticalEvidenceItems<
  T extends { type?: string; label?: string; detail?: string },
>(items: readonly T[]): T[] {
  const keys = new Set<string>();
  const out: T[] = [];
  for (const e of items) {
    const k = `${(e.type ?? "").toLowerCase()}|${(e.label ?? "").replace(/\s+/g, " ").trim()}|${(e.detail ?? "").replace(/\s+/g, " ").trim()}`;
    if (keys.has(k)) continue;
    keys.add(k);
    out.push(e);
  }
  return out;
}

function normalizeDetailKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/%$/, "").replace(/%/g, "");
}

/** Parse `k=v; k2=v2` evidence strings into readable rows. */
export function parseEvidenceDetailRows(
  detail: string,
  currencyCode: string | null
): { label: string; value: string }[] {
  const d = detail.trim();
  if (!d || d.length > 4000) return [];

  const looksLikeJson =
    (d.startsWith("{") && d.endsWith("}")) ||
    (d.startsWith("[") && d.endsWith("]")) ||
    /^\s*\{/.test(d);
  if (looksLikeJson) return [];

  const segments = d.split(/\s*;\s*/).filter(Boolean);
  const rows: { label: string; value: string }[] = [];

  for (const seg of segments) {
    const eq = seg.indexOf("=");
    if (eq <= 0) continue;
    const keyRaw = seg.slice(0, eq).trim();
    const valRaw = seg.slice(eq + 1).trim();
    const nk = normalizeDetailKey(keyRaw);
    const label =
      EVIDENCE_DETAIL_KEY_LABELS[nk] ??
      EVIDENCE_DETAIL_KEY_LABELS[keyRaw.trim().toLowerCase()] ??
      humanizeSnakeCase(nk.replace(/%/g, ""));

    let displayVal = valRaw;
    if (
      /amount|threshold|claim_amount|estimated_amount|similarity|score|fraud_score|severity/.test(
        nk
      ) &&
      /^-?\d+(\.\d+)?$/.test(valRaw)
    ) {
      const n = Number(valRaw);
      if (Number.isFinite(n)) {
        if (
          currencyCode &&
          (nk === "estimated_amount" ||
            nk === "claim_amount" ||
            nk === "gross_estimate" ||
            nk.includes("payable") ||
            nk === "excess_amount")
        ) {
          displayVal = formatCurrency(n, currencyCode, inferCurrencyLocale(currencyCode));
        } else if (nk.includes("similarity") || nk.includes("score") || nk.includes("severity")) {
          displayVal =
            n <= 1 && n >= 0 && !Number.isInteger(n)
              ? `${Math.round(n * 100)}%`
              : formatPlainNumber(n);
        } else {
          displayVal = formatPlainNumber(n);
        }
      }
    }
    if (nk === "action" && valRaw) {
      displayVal = humanizeSnakeCase(valRaw.replace(/_/g, " ").toLowerCase());
    }
    rows.push({ label, value: displayVal });
  }

  return rows;
}

export function isEvidenceDetailProbablyJson(detail: string): boolean {
  const d = detail.trim();
  if (d.length < 2) return false;
  if ((d.startsWith("{") && d.endsWith("}")) || (d.startsWith("[") && d.endsWith("]")))
    return true;
  if (d.includes("'phash_threshold'") || d.includes('"phash_threshold"')) return true;
  return false;
}

export function screeningConfigSummaryLine(): string {
  return "Similarity thresholds and match rules are on file; open below only if you need the raw parameters.";
}

/** Cap repetitive evidence types in the main list; remainder counts toward overflow. */
export const DAMAGE_ASSESSMENT_EVIDENCE_REPEAT_TYPES = new Set([
  "llm_authenticity_notes",
  "exif_warning",
]);

export const DAMAGE_ASSESSMENT_EVIDENCE_VISIBLE_PER_REPEAT_TYPE = 2;

/**
 * Drawer “surface” metrics: same count as the summary card (primary + shown secondaries).
 * Keeps drawer/card aligned without assuming a magic number unrelated to the card.
 */
export const DAMAGE_ASSESSMENT_CARD_SURFACE_METRIC_COUNT =
  1 + DAMAGE_ASSESSMENT_SUMMARY_SECONDARY_CAP;

/** First caveat on card: max length to stay scannable. */
export const DAMAGE_ASSESSMENT_CARD_CAVEAT_MAX_CHARS = 140;
