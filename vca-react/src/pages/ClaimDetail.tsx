import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  runDetailedDamageAssessment,
  runFraudDetection,
  runImageFraudAnalysis,
  type BusinessRuleSummaryBlock,
  type ClaimWorkflowSnapshot,
  type FnolPayload,
  type FnolResponse,
  type ClaimEvaluationResponse,
  type DetailedDamageAssessmentResponse,
  type DuplicateCandidatesResponse,
  type ImageFraudResultsResponse,
  type TotalValueResponse,
  type ClaimDecisionInsight,
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
import {
  fnolListQueryKey,
  removeClaimScopedQueryCaches,
} from "@/lib/claimScopedCache";
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
import { ClaimImageRiskDuplicateWarnings } from "@/components/claim/ClaimImageRiskDuplicateWarnings";
import {
  DamageAssessmentFinancialSummary,
  DamageAssessmentPartBreakdownTable,
  selectPartBreakdownRows,
  shouldShowPartBreakdownTable,
} from "@/components/claim/DamageAssessmentTotalValueSection";
import { ClaimEvaluationTabContent } from "@/components/claim/ClaimEvaluationTabContent";

const formatElaScore = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(value)) return "—";
  const minimumFractionDigits = Number.isInteger(value) ? 0 : value < 10 ? 2 : 1;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits,
    maximumFractionDigits: 2,
  }).format(value);
};

/** Shown next to per-image metrics; aligns with damage_detection_llm/image_fraud_service.py */
const AUTHENTICITY_TOOLTIP_FRAUD =
  "Composite fraud score (0–100): combines Error Level Analysis (ELA), metadata (EXIF) warnings, and AI authenticity. Higher = more suspicious.";
const AUTHENTICITY_TOOLTIP_ELA =
  "Error Level Analysis (ELA): compares the image to a JPEG recompressed copy. Higher values often indicate repeated saves, crops, or edits. This signal is weighted into the composite Fraud score (25%) with EXIF and AI checks.";

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

type AssessmentSnapshotState = {
  claimId: string;
  imageFraudResults: ImageFraudResultsResponse | null;
  duplicateCandidates: DuplicateCandidatesResponse | null;
  detailedDamageAssessment: DetailedDamageAssessmentResponse | null;
  totalValueSummary: TotalValueResponse | null;
};

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

/** Tags from evaluation `llm_damages` (strings or `{ damage_type }` objects). */
function normalizeStructuredDamageTags(llmDamages: unknown): string[] {
  if (!Array.isArray(llmDamages) || llmDamages.length === 0) return [];
  const out: string[] = [];
  for (const item of llmDamages) {
    if (typeof item === "string") {
      const t = item.trim();
      if (t) out.push(t);
    } else if (item && typeof item === "object") {
      const dt = String((item as { damage_type?: unknown }).damage_type ?? "").trim();
      if (dt) out.push(dt);
    }
  }
  return out;
}

/** When LLM did not persist tags, derive readable damage types from DA part lines. */
function damageTagsFromPartBreakdown(
  rows: Array<{ damage_type?: string | null }> | null | undefined
): string[] {
  if (!rows?.length) return [];
  const seenLower = new Set<string>();
  const tags: string[] = [];
  for (const row of rows) {
    const dt = (row.damage_type ?? "").trim();
    if (!dt) continue;
    const key = dt.toLowerCase();
    if (key === "none" || key === "—" || key === "-" || key === "n/a") continue;
    if (seenLower.has(key)) continue;
    seenLower.add(key);
    tags.push(dt);
  }
  return tags;
}

