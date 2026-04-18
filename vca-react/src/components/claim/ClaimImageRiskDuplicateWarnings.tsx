import { AlertTriangle, CheckCircle2, Loader2, ScanSearch } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  DuplicateCandidateItem,
  DuplicateCandidatesResponse,
  ImageAuthenticityLabel,
  ImageFraudResultItem,
  ImageFraudResultsResponse,
  ImageRiskSummaryBlock,
} from "@/lib/api";
import {
  getImageAuthenticityBadgeClasses,
  getImageAuthenticityLabels,
} from "@/lib/imageAuthenticity";
import { cn } from "@/lib/utils";

type Props = {
  imageFraudResults: ImageFraudResultsResponse | null;
  duplicateCandidates: DuplicateCandidatesResponse | null;
  imageRiskSummary: ImageRiskSummaryBlock | null | undefined;
  blockingImageRiskCodes: string[] | undefined;
  insightsLoading: boolean;
  /** True once lifecycle-scoped snapshot rows have been loaded for this claim. */
  snapshotReady: boolean;
  className?: string;
};

const LABEL_SORT_ORDER: Record<string, number> = {
  ai_generated: 0,
  edited: 1,
  stock_internet_sourced: 2,
  staged: 3,
  metadata_stripped: 4,
  needs_review: 5,
  genuine: 6,
};

function mergeAuthenticityLabelsAcrossPhotos(
  results: ImageFraudResultItem[]
): ImageAuthenticityLabel[] {
  const byCode = new Map<string, ImageAuthenticityLabel>();
  for (const row of results) {
    for (const lab of getImageAuthenticityLabels(row)) {
      if (!byCode.has(lab.code)) {
        byCode.set(lab.code, lab);
      }
    }
  }
  return Array.from(byCode.values()).sort(
    (a, b) =>
      (LABEL_SORT_ORDER[a.code] ?? 99) - (LABEL_SORT_ORDER[b.code] ?? 99) ||
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
  );
}

function isBlockingLabel(
  code: string,
  blockingCodes: string[] | undefined,
  tone: ImageAuthenticityLabel["tone"]
): boolean {
  if (blockingCodes?.includes(code)) return true;
  if (tone === "rose") return true;
  return false;
}

function formatSimilarityPercent(candidate: DuplicateCandidateItem): string {
  if (
    typeof candidate.similarity_percent === "number" &&
    Number.isFinite(candidate.similarity_percent)
  ) {
    return `${Math.round(candidate.similarity_percent)}%`;
  }
  const raw = candidate.similarity_score;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const pct = raw <= 1 ? raw * 100 : raw;
    return `${Math.round(pct)}%`;
  }
  return "—";
}

function _similaritySortKey(c: DuplicateCandidateItem): number {
  if (typeof c.similarity_percent === "number" && Number.isFinite(c.similarity_percent)) {
    return c.similarity_percent;
  }
  const raw = c.similarity_score;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw <= 1 ? raw * 100 : raw;
  }
  return 0;
}

/** One row per other claim; multiple photo-level rows (same external id) merge with matchCount. */
function dedupeDuplicateCandidatesByOtherClaim(
  candidates: DuplicateCandidateItem[]
): { candidate: DuplicateCandidateItem; matchCount: number }[] {
  const byOtherId = new Map<string, DuplicateCandidateItem[]>();
  for (const c of candidates) {
    const id = (c.other_complaint_id ?? "").trim();
    if (!id) continue;
    const list = byOtherId.get(id) ?? [];
    list.push(c);
    byOtherId.set(id, list);
  }
  const rows: { candidate: DuplicateCandidateItem; matchCount: number }[] = [];
  for (const group of byOtherId.values()) {
    const sorted = [...group].sort((a, b) => _similaritySortKey(b) - _similaritySortKey(a));
    const candidate = sorted[0]!;
    rows.push({ candidate, matchCount: group.length });
  }
  rows.sort((a, b) => _similaritySortKey(b.candidate) - _similaritySortKey(a.candidate));
  return rows;
}

function maxFraudScore(results: ImageFraudResultItem[]): number {
  let max = 0;
  for (const row of results) {
    if (typeof row.fraud_score === "number" && Number.isFinite(row.fraud_score)) {
      max = Math.max(max, row.fraud_score);
    }
  }
  return max;
}

