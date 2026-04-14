import type {
  UseMutationResult,
  UseQueryResult,
} from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { DamageAssessmentStatusChip } from "@/components/damage-assessment/DamageAssessmentStatusChip";
import {
  damageAssessmentCardDetailsKey,
  damageAssessmentCardsKey,
} from "@/components/damage-assessment/damageAssessmentQueryKeys";
import { ApiErrorState } from "@/components/ui/request-state";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getDamageAssessmentCardDetails,
  refreshDamageAssessmentCard,
} from "@/lib/api";
import {
  DAMAGE_ASSESSMENT_CARD_SURFACE_METRIC_COUNT,
  DAMAGE_ASSESSMENT_EVIDENCE_REPEAT_TYPES,
  DAMAGE_ASSESSMENT_EVIDENCE_VISIBLE_PER_REPEAT_TYPE,
  dedupeIdenticalEvidenceItems,
  extractCurrencyCodeFromMetrics,
  filterRedundantKeyTakeaways,
  formatDamageAssessmentConfidenceLine,
  formatDamageAssessmentMetricDisplayValue,
  formatEvidenceSourceLine,
  formatEvidenceTypeLabel,
  formatMetricDisplayLabel,
  isEvidenceDetailProbablyJson,
  parseEvidenceDetailRows,
  prettifyDamageAssessmentHeadline,
  screeningConfigSummaryLine,
} from "@/lib/damageAssessmentPresentation";
import { getApiErrorSummary } from "@/lib/httpClient";
import type {
  DamageAssessmentCardDetails,
  DamageAssessmentEvidenceItem,
  DamageAssessmentMetric,
} from "@/models/damageAssessmentCards";
import { isDamageAssessmentNarrative } from "@/models/damageAssessmentCards";
import { cn } from "@/lib/utils";

