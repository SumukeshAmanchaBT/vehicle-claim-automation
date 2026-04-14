import type { DuplicateDetectionSettings } from "@/lib/api";

const toPercent = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(value)) return null;
  return Math.round((value <= 1 ? value * 100 : value));
};

const inferSensitivityLabel = (
  settings: DuplicateDetectionSettings | null | undefined
) => {
  const values = [
    toPercent(settings?.phash_threshold),
    toPercent(settings?.dhash_threshold),
  ].filter((value): value is number => value != null);

  if (values.length === 0) return "Standard";
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (average >= 95) return "Strict";
  if (average >= 88) return "Balanced";
  return "Broad";
};

const inferMatchPolicyLabel = (
  settings: DuplicateDetectionSettings | null | undefined
) =>
  settings?.require_both_non_exact
    ? "Dual-signal confirmation"
    : "Single-signal alerting";

export const getDuplicateScreeningHeadline = (
  settings: DuplicateDetectionSettings | null | undefined
) => {
  if (!settings) return "Duplicate screening profile unavailable";

  const sensitivity = settings.sensitivity_label || inferSensitivityLabel(settings);
  const matchPolicy = settings.match_policy_label || inferMatchPolicyLabel(settings);
  return `${sensitivity} screening · ${matchPolicy}`;
};

export const getDuplicateScreeningSummary = (
  settings: DuplicateDetectionSettings | null | undefined
) => {
  if (!settings) {
    return "Duplicate-screening settings are not available yet.";
  }

  if (settings.reviewer_summary) {
    return settings.reviewer_summary;
  }

  const sensitivity = settings.sensitivity_label || inferSensitivityLabel(settings);
  return settings.require_both_non_exact
    ? `${sensitivity} screening. Both visual similarity signals must align before a possible cross-claim near-match is flagged.`
    : `${sensitivity} screening. A strong match on either visual similarity signal can flag a possible cross-claim near-match.`;
};

export const getDuplicateExactMatchPolicy = (
  settings: DuplicateDetectionSettings | null | undefined
) => settings?.exact_match_policy || "Exact file matches are always flagged.";