function screeningCardTone(args: {
  blockingSignals: number;
  blockingDupOrImage: boolean;
  hasConcernLabels: boolean;
}): "critical" | "warning" | "success" | "muted" {
  if (args.blockingSignals > 0 || args.blockingDupOrImage) return "critical";
  if (args.hasConcernLabels) return "warning";
  return "success";
}

const toneClasses = {
  critical: {
    card: "border-destructive/45 bg-destructive/5",
    iconBox: "bg-destructive/15",
    icon: "text-destructive",
    headline: "text-destructive",
  },
  warning: {
    card: "border-warning/45 bg-warning/5",
    iconBox: "bg-warning/15",
    icon: "text-warning",
    headline: "text-warning",
  },
  success: {
    card: "border-success/35 bg-success/10",
    iconBox: "bg-success/15",
    icon: "text-success",
    headline: "text-success",
  },
  muted: {
    card: "border-border/60 bg-muted/20",
    iconBox: "bg-muted",
    icon: "text-muted-foreground",
    headline: "text-foreground",
  },
} as const;

/**
 * Single top-row card: image authenticity + duplicate screening, driven by
 * GET image-fraud-results / duplicate-candidates (labels from API + shared normalizer).
 * Always occupies one grid cell — skeleton while loading until the snapshot is ready.
 */
