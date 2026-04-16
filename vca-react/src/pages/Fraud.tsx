import React, {
  startTransition,
  useDeferredValue,
  useEffect,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { ExpandableDetails } from "@/components/review/ExpandableDetails";
import { ImageAuthenticityClassificationBadges } from "@/components/review/ImageAuthenticityClassificationBadges";
import {
  joinDetailSegments,
  splitStoredDetailItems,
} from "@/components/review/expandable-details-utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FraudReviewSkeleton, StatusWrapper } from "@/components/ui/status-wrapper";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";
import {
  getDuplicateCandidates,
  getFraudClaims,
  getImageFraudResults,
  getTotalValue,
  type DuplicateCandidateItem,
  type DuplicateCandidatesResponse,
  type FraudClaimItem,
  type ImageFraudResultItem,
  type ImageFraudResultsResponse,
  type TotalValueResponse,
} from "@/lib/api";
import { getApiErrorSummary } from "@/lib/httpClient";
import { mapWithConcurrency } from "@/lib/mapWithConcurrency";
import {
  getDuplicateExactMatchPolicy,
  getDuplicateScreeningHeadline,
  getDuplicateScreeningSummary,
} from "@/lib/duplicateScreening";
import { formatCurrency, inferCurrencyLocale } from "@/lib/market";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  DollarSign,
  Eye,
  Loader2,
  RotateCcw,
  Search,
  ShieldAlert,
  TrendingUp,
  XCircle,
} from "lucide-react";

const HIGH_SUSPICION_SCORE = 60;
const REVIEW_SUSPICION_SCORE = 40;

const QUEUE_FILTERS = [
  { key: "all", label: "All claims" },
  { key: "escalate", label: "Escalate now" },
  { key: "review", label: "Review today" },
  { key: "incomplete", label: "Needs data" },
  { key: "clear", label: "Ready to clear" },
] as const;

type QueueFilter = (typeof QUEUE_FILTERS)[number]["key"];

type FraudClaimInsightSnapshot = {
  loaded: boolean;
  imageFraudResults: ImageFraudResultsResponse | null;
  duplicateCandidates: DuplicateCandidatesResponse | null;
  totalValue: TotalValueResponse | null;
  failedSections: string[];
};

type ReviewRecommendation = {
  label:
    | "Loading"
    | "Escalate now"
    | "Review today"
    | "Complete data"
    | "Run analysis"
    | "Ready to clear";
  variant: "processing" | "rejected" | "pending" | "approved";
  priority: number;
  summary: string;
};

const formatElaScore = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(value)) return "—";
  const minimumFractionDigits = Number.isInteger(value) ? 0 : value < 10 ? 2 : 1;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits,
    maximumFractionDigits: 2,
  }).format(value);
};

const getDisplayPhotoName = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

const renderDetailBulletItems = (
  items: string[],
  textClassName = "text-sm text-foreground/90"
) => (
  <ul className="space-y-2">
    {items.map((item, index) => (
      <li key={`${item}-${index}`} className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70"
        />
        <span className={`leading-6 ${textClassName}`}>{item}</span>
      </li>
    ))}
  </ul>
);

const formatReasonCodes = (reason: string) => {
  const codes = reason
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (codes.length === 0) return "Not provided";
  return codes
    .map((code) =>
      code
        .toLowerCase()
        .split("_")
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(" ")
    )
    .join(", ");
};

const formatHumanList = (items: string[]) => {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
};

const getStatusInfo = (status: string) => {
  const map = {
    under_review: { label: "Under Review", variant: "pending" as const, icon: Clock },
    cleared: { label: "Cleared", variant: "approved" as const, icon: CheckCircle2 },
    confirmed: { label: "Business Validation Failed", variant: "rejected" as const, icon: XCircle },
  };
  return map[status as keyof typeof map] || map.under_review;
};

const getClaimInsightMetrics = (snapshot?: FraudClaimInsightSnapshot) => {
  const fraudResults = snapshot?.imageFraudResults?.results ?? [];
  const duplicateCount = snapshot?.duplicateCandidates?.candidate_count ?? 0;
  const warningLabels = Array.from(
    new Set(
      fraudResults.flatMap((result) => result.exif_json?.warnings ?? [])
    )
  );
  const maxFraudScore = fraudResults.reduce(
    (highest, result) => Math.max(highest, result.fraud_score ?? 0),
    0
  );
  const averageFraudScore =
    fraudResults.length > 0
      ? fraudResults.reduce(
          (sum, result) => sum + (result.fraud_score ?? 0),
          0
        ) / fraudResults.length
      : 0;
  const netPayable = snapshot?.totalValue?.net_payable ?? 0;
  const grossEstimate = snapshot?.totalValue?.gross_estimate ?? 0;
  const currencyCode = snapshot?.totalValue?.currency_code ?? "THB";
  const currencyLocale =
    snapshot?.totalValue?.market_context?.locale ??
    inferCurrencyLocale(currencyCode);

  const topFraudResult =
    fraudResults.length > 0
      ? fraudResults.reduce((top, current) =>
          (current.fraud_score ?? 0) > (top?.fraud_score ?? 0) ? current : top
        )
      : null;

  return {
    fraudResults,
    duplicateCount,
    warningLabels,
    maxFraudScore,
    averageFraudScore,
    netPayable,
    grossEstimate,
    currencyCode,
    currencyLocale,
    topFraudResult,
    hasMediaAlert:
      maxFraudScore >= HIGH_SUSPICION_SCORE || duplicateCount > 0,
  };
};

