const KEY_SIGNAL_PATTERN =
  /(?:\b\d+(?:,\d{3})*(?:\.\d+)?%?\b|[$€£¥₹฿]\s*\d|RM\s*\d|MYR\s*\d|THB\s*\d|warning|fraud|risk|score|metadata|exif|duplicate|match|similarity|confidence|severity|estimate|valuation|payable|repair|replace|candidate|evidence|reason|note)/i;

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const trimSnippet = (value: string, maxLength = 180) => {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const truncated = normalized.slice(0, maxLength).trimEnd();
  const lastWordBoundary = truncated.lastIndexOf(" ");
  return `${(lastWordBoundary > 40 ? truncated.slice(0, lastWordBoundary) : truncated).trimEnd()}…`;
};

const scoreSnippet = (value: string) => {
  let score = 0;

  if (KEY_SIGNAL_PATTERN.test(value)) {
    score += 5;
  }

  if (/[0-9]/.test(value)) {
    score += 2;
  }

  if (/warning|risk|fraud|duplicate|match|severity|confidence/i.test(value)) {
    score += 2;
  }

  if (/estimate|valuation|repair|payable|cost|currency|pricing/i.test(value)) {
    score += 2;
  }

  score += Math.min(value.length, 160) / 160;

  return score;
};

export function joinDetailSegments(...segments: Array<string | null | undefined>) {
  return segments
    .map((segment) => segment?.trim())
    .filter((segment): segment is string => Boolean(segment))
    .join("\n");
}

export function splitStoredDetailItems(
  detailText: string,
  options: { fallback?: string | string[] } = {}
) {
  const { fallback } = options;
  const normalized = detailText.trim();

  if (!normalized) {
    if (!fallback) return [];
    return (Array.isArray(fallback) ? fallback : [fallback])
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const segments = normalized
    .split(/\r?\n+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments.length > 0 ? segments : [normalized];
}

export function buildSmartSummaryItems(
  detailText: string,
  options: { maxItems?: number; fallback?: string | string[] } = {}
) {
  const { maxItems = 2, fallback } = options;
  const normalized = detailText.trim();

  if (!normalized) {
    if (!fallback) return [];
    return Array.isArray(fallback) ? fallback : [fallback];
  }

  const segments = normalized
    .split(/\r?\n+|(?<=[.!?])\s+|•\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment, index) => ({
      index,
      text: trimSnippet(segment),
      score: scoreSnippet(segment),
    }));

  if (segments.length === 0) {
    return [trimSnippet(normalized)];
  }

  const ranked = [...segments]
    .sort((left, right) => {
      if (right.score === left.score) {
        return left.index - right.index;
      }
      return right.score - left.score;
    })
    .slice(0, maxItems)
    .sort((left, right) => left.index - right.index)
    .map((segment) => segment.text);

  const uniqueRanked = Array.from(new Set(ranked));

  return uniqueRanked.length > 0 ? uniqueRanked : [trimSnippet(normalized)];
}