export function ClaimImageRiskDuplicateWarnings({
  imageFraudResults,
  duplicateCandidates,
  imageRiskSummary,
  blockingImageRiskCodes,
  insightsLoading,
  snapshotReady,
  className,
}: Props) {
  const pending = insightsLoading || !snapshotReady;

  if (pending) {
    return (
      <Card
        data-testid="claim-screening-findings-loading"
        className={cn("card-elevated animate-pulse", className)}
      >
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-2.5 w-28 rounded bg-muted" />
              <div className="h-6 w-20 rounded bg-muted" />
              <div className="flex flex-wrap gap-1.5">
                <div className="h-6 w-16 rounded-full bg-muted" />
                <div className="h-6 w-24 rounded-full bg-muted" />
                <div className="h-6 w-20 rounded-full bg-muted" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const results = imageFraudResults?.results ?? [];
  const dupItems = duplicateCandidates?.candidates ?? [];
  const dedupedDupRows = dedupeDuplicateCandidatesByOtherClaim(dupItems);
  const mergedLabels = mergeAuthenticityLabelsAcrossPhotos(results);
  const categoriesSurfaced = imageRiskSummary?.categories_surfaced ?? 0;
  const blockingSignals = imageRiskSummary?.blocking_signals ?? 0;
  const highestFraud = imageRiskSummary?.highest_fraud_score ?? maxFraudScore(results);
  const stpThreshold = imageRiskSummary?.stp_threshold ?? 0;

  const hasDup = dupItems.length > 0;
  const hasPhotoRows = results.length > 0;
  const hasConcernLabels = mergedLabels.some(
    (l) => l.code !== "genuine" && l.code !== "needs_review"
  );
  const hasNeedsReviewOnly =
    mergedLabels.length > 0 &&
    mergedLabels.every((l) => l.code === "genuine" || l.code === "needs_review");
  const blockingDupOrImage =
    mergedLabels.some((l) => isBlockingLabel(l.code, blockingImageRiskCodes, l.tone)) ||
    dupItems.some((c) => {
      const pct = formatSimilarityPercent(c);
      return pct === "100%" || (c.match_reason && /exact/i.test(c.match_reason));
    });

  const toneKey = screeningCardTone({
    blockingSignals,
    blockingDupOrImage,
    hasConcernLabels: hasConcernLabels || (hasNeedsReviewOnly && highestFraud >= 60),
  });
  const tc = toneClasses[toneKey];

  const dataBothEmpty = !hasPhotoRows && dupItems.length === 0;
  if (dataBothEmpty) {
    return (
      <Card
        data-testid="claim-no-image-risk-confirmation"
        className={cn("card-elevated border-2 border-success/35 bg-success/10", className)}
      >
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success/15">
              <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Screening findings</p>
              <p className="text-xl font-bold text-success">No signals</p>
              <p className="text-xs text-muted-foreground">
                No image authenticity or duplicate rows for this lifecycle yet.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const headlineScore =
    highestFraud > 0 ? `${highestFraud % 1 === 0 ? highestFraud.toFixed(0) : highestFraud.toFixed(1)}` : null;

  return (
    <Card
      data-testid="claim-image-risk-dup-warnings"
      className={cn("card-elevated border-2", tc.card, className)}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
              tc.iconBox
            )}
          >
            {toneKey === "critical" || toneKey === "warning" ? (
              <AlertTriangle className={cn("h-5 w-5", tc.icon)} aria-hidden />
            ) : (
              <ScanSearch className={cn("h-5 w-5", tc.icon)} aria-hidden />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-xs text-muted-foreground">Screening findings</p>
            {headlineScore ? (
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <p className={cn("text-xl font-bold tabular-nums", tc.headline)}>{headlineScore}</p>
                <p className="text-xs text-muted-foreground">
                  Fraud score
                  {categoriesSurfaced > 0
                    ? ` · ${categoriesSurfaced} image-risk categories surfaced`
                    : ""}
                </p>
              </div>
            ) : hasDup && mergedLabels.length === 0 ? (
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <p className={cn("text-xl font-bold tabular-nums", tc.headline)}>
                  {dedupedDupRows.length}
                </p>
                <p className="text-xs text-muted-foreground">
                  Other claim{dedupedDupRows.length === 1 ? "" : "s"} flagged
                  {dupItems.length > dedupedDupRows.length
                    ? ` · ${dupItems.length} photo match${dupItems.length === 1 ? "" : "es"}`
                    : ""}
                </p>
              </div>
            ) : categoriesSurfaced > 0 ? (
              <p className="text-xs text-muted-foreground">
                {categoriesSurfaced} image-risk categories surfaced
              </p>
            ) : null}

            {mergedLabels.length > 0 ? (
              <div
                data-testid="claim-image-fraud-warnings"
                className="flex flex-wrap gap-1.5"
              >
                {mergedLabels.map((lab) => {
                  const blocking = isBlockingLabel(lab.code, blockingImageRiskCodes, lab.tone);
                  return (
                    <Badge
                      key={lab.code}
                      variant="outline"
                      className={cn(
                        "max-w-[11rem] truncate px-2 py-0.5 text-[10px] font-semibold shadow-none",
                        blocking
                          ? "border-destructive/35 bg-destructive/10 text-destructive"
                          : getImageAuthenticityBadgeClasses(lab.tone)
                      )}
                      title={lab.label}
                    >
                      {lab.label}
                    </Badge>
                  );
                })}
              </div>
            ) : null}

            {hasDup ? (
              <div data-testid="claim-duplicate-candidates-block" className="flex flex-wrap gap-1.5">
                <Badge variant="outline" className="text-[10px] font-semibold">
                  Duplicate findings
                </Badge>
                {dedupedDupRows.slice(0, 4).map(({ candidate: c, matchCount }) => (
                  <Badge
                    key={c.other_complaint_id}
                    data-testid="duplicate-candidate-row"
                    variant="outline"
                    className="max-w-[18rem] truncate border-border/60 bg-card px-2 py-0.5 text-[10px] font-medium text-foreground"
                    title={
                      matchCount > 1
                        ? `${c.other_complaint_id}: same cross-claim match on ${matchCount} of your uploaded photos${
                            c.match_reason ? ` · ${c.match_reason}` : ""
                          }`
                        : c.match_reason
                          ? `${c.other_complaint_id} · ${c.match_reason}`
                          : c.other_complaint_id
                    }
                  >
                    {c.other_complaint_id} · {formatSimilarityPercent(c)}
                    {matchCount > 1 ? ` · ${matchCount} photos` : ""}
                  </Badge>
                ))}
                {dedupedDupRows.length > 4 ? (
                  <span className="self-center text-[10px] font-medium text-muted-foreground">
                    +{dedupedDupRows.length - 4} more
                  </span>
                ) : null}
              </div>
            ) : null}

            {highestFraud > 0 && stpThreshold > 0 ? (
              <p className="text-[11px] tabular-nums text-muted-foreground">
                Threshold {stpThreshold.toFixed(1)}
                {blockingSignals > 0 ? ` · ${blockingSignals} blocking` : ""}
              </p>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