const hasAnyInsightData = (snapshot?: FraudClaimInsightSnapshot) => {
  if (!snapshot?.loaded) return false;
  const metrics = getClaimInsightMetrics(snapshot);
  return (
    metrics.fraudResults.length > 0 ||
    metrics.duplicateCount > 0 ||
    Boolean(snapshot.totalValue)
  );
};

const getAuthenticityState = (snapshot?: FraudClaimInsightSnapshot) => {
  if (!snapshot?.loaded) {
    return { label: "Loading", variant: "processing" as const };
  }

  const metrics = getClaimInsightMetrics(snapshot);
  if (metrics.fraudResults.length === 0) {
    return { label: "Not run", variant: "pending" as const };
  }
  if (metrics.duplicateCount > 0 || metrics.maxFraudScore >= HIGH_SUSPICION_SCORE) {
    return {
      label: `Alert ${Math.round(metrics.maxFraudScore)}`,
      variant: "rejected" as const,
    };
  }
  if (
    metrics.maxFraudScore >= REVIEW_SUSPICION_SCORE ||
    metrics.warningLabels.length > 0
  ) {
    return {
      label: `Review ${Math.round(metrics.maxFraudScore)}`,
      variant: "processing" as const,
    };
  }
  return {
    label: `Clear ${Math.round(metrics.maxFraudScore)}`,
    variant: "approved" as const,
  };
};

const getFraudScoreState = (score: number) => {
  if (score >= HIGH_SUSPICION_SCORE) return "rejected" as const;
  if (score >= REVIEW_SUSPICION_SCORE) return "processing" as const;
  return "approved" as const;
};

const getReviewRecommendation = (
  fraudCase: FraudClaimItem,
  snapshot?: FraudClaimInsightSnapshot
): ReviewRecommendation => {
  if (!snapshot?.loaded) {
    return {
      label: "Loading",
      variant: "processing",
      priority: 5,
      summary:
        "Image authenticity, duplicate screening, and valuation insights are loading.",
    };
  }

  const metrics = getClaimInsightMetrics(snapshot);
  const hasAnyData = hasAnyInsightData(snapshot);
  const failedSections = snapshot.failedSections;

  if (!hasAnyData) {
    return {
      label: "Run analysis",
      variant: "pending",
      priority: 4,
      summary:
        "Run Damage Detection from Claim Detail to populate image trust, duplicate, and valuation evidence for this claim.",
    };
  }

  if (metrics.duplicateCount > 0 || metrics.maxFraudScore >= HIGH_SUSPICION_SCORE) {
    const reasons = [];
    if (metrics.duplicateCount > 0) {
      reasons.push(
        `${metrics.duplicateCount} duplicate match${
          metrics.duplicateCount === 1 ? "" : "es"
        }`
      );
    }
    if (metrics.maxFraudScore >= HIGH_SUSPICION_SCORE) {
      reasons.push(`fraud score ${Math.round(metrics.maxFraudScore)}`);
    }
    if (failedSections.length > 0) {
      reasons.push(`${formatHumanList(failedSections)} still unavailable`);
    }
    return {
      label: "Escalate now",
      variant: "rejected",
      priority: 6,
      summary: `Hold this claim for reviewer confirmation because ${reasons.join(
        ", "
      )}.`,
    };
  }

  if (failedSections.length > 0) {
    return {
      label: "Complete data",
      variant: "processing",
      priority: 3,
      summary: `Some reviewer signals are partial: ${formatHumanList(
        failedSections
      )}. Review what is available and rerun Damage Detection if needed.`,
    };
  }

  if (
    metrics.maxFraudScore >= REVIEW_SUSPICION_SCORE ||
    metrics.warningLabels.length > 0 ||
    fraudCase.status === "under_review"
  ) {
    return {
      label: "Review today",
      variant: "processing",
      priority: 2,
      summary:
        metrics.warningLabels.length > 0
          ? `Media metadata warnings detected: ${metrics.warningLabels.join(
              ", "
            )}.`
          : "Business-rule and media signals are present, but still need reviewer confirmation.",
    };
  }

  return {
    label: "Ready to clear",
    variant: "approved",
    priority: 1,
    summary:
      "Media trust, duplicate screening, and valuation signals are present with no current escalation triggers.",
  };
};

const matchesQueueFilter = (
  filter: QueueFilter,
  recommendation: ReviewRecommendation
) => {
  if (filter === "all") return true;
  if (filter === "escalate") return recommendation.label === "Escalate now";
  if (filter === "review") return recommendation.label === "Review today";
  if (filter === "incomplete") {
    return (
      recommendation.label === "Complete data" ||
      recommendation.label === "Run analysis" ||
      recommendation.label === "Loading"
    );
  }
  return recommendation.label === "Ready to clear";
};

