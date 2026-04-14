import { useState, useEffect, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { StatusBadge } from "@/components/ui/status-badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Car,
  User,
  Calendar,
  Shield,
  CheckCircle2,
  AlertTriangle,
  Brain,
  Loader2,
  FileText,
  FileDown,
  Clock,
  ChevronDown,
} from "lucide-react";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import {
  getFnolById,
  getClaimEvaluation,
  getDetailedDamageAssessment,
  getDuplicateCandidates,
  getImageFraudResults,
  getRecommendationReportPdf,
  getTotalValue,
  processClaim,
  runDetailedDamageAssessment,
  runFraudDetection,
  runImageFraudAnalysis,
  type BusinessRuleSummaryBlock,
  type ClaimWorkflowState,
  type FnolPayload,
  type FnolResponse,
  type ProcessClaimResponse,
  type ClaimEvaluationResponse,
  type DetailedDamageAssessmentResponse,
  type DuplicateCandidatesResponse,
  type ImageFraudResultsResponse,
  type TotalValueResponse,
} from "@/lib/api";
import type { FraudRuleResult } from "@/models/fnol";
import type { DamageAssessmentCardSummary } from "@/models/damageAssessmentCards";
import { getApiErrorDetail, getApiErrorSummary, resolveDamagePhotoUrl } from "@/lib/httpClient";
import {
  formatCurrency,
  inferCurrencyLocale,
  inferMarketContextFromLocation,
} from "@/lib/market";
import { useToast } from "@/components/ui/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DamageAssessmentCardsPanel } from "@/components/damage-assessment/DamageAssessmentCardsPanel";
import { DamageAssessmentDetailsDrawer } from "@/components/damage-assessment/DamageAssessmentDetailsDrawer";
import { damageAssessmentCardsKey } from "@/components/damage-assessment/damageAssessmentQueryKeys";
import { ExpandableDetails } from "@/components/review/ExpandableDetails";
import { ImageAuthenticityClassificationBadges } from "@/components/review/ImageAuthenticityClassificationBadges";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  joinDetailSegments,
  splitStoredDetailItems,
} from "@/components/review/expandable-details-utils";
import { getCoverageTypeDisplay } from "@/lib/coverageDisplay";
import {
  buildClaimTopInsightRows,
  ClaimTopInsightsStrip,
} from "@/components/claim/ClaimTopInsightsStrip";
import { ClaimImageRiskSummaryCard } from "@/components/claim/ClaimImageRiskSummaryCard";

const formatElaScore = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(value)) return "—";
  const minimumFractionDigits = Number.isInteger(value) ? 0 : value < 10 ? 2 : 1;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatPipelineLabel = (pipeline?: string) => {
  switch (pipeline) {
    case "langgraph_agentic":
      return "LangGraph agentic pipeline";
    case "vision_llm_direct":
      return "Vision LLM direct estimate";
    default:
      return pipeline ? pipeline.replace(/_/g, " ") : "Not available";
  }
};

const formatPricingSourceLabel = (pricingSource?: string) => {
  switch (pricingSource) {
    case "web_search":
      return "Live web-search pricing";
    case "mixed":
      return "Web search + LLM reasoning";
    case "training_knowledge":
      return "LLM pricing knowledge";
    case "vision_llm_initial":
      return "Initial vision estimate";
    default:
      return pricingSource ? pricingSource.replace(/_/g, " ") : "Not available";
  }
};

const buildBusinessRuleSummaryFallback = (
  decisionSummary: ClaimEvaluationResponse["decision_summary"] | null | undefined,
  validationPassedFallback: boolean
): BusinessRuleSummaryBlock => {
  const failedRuleCount = decisionSummary?.signals.failed_business_rule_count ?? 0;
  const validationPassed =
    decisionSummary?.business_rule_validation_passed ?? validationPassedFallback;
  const fraudBand = (decisionSummary?.signals.fraud_band ?? "").trim().toLowerCase();

  if (failedRuleCount > 0 || decisionSummary?.business_rule_validation_passed === false) {
    return {
      status_tone: "critical",
      title: "Business Rule Validation Failed",
      headline: "High Risk",
      detail:
        failedRuleCount > 0
          ? `${failedRuleCount} business-rule check${failedRuleCount === 1 ? "" : "s"} failed.`
          : "Business-rule validation did not pass for this claim.",
      fraud_band: decisionSummary?.signals.fraud_band ?? null,
      failed_rule_count: failedRuleCount,
      validation_passed: false,
    };
  }

  if (fraudBand === "high") {
    return {
      status_tone: "critical",
      title: validationPassed
        ? "Business Rule Validation Passed"
        : "Business Rule Validation Completed",
      headline: "High Risk",
      detail: "Business-rule fraud screening classified this claim as high risk.",
      fraud_band: decisionSummary?.signals.fraud_band ?? null,
      failed_rule_count: 0,
      validation_passed: validationPassed,
    };
  }

  if (fraudBand === "medium" || fraudBand === "warning") {
    return {
      status_tone: "warning",
      title: validationPassed
        ? "Business Rule Validation Passed"
        : "Business Rule Validation Completed",
      headline: "Review Required",
      detail: "Business-rule fraud screening returned a medium-risk result.",
      fraud_band: decisionSummary?.signals.fraud_band ?? null,
      failed_rule_count: 0,
      validation_passed: validationPassed,
    };
  }

  if (validationPassed) {
    return {
      status_tone: "success",
      title: "Business Rule Validation Passed",
      headline: "Low Risk",
      detail: "All configured business and fraud rules passed.",
      fraud_band: decisionSummary?.signals.fraud_band ?? null,
      failed_rule_count: 0,
      validation_passed: true,
    };
  }

  return {
    status_tone: "info",
    title: "Business Rule Validation Pending",
    headline: "Pending",
    detail: "Run business-rule validation to evaluate policy and fraud rules.",
    fraud_band: decisionSummary?.signals.fraud_band ?? null,
    failed_rule_count: 0,
    validation_passed: validationPassed,
  };
};

const formatConfidenceLabel = (confidence?: string) => {
  if (!confidence) return "Not available";
  return confidence.charAt(0).toUpperCase() + confidence.slice(1);
};

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

type ClaimPhotoAsset = {
  key: string;
  label: string;
  url: string;
};

/** localStorage key for persisting DA-run status across navigation per claim. */
const daRunStorageKey = (claimId: string) => `vca_da_run_${claimId}`;

const buildClaimPhotoAssets = (
  photos: Array<string | { image?: { url?: string } }> | undefined
): ClaimPhotoAsset[] =>
  (photos ?? [])
    .map((photo, index) => {
      const rawUrl =
        typeof photo === "string" ? photo : photo?.image?.url ?? "";
      const resolvedUrl = rawUrl ? resolveDamagePhotoUrl(rawUrl) : "";
      if (!resolvedUrl) return null;

      const fileLabel =
        rawUrl.split(/[\\/]/).filter(Boolean).at(-1) ?? `Photo ${index + 1}`;

      return {
        key: `${fileLabel}-${index}`,
        label: fileLabel,
        url: resolvedUrl,
      };
    })
    .filter((photo): photo is ClaimPhotoAsset => Boolean(photo));

/**
 * Returns true only when the backend has ACTUAL persisted assessment data
 * (non-zero counts/parts).  All four insight APIs return 200 with empty
 * objects even before DA runs, so truthy-object checks are insufficient —
 * we must inspect the numeric fields.
 */
const hasPersistedAssessmentInsights = ({
  imageFraudResults,
  duplicateCandidates,
  detailedDamageAssessment,
  totalValueSummary,
}: {
  imageFraudResults: ImageFraudResultsResponse | null;
  duplicateCandidates: DuplicateCandidatesResponse | null;
  detailedDamageAssessment: DetailedDamageAssessmentResponse | null;
  totalValueSummary: TotalValueResponse | null;
}) =>
  (imageFraudResults?.results_count ?? 0) > 0 ||
  (duplicateCandidates?.candidate_count ?? 0) > 0 ||
  (detailedDamageAssessment?.total_parts ?? 0) > 0 ||
  (totalValueSummary?.part_count ?? 0) > 0;

function fraudBandToNumeric(band: string | number): number {
  if (typeof band === "number") {
    return band;
  }
  const parsed = Number(band);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  switch (band) {
    case "Low":
      return 10;
    case "Medium":
      return 50;
    case "High":
      return 90;
    default:
      return 0;
  }
}

function getDecisionToneClasses(tone?: string) {
  switch (tone) {
    case "success":
      return {
        border: "border-success/25",
        background: "bg-success/10",
        icon: "text-success",
        title: "text-success",
      };
    case "critical":
      return {
        border: "border-destructive/25",
        background: "bg-destructive/10",
        icon: "text-destructive",
        title: "text-destructive",
      };
    case "warning":
      return {
        border: "border-warning/30",
        background: "bg-warning/10",
        icon: "text-warning",
        title: "text-warning",
      };
    default:
      return {
        border: "border-primary/20",
        background: "bg-primary/5",
        icon: "text-primary",
        title: "text-foreground",
      };
  }
}