function MetricsDl({
  metrics,
  allMetrics,
  variant = "default",
}: {
  metrics: DamageAssessmentMetric[];
  allMetrics: DamageAssessmentMetric[];
  variant?: "default" | "muted";
}) {
  if (!metrics.length) return null;

  const isMuted = variant === "muted";

  return (
    <dl className={cn("space-y-2", isMuted && "text-xs")}>
      {metrics.map((metric, index) => (
        <div
          key={`${metric.label}-${index}`}
          className={cn(
            "flex items-start justify-between gap-4 rounded-md px-1 py-1.5",
            isMuted ? "text-muted-foreground" : "text-sm"
          )}
        >
          <dt
            className={cn(
              "leading-5",
              !isMuted && "text-muted-foreground"
            )}
          >
            {formatMetricDisplayLabel(metric.label)}
          </dt>
          <dd
            className={cn(
              "max-w-[12rem] text-right font-medium leading-5 tabular-nums",
              isMuted ? "text-foreground/80" : "text-foreground"
            )}
          >
            {formatDamageAssessmentMetricDisplayValue(
              metric.label,
              metric.value,
              allMetrics
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function MetricsSection({ metrics }: { metrics: DamageAssessmentMetric[] }) {
  if (!metrics.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No metrics in this response.
      </p>
    );
  }

  const surface = metrics.slice(0, DAMAGE_ASSESSMENT_CARD_SURFACE_METRIC_COUNT);
  const extended = metrics.slice(DAMAGE_ASSESSMENT_CARD_SURFACE_METRIC_COUNT);

  if (extended.length === 0) {
    return (
      <div
        className="rounded-lg bg-muted/15 p-3.5"
        data-testid="da-drawer-metrics-reference-only"
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Same figures as summary card
        </p>
        <div className="mt-3">
          <MetricsDl metrics={surface} allMetrics={metrics} variant="muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Additional detail
        </p>
        <MetricsDl metrics={extended} allMetrics={metrics} variant="default" />
      </div>
      <div className="rounded-lg bg-muted/15 p-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Same figures as summary card
        </p>
        <div className="mt-3">
          <MetricsDl metrics={surface} allMetrics={metrics} variant="muted" />
        </div>
      </div>
    </div>
  );
}

function partitionEvidenceItems(items: DamageAssessmentEvidenceItem[]) {
  const deduped = dedupeIdenticalEvidenceItems(items);
  const visible: DamageAssessmentEvidenceItem[] = [];
  const hidden: DamageAssessmentEvidenceItem[] = [];
  const counts = new Map<string, number>();

  for (const item of deduped) {
    const type = (item.type ?? "").trim().toLowerCase();

    if (DAMAGE_ASSESSMENT_EVIDENCE_REPEAT_TYPES.has(type)) {
      const nextCount = (counts.get(type) ?? 0) + 1;
      counts.set(type, nextCount);

      if (nextCount <= DAMAGE_ASSESSMENT_EVIDENCE_VISIBLE_PER_REPEAT_TYPE) {
        visible.push(item);
      } else {
        hidden.push(item);
      }
    } else {
      visible.push(item);
    }
  }

  return { visible, hidden };
}

function EvidenceDetailBody({
  item,
  currencyCode,
}: {
  item: DamageAssessmentEvidenceItem;
  currencyCode: string | null;
}) {
  const detailText = item.detail?.trim() ?? "";
  const type = (item.type ?? "").trim().toLowerCase();

  if (
    type === "screening_configuration" ||
    (detailText && isEvidenceDetailProbablyJson(detailText))
  ) {
    const intro =
      type === "screening_configuration"
        ? screeningConfigSummaryLine()
        : "Structured values from stored records; open below only if you need the raw text.";

    return (
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
        <p>{intro}</p>
        {detailText ? (
          <details className="rounded-lg border border-border/40 bg-background/60 px-3 py-2 text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              Raw values
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-muted-foreground">
              {detailText}
            </pre>
          </details>
        ) : null}
      </div>
    );
  }

  const rows = detailText ? parseEvidenceDetailRows(detailText, currencyCode) : [];

  if (rows.length > 0) {
    return (
      <ul className="mt-3 space-y-2 text-sm">
        {rows.map((row, index) => (
          <li
            key={`${row.label}-${index}`}
            className="flex items-start justify-between gap-3 rounded-lg bg-background/70 px-3 py-2.5"
          >
            <span className="leading-5 text-muted-foreground">{row.label}</span>
            <span className="max-w-[11rem] text-right font-medium leading-5 text-foreground tabular-nums">
              {row.value}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  if (!detailText) return null;

  return (
    <p className="mt-3 break-words text-sm leading-6 text-muted-foreground">
      {detailText}
    </p>
  );
}

function EvidenceList({
  items,
  metrics,
}: {
  items: DamageAssessmentEvidenceItem[];
  metrics: DamageAssessmentMetric[];
}) {
  if (!items.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No evidence rows on file.
      </p>
    );
  }

  const currencyCode = extractCurrencyCodeFromMetrics(metrics);
  const { visible, hidden } = partitionEvidenceItems(items);
  const overflowVerb =
    hidden.length > 0 &&
    hidden.every((item) => (item.type ?? "").toLowerCase() === "llm_authenticity_notes")
      ? "note"
      : "row";

  return (
    <div className="space-y-4">
      <ul className="space-y-4">
        {visible.map((item, index) => {
          const typeLabel = formatEvidenceTypeLabel(item.type);
          const sourceLine = formatEvidenceSourceLine(item.source);
          const type = (item.type ?? "").trim().toLowerCase();
          const redundantChip =
            type === "llm_authenticity_notes" &&
            /authenticity/i.test(item.label ?? "");

          return (
            <li
              key={`${item.type}-${item.label}-${index}`}
              className="rounded-xl border border-border/60 bg-background/80 px-4 py-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <span className="text-sm font-semibold leading-6 text-foreground">
                  {item.label || typeLabel || "Evidence item"}
                </span>
                {typeLabel && !redundantChip ? (
                  <span className="rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {typeLabel}
                  </span>
                ) : null}
              </div>
              <EvidenceDetailBody item={item} currencyCode={currencyCode} />
              {sourceLine ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-[11px] text-muted-foreground">
                    Record source
                  </summary>
                  <p className="mt-2 border-l border-border/40 pl-3 text-[11px] leading-5 text-muted-foreground">
                    {sourceLine}
                  </p>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>

      {hidden.length > 0 ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 px-2 text-xs text-muted-foreground"
              data-testid="da-drawer-evidence-more-similar"
            >
              {hidden.length} more {overflowVerb}
              {hidden.length === 1 ? "" : "s"} — show
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2">
            {hidden.map((item, index) => (
              <div
                key={`hidden-${item.type}-${index}`}
                className="rounded-lg border border-dashed border-border/50 bg-muted/10 px-3 py-3 text-xs text-muted-foreground"
              >
                {item.label ? (
                  <p className="font-medium text-foreground/90">{item.label}</p>
                ) : null}
                {item.detail ? (
                  <p className="mt-1.5 break-words whitespace-pre-wrap leading-5">
                    {item.detail}
                  </p>
                ) : null}
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

function narrativeLineKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

type NarrativeRenderModel = {
  summary: string;
  whyFiltered: string[];
  filteredTakeaways: string[];
  recommended_attention: string;
};

function getNarrativeRenderModel(
  detail: DamageAssessmentCardDetails
): NarrativeRenderModel | null {
  const narrative = detail.narrative;
  if (!isDamageAssessmentNarrative(narrative)) return null;

  const caveatKeys = new Set(
    (detail.caveats ?? []).map((caveat) => narrativeLineKey(caveat))
  );

  const whyFiltered = narrative.why_it_matters
    .filter((line) => String(line).trim().length > 0)
    .filter((line) => !caveatKeys.has(narrativeLineKey(String(line))));

  const filteredTakeaways = filterRedundantKeyTakeaways(
    narrative.key_takeaways.filter((line) => String(line).trim().length > 0),
    detail.metrics
  );

  const hasSummary = narrative.summary.trim().length > 0;
  const hasRecommendation = narrative.recommended_attention.trim().length > 0;

  if (
    !hasSummary &&
    whyFiltered.length === 0 &&
    filteredTakeaways.length === 0 &&
    !hasRecommendation
  ) {
    return null;
  }

  return {
    summary: narrative.summary.trim(),
    whyFiltered,
    filteredTakeaways,
    recommended_attention: narrative.recommended_attention.trim(),
  };
}

function NarrativeBody({ model }: { model: NarrativeRenderModel }) {
  const hasSummary = model.summary.length > 0;
  const hasWhy = model.whyFiltered.length > 0;
  const hasTakeaways = model.filteredTakeaways.length > 0;
  const hasRecommendation = model.recommended_attention.length > 0;

  return (
    <div className="space-y-4 rounded-lg bg-muted/10 p-4 text-sm sm:p-5">
      {hasSummary ? (
        <p className="text-sm font-medium leading-7 text-foreground/95">
          {model.summary}
        </p>
      ) : null}

      {hasWhy ? (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Why it matters
          </p>
          <ul className="list-disc space-y-2 pl-4 text-sm leading-6 text-muted-foreground">
            {model.whyFiltered.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasTakeaways ? (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Key takeaways
          </p>
          <ul className="list-disc space-y-2 pl-4 text-sm leading-6 text-muted-foreground">
            {model.filteredTakeaways.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasRecommendation ? (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Recommended attention
          </p>
          <p className="text-sm leading-6 text-foreground/90">
            {model.recommended_attention}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function PanelSectionTitle({ children }: { children: string }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/55">
      {children}
    </h3>
  );
}

function PanelSectionCard({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "space-y-3 rounded-lg border border-border/35 bg-muted/10 p-4 sm:p-5",
        className
      )}
    >
      <PanelSectionTitle>{title}</PanelSectionTitle>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function SummaryGuidanceSection({ detail }: { detail: DamageAssessmentCardDetails }) {
  const model = getNarrativeRenderModel(detail);
  if (!model) return null;

  return (
    <PanelSectionCard title="Summary & guidance">
      <NarrativeBody model={model} />
    </PanelSectionCard>
  );
}

function ClaimContextStrip({
  ctx,
}: {
  ctx: DamageAssessmentCardDetails["claim_context"];
}) {
  const rows: { label: string; value: string }[] = [];

  const add = (label: string, value: string | null | undefined) => {
    if (value != null && String(value).trim() !== "") {
      rows.push({ label, value: String(value) });
    }
  };

  add("Registration", ctx.registration);
  add("Policy", ctx.policy_number);
  add("Make / model / year", ctx.make_model_year);
  add("VIN", ctx.vin);

  if (ctx.overlap_summary) add("Overlap (context)", ctx.overlap_summary);
  if (ctx.claim_reported_context) {
    add("Reported context", ctx.claim_reported_context);
  }

  if (!rows.length) {
    return null;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.map((row) => (
        <div
          key={row.label}
          className="rounded-md bg-background/60 px-3 py-2.5"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {row.label}
          </p>
          <p className="mt-1.5 text-sm font-medium leading-6 text-foreground">
            {row.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}

function DetailsPanelPlaceholder() {
  return (
    <div className="rounded-lg border border-dashed border-border/45 bg-muted/10 px-4 py-5">
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/55">
          Review workspace
        </p>
        <h3 className="text-base font-semibold text-foreground">
          Select a summary card to inspect grounded evidence
        </h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Details open here so reviewers can compare the evidence without
          leaving the claim page.
        </p>
      </div>
    </div>
  );
}

type DetailPanelMode = "sheet" | "embedded";

type PanelBodyProps = {
  cardKey: string;
  detail: DamageAssessmentCardDetails | undefined;
  detailQuery: UseQueryResult<DamageAssessmentCardDetails>;
  refreshMutation: UseMutationResult<
    DamageAssessmentCardDetails,
    Error,
    void,
    unknown
  >;
  enabled: boolean;
  mode: DetailPanelMode;
  onOpenChange: (open: boolean) => void;
  supplementaryContent?: ReactNode;
};

function DetailsPanelBody({
  cardKey,
  detail,
  detailQuery,
  refreshMutation,
  enabled,
  mode,
  onOpenChange,
  supplementaryContent,
}: PanelBodyProps) {
  const errSummary = detailQuery.error
    ? getApiErrorSummary(detailQuery.error)
    : null;
  const claimContext = detail ? <ClaimContextStrip ctx={detail.claim_context} /> : null;

  return (
    <div className="flex min-h-full flex-col p-4 sm:p-5">
      <div className="space-y-3 pr-8 sm:pr-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Assessment details
            </p>
            <h2 className="text-lg font-semibold leading-tight text-foreground">
              {detail?.title ?? cardKey.replace(/_/g, " ")}
            </h2>
          </div>
          {detail ? <DamageAssessmentStatusChip status={detail.status} /> : null}
        </div>

        {detail?.headline ? (
          <p className="text-sm leading-6 text-muted-foreground">
            {prettifyDamageAssessmentHeadline(detail.headline, detail.metrics)}
          </p>
        ) : null}

        {detail ? (
          <p className="text-sm text-muted-foreground">
            {formatDamageAssessmentConfidenceLine(
              detail.confidence,
              detail.card_key,
              detail.metrics
            )}
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-muted/15 px-2 py-2">
        <Button
          id="da-drawer-refresh"
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!enabled || refreshMutation.isPending}
          aria-busy={refreshMutation.isPending}
          onClick={() => refreshMutation.mutate()}
        >
          {refreshMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Refresh from server
        </Button>

        {mode === "embedded" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => onOpenChange(false)}
          >
            Clear selection
          </Button>
        ) : null}

        {refreshMutation.isError ? (
          <span className="text-xs text-destructive">
            Refresh failed — try again.
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3 pb-1">
        {detailQuery.isLoading ? <DrawerSkeleton /> : null}

        {detailQuery.isError && errSummary ? (
          <ApiErrorState
            title="Could not load card details"
            error={errSummary}
            onRetry={() => detailQuery.refetch()}
          />
        ) : null}

        {detail ? (
          <>
            {claimContext ? (
              <PanelSectionCard title="Claim context">{claimContext}</PanelSectionCard>
            ) : null}

            <SummaryGuidanceSection detail={detail} />

            <PanelSectionCard title="Evidence">
              <EvidenceList items={detail.evidence} metrics={detail.metrics} />
            </PanelSectionCard>

            {detail.caveats?.length ? (
              <PanelSectionCard title="Caveats">
                <Collapsible defaultOpen={mode === "sheet" || mode === "embedded"}>
                  <CollapsibleTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 w-full justify-between rounded-md bg-muted/20 px-3 text-xs font-medium text-muted-foreground hover:bg-muted/35"
                    >
                      <span>Reviewer caveats</span>
                      <span className="text-[10px] opacity-70">
                        {detail.caveats.length} item
                        {detail.caveats.length === 1 ? "" : "s"}
                      </span>
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-3">
                    <ul className="list-disc space-y-2 pl-4 text-sm leading-6 text-muted-foreground">
                      {detail.caveats.map((caveat, index) => (
                        <li key={index} className="break-words">
                          {caveat}
                        </li>
                      ))}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              </PanelSectionCard>
            ) : null}

            <PanelSectionCard title="Figures & metrics">
              <Collapsible defaultOpen={mode === "sheet" || mode === "embedded"}>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 w-full justify-between rounded-md bg-muted/20 px-3 text-xs font-medium text-muted-foreground hover:bg-muted/35"
                    data-testid="da-drawer-metrics-toggle"
                  >
                    <span>Figures & metrics</span>
                    <span className="text-[10px] opacity-70">
                      {detail.metrics.length} field
                      {detail.metrics.length === 1 ? "" : "s"}
                    </span>
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                  <MetricsSection metrics={detail.metrics} />
                </CollapsibleContent>
              </Collapsible>
            </PanelSectionCard>

            {detail.unsupported_fields?.length ? (
              <PanelSectionCard title="Stored data limits">
                <Collapsible defaultOpen={false}>
                  <CollapsibleTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 w-full justify-between rounded-md bg-muted/20 px-3 text-xs font-medium text-muted-foreground hover:bg-muted/35"
                      data-testid="da-drawer-unsupported-toggle"
                    >
                      <span>Not available from stored records</span>
                      <span className="text-[10px] opacity-70">
                        {detail.unsupported_fields.length} field
                        {detail.unsupported_fields.length === 1 ? "" : "s"}
                      </span>
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-3">
                    <p className="text-sm leading-6 text-muted-foreground">
                      {detail.unsupported_fields
                        .map((field) =>
                          formatMetricDisplayLabel(field.replace(/\./g, "_"))
                        )
                        .join(" · ")}
                    </p>
                  </CollapsibleContent>
                </Collapsible>
              </PanelSectionCard>
            ) : null}

            {detail.insight?.persisted_error &&
            Object.keys(detail.insight.persisted_error).length > 0 ? (
              <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">
                Persisted insight error — see operational logs.
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {supplementaryContent ? (
        <div className="mt-6 border-t border-border/35 pt-6">{supplementaryContent}</div>
      ) : null}
    </div>
  );
}

type Props = {
  complaintId: string;
  cardKey: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: DetailPanelMode;
  className?: string;
  /** Extra blocks (e.g. per-photo findings, part breakdown) merged below API detail — same for sheet & embedded */
  supplementaryContent?: ReactNode;
};

export function DamageAssessmentDetailsDrawer({
  complaintId,
  cardKey,
  open,
  onOpenChange,
  mode = "sheet",
  className,
  supplementaryContent,
}: Props) {
  const queryClient = useQueryClient();
  const enabled = Boolean(open && complaintId && cardKey);

  const detailQuery = useQuery({
    queryKey:
      cardKey && complaintId
        ? damageAssessmentCardDetailsKey(complaintId, cardKey)
        : ["damage-assessment-card-details", "idle"],
    queryFn: () =>
      getDamageAssessmentCardDetails(complaintId, cardKey as string),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const refreshMutation = useMutation({
    mutationFn: () => refreshDamageAssessmentCard(complaintId, cardKey as string),
    onError: (error) => {
      if (import.meta.env.DEV) {
        console.warn("[vca] damage-assessment refresh failed", error);
      }
    },
    onSuccess: (data) => {
      if (!cardKey) return;

      queryClient.setQueryData(
        damageAssessmentCardDetailsKey(complaintId, cardKey),
        data
      );
      queryClient.invalidateQueries({
        queryKey: damageAssessmentCardsKey(complaintId),
      });
    },
  });

  useEffect(() => {
    if (mode !== "embedded" || !open || !cardKey) return;
    const id = requestAnimationFrame(() => {
      document.getElementById("da-drawer-refresh")?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [mode, open, cardKey, detailQuery.isSuccess]);

  if (mode === "embedded") {
    return (
      <div
        data-testid="damage-assessment-drawer"
        className={cn(
          "w-full rounded-2xl border border-border/50 bg-card/95 p-0 shadow-sm ring-1 ring-border/20 backdrop-blur-sm",
          className
        )}
      >
        {open && cardKey ? (
          <DetailsPanelBody
            cardKey={cardKey}
            detail={detailQuery.data}
            detailQuery={detailQuery}
            refreshMutation={refreshMutation}
            enabled={enabled}
            mode="embedded"
            onOpenChange={onOpenChange}
            supplementaryContent={supplementaryContent}
          />
        ) : (
          <div className="p-5 sm:p-6">
            <DetailsPanelPlaceholder />
          </div>
        )}
      </div>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        data-testid="damage-assessment-drawer"
        className={cn("w-full min-w-0 overflow-y-auto p-0 sm:max-w-2xl", className)}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() => {
            document.getElementById("da-drawer-refresh")?.focus();
          });
        }}
      >
        <div className="sr-only">
          <SheetTitle>
            {cardKey ? `${cardKey.replace(/_/g, " ")} details` : "Assessment details"}
          </SheetTitle>
          <SheetDescription>
            Grounded backend detail for the selected damage-assessment card.
          </SheetDescription>
        </div>
        {cardKey ? (
          <DetailsPanelBody
            cardKey={cardKey}
            detail={detailQuery.data}
            detailQuery={detailQuery}
            refreshMutation={refreshMutation}
            enabled={enabled}
            mode="sheet"
            onOpenChange={onOpenChange}
            supplementaryContent={supplementaryContent}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