const sortFraudCases = (
  left: FraudClaimItem,
  right: FraudClaimItem,
  claimInsightsById: Record<string, FraudClaimInsightSnapshot>
) => {
  const leftSnapshot = claimInsightsById[left.complaint_id];
  const rightSnapshot = claimInsightsById[right.complaint_id];
  const leftRecommendation = getReviewRecommendation(left, leftSnapshot);
  const rightRecommendation = getReviewRecommendation(right, rightSnapshot);
  if (rightRecommendation.priority !== leftRecommendation.priority) {
    return rightRecommendation.priority - leftRecommendation.priority;
  }

  const leftMetrics = getClaimInsightMetrics(leftSnapshot);
  const rightMetrics = getClaimInsightMetrics(rightSnapshot);
  if (rightMetrics.duplicateCount !== leftMetrics.duplicateCount) {
    return rightMetrics.duplicateCount - leftMetrics.duplicateCount;
  }
  if (rightMetrics.maxFraudScore !== leftMetrics.maxFraudScore) {
    return rightMetrics.maxFraudScore - leftMetrics.maxFraudScore;
  }
  if (rightMetrics.netPayable !== leftMetrics.netPayable) {
    return rightMetrics.netPayable - leftMetrics.netPayable;
  }
  return (
    (Date.parse(right.detectedAt ?? "") || 0) -
    (Date.parse(left.detectedAt ?? "") || 0)
  );
};