function normalizeSummaryCopy(value?: string | null) {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export default function ClaimDetail() {
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const isReopenFlow = searchParams.get("reopen") === "1";
  const [fnol, setFnol] = useState<FnolResponse | null>(null);
  const [assessment, setAssessment] = useState<ProcessClaimResponse | null>(null);
  const [loading, setLoading] = useState(true);
  /** Load failure for GET FNOL only */
  const [error, setError] = useState<string | null>(null);
  /** POST /process-claim preview failure (does not block viewing the claim) */
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [fraudDetectionLoading, setFraudDetectionLoading] = useState(false);
  const [damageDetectionLoading, setDamageDetectionLoading] = useState(false);
  const [fraudSuccessModalOpen, setFraudSuccessModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("details");
  const [activeAssessmentCard, setActiveAssessmentCard] = useState<{
    key: string;
    title: string;
  } | null>(null);
  const findingsSectionRef = useRef<HTMLDivElement>(null);

  const handleAssessmentCardSelection = useCallback(
    (key: string | null, card?: DamageAssessmentCardSummary | null) => {
      if (!key) {
        setActiveAssessmentCard(null);
        return;
      }
      setActiveAssessmentCard({
        key,
        title:
          card?.title ??
          key
            .split("_")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" "),
      });
    },
    []
  );
  const [fraudResult, setFraudResult] = useState<ProcessClaimResponse | null>(null);
  const [damageDetectionRun, setDamageDetectionRun] = useState(false);
  const [assessmentInsightAlert, setAssessmentInsightAlert] = useState<string | null>(null);
  const [claimEvaluation, setClaimEvaluation] = useState<ClaimEvaluationResponse | null>(null);
  const [claimEvaluationLoading, setClaimEvaluationLoading] = useState(false);
  const [reportPdfLoading, setReportPdfLoading] = useState(false);
  /** True after user runs “Damage detection” until a persisted evaluation exists */
  const [showDamageRunSummary, setShowDamageRunSummary] = useState(false);
  const [claimInsightsLoading, setClaimInsightsLoading] = useState(false);
  const [imageFraudResults, setImageFraudResults] =
    useState<ImageFraudResultsResponse | null>(null);
  const [duplicateCandidates, setDuplicateCandidates] =
    useState<DuplicateCandidatesResponse | null>(null);
  const [detailedDamageAssessment, setDetailedDamageAssessment] =
    useState<DetailedDamageAssessmentResponse | null>(null);
  const [totalValueSummary, setTotalValueSummary] =
    useState<TotalValueResponse | null>(null);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false);
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const rawPhotoEntries = fnol?.raw_response?.documents?.photos ?? fnol?.damage_photos ?? [];
  const claimPhotoAssets = buildClaimPhotoAssets(rawPhotoEntries);

  useEffect(() => {
    setSelectedPhotoIndex(0);
    setPhotoPreviewOpen(false);
    setActiveAssessmentCard(null);
  }, [id]);

  useEffect(() => {
    if (activeTab !== "assessment") {
      setActiveAssessmentCard(null);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!activeAssessmentCard?.key) return;
    requestAnimationFrame(() => {
      findingsSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [activeAssessmentCard?.key]);

  useEffect(() => {
    if (!activeAssessmentCard || isMobile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      handleAssessmentCardSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeAssessmentCard, isMobile, handleAssessmentCardSelection]);

  useEffect(() => {
    if (claimPhotoAssets.length === 0 && selectedPhotoIndex !== 0) {
      setSelectedPhotoIndex(0);
      return;
    }
    if (selectedPhotoIndex >= claimPhotoAssets.length && claimPhotoAssets.length > 0) {
      setSelectedPhotoIndex(claimPhotoAssets.length - 1);
    }
  }, [claimPhotoAssets.length, selectedPhotoIndex]);

  const loadAssessmentInsightsSnapshot = useCallback(async (claimId: string) => {
    const [fraudResults, duplicateResults, detailedResults, totalResults] =
      await Promise.allSettled([
        getImageFraudResults(claimId),
        getDuplicateCandidates(claimId),
        getDetailedDamageAssessment(claimId),
        getTotalValue(claimId),
      ]);

    const failedSections = [
      fraudResults.status === "rejected"
        ? getApiErrorDetail(fraudResults.reason)
          ? `image authenticity (${getApiErrorDetail(fraudResults.reason)})`
          : "image authenticity"
        : null,
      duplicateResults.status === "rejected"
        ? getApiErrorDetail(duplicateResults.reason)
          ? `duplicate screening (${getApiErrorDetail(duplicateResults.reason)})`
          : "duplicate screening"
        : null,
      detailedResults.status === "rejected"
        ? getApiErrorDetail(detailedResults.reason)
          ? `part breakdown (${getApiErrorDetail(detailedResults.reason)})`
          : "part breakdown"
        : null,
      totalResults.status === "rejected"
        ? getApiErrorDetail(totalResults.reason)
          ? `valuation totals (${getApiErrorDetail(totalResults.reason)})`
          : "valuation totals"
        : null,
    ].filter(Boolean) as string[];

    return {
      imageFraudResults:
        fraudResults.status === "fulfilled" ? fraudResults.value : null,
      duplicateCandidates:
        duplicateResults.status === "fulfilled" ? duplicateResults.value : null,
      detailedDamageAssessment:
        detailedResults.status === "fulfilled" ? detailedResults.value : null,
      totalValueSummary:
        totalResults.status === "fulfilled" ? totalResults.value : null,
      failedSections,
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setAssessmentError(null);
    setFraudResult(null);
    getFnolById(id)
      .then((data) => {
        if (cancelled) return;
        setFnol(data);
        const isClosed =
          (data.status || "").toLowerCase() === "closed damage detection" ||
          (data.status || "").toLowerCase() === "recommendation shared";
        // Restore DA-run flag from localStorage so results survive navigation
        const daRunStored = id
          ? localStorage.getItem(daRunStorageKey(id)) === "1"
          : false;
        setDamageDetectionRun(isClosed || daRunStored);
        return processClaim(data.raw_response)
          .then((result) => {
            if (!cancelled && result) {
              setAssessment(result);
              setAssessmentError(null);
            }
          })
          .catch((assessErr) => {
            if (!cancelled) {
              setAssessment(null);
              setAssessmentError(
                assessErr instanceof Error ? assessErr.message : "Could not load fraud assessment preview."
              );
            }
          });
      })
      .catch((err) => {
        if (!cancelled) {
          setFnol(null);
          setError(err instanceof Error ? err.message : "Failed to load claim");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  // Fetch claim evaluation when status is Closed: Auto review or Closed: Manual review
  const statusLower = (fnol?.status || "").toLowerCase();
  const isOpenClaim =
    !fnol?.status ||
    statusLower === "fnol" ||
    statusLower === "open" ||
    statusLower === "open to fnol" ||
    statusLower === "pending";
  // Load latest persisted evaluation whenever FNOL is present so Business Rule Validation
  // can show the real rule snapshot (404 = no run yet — do not use process-claim preview rules).
  const shouldFetchClaimEvaluation = Boolean(id) && Boolean(fnol);

  useEffect(() => {
    if (!id || !shouldFetchClaimEvaluation) return;
    let cancelled = false;
    setClaimEvaluationLoading(true);
    setClaimEvaluation(null);
    getClaimEvaluation(id)
      .then((data) => {
        if (cancelled) return;
        if (data.not_started) {
          setClaimEvaluation(null);
        } else {
          setClaimEvaluation(data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setClaimEvaluation(null);
          const summary = getApiErrorSummary(err);
          if (
            summary.statusCode != null &&
            summary.statusCode >= 500
          ) {
            setAssessmentInsightAlert(
              `Business-rule details could not be loaded: ${summary.userMessage}`
            );
          } else if (summary.isNetworkError || summary.isTimeout) {
            setAssessmentInsightAlert(
              `Business-rule details could not be loaded: ${summary.userMessage}`
            );
          }
        }
      })
      .finally(() => {
        if (!cancelled) setClaimEvaluationLoading(false);
      });
    return () => { cancelled = true; };
  }, [id, shouldFetchClaimEvaluation]);

  useEffect(() => {
    if (claimEvaluation) setShowDamageRunSummary(false);
  }, [claimEvaluation]);

  useEffect(() => {
    if (!fnol) return;
    const ws =
      (fnol.workflow_state as ClaimWorkflowState | undefined) ?? "NOT_STARTED";
    if (ws === "NOT_STARTED" && !fraudResult && activeTab === "fraud-evaluation") {
      setActiveTab("details");
    }
  }, [fnol, fraudResult, activeTab]);

  useEffect(() => {
    setImageFraudResults(null);
    setDuplicateCandidates(null);
    setDetailedDamageAssessment(null);
    setTotalValueSummary(null);
    setAssessmentInsightAlert(null);
    setShowDamageRunSummary(false);
  }, [id]);

  useEffect(() => {
    if (!id || !fnol || (isOpenClaim && !damageDetectionRun)) return;
    let cancelled = false;

    const hydrateClaimInsightsSnapshot = async () => {
      setClaimInsightsLoading(true);
      const snapshot = await loadAssessmentInsightsSnapshot(id);

      if (cancelled) return;
      setImageFraudResults(snapshot.imageFraudResults);
      setDuplicateCandidates(snapshot.duplicateCandidates);
      setDetailedDamageAssessment(snapshot.detailedDamageAssessment);
      setTotalValueSummary(snapshot.totalValueSummary);
      if (hasPersistedAssessmentInsights(snapshot)) {
        // Actual backend data found — treat as DA already run and persist
        if (id) localStorage.setItem(daRunStorageKey(id), "1");
        setDamageDetectionRun(true);
      }
      setClaimInsightsLoading(false);
    };

    hydrateClaimInsightsSnapshot().catch(() => {
      if (!cancelled) {
        setClaimInsightsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [id, fnol, isOpenClaim, damageDetectionRun, loadAssessmentInsightsSnapshot]);

  const handleFraudDetection = async () => {
    if (!id) return;
    setFraudDetectionLoading(true);
    setError(null);
    try {
      const result = await runFraudDetection(id);
      setFraudResult(result);
      setAssessment(result);
      const updatedFnol = await getFnolById(id);
      setFnol(updatedFnol);
      try {
        const latestEvaluation = await getClaimEvaluation(id);
        if (latestEvaluation.not_started) {
          setClaimEvaluation(null);
        } else {
          setClaimEvaluation(latestEvaluation);
        }
      } catch {
        setClaimEvaluation(null);
      }
      setActiveTab("fraud-evaluation");
      setFraudSuccessModalOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Business Rule Validation failed");
    } finally {
      setFraudDetectionLoading(false);
    }
  };

  const handleGenerateRecommendationReport = async () => {
    if (!id) return;
    setReportPdfLoading(true);
    setError(null);
    try {
      const blob = await getRecommendationReportPdf(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Motor_Claim_Recommendation_Report_${id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate recommendation report");
    } finally {
      setReportPdfLoading(false);
    }
  };

  const handleDamageDetection = async () => {
    if (!id || !fnol) return;
    const rawPhotos =
      fnol.raw_response?.documents?.photos ?? fnol.damage_photos ?? [];
    const imageUrls = rawPhotos
      .map((obj: string | { image?: { url?: string } }) => {
        const url =
          typeof obj === "string"
            ? obj
            : (obj as { image?: { url?: string } })?.image?.url;
        if (!url) return null;
        return resolveDamagePhotoUrl(url);
      })
      .filter(Boolean) as string[];

    if (imageUrls.length === 0) {
      setError("No images attached to process damage detection.");
      return;
    }

    setDamageDetectionLoading(true);
    setClaimInsightsLoading(true);
    setError(null);
    setAssessmentInsightAlert(null);
    try {
      const [fraudRun, detailedRun] = await Promise.allSettled([
        runImageFraudAnalysis(id),
        runDetailedDamageAssessment(id),
      ]);

      const snapshot = await loadAssessmentInsightsSnapshot(id);
      const canonicalFraudResults =
        snapshot.imageFraudResults ??
        (fraudRun.status === "fulfilled" ? fraudRun.value : null);
      const canonicalDetailedAssessment =
        snapshot.detailedDamageAssessment ??
        (detailedRun.status === "fulfilled" ? detailedRun.value : null);

      setImageFraudResults(canonicalFraudResults);
      setDuplicateCandidates(snapshot.duplicateCandidates);
      setDetailedDamageAssessment(canonicalDetailedAssessment);
      setTotalValueSummary(snapshot.totalValueSummary);

      const labelWithDetail = (label: string, run: PromiseSettledResult<unknown>) => {
        if (run.status === "fulfilled") return null;
        const detail = getApiErrorDetail(run.reason);
        return detail ? `${label} (${detail})` : label;
      };
      const incompleteInsightSteps = [
        labelWithDetail("image authenticity", fraudRun),
        labelWithDetail("part breakdown", detailedRun),
        ...snapshot.failedSections,
      ].filter(Boolean) as string[];

      if (fraudRun.status !== "fulfilled" && detailedRun.status !== "fulfilled") {
        const reason =
          getApiErrorDetail(detailedRun.status === "rejected" ? detailedRun.reason : null) ||
          getApiErrorDetail(fraudRun.status === "rejected" ? fraudRun.reason : null) ||
          "Could not run damage assessment.";
        setError(reason);
        return;
      }

      const detailed = canonicalDetailedAssessment;
      const totalVal = snapshot.totalValueSummary;
      const nPhotos = imageUrls.length;
      if (detailed) {
        const partsPreview =
          detailed.part_breakdown?.length > 0
            ? detailed.part_breakdown
              .slice(0, 3)
              .map((p) => p.part_name)
              .join(", ") +
            (detailed.part_breakdown.length > 3 ? "…" : "")
            : "—";
        toast({
          title: "Damage assessment complete",
          description: `${nPhotos} image${nPhotos === 1 ? "" : "s"} · ${detailed.total_parts} part line${detailed.total_parts === 1 ? "" : "s"} · Est. repair ${formatClaimCurrency(detailed.total_estimated_cost)}${totalVal ? ` · Net ${formatClaimCurrency(totalVal.net_payable)}` : ""} · ${partsPreview}`,
        });
      } else {
        toast({
          title: "Damage assessment partial",
          description: `Image authenticity saved; part breakdown unavailable (${nPhotos} image${nPhotos === 1 ? "" : "s"}).`,
        });
      }

      if (incompleteInsightSteps.length > 0) {
        setAssessmentInsightAlert(
          `Some Assessment insights could not be loaded: ${incompleteInsightSteps.join("; ")}.`
        );
        toast({
          title: "Analysis partially loaded",
          description: `Issues: ${incompleteInsightSteps.join("; ")}.`,
        });
      }

      setShowDamageRunSummary(true);
      // Persist so results survive navigation to another page and back
      if (id) localStorage.setItem(daRunStorageKey(id), "1");
      setDamageDetectionRun(true);
      setActiveTab("assessment");

      // Re-fetch claim evaluation: getTotalValue (inside loadAssessmentInsightsSnapshot above)
      // calls run_full_valuation on the backend, which writes the computed gross/net amounts
      // back into ClaimEvaluationResponse.claim_amount.  Without this re-fetch the overview
      // "Claim Amount" card stays at ฿0 even though the DA breakdown shows ฿22,000.
      try {
        const latestEvaluation = await getClaimEvaluation(id!);
        if (latestEvaluation.not_started) {
          setClaimEvaluation(null);
        } else {
          setClaimEvaluation(latestEvaluation);
        }
      } catch {
        // Evaluation might not exist; overview falls back to totalValueSummary amounts
      }

      const updatedFnol = await getFnolById(id!);
      setFnol(updatedFnol);

      queryClient.invalidateQueries({ queryKey: damageAssessmentCardsKey(id) });
      queryClient.invalidateQueries({
        queryKey: ["damage-assessment-card-details", id],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Damage detection failed");
    } finally {
      setClaimInsightsLoading(false);
      setDamageDetectionLoading(false);
    }
  };

  if (loading) {
    return (
      <AppLayout title="Claim Details">
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="mt-4 text-sm text-muted-foreground">Loading claim...</p>
        </div>
      </AppLayout>
    );
  }

  if (!fnol) {
    return (
      <AppLayout title="Claim Not Found">
        <div className="flex flex-col items-center justify-center py-12">
          <p className="text-lg text-muted-foreground">
            {error || "The claim you're looking for doesn't exist."}
          </p>
          <Button asChild className="mt-4">
            <Link to="/claims">Back to Claims</Link>
          </Button>
        </div>
      </AppLayout>
    );
  }

  const r: Partial<FnolPayload> = fnol.raw_response || {};
  const incident = (r.incident || {}) as FnolPayload["incident"];
  const policy = (r.policy || {}) as FnolPayload["policy"];
  const vehicle = (r.vehicle || {}) as FnolPayload["vehicle"];
  const claimant = (r.claimant || {}) as FnolPayload["claimant"];

  const workflowState: ClaimWorkflowState =
    (fnol.workflow_state as ClaimWorkflowState | undefined) ?? "NOT_STARTED";

  // Prefer top-level API fields (complaint_id, incident_date_time, incident_location, etc.), fall back to raw_response
  const incidentDate = fnol.incident_date_time || incident.date_time_of_loss;
  const incidentType =
    fnol.incident_type ??
    (r as { Incident_type?: string }).Incident_type ??
    incident.claim_type;
  const incidentDescription = fnol.incident_description ?? incident.loss_description;
  // Submitted = claim creation date from API; fallback to incident date if not returned yet
  const submittedDate = fnol.created_date || incidentDate;

  const selectedPhoto = claimPhotoAssets[selectedPhotoIndex] ?? null;
  const aiConfidence =
    claimEvaluation?.damage_confidence ?? assessment?.damage_confidence ?? 0;
  const hasDamageConfidenceSignal =
    claimEvaluation?.damage_confidence != null || assessment?.damage_confidence != null;
  const fraudBand =
    claimEvaluation?.fraud_score ?? fraudResult?.fraud_score ?? assessment?.fraud_score ?? "—";
  const fraudScore = fraudBandToNumeric(fraudBand);
  const decisionSummary = claimEvaluation?.decision_summary ?? null;
  const decision = claimEvaluation?.decision ?? assessment?.decision ?? "Pending";
  const claimStatus =
    claimEvaluation?.claim_status ?? assessment?.claim_status ?? "FNOL";
  // Only show rule rows from persisted evaluation (GET /evaluation) or an in-session run-fraud-detection
  // response. Do NOT use assessment.fraud_rule_results — that comes from process-claim preview
  // (heuristic evaluation on page load) and is not the same as clicking "Run Business Rule Validation".
  const validationRules =
    claimEvaluation?.fraud_rule_results && claimEvaluation.fraud_rule_results.length > 0
      ? claimEvaluation.fraud_rule_results
      : fraudResult?.fraud_rule_results && fraudResult.fraud_rule_results.length > 0
        ? fraudResult.fraud_rule_results
        : [];
  const fraudResults = imageFraudResults?.results ?? [];
  const highRiskFraudImages = fraudResults.filter(
    (result) => (result.fraud_score ?? 0) >= 70
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
  const totalPartCount =
    totalValueSummary?.part_count ?? detailedDamageAssessment?.total_parts ?? 0;
  const totalEstimate =
    totalValueSummary?.gross_estimate ??
    detailedDamageAssessment?.total_estimated_cost ??
    0;
  const pipelineMetadata = detailedDamageAssessment?.pipeline_metadata ?? null;
  const hasPipelineTransparencyData = Boolean(
    pipelineMetadata &&
    (
      pipelineMetadata.pipeline ||
      pipelineMetadata.pricing_source ||
      pipelineMetadata.confidence_level ||
      pipelineMetadata.reasoning_summary ||
      pipelineMetadata.regional_context ||
      pipelineMetadata.currency_code ||
      pipelineMetadata.nodes_executed?.length ||
      pipelineMetadata.parts_searched?.length ||
      pipelineMetadata.part_level_ranges?.length ||
      pipelineMetadata.cost_range
    )
  );
  const partLevelRanges = pipelineMetadata?.part_level_ranges ?? [];
  const isFallbackConfidence = hasDamageConfidenceSignal && aiConfidence === 50;
  const aiConfidenceDescriptor = pipelineMetadata?.confidence_level
    ? `${formatConfidenceLabel(pipelineMetadata.confidence_level)} confidence`
    : isFallbackConfidence
      ? "Under review"
      : aiConfidence >= 70
        ? "High confidence"
        : aiConfidence >= 40
          ? "Moderate confidence"
          : "Low confidence";
  const inferredMarketContext = inferMarketContextFromLocation(
    fnol.accident_location ??
    fnol.raw_response?.accident_location ??
    fnol.raw_response?.incident?.accident_location ??
    null
  );
  const resolvedMarketContext =
    detailedDamageAssessment?.market_context ??
    totalValueSummary?.market_context ??
    inferredMarketContext;
  const currencyCode =
    detailedDamageAssessment?.currency_code ??
    resolvedMarketContext?.currency_code ??
    totalValueSummary?.currency_code ??
    inferredMarketContext?.currency_code ??
    "THB";
  const currencyLocale =
    resolvedMarketContext?.locale ??
    inferredMarketContext?.locale ??
    inferCurrencyLocale(currencyCode);
  const currencyMarker =
    currencyCode.toUpperCase() === "MYR"
      ? "RM"
      : currencyCode.toUpperCase() === "THB"
        ? "฿"
        : currencyCode.toUpperCase();
  const formatClaimCurrency = (amount: number) =>
    formatCurrency(amount, currencyCode, currencyLocale);
  const estimatedRangeLabel =
    pipelineMetadata?.cost_range != null
      ? `${formatClaimCurrency(pipelineMetadata.cost_range.low)} - ${formatClaimCurrency(
        pipelineMetadata.cost_range.high
      )}`
      : "Not available";
  // Only use persisted fnol.status (from fnol_claims.claim_status), not live assessment.decision
  const isAutoApproved =
    (fnol.status || "").toLowerCase() === "closed damage detection" ||
    (fnol.status || "").toLowerCase() === "recommendation shared";

  const statusForCheck = (fnol.status || claimStatus || "").toLowerCase();

  const isPendingDamageDetection =
    statusForCheck === "business rule validation-pass" ||
    statusForCheck === "pending damage detection" ||
    statusForCheck === "pending_damage_detection";

  const isFraudDetection =
    statusForCheck === "business rule validation-fail" ||
    statusForCheck === "fraudulent";
  const hasPersistedValidation =
    workflowState !== "NOT_STARTED" ||
    !!fraudResult ||
    statusForCheck === "business rule validation-pass" ||
    statusForCheck === "business rule validation-fail" ||
    statusForCheck === "recommendation shared";

  // All rules passed: from status (Business Rule Validation-pass) or from last run result (Low risk)
  const hasBusinessRuleValidationPassed =
    decisionSummary?.business_rule_validation_passed ??
    (isPendingDamageDetection || (!!fraudResult && fraudScore < 50));

  const isRecommendationShared =
    (fnol.status || "").toLowerCase() === "recommendation shared";

  // Full DA workspace (cards, findings): local run flag, terminal claim status, or backend workflow.
  // workflow_state is the source of truth after reload; isAutoApproved covers legacy statuses.
  const showDamageAssessmentExperience =
    damageDetectionRun ||
    isAutoApproved ||
    workflowState === "DAMAGE_ASSESSMENT_COMPLETED";

  const canRunBusinessRuleValidation =
    Boolean(fnol) && !fraudDetectionLoading && !isRecommendationShared;

  // True once BRV has been persisted (DB) or run in this session
  const hasBrvBeenRun = hasPersistedValidation;

  // Label adapts to whether BRV has run before
  const businessRuleActionLabel = hasBrvBeenRun
    ? "Re-run Business Rule Validation"
    : "Run Business Rule Validation";

  // DA label: "Re-run" only after DA has actually been run (localStorage / real backend data)
  const damageAssessmentActionLabel = damageDetectionRun
    ? "Re-run Damage Assessment"
    : "Run Damage Assessment";

  // Tooltip shown on the disabled DA button so users understand why it's locked
  const daDisabledTooltip = !hasBusinessRuleValidationPassed
    ? isFraudDetection
      ? "Business Rule Validation failed — re-run and resolve all failing rules before assessing damage"
      : hasBrvBeenRun
        ? "Business Rule Validation did not pass — re-run it and ensure it passes first"
        : "Run Business Rule Validation first to unlock Damage Assessment"
    : undefined;

  // ── Claim Amount: dynamic, source-priority order ──────────────────────────
  // 1. DA gross estimate (ClaimPhase1Valuation.gross_estimate via totalValueSummary)
  // 2. DA part-level total (DamagePartAssessment sum via detailedDamageAssessment)
  // 3. BRV evaluation amount (ClaimEvaluationResponse.claim_amount)
  // 4. Zero (nothing available yet)
  //
  // This eliminates the ฿0 discrepancy that arises when BRV stored no
  // incident.estimated_amount but DA later computed a non-zero repair cost.
  const daGrossEstimate = totalValueSummary?.gross_estimate ?? 0;
  const daPartsTotal = detailedDamageAssessment?.total_estimated_cost ?? 0;
  const brvClaimAmount = claimEvaluation?.claim_amount ?? 0;

  const displayClaimAmount =
    daGrossEstimate > 0
      ? daGrossEstimate
      : daPartsTotal > 0
        ? daPartsTotal
        : brvClaimAmount;

  // Label changes once DA has produced an actual estimate
  const claimAmountLabel =
    daGrossEstimate > 0 || daPartsTotal > 0
      ? "Gross Repair Estimate"
      : "Claim Amount";

  /** Only after damage assessment is completed in the backend and we have a positive valuation. */
  const showClaimAmountCard =
    workflowState === "DAMAGE_ASSESSMENT_COMPLETED" && displayClaimAmount > 0;

  const showBusinessRuleValidationTab =
    (workflowState !== "NOT_STARTED" || !!fraudResult) && !fraudDetectionLoading;

  // DA tab: visible as soon as BRV has been run (shows empty state if DA not yet triggered,
  // or full results after DA runs).
  const showDamageAssessmentTab =
    showDamageAssessmentExperience || hasBusinessRuleValidationPassed || hasBrvBeenRun;
  const prioritizeAssessmentLayout = activeTab === "assessment";
  const businessRuleButtonVariant = hasBrvBeenRun ? "outline" : "default";
  const damageAssessmentButtonVariant =
    showDamageAssessmentExperience || !hasBusinessRuleValidationPassed
      ? "outline"
      : "default";
  const businessRuleSummary =
    decisionSummary?.business_rule_summary ??
    buildBusinessRuleSummaryFallback(
      decisionSummary,
      Boolean(hasBusinessRuleValidationPassed)
    );
  const businessRuleRiskClasses =
    businessRuleSummary.status_tone === "critical"
      ? {
          card: "border-destructive bg-destructive/5",
          iconBox: "bg-destructive/20",
          icon: "text-destructive",
          title: "text-destructive",
        }
      : businessRuleSummary.status_tone === "warning"
        ? {
            card: "border-warning bg-warning/5",
            iconBox: "bg-warning/20",
            icon: "text-warning",
            title: "text-warning",
          }
        : businessRuleSummary.status_tone === "info"
          ? {
              card: "border-border bg-muted/30",
              iconBox: "bg-primary/10",
              icon: "text-primary",
              title: "text-foreground",
            }
          : {
            card: "border-success bg-success/5",
            iconBox: "bg-success/20",
            icon: "text-success",
            title: "text-success",
          };
  const topLevelInsights = decisionSummary?.top_insights ?? [];
  const imageRiskSummaryBlock = decisionSummary?.image_risk_summary ?? null;
  const mergedTopSummaryRows = buildClaimTopInsightRows(
    imageRiskSummaryBlock,
    topLevelInsights
  );
  const hasMergedTopWarnings =
    mergedTopSummaryRows.length > 0 &&
    (decisionSummary?.status_tone === "critical" ||
      decisionSummary?.status_tone === "warning");
  // The top strip is the single warning-summary surface for blocker/review states.
  // When it already carries the decision blockers, suppress the duplicate lower
  // summary banner and reason text in the assessment body.
  const shouldRenderAssessmentDecisionBanner = Boolean(
    decisionSummary &&
      (!hasMergedTopWarnings ||
        decisionSummary.status_tone === "success" ||
        decisionSummary.status_tone === "info")
  );
  const normalizedTopSummaryDetails = new Set(
    [
      decisionSummary?.status_detail ?? null,
      ...mergedTopSummaryRows.map((row) => row.detail),
    ]
      .map((value) => normalizeSummaryCopy(value))
      .filter(Boolean)
  );
  const shouldRenderAssessmentReason = Boolean(
    claimEvaluation?.reason &&
      !normalizedTopSummaryDetails.has(
        normalizeSummaryCopy(claimEvaluation.reason)
      )
  );
  const decisionToneClasses = getDecisionToneClasses(decisionSummary?.status_tone);
  const renderImageAuthenticityPageCopy = () => (
    <>
      {fraudResults.length > 0 ? (
        <div className="space-y-4">
          {fraudResults.map((result, index) => {
            const fileLabel =
              result.photo_path.split(/[\\/]/).pop() || `Photo ${index + 1}`;
            const warnings = result.exif_json?.warnings ?? [];
            const thumbUrl = resolveDamagePhotoUrl(result.photo_path);
            const exactAuthenticityDetails = joinDetailSegments(
              warnings.length > 0 ? `Warnings: ${warnings.join(", ")}` : null,
              result.llm_notes ?? null
            );
            const authenticityDetailItems = splitStoredDetailItems(
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
                key={`${result.photo_path}-${index}`}
                className="overflow-hidden rounded-xl border border-border/40 bg-gradient-to-b from-card to-muted/10"
              >
                <div className="grid gap-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-stretch">
                  <div className="relative aspect-[4/3] w-full bg-muted/40 sm:aspect-auto sm:min-h-[9rem] sm:w-full">
                    {thumbUrl ? (
                      <img
                        src={thumbUrl}
                        alt={`Vehicle photo ${fileLabel}`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full min-h-[8rem] items-center justify-center px-2 text-center text-[11px] text-muted-foreground">
                        Preview unavailable
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-3 p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-2">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {fileLabel}
                        </p>
                        <ImageAuthenticityClassificationBadges
                          result={result}
                          className="pt-0.5"
                        />
                        <p className="text-xs text-muted-foreground">
                          {warnings.length > 0
                            ? `${warnings.length} metadata warning${
                                warnings.length === 1 ? "" : "s"
                              }`
                            : "No metadata warnings detected"}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <div className="rounded-md bg-background/90 px-3 py-2 text-right shadow-sm ring-1 ring-border/30">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground/55">
                            Fraud
                          </p>
                          <p className="mt-0.5 text-base font-semibold tabular-nums text-foreground">
                            {Math.round(result.fraud_score ?? 0)}
                          </p>
                        </div>
                        <div className="rounded-md bg-background/90 px-3 py-2 text-right shadow-sm ring-1 ring-border/30">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground/55">
                            ELA
                          </p>
                          <p className="mt-0.5 text-base font-semibold tabular-nums text-foreground">
                            {formatElaScore(result.ela_score)}
                          </p>
                        </div>
                      </div>
                    </div>
                    {exactAuthenticityDetails ? (
                      <ExpandableDetails
                        className="border-0 shadow-none"
                        previewTone={
                          (result.fraud_score ?? 0) >= 70
                            ? "destructive"
                            : warnings.length > 0
                              ? "warning"
                              : "info"
                        }
                        hideHeader
                        summary={renderDetailBulletItems(
                          authenticityDetailItems,
                          "text-sm leading-relaxed text-foreground/90"
                        )}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No additional authenticity narrative was stored for this image.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No persisted image authenticity results are available yet for this claim.
        </p>
      )}
    </>
  );
  const renderDamageBreakdownPageCopy = () =>
    detailedDamageAssessment?.part_breakdown?.length ? (
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/60">
              <th className="rounded-tl-lg px-4 py-3 pl-5 sm:pl-6">Part</th>
              <th className="px-4 py-3">Damage</th>
              <th className="px-4 py-3 text-right">Severity %</th>
              <th className="px-4 py-3">Repair action</th>
              <th className="rounded-tr-lg px-4 py-3 pr-5 text-right sm:pr-6">
                Est. amount
              </th>
            </tr>
          </thead>
          <tbody className="text-[13px]">
            {detailedDamageAssessment.part_breakdown.map((item, index) => (
              <tr
                key={`${item.part_name}-${item.damage_type}-${index}`}
                className={cn(
                  "border-b border-border/30 transition-colors hover:bg-muted/15",
                  index % 2 === 1 && "bg-muted/5"
                )}
              >
                <td className="px-4 py-3 pl-5 font-semibold text-foreground sm:pl-6">
                  {item.part_name}
                </td>
                <td className="max-w-[12rem] px-4 py-3 text-muted-foreground">
                  {item.damage_type}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-foreground/90">
                  {item.severity_percent}%
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {item.repair_action}
                </td>
                <td className="px-4 py-3 pr-5 text-right text-sm font-semibold tabular-nums text-foreground sm:pr-6">
                  {formatClaimCurrency(item.estimated_amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <p className="px-5 py-4 text-sm text-muted-foreground sm:px-6">
        No part-level damage breakdown is available yet for this claim.
      </p>
    );

  const activeFindingsSubtitle =
    activeAssessmentCard?.key === "image_authenticity"
      ? "Per-photo signals, scores, and stored reviewer notes."
      : activeAssessmentCard?.key === "damage_detection"
        ? "Line-level repair actions and estimates."
        : "Detailed assessment evidence and guidance.";
  const embeddedFindingsSupplementary =
    activeAssessmentCard?.key === "image_authenticity"
      ? renderImageAuthenticityPageCopy()
      : activeAssessmentCard?.key === "damage_detection"
        ? renderDamageBreakdownPageCopy()
        : null;

  const renderPipelineTransparencyContent = () =>
    hasPipelineTransparencyData ? (
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-border/60 bg-muted/15 p-4">
            <p className="text-xs text-muted-foreground">Pipeline</p>
            <p className="mt-1 text-sm font-medium">
              {formatPipelineLabel(pipelineMetadata!.pipeline)}
            </p>
          </div>
          <div className="rounded-xl border border-border/60 bg-muted/15 p-4">
            <p className="text-xs text-muted-foreground">Pricing source</p>
            <p className="mt-1 text-sm font-medium">
              {formatPricingSourceLabel(pipelineMetadata!.pricing_source)}
            </p>
          </div>
          <div className="rounded-xl border border-border/60 bg-muted/15 p-4">
            <p className="text-xs text-muted-foreground">Confidence</p>
            <p className="mt-1 text-sm font-medium">
              {formatConfidenceLabel(pipelineMetadata!.confidence_level)}
            </p>
          </div>
          <div className="rounded-xl border border-border/60 bg-muted/15 p-4">
            <p className="text-xs text-muted-foreground">Estimated range</p>
            <p className="mt-1 text-sm font-medium">{estimatedRangeLabel}</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-border/60 bg-muted/15 p-4">
            <p className="text-xs text-muted-foreground">
              Regional pricing context
            </p>
            <p className="mt-1 text-sm font-medium">
              {pipelineMetadata!.regional_context ??
                resolvedMarketContext?.market_label ??
                "Not available"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Currency: {pipelineMetadata!.currency_code ?? currencyCode} · Web
              search {pipelineMetadata!.web_search_used ? "enabled" : "not used"}
            </p>
          </div>
          <div className="rounded-xl border border-border/60 bg-muted/15 p-4">
            <p className="text-xs text-muted-foreground">Orchestration stages</p>
            <p className="mt-1 text-sm font-medium">
              {pipelineMetadata!.nodes_executed?.length
                ? pipelineMetadata!.nodes_executed
                    .map((node) => node.replace(/_/g, " "))
                    .join(" -> ")
                : "Vision detection -> pricing -> estimation"}
            </p>
            {pipelineMetadata!.parts_searched?.length ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Parts searched: {pipelineMetadata!.parts_searched.join(", ")}
              </p>
            ) : null}
          </div>
        </div>

        {pipelineMetadata!.reasoning_summary ? (
          <div className="rounded-xl border border-border/60 bg-muted/15 p-4">
            <p className="text-xs text-muted-foreground">
              Pricing reasoning summary
            </p>
            <ExpandableDetails
              className="mt-3"
              previewTone="info"
              hideHeader
              summary={renderDetailBulletItems(
                splitStoredDetailItems(pipelineMetadata!.reasoning_summary, {
                  fallback: pipelineMetadata!.reasoning_summary,
                })
              )}
            />
          </div>
        ) : null}

        {partLevelRanges.length > 0 ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Part-level pricing evidence
            </p>
            {partLevelRanges.map((partRange, index) => (
              <div
                key={`${partRange.part}-${index}`}
                className="rounded-xl border border-border/60 bg-muted/15 p-4"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">{partRange.part}</p>
                    <p className="text-xs text-muted-foreground">
                      Range {formatClaimCurrency(partRange.cost_range_low)} -{" "}
                      {formatClaimCurrency(partRange.cost_range_high)}
                    </p>
                  </div>
                  <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium">
                    {formatClaimCurrency(partRange.estimated_cost)}
                  </span>
                </div>
                {partRange.pricing_basis ? (
                  <ExpandableDetails
                    className="mt-3"
                    previewTone="info"
                    hideHeader
                    summary={renderDetailBulletItems(
                      splitStoredDetailItems(partRange.pricing_basis, {
                        fallback: partRange.pricing_basis,
                      })
                    )}
                  />
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    ) : null;

  return (
    <AppLayout
      title={fnol.complaint_id || r.claim_id || `FNOL-${fnol.id}`}
      subtitle={`${incidentType || "Claim"} - ${fnol.policy_holder_name || claimant.driver_name || "—"}`}
    >
      <div className="space-y-6 animate-fade-in">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Action needs attention</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {assessmentError && !error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Assessment preview unavailable</AlertTitle>
            <AlertDescription>
              {assessmentError} You can still use Business Rule Validation and Damage Detection; if this
              persists, run database migrations and check server logs.
            </AlertDescription>
          </Alert>
        )}
        {assessmentInsightAlert && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Some insights are partial</AlertTitle>
            <AlertDescription>{assessmentInsightAlert}</AlertDescription>
          </Alert>
        )}

        {/* Header Actions */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="outline" asChild>
            <Link to="/claims">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Claims
            </Link>
          </Button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* Generate Recommendation Report — final state only */}
            {isRecommendationShared && (
              <Button
                onClick={handleGenerateRecommendationReport}
                disabled={reportPdfLoading}
              >
                {reportPdfLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <FileDown className="mr-2 h-4 w-4" />
                    Generate Recommendation Report
                  </>
                )}
              </Button>
            )}

            {/* Re-validation of Business Rules — re-open workflow only */}
            {fnol?.re_open === 1 && isReopenFlow ? (
              <Button
                variant="outline"
                onClick={handleFraudDetection}
                disabled={fraudDetectionLoading || !fnol}
              >
                {fraudDetectionLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Validating...
                  </>
                ) : (
                  "Re-validation of Business Rules"
                )}
              </Button>
            ) : null}

            {/* Business Rule Validation — always visible unless recommendation shared or re-open flow */}
            {!isRecommendationShared && !(fnol?.re_open === 1 && isReopenFlow) && (
              <Button
                variant={businessRuleButtonVariant}
                onClick={handleFraudDetection}
                disabled={!canRunBusinessRuleValidation}
              >
                {fraudDetectionLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Validating...
                  </>
                ) : (
                  <>
                    <Shield className="mr-2 h-4 w-4" />
                    {businessRuleActionLabel}
                  </>
                )}
              </Button>
            )}

            {/* Damage Assessment — always visible; disabled until BRV passes;
                re-runnable after first run; tooltip explains why it is locked */}
            {!isRecommendationShared && (
              <Button
                variant={damageAssessmentButtonVariant}
                onClick={handleDamageDetection}
                disabled={damageDetectionLoading || !hasBusinessRuleValidationPassed}
                title={daDisabledTooltip}
              >
                {damageDetectionLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Assessing...
                  </>
                ) : (
                  <>
                    <Brain className="mr-2 h-4 w-4" />
                    {damageAssessmentActionLabel}
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        <Dialog open={fraudSuccessModalOpen} onOpenChange={setFraudSuccessModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Business Rule Validation Evaluated Successfully</DialogTitle>
              <DialogDescription>
                Review the fraud-evaluation tab to inspect the latest business rule
                validation findings for this claim.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Business Rule Validation has been completed for this claim. You can review the results in the Fraud Evaluation tab.
            </p>
            <DialogFooter>
              <Button onClick={() => setFraudSuccessModalOpen(false)}>OK</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={photoPreviewOpen} onOpenChange={setPhotoPreviewOpen}>
          <DialogContent className="max-w-5xl">
            <DialogHeader>
              <DialogTitle>{selectedPhoto?.label ?? "Vehicle photo preview"}</DialogTitle>
              <DialogDescription>
                Enlarged view of the selected vehicle photo for closer reviewer inspection.
              </DialogDescription>
            </DialogHeader>
            {selectedPhoto ? (
              <div className="space-y-4">
                <div className="overflow-hidden rounded-lg border bg-muted/20">
                  <img
                    src={selectedPhoto.url}
                    alt={selectedPhoto.label}
                    className="max-h-[75vh] w-full object-contain"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Photo {selectedPhotoIndex + 1} of {claimPhotoAssets.length}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No vehicle photo is currently selected.
              </p>
            )}
          </DialogContent>
        </Dialog>

        {showDamageRunSummary && !claimEvaluation && detailedDamageAssessment && (
          <Alert className="border-primary/40 bg-primary/5">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            <AlertTitle>Latest damage assessment</AlertTitle>
            <AlertDescription className="text-sm space-y-1">
              <p>
                <span className="font-medium text-foreground">
                  {detailedDamageAssessment.total_parts}
                </span>{" "}
                part line
                {detailedDamageAssessment.total_parts === 1 ? "" : "s"} · Est. repair{" "}
                <span className="font-medium text-foreground">
                  {formatClaimCurrency(detailedDamageAssessment.total_estimated_cost)}
                </span>
                {totalValueSummary ? (
                  <>
                    {" · "}
                    Net payable{" "}
                    <span className="font-medium text-foreground">
                      {formatClaimCurrency(totalValueSummary.net_payable)}
                    </span>
                  </>
                ) : null}
              </p>
              {detailedDamageAssessment.part_breakdown &&
                detailedDamageAssessment.part_breakdown.length > 0 ? (
                <p className="text-muted-foreground">
                  Parts:{" "}
                  {detailedDamageAssessment.part_breakdown
                    .slice(0, 5)
                    .map((p) => p.part_name)
                    .join(", ")}
                  {detailedDamageAssessment.part_breakdown.length > 5 ? "…" : ""}
                </p>
              ) : null}
            </AlertDescription>
          </Alert>
        )}

        <div
          className={cn(
            "grid gap-6 xl:items-start",
            prioritizeAssessmentLayout
              ? "xl:grid-cols-1"
              : "xl:grid-cols-[minmax(0,1.7fr)_minmax(18rem,20rem)]"
          )}
        >
          {/* Main Content */}
          <div className="min-w-0 space-y-8">
            {/* Two-column overview cards: Fraud Evaluation (red if fraud, green otherwise) + AI Assessment */}
            {(fraudResult || (!isOpenClaim && assessment) || showDamageAssessmentExperience) && (
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
                {/* Column 1: Fraud Evaluation – red when fraud detected, green otherwise */}

                <Card
                  data-testid="business-rule-summary-card"
                  className={`card-elevated border-2 ${businessRuleRiskClasses.card}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${businessRuleRiskClasses.iconBox}`}
                      >
                        <Shield className={`h-5 w-5 ${businessRuleRiskClasses.icon}`} />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">
                          {businessRuleSummary.title}
                        </p>
                        <p className={`text-xl font-bold ${businessRuleRiskClasses.title}`}>
                          {businessRuleSummary.headline}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                {/* Column 2: AI Assessment – visible only after Damage Detection is run */}
                {showDamageAssessmentExperience && (
                  <Card className="card-elevated">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">

                        {/* Icon Box */}
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg
        ${isFallbackConfidence
                              ? "bg-warning/20"
                              : aiConfidence >= 70
                              ? "bg-success/20"
                              : aiConfidence >= 40
                                ? "bg-warning/20"
                                : "bg-destructive/20"
                            }`}
                        >
                          <Brain
                            className={`h-5 w-5
          ${isFallbackConfidence
                                ? "text-warning"
                                : aiConfidence >= 70
                                ? "text-success"
                                : aiConfidence >= 40
                                  ? "text-warning"
                                  : "text-destructive"
                              }`}
                          />
                        </div>

                        {/* Text */}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-muted-foreground">
                            Damage Assessment
                          </p>

                          <p
                            className={`text-xl font-bold
          ${isFallbackConfidence
                                ? "text-warning"
                                : aiConfidence >= 70
                                ? "text-success"
                                : aiConfidence >= 40
                                  ? "text-warning"
                                  : "text-destructive"
                              }`}
                          >
                            {aiConfidence}%
                          </p>

                          <p className="text-xs text-muted-foreground mt-0.5">
                            {aiConfidenceDescriptor}
                          </p>
                        </div>

                      </div>
                    </CardContent>
                  </Card>
                )}
                {imageRiskSummaryBlock?.summary_card ? (
                  <ClaimImageRiskSummaryCard imageRiskSummary={imageRiskSummaryBlock} />
                ) : null}
                {/* Claim Amount / Gross Repair Estimate ─ dynamic source priority:
                    DA gross estimate > DA parts total > BRV claim_amount > 0 */}
                {showClaimAmountCard && (
                  <Card className="card-elevated">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <span className="text-primary text-sm font-semibold">
                            {currencyMarker}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-muted-foreground">{claimAmountLabel}</p>
                          <p className="text-xl font-bold">{formatClaimCurrency(displayClaimAmount)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            <ClaimTopInsightsStrip
              imageRiskSummary={imageRiskSummaryBlock}
              insights={topLevelInsights}
            />

            {prioritizeAssessmentLayout ? (
              <div className="hidden xl:block">
                <Collapsible defaultOpen={false} className="group">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/35 bg-muted/15 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/55">
                      Review context
                    </p>
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <span className="truncate font-medium text-foreground">
                        {fnol.policy_holder_name || claimant.driver_name || "—"}
                      </span>
                      <span className="hidden text-border/80 sm:inline" aria-hidden>
                        |
                      </span>
                      <span className="tabular-nums text-foreground/90">
                        {fnol.policy_number || policy.policy_number || "—"}
                      </span>
                      <span className="hidden text-border/80 lg:inline" aria-hidden>
                        |
                      </span>
                      <span className="max-w-[20rem] truncate text-foreground/90">
                        {[fnol.vehicle_year, fnol.vehicle_make, fnol.vehicle_model]
                          .filter(Boolean)
                          .join(" ") ||
                          `${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim() ||
                          "—"}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-foreground/85">
                        {fnol.vehicle_registration_number ||
                          vehicle.registration_number ||
                          "—"}
                      </span>
                    </div>
                    <CollapsibleTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 shrink-0 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <span className="hidden sm:inline">Policy details</span>
                        <ChevronDown className="h-4 w-4 opacity-70 transition-transform group-data-[state=open]:rotate-180" />
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent className="data-[state=closed]:animate-none">
                    <div className="mt-2 grid gap-2 rounded-lg border border-border/35 bg-card/80 px-3 py-3 text-sm shadow-sm sm:grid-cols-3">
                      <div className="space-y-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/55">
                          Coverage
                        </p>
                        <p className="font-medium leading-snug text-foreground">
                          {getCoverageTypeDisplay(fnol)}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/55">
                          Status
                        </p>
                        <p className="font-medium leading-snug text-foreground">
                          {fnol.policy_status || policy.policy_status || "—"}
                        </p>
                      </div>
                      <div className="space-y-1 sm:col-span-3 lg:col-span-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/55">
                          Period
                        </p>
                        <p className="tabular-nums leading-snug text-foreground/90">
                          {formatDate(fnol.policy_start_date) || "—"} –{" "}
                          {formatDate(fnol.policy_end_date) || "—"}
                        </p>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            ) : null}

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-6">
              <TabsList className="h-12 w-full justify-start gap-2 overflow-x-auto rounded-xl border border-border/70 bg-muted/30 p-1.5 whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <TabsTrigger className="shrink-0 rounded-lg px-4 py-2" value="details">
                  Claim Details
                </TabsTrigger>
                <TabsTrigger className="shrink-0 rounded-lg px-4 py-2" value="documents">
                  Vehicle Images
                </TabsTrigger>
                {!isRecommendationShared && showBusinessRuleValidationTab && (
                  <TabsTrigger className="shrink-0 rounded-lg px-4 py-2" value="fraud-evaluation">
                    Business Rule Validation
                  </TabsTrigger>
                )}
                {/* Damage Assessment tab — show as soon as BRV passed (guiding user to next step)
                    or after DA has already been run */}
                {showDamageAssessmentTab && (
                  <TabsTrigger className="shrink-0 rounded-lg px-4 py-2" value="assessment">
                    Damage Assessment
                  </TabsTrigger>
                )}
                {/* Claim Evaluation tab — only available after Damage Assessment has been run */}
                {showDamageAssessmentExperience && (
                  <TabsTrigger className="shrink-0 rounded-lg px-4 py-2" value="claim-evaluation">
                    Claim Evaluation
                  </TabsTrigger>
                )}

              </TabsList>

              <TabsContent value="details">
                <Card className="card-elevated">
                  <CardHeader>
                    <CardTitle className="text-base">Incident Information</CardTitle>
                  </CardHeader>
                  <CardContent className="pl-4 space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">

                      {/* LEFT COLUMN */}
                      <div className="space-y-4">
                        <div className="flex items-start gap-3">
                          <Calendar className="h-4 w-4 mt-1 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Incident Date</p>
                            <p className="text-sm text-muted-foreground">
                              {formatDate(incidentDate) || "—"}
                            </p>
                          </div>
                        </div>

                        {/* <div className="flex items-start gap-3">
                          <Clock className="h-4 w-4 mt-1 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Submitted</p>
                            <p className="text-sm text-muted-foreground">
                              {submittedDate
                                ? new Date(submittedDate).toLocaleString(undefined, {
                                    dateStyle: "short",
                                    timeStyle: "short",
                                  })
                                : "—"}
                            </p>
                          </div>
                        </div> */}

                        <div className="flex items-start gap-3">
                          <User className="h-4 w-4 mt-1 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Incident Type</p>
                            <p className="text-sm text-muted-foreground">
                              {incidentType || "—"}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* RIGHT COLUMN */}
                      <div className="space-y-4">

                        <div className="flex items-start gap-3">
                          <Clock className="h-4 w-4 mt-1 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Notification Date</p>
                            <p className="text-sm text-muted-foreground">
                              {formatDateTime(submittedDate) || "—"}
                            </p>
                          </div>
                        </div>

                      </div>

                    </div> <br></br>

                    <Separator />

                    <div className="">
                      <h4 className="text-sm font-medium mb-3">Incident Description</h4>
                      <p className="text-sm text-muted-foreground mb-3">
                        {incidentDescription || "—"}
                      </p>
                    </div>
                  </CardContent>

                </Card>
              </TabsContent>

              <TabsContent value="documents">
                <Card className="card-elevated">
                  <CardHeader>
                    <CardTitle className="text-base">Vehicle Images</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 sm:grid-cols-1">
                      {/* <div className="flex items-center justify-between rounded-lg border p-4">
                        <span className="text-sm font-medium">RC Copy</span>
                        <StatusBadge status={documents.rc_copy_uploaded ? "approved" : "pending"}>
                          {documents.rc_copy_uploaded ? "Uploaded" : "Missing"}
                        </StatusBadge>
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-4">
                        <span className="text-sm font-medium">DL Copy</span>
                        <StatusBadge status={documents.dl_copy_uploaded ? "approved" : "pending"}>
                          {documents.dl_copy_uploaded ? "Uploaded" : "Missing"}
                        </StatusBadge>
                      </div> */}
                      {/* <div className="flex items-center justify-between rounded-lg border p-4">
                        <span className="text-sm font-medium">Photos</span>
                        <StatusBadge status={documents.photos_uploaded ? "approved" : "pending"}>
                          {documents.photos_uploaded ? "Uploaded" : "Missing"}
                        </StatusBadge>
                      </div> */}
                      {/* <div className="flex items-center justify-between rounded-lg border p-4">
                        <span className="text-sm font-medium">FIR</span>
                        <StatusBadge status={documents.fir_uploaded ? "approved" : "pending"}>
                          {documents.fir_uploaded ? "Uploaded" : "Missing"}
                        </StatusBadge>
                      </div> */}


                      <div className="rounded-lg border p-4 space-y-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <span className="text-sm font-medium">Photos</span>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {claimPhotoAssets.length > 0
                                ? `${claimPhotoAssets.length} attached claim photo${claimPhotoAssets.length === 1 ? "" : "s"
                                }`
                                : "No vehicle photos attached yet"}
                            </p>
                          </div>
                          <StatusBadge
                            status={claimPhotoAssets.length >= 1 ? "approved" : "pending"}
                          >
                            {claimPhotoAssets.length >= 1 ? "Available" : "Missing"}
                          </StatusBadge>
                        </div>

                        {selectedPhoto ? (
                          <>
                            <button
                              type="button"
                              onClick={() => setPhotoPreviewOpen(true)}
                              aria-label={`Open full-size photo: ${selectedPhoto.label}`}
                              className="w-full overflow-hidden rounded-lg border text-left transition hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                            >
                              <img
                                src={selectedPhoto.url}
                                alt={selectedPhoto.label}
                                className="h-[320px] w-full object-cover sm:h-[360px]"
                                loading="lazy"
                              />
                            </button>

                            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                              <span className="truncate font-medium text-foreground">
                                {selectedPhoto.label}
                              </span>
                              <span>
                                {selectedPhotoIndex + 1} / {claimPhotoAssets.length}
                              </span>
                            </div>

                            {claimPhotoAssets.length > 1 ? (
                              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                                {claimPhotoAssets.map((photo, index) => {
                                  const isSelected = index === selectedPhotoIndex;
                                  return (
                                    <button
                                      key={photo.key}
                                      type="button"
                                      onClick={() => setSelectedPhotoIndex(index)}
                                      aria-label={`Photo ${index + 1} of ${claimPhotoAssets.length}: ${photo.label}`}
                                      className={`overflow-hidden rounded-lg border text-left transition focus:outline-none focus:ring-2 focus:ring-primary/40 ${isSelected
                                          ? "border-primary ring-1 ring-primary/30"
                                          : "hover:border-primary/60"
                                        }`}
                                    >
                                      <img
                                        src={photo.url}
                                        alt={photo.label}
                                        className="h-24 w-full object-cover sm:h-28"
                                        loading="lazy"
                                      />
                                      <div className="border-t px-3 py-2">
                                        <p className="truncate text-xs font-medium text-foreground">
                                          {photo.label}
                                        </p>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <div className="flex h-32 items-center justify-center rounded-lg border border-dashed bg-muted/20 px-4 text-center text-sm text-muted-foreground">
                            No vehicle photos are attached to this claim yet.
                          </div>
                        )}
                      </div>


                    </div>




                  </CardContent>
                </Card>
              </TabsContent>

              {!isRecommendationShared && showBusinessRuleValidationTab && (
                <TabsContent value="fraud-evaluation">
                  <Card className="card-elevated">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Shield className="h-4 w-4" />
                        Business Rule Validation
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Evaluation based on Master Data business and fraud rules. Green indicates the rule passed; red
                        indicates it failed.
                      </p>
                      {(() => {
                        const rules = validationRules;
                        if (rules.length === 0) {
                          return (
                            <div className="rounded-lg border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground">
                              <p className="font-medium text-foreground">Rule-level validation details are not available yet.</p>
                              <p className="mt-2">
                                {hasPersistedValidation
                                  ? "This claim already has a validation outcome, but no detailed rule snapshot was persisted for it."
                                  : "Run Business Rule Validation to generate rule-by-rule results for this claim."}
                              </p>
                              <div className="mt-4 space-y-1">
                                <p>
                                  Latest status: <span className="font-medium text-foreground">{claimEvaluation?.claim_status ?? fnol.status ?? "Pending"}</span>
                                </p>
                                <p>
                                  Decision: <span className="font-medium text-foreground">{claimEvaluation?.decision ?? assessment?.decision ?? "Pending"}</span>
                                </p>
                                <p>
                                  Reason: <span className="font-medium text-foreground">{claimEvaluation?.reason ?? assessment?.reason ?? "No rule-level explanation is currently stored."}</span>
                                </p>
                              </div>
                            </div>
                          );
                        }

                        const businessRules = rules.filter(
                          (r) => !r.rule_group || r.rule_group.toLowerCase() === "business rule"
                        );
                        const fraudRules = rules.filter(
                          (r) => r.rule_group && r.rule_group.toLowerCase() === "fraud check"
                        );

                        const renderRuleCard = (r: FraudRuleResult, key: React.Key) => (
                          <div
                            key={key}
                            className={`flex items-center justify-between rounded-lg border p-4 ${r.passed
                              ? "bg-success/5 border-success/20"
                              : "bg-destructive/5 border-destructive/20"
                              }`}
                          >
                            <div>
                              <p className="text-sm font-medium">{r.rule_type}</p>
                              <p className="text-xs text-muted-foreground">{r.rule_description}</p>
                            </div>
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${r.passed ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                                }`}
                            >
                              {r.passed ? (
                                <>
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Pass
                                </>
                              ) : (
                                <>
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                  Fail
                                </>
                              )}
                            </span>
                          </div>
                        );

                        return (
                          <div className="space-y-6">
                            {businessRules.length > 0 && (
                              <div className="space-y-3">
                                <h4 className="text-sm font-semibold">1. Business Rule Validation</h4>
                                {businessRules.map((r, i) => renderRuleCard(r, `business-${i}`))}
                              </div>
                            )}
                            {fraudRules.length > 0 && (
                              <div className="space-y-3">
                                <h4 className="text-sm font-semibold">2. Fraud Rule Validation</h4>
                                {fraudRules.map((r, i) => renderRuleCard(r, `fraud-${i}`))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>
                </TabsContent>
              )}

              {/* Damage Assessment tab content — shown when BRV passed or DA already ran */}
              {showDamageAssessmentTab && (
                <TabsContent value="assessment">
                  {!showDamageAssessmentExperience ? (
                    /* Empty state: BRV passed but DA not yet triggered */
                    <Card className="card-elevated">
                      <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                          <Brain className="h-7 w-7 text-primary" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-base font-semibold">Damage Assessment not yet run</p>
                          <p className="max-w-sm text-sm text-muted-foreground">
                            Business Rule Validation passed. Click{" "}
                            <span className="font-medium text-foreground">Run Damage Assessment</span>{" "}
                            above to analyse the claim photos for part-level damage, image
                            authenticity, and duplicate screening.
                          </p>
                        </div>
                        <Button
                          variant="default"
                          onClick={handleDamageDetection}
                          disabled={damageDetectionLoading || !hasBusinessRuleValidationPassed}
                          title={daDisabledTooltip}
                        >
                          {damageDetectionLoading ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Assessing...
                            </>
                          ) : (
                            "Run Damage Assessment"
                          )}
                        </Button>
                      </CardContent>
                    </Card>
                  ) : (
                    /* Full DA content after assessment has been run */
                    <Card className="card-elevated">
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <Brain className="h-4 w-4" />
                          Damage Assessment
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-8 px-5 pb-6 sm:px-6">
                        <section className="space-y-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              Assessment summary
                            </p>
                            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                              Confidence, valuation, severity context, and model outcome signals.
                            </p>
                          </div>

                          <div className="grid gap-3 lg:grid-cols-12">
                            <div className="space-y-2 rounded-lg bg-muted/15 p-3.5 lg:col-span-5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium text-foreground/80">
                                  AI confidence
                                </span>
                                <div className="flex items-center gap-2">
                                  {isFallbackConfidence ? (
                                    <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
                                      Under review
                                    </span>
                                  ) : null}
                                  <span className="text-sm font-semibold tabular-nums text-foreground">
                                    {aiConfidence}%
                                  </span>
                                </div>
                              </div>
                              <Progress value={aiConfidence} className="h-1.5" />
                              {isFallbackConfidence || pipelineMetadata?.confidence_level ? (
                                <p className="text-xs leading-relaxed text-muted-foreground">
                                  {pipelineMetadata?.confidence_level
                                    ? `Analysis indicates ${formatConfidenceLabel(
                                        pipelineMetadata.confidence_level
                                      ).toLowerCase()} confidence.`
                                    : "Standard review indicator until a detailed confidence score is returned."}
                                </p>
                              ) : null}
                            </div>

                            {totalValueSummary ? (
                              <div className="flex flex-col justify-center rounded-lg bg-muted/15 px-3.5 py-3 text-sm text-muted-foreground lg:col-span-7">
                                <span className="text-xs font-medium text-foreground/70">
                                  Valuation
                                </span>
                                <p className="mt-1 leading-snug">
                                  Excess{" "}
                                  <span className="font-semibold text-foreground tabular-nums">
                                    {formatClaimCurrency(totalValueSummary.excess_amount ?? 0)}
                                  </span>
                                  {totalValueSummary.excess_from_fnol != null ? (
                                    <span> (from policy)</span>
                                  ) : (
                                    <span> (computed)</span>
                                  )}
                                  {" · "}
                                  Net payable{" "}
                                  <span className="font-semibold text-foreground tabular-nums">
                                    {formatClaimCurrency(
                                      totalValueSummary.net_payable ?? totalEstimate
                                    )}
                                  </span>
                                </p>
                              </div>
                            ) : null}
                          </div>

                          {shouldRenderAssessmentDecisionBanner ? (
                            <div
                              className={cn(
                                "flex items-center gap-2.5 rounded-lg border px-3 py-2.5",
                                decisionToneClasses.border,
                                decisionToneClasses.background
                              )}
                            >
                              {decisionSummary.status_tone === "success" ? (
                                <CheckCircle2
                                  className={cn(
                                    "h-4 w-4 shrink-0",
                                    decisionToneClasses.icon
                                  )}
                                />
                              ) : (
                                <AlertTriangle
                                  className={cn(
                                    "h-4 w-4 shrink-0",
                                    decisionToneClasses.icon
                                  )}
                                />
                              )}
                              <div>
                                <p
                                  className={cn(
                                    "text-sm font-medium",
                                    decisionToneClasses.title
                                  )}
                                >
                                  {decisionSummary.status_title}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {decisionSummary.status_detail}
                                </p>
                              </div>
                            </div>
                          ) : null}

                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="rounded-lg bg-muted/15 p-3.5">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/55">
                                Severity
                              </p>
                              <p className="mt-1.5 text-base font-semibold capitalize text-foreground">
                                {claimEvaluation?.severity ??
                                  claimEvaluation?.llm_severity ??
                                  "—"}
                              </p>
                            </div>

                            <div className="rounded-lg bg-muted/15 p-3.5">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/55">
                                Damages detected
                              </p>
                              {claimEvaluation?.llm_damages &&
                              claimEvaluation.llm_damages.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {claimEvaluation.llm_damages.map((damage) => (
                                    <span
                                      key={damage}
                                      className="rounded-full bg-secondary/90 px-2.5 py-0.5 text-xs font-medium text-foreground"
                                    >
                                      {damage}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <p className="mt-2 text-sm text-muted-foreground">
                                  No structured damage tags were returned.
                                </p>
                              )}
                            </div>

                            {shouldRenderAssessmentReason ? (
                              <div className="rounded-lg bg-muted/15 p-3.5 md:col-span-2">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/55">
                                  Reason
                                </p>
                                <p className="mt-1.5 text-sm font-medium leading-relaxed text-foreground">
                                  {claimEvaluation?.reason}
                                </p>
                              </div>
                            ) : null}
                          </div>
                        </section>

                        <section className="space-y-4">
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              Review workspace
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Select a card to load detailed findings in the section below the
                              summary grid.
                            </p>
                          </div>

                        {claimInsightsLoading && (
                          <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin text-primary" />
                            Image authenticity, duplicate screening, and valuation
                            insights are loading.
                          </div>
                        )}

                        {id ? (
                          <DamageAssessmentCardsPanel
                            complaintId={id}
                            selectedCardKey={activeAssessmentCard?.key ?? null}
                            onSelectedCardKeyChange={handleAssessmentCardSelection}
                            supplementaryContent={embeddedFindingsSupplementary}
                          />
                        ) : null}

                        <div ref={findingsSectionRef} className="space-y-4">
                          {activeAssessmentCard && !isMobile ? (
                            <div className="rounded-xl border border-border/45 bg-card/95 p-4 shadow-sm sm:p-5">
                              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                                <div className="flex items-center gap-2">
                                  <Shield className="h-4 w-4 text-primary" />
                                  <span className="text-sm font-semibold text-foreground">
                                    {activeAssessmentCard.title} findings
                                  </span>
                                </div>
                                <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
                                  {activeFindingsSubtitle}
                                </p>
                              </div>
                              <div className="mt-4">
                                <DamageAssessmentDetailsDrawer
                                  complaintId={id!}
                                  cardKey={activeAssessmentCard.key}
                                  open
                                  onOpenChange={(open) => {
                                    if (!open) handleAssessmentCardSelection(null);
                                  }}
                                  mode="embedded"
                                  className="border-0 bg-transparent shadow-none ring-0"
                                  supplementaryContent={embeddedFindingsSupplementary}
                                />
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="rounded-xl border border-border/45 bg-card/95 p-4 shadow-sm sm:p-5">
                                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="flex items-center gap-2">
                                    <Shield className="h-4 w-4 text-primary" />
                                    <span className="text-sm font-semibold text-foreground">
                                      Image authenticity findings
                                    </span>
                                  </div>
                                  <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
                                    Per-photo signals, scores, and stored reviewer notes.
                                  </p>
                                </div>
                                <div className="mt-4">{renderImageAuthenticityPageCopy()}</div>
                              </div>

                              <div className="overflow-hidden rounded-xl border border-border/45 bg-card/95 shadow-sm">
                                <div className="border-b border-border/35 bg-muted/10 px-4 py-3 sm:px-5">
                                  <p className="text-sm font-semibold text-foreground">
                                    Damage breakdown by part
                                  </p>
                                  <p className="mt-0.5 text-xs text-muted-foreground">
                                    Line-level repair actions and estimates.
                                  </p>
                                </div>
                                {renderDamageBreakdownPageCopy()}
                              </div>
                            </>
                          )}
                        </div>

                        {hasPipelineTransparencyData ? (
                          <section className="space-y-4">
                            <div className="space-y-1">
                              <p className="text-sm font-medium">
                                Advanced & technical evidence
                              </p>
                              <p className="text-sm text-muted-foreground">
                                Lower-priority diagnostic and pipeline context stays available
                                here without crowding the primary review workspace.
                              </p>
                            </div>
                            <div className="rounded-xl border border-border/60 bg-card p-5 sm:p-6">
                              <Collapsible defaultOpen={false}>
                                <CollapsibleTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="h-10 w-full justify-center text-sm"
                                  >
                                    Show estimation pipeline evidence
                                  </Button>
                                </CollapsibleTrigger>
                                <CollapsibleContent className="pt-5">
                                  {renderPipelineTransparencyContent()}
                                </CollapsibleContent>
                              </Collapsible>
                            </div>
                          </section>
                        ) : null}

                        </section>
                        {/* Metadata warnings removed: each photo card already shows its own
                            per-image EXIF warnings in the "Image authenticity findings" section
                            above, so aggregating them here is redundant and clutters the UI. */}
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
              )}

              {/* Claim Evaluation tab — only after DA has been run */}
              {showDamageAssessmentExperience && (
                <TabsContent value="claim-evaluation">
                    <Card className="card-elevated">
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <FileText className="h-4 w-4" />
                          Claim Evaluation Response
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {claimEvaluationLoading ? (
                          <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                          </div>
                        ) : claimEvaluation ? (
                          <div className="space-y-6">
                            <div className="grid gap-4 sm:grid-cols-2">
                              {claimEvaluation.claim_complexity && (
                                <div className="rounded-lg border p-4">
                                  <p className="text-xs text-muted-foreground">Claim Type</p>
                                  <p className="text-sm font-medium mt-1">
                                    {claimEvaluation.claim_complexity}
                                  </p>
                                </div>
                              )}
                              <div className="rounded-lg border p-4">
                                <p className="text-xs text-muted-foreground">Conclusion</p>
                                <p className="text-sm font-medium mt-1 capitalize">{claimEvaluation.decision ?? "—"}</p>
                              </div>
                              <div className="rounded-lg border p-4">
                                <p className="text-xs text-muted-foreground">Claim Amount</p>
                                <p className="text-sm font-medium mt-1">{formatClaimCurrency(claimEvaluation.claim_amount)}</p>
                              </div>
                              <div className="rounded-lg border p-4">
                                <p className="text-xs text-muted-foreground">Excess Amount</p>
                                <p className="text-sm font-medium mt-1">{formatClaimCurrency(claimEvaluation.excess_amount ?? 0)}</p>
                              </div>
                              <div className="rounded-lg border p-4">
                                <p className="text-xs text-muted-foreground">Estimated Repair</p>
                                <p className="text-sm font-medium mt-1">
                                  {formatClaimCurrency(claimEvaluation.estimated_repair ?? Math.max(0, (claimEvaluation.claim_amount ?? 0) - (claimEvaluation.excess_amount ?? 0)))}
                                </p>
                              </div>
                              <div className="rounded-lg border p-4">
                                <p className="text-xs text-muted-foreground">Threshold Value</p>
                                <p className="text-sm font-medium mt-1">{claimEvaluation.threshold_value ?? "—"}</p>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground py-8 text-center">
                            No evaluation data found for this claim.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>
              )}

            </Tabs>
          </div>

          {/* Sidebar */}
          <div
            className={cn(
              "space-y-6 xl:sticky xl:top-24 xl:z-10",
              prioritizeAssessmentLayout && "xl:hidden"
            )}
          >
            <Card className="card-elevated">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Customer Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {/* <div>
                  <p className="text-sm">
                    Name: {fnol.policy_holder_name || claimant.driver_name || "—"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Policy: {fnol.policy_number || policy.policy_number || "—"}
                  </p>
                </div> 
                <Separator /> */}
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-muted-foreground">Name</span>
                    <span className="max-w-[11rem] text-right font-medium text-foreground">
                      {fnol.policy_holder_name || claimant.driver_name || "—"}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-muted-foreground">Policy</span>
                    <span className="max-w-[11rem] text-right font-medium tabular-nums">
                      {fnol.policy_number || policy.policy_number || "—"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="card-elevated">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Policy Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <span className="text-muted-foreground">Coverage Type</span>
                  <span className="max-w-[11rem] text-right font-medium">
                    {getCoverageTypeDisplay(fnol)}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <span className="text-muted-foreground">Policy Status</span>
                  <span className="max-w-[11rem] text-right font-medium">
                    {fnol.policy_status || policy.policy_status || "—"}
                  </span>
                </div>
                {/* <div className="flex justify-between">
                  <span className="text-muted-foreground">Flood Coverage Endorsement</span>
                  <span className="font-medium">
                    {fnol.flood_coverage ? "Yes" : "No"}
                  </span>
                </div> */}
                <div className="flex items-start justify-between gap-4">
                  <span className="text-muted-foreground">Policy Start</span>
                  <span className="max-w-[11rem] text-right tabular-nums">
                    {formatDate(fnol.policy_start_date) || "—"}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <span className="text-muted-foreground">Policy End</span>
                  <span className="max-w-[11rem] text-right tabular-nums">
                    {formatDate(fnol.policy_end_date) || "—"}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="card-elevated">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Car className="h-4 w-4" />
                  Vehicle Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <span className="text-muted-foreground">Vehicle</span>
                  <span className="max-w-[11rem] text-right">
                    {[fnol.vehicle_year, fnol.vehicle_make, fnol.vehicle_model]
                      .filter(Boolean)
                      .join(" ") ||
                      `${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim() ||
                      "—"}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <span className="text-muted-foreground">Registration</span>
                  <span className="max-w-[11rem] text-right font-mono tabular-nums">
                    {fnol.vehicle_registration_number || vehicle.registration_number || "—"}
                  </span>
                </div>
                {/* <div className="flex justify-between">
                  <span className="text-muted-foreground">Coverage</span>
                  <span>{getCoverageTypeDisplay(fnol)}</span>
                </div> */}
              </CardContent>
            </Card>

          </div>
        </div>
      </div>
    </AppLayout>
  );
}
