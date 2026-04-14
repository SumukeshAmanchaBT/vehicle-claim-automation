import { DamageAssessmentStatusChip } from "@/components/damage-assessment/DamageAssessmentStatusChip";
import type { DamageAssessmentCardSummary as CardSummary } from "@/models/damageAssessmentCards";
import {
  DAMAGE_ASSESSMENT_SUMMARY_SECONDARY_CAP,
  formatDamageAssessmentMetricDisplayValue,
  formatMetricDisplayLabel,
  prettifyDamageAssessmentHeadline,
} from "@/lib/damageAssessmentPresentation";
import { cn } from "@/lib/utils";

type Props = {
  card: CardSummary;
  onViewDetails: (cardKey: string) => void;
  isSelected?: boolean;
  className?: string;
};

export function DamageAssessmentCardSummaryView({
  card,
  onViewDetails,
  isSelected = false,
  className,
}: Props) {
  const { primary_metric, secondary_metrics } = card;
  const metricsForFormat = [
    primary_metric,
    ...(secondary_metrics ?? []),
  ].filter(Boolean);
  const secondaries = (secondary_metrics ?? []).slice(
    0,
    DAMAGE_ASSESSMENT_SUMMARY_SECONDARY_CAP
  );

  const headline = prettifyDamageAssessmentHeadline(
    card.headline || "",
    metricsForFormat
  );

  return (
    <button
      type="button"
      data-testid={`da-summary-card-${card.card_key}`}
      className={cn(
        "flex h-full min-h-[12.5rem] w-full flex-col rounded-xl border bg-card p-4 text-left shadow-sm transition-shadow outline-none",
        "hover:border-primary/35 hover:shadow-md",
        "focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2",
        isSelected
          ? "border-primary/50 bg-primary/[0.04] shadow-md ring-2 ring-primary/25"
          : "border-border/60",
        card.status === "failed" && "border-destructive/30 bg-destructive/5",
        card.status === "critical" && "border-destructive/25",
        card.status === "warning" && "border-amber-500/25",
        !card.view_details_enabled && "cursor-not-allowed opacity-70",
        className
      )}
      disabled={!card.view_details_enabled}
      {...(isSelected ? { "aria-current": "true" as const } : {})}
      aria-label={`View details for ${card.title}`}
      onClick={() => {
        if (card.view_details_enabled) onViewDetails(card.card_key);
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[15px] font-semibold leading-snug text-foreground">
          {card.title}
        </p>
        <DamageAssessmentStatusChip status={card.status} />
      </div>
      <p className="mt-2.5 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
        {headline || "—"}
      </p>
      <div className="mt-3 rounded-lg bg-muted/25 px-3 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {formatMetricDisplayLabel(primary_metric?.label ?? "")}
        </p>
        <p className="mt-1.5 text-2xl font-semibold leading-none tabular-nums">
          {formatDamageAssessmentMetricDisplayValue(
            primary_metric?.label ?? "",
            primary_metric?.value,
            metricsForFormat
          )}
        </p>
      </div>
      {secondaries.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-border/40 pt-2.5 text-xs text-muted-foreground">
          {secondaries.map((m, i) => (
            <li
              key={`${m.label}-${i}`}
              className="flex items-start justify-between gap-3"
            >
              <span className="truncate leading-5 text-foreground/85">
                {formatMetricDisplayLabel(m.label)}
              </span>
              <span className="shrink-0 text-right font-medium text-foreground tabular-nums">
                {formatDamageAssessmentMetricDisplayValue(
                  m.label,
                  m.value,
                  metricsForFormat
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <span
        className={cn(
          "mt-auto pt-3 text-sm font-medium",
          isSelected ? "text-primary" : "text-primary/90"
        )}
        data-testid={`da-view-details-${card.card_key}`}
      >
        {isSelected ? "Viewing details" : "View details →"}
      </span>
    </button>
  );
}