export default function Fraud() {
  const [fraudCases, setFraudCases] = useState<FraudClaimItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [queueError, setQueueError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [claimInsightsLoading, setClaimInsightsLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<QueueFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [claimInsightsById, setClaimInsightsById] = useState<
    Record<string, FraudClaimInsightSnapshot>
  >({});

  const deferredSearchQuery = useDeferredValue(searchQuery);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setQueueError(null);
    getFraudClaims()
      .then((data) => {
        if (!cancelled) setFraudCases(data || []);
      })
      .catch((err) => {
        if (!cancelled) {
          setFraudCases([]);
          setQueueError(err);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const queueErrorSummary = queueError ? getApiErrorSummary(queueError) : null;

  useEffect(() => {
    if (fraudCases.length === 0) {
      setClaimInsightsById({});
      setClaimInsightsLoading(false);
      return;
    }

    let cancelled = false;
    setClaimInsightsLoading(true);
    setClaimInsightsById(
      Object.fromEntries(
        fraudCases.map((fraudCase) => [
          fraudCase.complaint_id,
          {
            loaded: false,
            imageFraudResults: null,
            duplicateCandidates: null,
            totalValue: null,
            failedSections: [],
          },
        ])
      )
    );

    const FRAUD_ENRICHMENT_CONCURRENCY = 4;

    mapWithConcurrency(fraudCases, FRAUD_ENRICHMENT_CONCURRENCY, async (fraudCase) => {
      const [imageFraudResults, duplicateCandidates, totalValue] =
        await Promise.allSettled([
          getImageFraudResults(fraudCase.complaint_id),
          getDuplicateCandidates(fraudCase.complaint_id),
          getTotalValue(fraudCase.complaint_id),
        ]);

      const failedSections: string[] = [];
      if (imageFraudResults.status === "rejected") {
        failedSections.push("image authenticity");
      }
      if (duplicateCandidates.status === "rejected") {
        failedSections.push("duplicate screening");
      }
      if (totalValue.status === "rejected") {
        failedSections.push("valuation");
      }

      return [
        fraudCase.complaint_id,
        {
          loaded: true,
          imageFraudResults:
            imageFraudResults.status === "fulfilled"
              ? imageFraudResults.value
              : null,
          duplicateCandidates:
            duplicateCandidates.status === "fulfilled"
              ? duplicateCandidates.value
              : null,
          totalValue:
            totalValue.status === "fulfilled" ? totalValue.value : null,
          failedSections,
        },
      ] as const;
    })
      .then((entries) => {
        if (!cancelled) {
          setClaimInsightsById(Object.fromEntries(entries));
          setClaimInsightsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setClaimInsightsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fraudCases]);

  const mediaAlertCount = fraudCases.filter((fraudCase) =>
    getClaimInsightMetrics(claimInsightsById[fraudCase.complaint_id]).hasMediaAlert
  ).length;
  const duplicateFlagCount = fraudCases.filter(
    (fraudCase) =>
      getClaimInsightMetrics(claimInsightsById[fraudCase.complaint_id]).duplicateCount > 0
  ).length;
  const netExposure = fraudCases.reduce(
    (sum, fraudCase) =>
      sum + getClaimInsightMetrics(claimInsightsById[fraudCase.complaint_id]).netPayable,
    0
  );
  const netExposureCurrencies = Array.from(
    new Set(
      fraudCases
        .map(
          (fraudCase) =>
            claimInsightsById[fraudCase.complaint_id]?.totalValue?.currency_code
        )
        .filter((value): value is string => Boolean(value))
    )
  );
  const netExposureCurrencyCode =
    netExposureCurrencies.length === 1 ? netExposureCurrencies[0] : undefined;
  const insightsLoadedCount = fraudCases.filter(
    (fraudCase) => claimInsightsById[fraudCase.complaint_id]?.loaded
  ).length;
  const partialSignalCount = fraudCases.filter(
    (fraudCase) =>
      (claimInsightsById[fraudCase.complaint_id]?.failedSections.length ?? 0) > 0
  ).length;
  const needsAnalysisCount = fraudCases.filter((fraudCase) => {
    const recommendation = getReviewRecommendation(
      fraudCase,
      claimInsightsById[fraudCase.complaint_id]
    );
    return recommendation.label === "Run analysis";
  }).length;
  const normalizedSearchQuery = deferredSearchQuery.trim().toLowerCase();
  const visibleFraudCases = [...fraudCases]
    .sort((left, right) => sortFraudCases(left, right, claimInsightsById))
    .filter((fraudCase) => {
      const snapshot = claimInsightsById[fraudCase.complaint_id];
      const recommendation = getReviewRecommendation(fraudCase, snapshot);
      const matchesFilter = matchesQueueFilter(activeFilter, recommendation);
      if (!matchesFilter) return false;

      if (!normalizedSearchQuery) return true;

      const searchHaystack = [
        fraudCase.claimNumber,
        fraudCase.complaint_id,
        fraudCase.customer,
        fraudCase.reason,
        fraudCase.latest_claim_status,
        recommendation.label,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchHaystack.includes(normalizedSearchQuery);
    });
  const filterCounts = Object.fromEntries(
    QUEUE_FILTERS.map((filter) => [
      filter.key,
      fraudCases.filter((fraudCase) =>
        matchesQueueFilter(
          filter.key,
          getReviewRecommendation(
            fraudCase,
            claimInsightsById[fraudCase.complaint_id]
          )
        )
      ).length,
    ])
  ) as Record<QueueFilter, number>;

  return (
    <AppLayout
      title="Fraud Review"
      subtitle="Re-open claims enriched with media trust, duplicate detection, and valuation signals"
    >
      <div className="space-y-6 animate-fade-in">
        <Alert className="border-primary/20 bg-primary/5">
          <AlertTriangle className="h-4 w-4 text-primary" />
          <AlertTitle>Fraud review queue</AlertTitle>
          <AlertDescription>
            This workspace combines business-rule history with image authenticity,
            duplicate reuse, and valuation signals. If media trust or valuation
            data is missing, run Damage Detection from Claim Detail first.
          </AlertDescription>
        </Alert>

        {(partialSignalCount > 0 || needsAnalysisCount > 0) && (
          <Alert className="border-warning/30 bg-warning/5">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <AlertTitle>Some claims need follow-up before final review</AlertTitle>
            <AlertDescription>
              {partialSignalCount > 0
                ? `${partialSignalCount} claim${
                    partialSignalCount === 1 ? "" : "s"
                  } loaded only part of the reviewer evidence. `
                : ""}
              {needsAnalysisCount > 0
                ? `${needsAnalysisCount} claim${
                    needsAnalysisCount === 1 ? "" : "s"
                  } still need Damage Detection to populate image-trust and valuation outputs.`
                : ""}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-4">
          <Card className="card-elevated border-l-4 border-l-primary">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <ShieldAlert className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Re-open Claims</p>
                  <p className="text-2xl font-bold">{fraudCases.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="card-elevated border-l-4 border-l-destructive">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Media Trust Alerts</p>
                  <p className="text-2xl font-bold">{mediaAlertCount}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="card-elevated border-l-4 border-l-warning">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/10">
                  <TrendingUp className="h-5 w-5 text-warning" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Duplicate Flags</p>
                  <p className="text-2xl font-bold">{duplicateFlagCount}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="card-elevated border-l-4 border-l-success">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
                  <DollarSign className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Net Exposure</p>
                  <p className="text-2xl font-bold">
                    {netExposureCurrencyCode
                      ? formatCurrency(netExposure, netExposureCurrencyCode)
                      : new Intl.NumberFormat("en-US", {
                          maximumFractionDigits: 0,
                          minimumFractionDigits: 0,
                        }).format(netExposure)}
                  </p>
                  {netExposureCurrencies.length > 1 && (
                    <p className="text-xs text-muted-foreground">
                      Mixed currencies across Thailand/Malaysia claim contexts
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="card-elevated">
          <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) =>
                  startTransition(() => setSearchQuery(event.target.value))
                }
                placeholder="Search by claim number, complaint ID, customer, or review state"
                className="pl-9"
                aria-label="Search fraud review queue"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {QUEUE_FILTERS.map((filter) => (
                <Button
                  key={filter.key}
                  type="button"
                  size="sm"
                  variant={activeFilter === filter.key ? "default" : "outline"}
                  onClick={() =>
                    startTransition(() => setActiveFilter(filter.key))
                  }
                >
                  {filter.label}
                  <span className="ml-1 text-xs opacity-80">
                    {filterCounts[filter.key]}
                  </span>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="card-elevated overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Fraud Review Queue
            </CardTitle>
            {!loading && (
              <div className="text-right text-sm text-muted-foreground">
                <p>
                  Showing{" "}
                  <span className="font-medium text-foreground">
                    {visibleFraudCases.length}
                  </span>
                  {" "}of{" "}
                  <span className="font-medium text-foreground">
                    {fraudCases.length}
                  </span>{" "}
                  claims
                </p>
                <p>
                  Enrichment loaded:{" "}
                  <span className="font-medium text-foreground">
                    {insightsLoadedCount}/{fraudCases.length}
                  </span>
                  {claimInsightsLoading ? " (refreshing)" : ""}
                </p>
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <StatusWrapper
              status={
                loading ? "loading" : queueErrorSummary ? "error" : "success"
              }
              loading={<FraudReviewSkeleton />}
              loadingTitle="Loading fraud review queue"
              loadingDescription="Fetching re-open claims enriched with media trust, duplicate detection, and valuation signals."
              errorTitle="Could not load fraud review"
              error={queueErrorSummary}
              onRetry={() => setReloadToken((value) => value + 1)}
            >
            {fraudCases.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                No re-open claims are available for fraud review yet.
              </div>
            ) : visibleFraudCases.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                No claims match the current search or filter.
              </div>
            ) : (
              <Table>
                <TableHeader className="table-header-bg">
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="w-10 pl-4 pr-0" />
                    <TableHead className="pl-4">Claim #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Review State</TableHead>
                    <TableHead>Authenticity</TableHead>
                    <TableHead>Duplicate Flags</TableHead>
                    <TableHead>Net Payable</TableHead>
                    <TableHead className="pr-6 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleFraudCases.map((fraudCase) => {
                    const statusInfo = getStatusInfo(fraudCase.status);
                    const StatusIcon = statusInfo.icon;
                    const isExpanded = expandedId === fraudCase.complaint_id;
                    const timesProcessed = fraudCase.times_processed ?? 0;
                    const insightSnapshot = claimInsightsById[fraudCase.complaint_id];
                    const insightMetrics = getClaimInsightMetrics(insightSnapshot);
                    const authenticityState = getAuthenticityState(insightSnapshot);
                    const reviewRecommendation = getReviewRecommendation(
                      fraudCase,
                      insightSnapshot
                    );
                    const duplicateSettings =
                      insightSnapshot?.duplicateCandidates?.duplicate_detection;

                    return (
                      <React.Fragment key={fraudCase.complaint_id}>
                        <TableRow
                          className="group cursor-pointer hover:bg-muted/50"
                          onClick={() =>
                            setExpandedId(
                              isExpanded ? null : fraudCase.complaint_id
                            )
                          }
                        >
                          <TableCell
                            className="w-10 pl-4 pr-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="flex items-center justify-center rounded p-1 hover:bg-muted"
                              aria-label={isExpanded ? "Collapse" : "Expand"}
                              onClick={() =>
                                setExpandedId(
                                  isExpanded ? null : fraudCase.complaint_id
                                )
                              }
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                            </button>
                          </TableCell>
                          <TableCell
                            className="pl-4"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="space-y-1">
                              <Link
                                to={`/claims/${fraudCase.complaint_id}`}
                                className="font-medium text-primary hover:underline"
                              >
                                {fraudCase.claimNumber}
                              </Link>
                              <p className="text-xs text-muted-foreground">
                                {fraudCase.complaint_id}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <p className="font-medium">{fraudCase.customer}</p>
                              <StatusBadge status={reviewRecommendation.variant}>
                                {reviewRecommendation.label}
                              </StatusBadge>
                            </div>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={statusInfo.variant}>
                              <StatusIcon className="h-3 w-3" />
                              {fraudCase.latest_claim_status ?? statusInfo.label}
                            </StatusBadge>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={authenticityState.variant}>
                              {authenticityState.label}
                            </StatusBadge>
                          </TableCell>
                          <TableCell>
                            {insightSnapshot?.loaded ? (
                              insightMetrics.duplicateCount > 0 ? (
                                <span className="text-sm font-medium text-destructive">
                                  {insightMetrics.duplicateCount} match
                                  {insightMetrics.duplicateCount === 1 ? "" : "es"}
                                </span>
                              ) : (
                                <span className="text-sm text-muted-foreground">
                                  None
                                </span>
                              )
                            ) : (
                              <span className="text-sm text-muted-foreground">
                                Loading...
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="font-medium">
                            {insightSnapshot?.loaded
                              ? formatCurrency(
                                  insightMetrics.netPayable,
                                  insightMetrics.currencyCode,
                                  insightMetrics.currencyLocale
                                )
                              : "—"}
                          </TableCell>
                          <TableCell
                            className="pr-6 text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-end gap-2">
                              <Button variant="outline" size="sm" asChild>
                                <Link to={`/claims/${fraudCase.complaint_id}`}>
                                  <Eye className="mr-1 h-4 w-4" />
                                  Review
                                </Link>
                              </Button>
                              {fraudCase.re_open === 1 && (
                                <Button variant="outline" size="sm" asChild>
                                  <Link
                                    to={`/claims/${fraudCase.complaint_id}?reopen=1`}
                                  >
                                    <RotateCcw className="mr-1 h-4 w-4" />
                                    Reopen
                                  </Link>
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={8} className="pl-12 pr-6 py-4">
                              {!insightSnapshot?.loaded ? (
                                <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
                                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                  Loading media-trust signals for this claim.
                                </div>
                              ) : (
                                <div className="space-y-4">
                                  <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
                                    <div className="rounded-lg border p-4">
                                      <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                          <p className="text-sm font-medium text-foreground">
                                            Recommended next step
                                          </p>
                                          <p className="mt-1 text-sm text-muted-foreground">
                                            {reviewRecommendation.summary}
                                          </p>
                                        </div>
                                        <StatusBadge status={reviewRecommendation.variant}>
                                          {reviewRecommendation.label}
                                        </StatusBadge>
                                      </div>

                                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                                        <div className="rounded-md bg-muted/50 p-3">
                                          <p className="text-xs text-muted-foreground">
                                            Business-rule reason
                                          </p>
                                          <p className="mt-1 text-sm text-foreground">
                                            {fraudCase.reason || "No reason captured."}
                                          </p>
                                        </div>
                                        <div className="rounded-md bg-muted/50 p-3">
                                          <p className="text-xs text-muted-foreground">
                                            Latest run
                                          </p>
                                          <p className="mt-1 text-sm text-foreground">
                                            {fraudCase.detectedAt
                                              ? formatDateTime(fraudCase.detectedAt)
                                              : "—"}
                                          </p>
                                        </div>
                                      </div>
                                    </div>

                                    <div className="rounded-lg border p-4">
                                      <p className="text-sm font-medium text-foreground">
                                        Reviewer checklist
                                      </p>
                                      <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                                        <p>
                                          1. Confirm media-trust score and duplicate
                                          evidence.
                                        </p>
                                        <p>
                                          2. Compare valuation exposure against the
                                          claim narrative.
                                        </p>
                                        <p>
                                          3. Open Claim Detail for photo-by-photo
                                          investigation or rerun analysis.
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  {insightSnapshot.failedSections.length > 0 && (
                                    <Alert className="border-warning/30 bg-warning/5">
                                      <AlertTriangle className="h-4 w-4 text-warning" />
                                      <AlertTitle>Some insights are partial</AlertTitle>
                                      <AlertDescription>
                                        {formatHumanList(insightSnapshot.failedSections)}{" "}
                                        could not be loaded for this claim. The queue
                                        is showing the evidence that is available now.
                                      </AlertDescription>
                                    </Alert>
                                  )}

                                  {!hasAnyInsightData(insightSnapshot) ? (
                                    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                                      Image-authenticity and duplicate results
                                      are not available yet for this claim. Run
                                      Damage Detection from Claim Detail to
                                      populate them.
                                    </div>
                                  ) : (
                                    <>
                                      <div className="grid gap-4 lg:grid-cols-3">
                                        <div className="rounded-lg border p-4">
                                          <p className="text-xs text-muted-foreground">
                                            Highest Fraud Score
                                          </p>
                                          <p className="mt-2 text-2xl font-semibold">
                                            {Math.round(
                                              insightMetrics.maxFraudScore
                                            )}
                                          </p>
                                          <p className="mt-2 text-sm text-muted-foreground">
                                            {insightMetrics.fraudResults.length}{" "}
                                            image
                                            {insightMetrics.fraudResults.length === 1
                                              ? ""
                                              : "s"}{" "}
                                            screened. Average score{" "}
                                            {Math.round(
                                              insightMetrics.averageFraudScore
                                            )}
                                            .
                                          </p>
                                        </div>

                                        <div className="rounded-lg border p-4">
                                          <p className="text-xs text-muted-foreground">
                                            Duplicate Review
                                          </p>
                                          <p className="mt-2 text-2xl font-semibold">
                                            {insightMetrics.duplicateCount}
                                          </p>
                                          <p className="mt-2 text-sm text-muted-foreground">
                                            {insightMetrics.duplicateCount > 0
                                              ? "Cross-claim image reuse candidates need reviewer confirmation."
                                              : "No cross-claim image reuse candidates detected."}
                                          </p>
                                        </div>

                                        <div className="rounded-lg border p-4">
                                          <p className="text-xs text-muted-foreground">
                                            Valuation Summary
                                          </p>
                                          <p className="mt-2 text-2xl font-semibold">
                                            {formatCurrency(
                                              insightMetrics.netPayable,
                                              insightMetrics.currencyCode,
                                              insightMetrics.currencyLocale
                                            )}
                                          </p>
                                          <p className="mt-2 text-sm text-muted-foreground">
                                            Gross estimate{" "}
                                            {formatCurrency(
                                              insightMetrics.grossEstimate,
                                              insightMetrics.currencyCode,
                                              insightMetrics.currencyLocale
                                            )}
                                            . Excess{" "}
                                            {formatCurrency(
                                              insightSnapshot.totalValue
                                                ?.excess_amount ?? 0,
                                              insightMetrics.currencyCode,
                                              insightMetrics.currencyLocale
                                            )}
                                            .
                                          </p>
                                        </div>
                                      </div>

                                      <div className="grid gap-4 xl:grid-cols-2">
                                        <div className="rounded-lg border p-4">
                                          <div className="flex items-center justify-between gap-3">
                                            <div>
                                              <p className="text-sm font-medium text-foreground">
                                                Photo screening results
                                              </p>
                                              <p className="text-xs text-muted-foreground">
                                                Fraud score (composite), Error Level Analysis
                                                (ELA), warnings, and authenticity notes per image
                                              </p>
                                            </div>
                                            <span className="text-xs text-muted-foreground">
                                              {insightMetrics.fraudResults.length} image
                                              {insightMetrics.fraudResults.length === 1
                                                ? ""
                                                : "s"}
                                            </span>
                                          </div>

                                          <div className="mt-4 space-y-3">
                                            {insightMetrics.fraudResults.length === 0 ? (
                                              <p className="text-sm text-muted-foreground">
                                                No image-authenticity results are stored
                                                yet.
                                              </p>
                                            ) : (
                                              insightMetrics.fraudResults.map(
                                                (result: ImageFraudResultItem) => {
                                                  const warnings =
                                                    result.exif_json?.warnings ?? [];
                                                  const exactAuthenticityDetails =
                                                    joinDetailSegments(
                                                      warnings.length > 0
                                                        ? `Warnings: ${warnings.join(", ")}`
                                                        : null,
                                                      result.llm_notes ?? null
                                                    );
                                                  const authenticityDetailItems =
                                                    splitStoredDetailItems(
                                                      exactAuthenticityDetails,
                                                      {
                                                        fallback:
                                                          warnings.length > 0
                                                            ? [`Warnings: ${warnings.join(", ")}`]
                                                            : "No additional authenticity narrative was stored for this image.",
                                                      }
                                                    );

                                                  return (
                                                    <div
                                                      key={
                                                        result.id ??
                                                        `${fraudCase.complaint_id}-${result.photo_path}`
                                                      }
                                                      className="rounded-md border bg-muted/20 p-3"
                                                    >
                                                      <div className="flex flex-wrap items-center justify-between gap-3">
                                                        <div>
                                                          <p className="text-sm font-medium text-foreground">
                                                            {getDisplayPhotoName(
                                                              result.photo_path
                                                            )}
                                                          </p>
                                                          <ImageAuthenticityClassificationBadges
                                                            result={result}
                                                            className="pt-1"
                                                          />
                                                          <p className="text-xs text-muted-foreground">
                                                            Error Level Analysis (ELA):{" "}
                                                            {formatElaScore(result.ela_score)}
                                                          </p>
                                                        </div>
                                                        <StatusBadge
                                                          status={getFraudScoreState(
                                                            result.fraud_score ?? 0
                                                          )}
                                                        >
                                                          Score{" "}
                                                          {Math.round(
                                                            result.fraud_score ?? 0
                                                          )}
                                                        </StatusBadge>
                                                      </div>

                                                      {exactAuthenticityDetails ? (
                                                        <ExpandableDetails
                                                          className="mt-3"
                                                          previewTone={
                                                            (result.fraud_score ?? 0) >=
                                                              HIGH_SUSPICION_SCORE
                                                              ? "destructive"
                                                              : warnings.length > 0
                                                                ? "warning"
                                                                : "info"
                                                          }
                                                          hideHeader
                                                          summary={renderDetailBulletItems(
                                                            authenticityDetailItems,
                                                            "text-sm text-foreground/90"
                                                          )}
                                                        />
                                                      ) : (
                                                        <p className="mt-3 text-sm text-muted-foreground">
                                                          No additional authenticity narrative is stored
                                                          for this image.
                                                        </p>
                                                      )}
                                                    </div>
                                                  );
                                                }
                                              )
                                            )}
                                          </div>
                                        </div>

                                        <div className="rounded-lg border p-4">
                                          <div className="flex items-center justify-between gap-3">
                                            <div>
                                              <p className="text-sm font-medium text-foreground">
                                                Cross-claim duplicate candidates
                                              </p>
                                              <p className="text-xs text-muted-foreground">
                                                Similarity scores, reason codes, and
                                                reviewer thresholds
                                              </p>
                                            </div>
                                            {duplicateSettings && (
                                              <p className="text-xs text-muted-foreground">
                                                {getDuplicateScreeningHeadline(
                                                  duplicateSettings
                                                )}
                                              </p>
                                            )}
                                          </div>

                                          <div className="mt-4 space-y-3">
                                            {duplicateSettings && (
                                              <p className="text-xs text-muted-foreground">
                                                {getDuplicateScreeningSummary(
                                                  duplicateSettings
                                                )}{" "}
                                                {getDuplicateExactMatchPolicy(
                                                  duplicateSettings
                                                )}
                                              </p>
                                            )}
                                            {(
                                              insightSnapshot.duplicateCandidates?.candidates ??
                                              []
                                            ).length === 0 ? (
                                              <p className="text-sm text-muted-foreground">
                                                No duplicate candidates were persisted
                                                for this claim.
                                              </p>
                                            ) : (
                                              (
                                                insightSnapshot.duplicateCandidates
                                                  ?.candidates ?? []
                                              ).map(
                                                (candidate: DuplicateCandidateItem) => (
                                                  <div
                                                    key={`${fraudCase.complaint_id}-${candidate.other_complaint_id}`}
                                                    className="rounded-md border bg-muted/20 p-3"
                                                  >
                                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                                      <div>
                                                        <p className="text-sm font-medium text-foreground">
                                                          {candidate.other_complaint_id}
                                                        </p>
                                                        <p className="text-xs text-muted-foreground">
                                                          {formatReasonCodes(
                                                            candidate.match_reason
                                                          )}
                                                        </p>
                                                      </div>
                                                      <StatusBadge status="rejected">
                                                        {Math.round(
                                                          candidate.similarity_percent ??
                                                            candidate.similarity_score ??
                                                            0
                                                        )}
                                                        % similar
                                                      </StatusBadge>
                                                    </div>
                                                    {candidate.match_reason ? (
                                                      <ExpandableDetails
                                                        className="mt-3"
                                                        previewTone="warning"
                                                        hideHeader
                                                        summary={renderDetailBulletItems(
                                                          splitStoredDetailItems(
                                                            candidate.match_reason,
                                                            {
                                                              fallback:
                                                                candidate.match_reason,
                                                            }
                                                          ),
                                                          "text-sm text-foreground/90"
                                                        )}
                                                      />
                                                    ) : (
                                                      <p className="mt-3 text-xs text-muted-foreground">
                                                        No stored match explanation is available
                                                        for this candidate.
                                                      </p>
                                                    )}
                                                  </div>
                                                )
                                              )
                                            )}
                                          </div>
                                        </div>
                                      </div>

                                      {insightMetrics.warningLabels.length > 0 && (
                                        <div className="rounded-lg border p-4">
                                          <p className="text-xs text-muted-foreground">
                                            Metadata warnings
                                          </p>
                                          <p className="mt-2 text-sm font-medium">
                                            {insightMetrics.warningLabels.join(
                                              ", "
                                            )}
                                          </p>
                                        </div>
                                      )}

                                      {insightMetrics.fraudResults.length > 1 &&
                                        insightMetrics.topFraudResult?.llm_notes && (
                                        <div className="rounded-lg border p-4">
                                          <p className="text-xs text-muted-foreground">
                                            Top authenticity finding
                                          </p>
                                          <ExpandableDetails
                                            className="mt-3"
                                            previewTone="warning"
                                            hideHeader
                                            summary={renderDetailBulletItems(
                                              splitStoredDetailItems(
                                                insightMetrics.topFraudResult.llm_notes,
                                                {
                                                  fallback:
                                                    insightMetrics.topFraudResult.llm_notes,
                                                }
                                              ),
                                              "text-sm text-foreground/90"
                                            )}
                                          />
                                        </div>
                                      )}
                                    </>
                                  )}

                                  <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                      <p className="text-sm font-medium text-foreground">
                                        Evaluation records ({timesProcessed} record
                                        {timesProcessed === 1 ? "" : "s"})
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        Latest run:{" "}
                                        {fraudCase.detectedAt
                                          ? formatDateTime(fraudCase.detectedAt)
                                          : "—"}
                                      </p>
                                    </div>

                                    {fraudCase.evaluation_records &&
                                    fraudCase.evaluation_records.length > 0 ? (
                                      <div className="overflow-x-auto rounded-md border border-border">
                                        <Table>
                                          <TableHeader>
                                            <TableRow className="bg-muted/50">
                                              <TableHead className="text-xs">#</TableHead>
                                              <TableHead className="text-xs">
                                                Complaint ID
                                              </TableHead>
                                              <TableHead className="text-xs">
                                                Threshold value
                                              </TableHead>
                                              <TableHead className="text-xs">
                                                Claim status
                                              </TableHead>
                                              <TableHead className="min-w-[220px] text-xs">
                                                Reason
                                              </TableHead>
                                            </TableRow>
                                          </TableHeader>
                                          <TableBody>
                                            {fraudCase.evaluation_records.map(
                                              (record) => (
                                                <TableRow
                                                  key={`${record.complaint_id}-${record.version}`}
                                                  className="border-border"
                                                >
                                                  <TableCell className="py-2 text-xs">
                                                    {record.version}
                                                  </TableCell>
                                                  <TableCell className="py-2 text-xs">
                                                    {record.complaint_id}
                                                  </TableCell>
                                                  <TableCell className="py-2 text-xs">
                                                    {record.threshold_value ?? "—"}
                                                  </TableCell>
                                                  <TableCell className="py-2 text-xs">
                                                    {record.claim_status}
                                                  </TableCell>
                                                  <TableCell className="max-w-[320px] break-words py-2 text-xs">
                                                    {record.reason}
                                                  </TableCell>
                                                </TableRow>
                                              )
                                            )}
                                          </TableBody>
                                        </Table>
                                      </div>
                                    ) : (
                                      <p className="text-sm text-muted-foreground">
                                        No evaluation records.
                                      </p>
                                    )}
                                  </div>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            </StatusWrapper>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