export default function ClaimDetail() {
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const isReopenFlow = searchParams.get("reopen") === "1";
  const [fnol, setFnol] = useState<FnolResponse | null>(null);
  const [loading, setLoading] = useState(true);
  /** Load failure for GET FNOL only */
  const [error, setError] = useState<string | null>(null);
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
  const [assessmentInsightAlert, setAssessmentInsightAlert] = useState<string | null>(null);
  const [claimEvaluation, setClaimEvaluation] = useState<ClaimEvaluationResponse | null>(null);
  const [claimEvaluationLoading, setClaimEvaluationLoading] = useState(false);
  const [reportPdfLoading, setReportPdfLoading] = useState(false);
  /** True after user runs “Damage detection” until a persisted evaluation exists */
  const [showDamageRunSummary, setShowDamageRunSummary] = useState(false);
  const [claimInsightsLoading, setClaimInsightsLoading] = useState(false);
  const [assessmentSnapshot, setAssessmentSnapshot] =
    useState<AssessmentSnapshotState | null>(null);
  /** Bumps when claim-scoped data is purged+refetched so tab bodies remount (no stale subtree state). */
  const [claimDetailDataRevision, setClaimDetailDataRevision] = useState(0);
  /** Full-page guard during post-mutation refetch so testers never see stale DA/evaluation rows. */
  const [postActionRefetchBusy, setPostActionRefetchBusy] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false);
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const activeClaimIdRef = useRef<string | null>(id ?? null);
  const rawPhotoEntries = fnol?.raw_response?.documents?.photos ?? fnol?.damage_photos ?? [];
  const claimPhotoAssets = buildClaimPhotoAssets(rawPhotoEntries);
  const activeClaimEvaluation =
    claimEvaluation?.complaint_id === id ? claimEvaluation : null;
  /** Authoritative lifecycle for tab/button gates (FNOL or latest evaluation payload). */
  const workflowSnapshot = useMemo(
    () =>
      (activeClaimEvaluation?.workflow_snapshot ??
        fnol?.workflow_snapshot ??
        null) as ClaimWorkflowSnapshot | null,
    [activeClaimEvaluation, fnol?.workflow_snapshot]
  );

  const claimDetailWorkflowGates = useMemo(() => {
    const ws = workflowSnapshot;
    if (!ws) {
      return {
        brvManualReviewBanner: false,
        damageAssessmentTabUnlocked: false,
        showRunBrvButton: false,
        showRunDamageAssessmentButton: false,
        damageAssessmentIncompleteNoValuation: false,
        showDamageAssessmentResultsPanel: false,
        showClaimEvaluationTabStrip: false,
      };
    }
    const brv = ws.business_rule_validation;
    const da = ws.damage_assessment;
    const ce = ws.claim_evaluation;
    const brvFailed = brv?.passed === false;
    return {
      brvManualReviewBanner: brvFailed,
      damageAssessmentTabUnlocked: Boolean(da?.available) && !brvFailed,
      showRunBrvButton: Boolean(brv?.run_allowed),
      showRunDamageAssessmentButton: Boolean(da?.run_allowed),
      damageAssessmentIncompleteNoValuation:
        Boolean(da?.completed) && da?.valuation_ready === false,
      showDamageAssessmentResultsPanel:
        Boolean(da?.completed) && da?.valuation_ready !== false,
      showClaimEvaluationTabStrip: Boolean(ce?.available),
    };
  }, [workflowSnapshot]);

  useEffect(() => {
    if (activeTab === "assessment" && !claimDetailWorkflowGates.damageAssessmentTabUnlocked) {
      setActiveTab("details");
    }
  }, [activeTab, claimDetailWorkflowGates.damageAssessmentTabUnlocked]);

  useEffect(() => {
    if (activeTab === "claim-evaluation" && !claimDetailWorkflowGates.showClaimEvaluationTabStrip) {
      setActiveTab("details");
    }
  }, [activeTab, claimDetailWorkflowGates.showClaimEvaluationTabStrip]);

  const activeAssessmentSnapshot =
    assessmentSnapshot?.claimId === id ? assessmentSnapshot : null;
  const imageFraudResults = activeAssessmentSnapshot?.imageFraudResults ?? null;
  const duplicateCandidates = activeAssessmentSnapshot?.duplicateCandidates ?? null;
  const detailedDamageAssessment =
    activeAssessmentSnapshot?.detailedDamageAssessment ?? null;
  const totalValueSummary = activeAssessmentSnapshot?.totalValueSummary ?? null;

  const displayDamageTags = useMemo(() => {
    const fromLlm = normalizeStructuredDamageTags(activeClaimEvaluation?.llm_damages);
    if (fromLlm.length > 0) return fromLlm;
    return damageTagsFromPartBreakdown(detailedDamageAssessment?.part_breakdown);
  }, [activeClaimEvaluation?.llm_damages, detailedDamageAssessment?.part_breakdown]);

  useEffect(() => {
    activeClaimIdRef.current = id ?? null;
  }, [id]);

  const isCurrentClaimRoute = useCallback(
    (claimId?: string | null) =>
      Boolean(claimId && activeClaimIdRef.current === claimId),
    []
  );

  const applyAssessmentSnapshot = useCallback(
    (
      claimId: string,
      snapshot: Omit<AssessmentSnapshotState, "claimId">
    ) => {
      if (!isCurrentClaimRoute(claimId)) return;
      setAssessmentSnapshot({ claimId, ...snapshot });
    },
    [isCurrentClaimRoute]
  );

  const resetDamageAssessmentUiState = useCallback(
    (claimId?: string | null) => {
      setAssessmentSnapshot(null);
      setAssessmentInsightAlert(null);
      setShowDamageRunSummary(false);
      setActiveAssessmentCard(null);
      if (claimId) {
        removeClaimScopedQueryCaches(queryClient, claimId);
      }
    },
    [queryClient]
  );

  const refreshClaimContext = useCallback(
    async (claimId: string) => {
      const updatedFnol = await getFnolById(claimId);
      if (!isCurrentClaimRoute(claimId)) return null;

      setFnol(updatedFnol);

      try {
        const latestEvaluation = await getClaimEvaluation(claimId);
        if (!isCurrentClaimRoute(claimId)) return null;

        if (!latestEvaluation) {
          setClaimEvaluation(null);
          return { fnol: updatedFnol, evaluation: null };
        }

        setClaimEvaluation(latestEvaluation);
        return { fnol: updatedFnol, evaluation: latestEvaluation };
      } catch {
        if (isCurrentClaimRoute(claimId)) {
          setClaimEvaluation(null);
        }
        return { fnol: updatedFnol, evaluation: null };
      }
    },
    [isCurrentClaimRoute]
  );

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
    // All four requests run concurrently; damage-assessment-detailed and total-value in parallel.
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

  const refetchClaimDetailAfterMutation = useCallback(
    async (claimId: string) => {
      if (!claimId || !isCurrentClaimRoute(claimId)) return;
      setPostActionRefetchBusy(true);
      setClaimEvaluationLoading(true);
      try {
        removeClaimScopedQueryCaches(queryClient, claimId);
        resetDamageAssessmentUiState(claimId);
        setClaimEvaluation(null);
        setClaimInsightsLoading(true);

        const updatedFnol = await getFnolById(claimId);
        if (!isCurrentClaimRoute(claimId)) return;
        setFnol(updatedFnol);

        try {
          const latestEvaluation = await getClaimEvaluation(claimId);
          if (!isCurrentClaimRoute(claimId)) return;
          setClaimEvaluation(latestEvaluation ?? null);
        } catch {
          if (isCurrentClaimRoute(claimId)) {
            setClaimEvaluation(null);
          }
        }

        const insightSnapshot = await loadAssessmentInsightsSnapshot(claimId);
        if (!isCurrentClaimRoute(claimId)) return;
        applyAssessmentSnapshot(claimId, {
          imageFraudResults: insightSnapshot.imageFraudResults,
          duplicateCandidates: insightSnapshot.duplicateCandidates,
          detailedDamageAssessment: insightSnapshot.detailedDamageAssessment,
          totalValueSummary: insightSnapshot.totalValueSummary,
        });
        if (isCurrentClaimRoute(claimId)) {
          setClaimInsightsLoading(false);
        }

        await queryClient.invalidateQueries({
          queryKey: damageAssessmentCardsKey(claimId),
        });
        await queryClient.invalidateQueries({ queryKey: fnolListQueryKey });
        if (isCurrentClaimRoute(claimId)) {
          setClaimDetailDataRevision((n) => n + 1);
        }
      } finally {
        if (isCurrentClaimRoute(claimId)) {
          setClaimEvaluationLoading(false);
          setPostActionRefetchBusy(false);
        }
      }
    },
    [
      applyAssessmentSnapshot,
      isCurrentClaimRoute,
      loadAssessmentInsightsSnapshot,
      queryClient,
      resetDamageAssessmentUiState,
    ]
  );

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFnol(null);
    setFraudDetectionLoading(false);
    setDamageDetectionLoading(false);
    setClaimInsightsLoading(false);
    setFraudSuccessModalOpen(false);
    setClaimEvaluation(null);
    setClaimEvaluationLoading(false);
    setClaimDetailDataRevision(0);
    resetDamageAssessmentUiState(id);
    setAssessmentInsightAlert(null);
    getFnolById(id)
      .then((data) => {
        if (cancelled) return;
        setFnol(data);
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
  }, [id, resetDamageAssessmentUiState]);

  const shouldFetchClaimEvaluation = Boolean(id && fnol?.complaint_id === id);

  useEffect(() => {
    if (!id) return;
    if (!shouldFetchClaimEvaluation) {
      setClaimEvaluation(null);
      setClaimEvaluationLoading(false);
      return;
    }
    // refetchClaimDetailAfterMutation owns GET /evaluation while postActionRefetchBusy;
    // without this guard the effect re-fetches against stale fnol and can resurrect old rows.
    if (postActionRefetchBusy) {
      return;
    }
    let cancelled = false;
    setClaimEvaluationLoading(true);
    setClaimEvaluation(null);
    Promise.resolve(getClaimEvaluation(id))
      .then((data) => {
        if (cancelled) return;
        if (!data) {
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
  }, [id, shouldFetchClaimEvaluation, fnol, postActionRefetchBusy]);

  useEffect(() => {
    if (activeClaimEvaluation) setShowDamageRunSummary(false);
  }, [activeClaimEvaluation]);

  useEffect(() => {
    if (!fnol || !workflowSnapshot) return;
    const ws = workflowSnapshot;
    const allowedTabs = new Set(["details", "documents"]);

    if (ws.business_rule_validation?.visible) {
      allowedTabs.add("fraud-evaluation");
    }
    if (ws.damage_assessment?.available) {
      allowedTabs.add("assessment");
    }
    if (ws.claim_evaluation?.available) {
      allowedTabs.add("claim-evaluation");
    }

    if (!allowedTabs.has(activeTab)) {
      setActiveTab("details");
    }
  }, [fnol, workflowSnapshot, activeTab]);

  useEffect(() => {
    resetDamageAssessmentUiState(id);
  }, [id, resetDamageAssessmentUiState]);

  useEffect(() => {
    const shouldHydrateDamageAssessment = Boolean(
      id &&
        fnol &&
        workflowSnapshot?.damage_assessment?.completed
    );
    if (!shouldHydrateDamageAssessment || !id || !fnol) return;
    if (postActionRefetchBusy) {
      return;
    }
    let cancelled = false;

    const hydrateClaimInsightsSnapshot = async () => {
      setClaimInsightsLoading(true);
      const snapshot = await loadAssessmentInsightsSnapshot(id);

      if (cancelled) return;
      applyAssessmentSnapshot(id, {
        imageFraudResults: snapshot.imageFraudResults,
        duplicateCandidates: snapshot.duplicateCandidates,
        detailedDamageAssessment: snapshot.detailedDamageAssessment,
        totalValueSummary: snapshot.totalValueSummary,
      });
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
  }, [
    id,
    fnol,
    workflowSnapshot,
    postActionRefetchBusy,
    loadAssessmentInsightsSnapshot,
    applyAssessmentSnapshot,
  ]);

  const handleFraudDetection = async () => {
    if (!id) return;
    setFraudDetectionLoading(true);
    setError(null);
    try {
      await runFraudDetection(id);
      await refetchClaimDetailAfterMutation(id);
      if (!isCurrentClaimRoute(id)) return;
      setActiveTab("fraud-evaluation");
      setFraudSuccessModalOpen(true);
    } catch (err) {
      if (isCurrentClaimRoute(id)) {
        setError(err instanceof Error ? err.message : "Business Rule Validation failed");
      }
    } finally {
      if (isCurrentClaimRoute(id)) {
        setFraudDetectionLoading(false);
      }
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
    setPostActionRefetchBusy(true);
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

      applyAssessmentSnapshot(id, {
        imageFraudResults: canonicalFraudResults,
        duplicateCandidates: snapshot.duplicateCandidates,
        detailedDamageAssessment: canonicalDetailedAssessment,
        totalValueSummary: snapshot.totalValueSummary,
      });

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
        if (isCurrentClaimRoute(id)) {
          setError(reason);
        }
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
        if (isCurrentClaimRoute(id)) {
          setAssessmentInsightAlert(
            `Some Assessment insights could not be loaded: ${incompleteInsightSteps.join(
              "; "
            )}.`
          );
        }
        if (isCurrentClaimRoute(id)) {
          toast({
            title: "Analysis partially loaded",
            description: `Issues: ${incompleteInsightSteps.join("; ")}.`,
          });
        }
      }

      if (!isCurrentClaimRoute(id)) return;
      setShowDamageRunSummary(true);
      setActiveTab("assessment");

      // Re-fetch claim evaluation: getTotalValue (inside loadAssessmentInsightsSnapshot above)
      // calls run_full_valuation on the backend, which writes the computed gross/net amounts
      // back into ClaimEvaluationResponse.claim_amount.  Without this re-fetch the overview
      // "Claim Amount" card stays at ฿0 even though the DA breakdown shows ฿22,000.
      setClaimEvaluationLoading(true);
      await refreshClaimContext(id);
      if (!isCurrentClaimRoute(id)) return;

      queryClient.invalidateQueries({ queryKey: damageAssessmentCardsKey(id) });
      queryClient.invalidateQueries({
        queryKey: ["damage-assessment-card-details", id],
      });
      void queryClient.invalidateQueries({ queryKey: fnolListQueryKey });
      setClaimDetailDataRevision((n) => n + 1);
    } catch (err) {
      if (isCurrentClaimRoute(id)) {
        setError(err instanceof Error ? err.message : "Damage detection failed");
      }
    } finally {
      if (isCurrentClaimRoute(id)) {
        setClaimEvaluationLoading(false);
        setClaimInsightsLoading(false);
        setDamageDetectionLoading(false);
        setPostActionRefetchBusy(false);
      }
    }
  };

  const isRouteClaimLoading =
    loading || (id != null && fnol != null && fnol.complaint_id !== id);

  if (isRouteClaimLoading) {
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

  const businessRuleValidationState =
    workflowSnapshot?.business_rule_validation ?? null;
  const damageAssessmentState = workflowSnapshot?.damage_assessment ?? null;
  const claimEvaluationState = workflowSnapshot?.claim_evaluation ?? null;

  const {
    brvManualReviewBanner,
    damageAssessmentTabUnlocked,
    showRunBrvButton,
    showRunDamageAssessmentButton,
    damageAssessmentIncompleteNoValuation,
    showDamageAssessmentResultsPanel,
    showClaimEvaluationTabStrip,
  } = claimDetailWorkflowGates;

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
  const aiConfidence = activeClaimEvaluation?.damage_confidence ?? 0;
  const hasDamageConfidenceSignal = activeClaimEvaluation?.damage_confidence != null;
  const fraudBand = activeClaimEvaluation?.fraud_score ?? "—";
  const fraudScore = fraudBandToNumeric(fraudBand);
  const decisionSummary = activeClaimEvaluation?.decision_summary ?? null;
  const decision = activeClaimEvaluation?.decision ?? "Pending";
  const claimStatus = activeClaimEvaluation?.claim_status ?? fnol.status ?? "FNOL";
  // Only show rule rows from the persisted evaluation API. Do not infer BRV
  // completion from stale page state or other downstream APIs.
  const validationRules =
    activeClaimEvaluation?.fraud_rule_results &&
    activeClaimEvaluation.fraud_rule_results.length > 0
      ? activeClaimEvaluation.fraud_rule_results
      : [];
  /** True when API returned a persisted rule-by-rule snapshot (session or DB). */
  const hasPersistedRuleSnapshot = validationRules.length > 0;
  const allStoredRulesPassed =
    hasPersistedRuleSnapshot && validationRules.every((r) => r.passed);
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
  const formatOptionalClaimCurrency = (amount: number | null | undefined) =>
    amount == null ? "—" : formatClaimCurrency(amount);
  const estimatedRangeLabel =
    pipelineMetadata?.cost_range != null
      ? `${formatClaimCurrency(pipelineMetadata.cost_range.low)} - ${formatClaimCurrency(
        pipelineMetadata.cost_range.high
      )}`
      : "Not available";

  const statusForCheck = (fnol.status || claimStatus || "").toLowerCase();

  const isPendingDamageDetection =
    statusForCheck === "business rule validation-pass" ||
    statusForCheck === "pending damage detection" ||
    statusForCheck === "pending_damage_detection";

  const hasPersistedValidation =
    Boolean(businessRuleValidationState?.completed || hasPersistedRuleSnapshot);

  const hasBusinessRuleValidationPassed =
    businessRuleValidationState?.passed ??
    decisionSummary?.business_rule_validation_passed ??
    (isPendingDamageDetection || allStoredRulesPassed);

  const hasBackendDamageAssessment = showDamageAssessmentResultsPanel;

  const showGenerateRecommendationReport =
    Boolean(
      businessRuleValidationState?.completed &&
        businessRuleValidationState?.passed !== false
    ) && hasBackendDamageAssessment;

  const canRunBusinessRuleValidation =
    Boolean(fnol) && !fraudDetectionLoading && showRunBrvButton;

  const hasBrvBeenRun = hasPersistedValidation;

  const businessRuleActionLabel =
    businessRuleValidationState?.completed
      ? "Re-run Business Rule Validation"
      : "Run Business Rule Validation";

  const damageAssessmentActionLabel = damageAssessmentState?.completed
    ? "Re-run Damage Assessment"
    : "Run Damage Assessment";

  const daDisabledTooltip = brvManualReviewBanner
    ? "Business Rule Validation failed — manual review is required before damage assessment."
    : !damageAssessmentState?.run_allowed
      ? "Complete Business Rule Validation successfully to unlock Damage Assessment."
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
  const brvClaimAmount = activeClaimEvaluation?.claim_amount ?? 0;

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

  const showClaimAmountCard =
    Boolean(claimEvaluationState?.financials_ready) && displayClaimAmount > 0;

  const showBusinessRuleValidationTab =
    Boolean(businessRuleValidationState?.visible) && !fraudDetectionLoading;
  const showDamageAssessmentTab = Boolean(damageAssessmentState?.available);
  const showClaimEvaluationTab = showClaimEvaluationTabStrip;
  const prioritizeAssessmentLayout = activeTab === "assessment";
  const businessRuleButtonVariant = showRunBrvButton ? "default" : "outline";
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
  const topLevelInsightsForStrip = topLevelInsights.filter(
    (insight: ClaimDecisionInsight) =>
      !/^claim_duplicate_candidates|^image_fraud_results/.test(insight.source)
  );
  const mergedTopSummaryRows = buildClaimTopInsightRows(
    null,
    topLevelInsightsForStrip
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
    activeClaimEvaluation?.reason &&
      !normalizedTopSummaryDetails.has(
        normalizeSummaryCopy(activeClaimEvaluation.reason)
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
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className="cursor-help rounded-md bg-background/90 px-3 py-2 text-right shadow-sm ring-1 ring-border/30"
                              tabIndex={0}
                            >
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground/55">
                                Fraud
                              </p>
                              <p className="mt-0.5 text-base font-semibold tabular-nums text-foreground">
                                {Math.round(result.fraud_score ?? 0)}
                              </p>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-left">
                            {AUTHENTICITY_TOOLTIP_FRAUD}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className="cursor-help rounded-md bg-background/90 px-3 py-2 text-right shadow-sm ring-1 ring-border/30"
                              tabIndex={0}
                            >
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground/55">
                                ELA
                              </p>
                              <p className="mt-0.5 text-base font-semibold tabular-nums text-foreground">
                                {formatElaScore(result.ela_score)}
                              </p>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-left">
                            {AUTHENTICITY_TOOLTIP_ELA}
                          </TooltipContent>
                        </Tooltip>
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
  const partBreakdownRowsForAssessment = selectPartBreakdownRows(
    totalValueSummary,
    detailedDamageAssessment
  );

  const renderDamageBreakdownPageCopy = () =>
    shouldShowPartBreakdownTable(totalValueSummary, detailedDamageAssessment) ? (
      <DamageAssessmentPartBreakdownTable rows={partBreakdownRowsForAssessment} />
    ) : null;

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
      <div className="relative min-h-[14rem] space-y-6 animate-fade-in">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Action needs attention</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {assessmentInsightAlert && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Some insights are partial</AlertTitle>
            <AlertDescription>{assessmentInsightAlert}</AlertDescription>
          </Alert>
        )}
        {brvManualReviewBanner && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Business Rule Validation Failed – Manual Review</AlertTitle>
            <AlertDescription>
              Business Rule Validation did not pass. Damage Assessment is locked until this claim is
              reviewed.
            </AlertDescription>
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
            {/* Generate Recommendation Report — only when BRV snapshot + DA exist */}
            {showGenerateRecommendationReport && (
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

            {/* Business Rule Validation — run only when workflow_snapshot allows a first run */}
            {showRunBrvButton && !(fnol?.re_open === 1 && isReopenFlow) && (
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

            {/* Damage Assessment — run only when snapshot unlocks DA and first run is pending */}
            {showRunDamageAssessmentButton && damageAssessmentTabUnlocked && (
              <Button
                variant="destructive"
                onClick={handleDamageDetection}
                disabled={damageDetectionLoading || !damageAssessmentState?.run_allowed}
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
                Review the Business Rule Validation tab to inspect the latest business rule
                validation findings for this claim.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Business Rule Validation has been completed for this claim. You can review the results in the Business Rule Validation tab.
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

        {showDamageRunSummary && !activeClaimEvaluation && detailedDamageAssessment && (
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
            {(showBusinessRuleValidationTab || showDamageAssessmentResultsPanel) && (
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
                {showDamageAssessmentResultsPanel && (
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
                {showDamageAssessmentResultsPanel ? (
                  <ClaimImageRiskDuplicateWarnings
                    imageFraudResults={imageFraudResults}
                    duplicateCandidates={duplicateCandidates}
                    imageRiskSummary={imageRiskSummaryBlock}
                    blockingImageRiskCodes={
                      decisionSummary?.signals?.blocking_image_risk_codes
                    }
                    insightsLoading={claimInsightsLoading}
                    snapshotReady={Boolean(activeAssessmentSnapshot?.claimId === id)}
                    evaluationDuplicateCandidateCount={
                      decisionSummary?.signals?.duplicate_candidate_count
                    }
                  />
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
              imageRiskSummary={null}
              insights={topLevelInsightsForStrip}
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
                      <span className="text-xs tabular-nums text-foreground/85">
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
            <Tabs
              key={claimDetailDataRevision}
              value={activeTab}
              onValueChange={setActiveTab}
              className="w-full space-y-6"
            >
              <TabsList className="h-12 w-full justify-start gap-2 overflow-x-auto rounded-xl border border-border/70 bg-muted/30 p-1.5 whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <TabsTrigger className="shrink-0 rounded-lg px-4 py-2" value="details">
                  Claim Details
                </TabsTrigger>
                <TabsTrigger className="shrink-0 rounded-lg px-4 py-2" value="documents">
                  Vehicle Images
                </TabsTrigger>
                {/* Keep tab visible at terminal stages (e.g. Recommendation shared) so reviewers can
                    still open rule-by-rule results; header actions control re-run, not tab visibility */}
                {showBusinessRuleValidationTab && (
                  <TabsTrigger className="shrink-0 rounded-lg px-4 py-2" value="fraud-evaluation">
                    Business Rule Validation
                  </TabsTrigger>
                )}
                {showDamageAssessmentTab && (
                  <TabsTrigger
                    className={cn(
                      "shrink-0 rounded-lg px-4 py-2",
                      !damageAssessmentTabUnlocked && "pointer-events-none opacity-50"
                    )}
                    value="assessment"
                    disabled={!damageAssessmentTabUnlocked}
                    aria-disabled={!damageAssessmentTabUnlocked || undefined}
                  >
                    Damage Assessment
                  </TabsTrigger>
                )}
                {showClaimEvaluationTab && (
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

              {showBusinessRuleValidationTab && (
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
                                  ? "No rule-by-rule rows are stored for this claim yet. Use “Re-run Business Rule Validation” above to persist a full snapshot."
                                  : "Run Business Rule Validation to generate rule-by-rule results for this claim."}
                              </p>
                              <div className="mt-4 space-y-1">
                                <p>
                                  Latest status: <span className="font-medium text-foreground">{activeClaimEvaluation?.claim_status ?? fnol.status ?? "Pending"}</span>
                                </p>
                                <p>
                                  Decision: <span className="font-medium text-foreground">{activeClaimEvaluation?.decision ?? "Pending"}</span>
                                </p>
                                <p>
                                  Reason: <span className="font-medium text-foreground">{activeClaimEvaluation?.reason ?? "No rule-level explanation is currently stored."}</span>
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

              {showDamageAssessmentTab && (
                <TabsContent value="assessment">
                  {damageAssessmentIncompleteNoValuation ? (
                    <Card className="card-elevated">
                      <CardContent className="flex flex-col items-center justify-center gap-4 px-5 py-14 text-center sm:px-6">
                        <AlertTriangle className="h-10 w-10 text-warning" />
                        <div className="space-y-2">
                          <p className="text-base font-semibold">Incomplete DA</p>
                          <p className="max-w-md text-sm text-muted-foreground">
                            No structural damage detected. Manual review required.
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  ) : showDamageAssessmentResultsPanel ? (
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
                              {pipelineMetadata?.confidence_level ? (
                                <p className="text-xs leading-relaxed text-muted-foreground">
                                  Analysis indicates{" "}
                                  {formatConfidenceLabel(
                                    pipelineMetadata.confidence_level
                                  ).toLowerCase()}{" "}
                                  confidence.
                                </p>
                              ) : null}
                            </div>

                            <DamageAssessmentFinancialSummary
                              totalValue={totalValueSummary}
                              insightsLoading={claimInsightsLoading}
                              affectedPartsCount={partBreakdownRowsForAssessment.length}
                            />
                          </div>

                          {shouldRenderAssessmentDecisionBanner && decisionSummary ? (
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
                                {activeClaimEvaluation?.severity ??
                                  activeClaimEvaluation?.llm_severity ??
                                  "—"}
                              </p>
                            </div>

                            <div className="rounded-lg bg-muted/15 p-3.5">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/55">
                                Damages detected
                              </p>
                              {displayDamageTags.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {displayDamageTags.map((damage, idx) => (
                                    <span
                                      key={`${damage}-${idx}`}
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
                                  {activeClaimEvaluation?.reason}
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

                              {shouldShowPartBreakdownTable(
                                totalValueSummary,
                                detailedDamageAssessment
                              ) ? (
                                <div className="overflow-hidden rounded-xl border border-border/45 bg-card/95 shadow-sm">
                                  <div className="border-b border-border/35 bg-muted/10 px-4 py-3 sm:px-5">
                                    <p className="text-sm font-semibold text-foreground">
                                      Damage breakdown by part
                                    </p>
                                    <p className="mt-0.5 text-xs text-muted-foreground">
                                      Line-level repair actions and estimates (totals from valuation
                                      service).
                                    </p>
                                  </div>
                                  {renderDamageBreakdownPageCopy()}
                                </div>
                              ) : null}
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
                  ) : (
                    <Card className="card-elevated">
                      <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                          <Brain className="h-7 w-7 text-primary" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-base font-semibold">Damage Assessment not yet run</p>
                          <p className="max-w-sm text-sm text-muted-foreground">
                            Run Damage Assessment from the button below or in the page header when Business Rule
                            Validation has passed and the workflow unlocks this step.
                          </p>
                        </div>
                        {showRunDamageAssessmentButton && damageAssessmentTabUnlocked ? (
                          <Button
                            type="button"
                            variant="destructive"
                            onClick={handleDamageDetection}
                            disabled={damageDetectionLoading || !damageAssessmentState?.run_allowed}
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
                        ) : null}
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
              )}

              {showClaimEvaluationTab && (
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
                        ) : activeClaimEvaluation ? (
                          <ClaimEvaluationTabContent evaluation={activeClaimEvaluation} />
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
                  <span className="max-w-[11rem] text-right tabular-nums">
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
