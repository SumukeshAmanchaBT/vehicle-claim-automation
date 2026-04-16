import { AlertTriangle, Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ClaimDecisionInsight, ImageRiskSummaryBlock } from "@/lib/api";

function compactInsightRowClass(severity: ClaimDecisionInsight["severity"]): string {
  switch (severity) {
    case "critical":
      return "border-l-destructive bg-destructive/[0.06]";
    case "warning":
      return "border-l-warning bg-warning/[0.06]";
    case "info":
      return "border-l-primary bg-primary/[0.04]";
    default:
      return "border-l-border bg-muted/20";
  }
}

function insightIconColor(severity: ClaimDecisionInsight["severity"]): string {
  switch (severity) {
    case "critical":
      return "text-destructive";
    case "warning":
      return "text-warning";
    case "success":
      return "text-success";
    default:
      return "text-primary";
  }
}

type Props = {
  imageRiskSummary: ImageRiskSummaryBlock | null | undefined;
  insights: ClaimDecisionInsight[];
  className?: string;
};

export function buildClaimTopInsightRows(
  imageRiskSummary: ImageRiskSummaryBlock | null | undefined,
  insights: ClaimDecisionInsight[]
): ClaimDecisionInsight[] {
  const imageHighlights = imageRiskSummary?.highlights ?? [];
  const imageHighlightCodes = new Set(imageHighlights.map((item) => item.code));
  const secondaryInsights = insights.filter(
    (item) => !imageHighlightCodes.has(item.code)
  );
  return [...imageHighlights, ...secondaryInsights];
}

/**
 * Compact top-of-claim alert rows. Image-risk-specific highlights come from the
 * dedicated backend image-risk summary; remaining decision insights come from
 * the generic decision summary and are de-duplicated by insight code only.
 */
export function ClaimTopInsightsStrip({
  imageRiskSummary,
  insights,
  className,
}: Props) {
  const rows = buildClaimTopInsightRows(imageRiskSummary, insights);

  if (!rows.length) {
    return null;
  }

  return (
    <div
      data-testid="claim-top-insights-strip"
      className={cn(
        "flex flex-col gap-1.5 border border-border/50 bg-card/80",
        className
      )}
      role="alert"
    >
      {rows.map((insight) => (
        <div
          key={`${insight.code}-${insight.source}`}
          className={cn(
            "flex gap-2.5 border-l-4 px-3 py-2",
            compactInsightRowClass(insight.severity)
          )}
        >
          <AlertTriangle
            className={cn("mt-0.5 h-4 w-4 shrink-0", insightIconColor(insight.severity))}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium leading-snug text-foreground">
                {insight.title}
              </p>
              {insight.blocking ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-destructive">
                  <Lock className="h-3 w-3" aria-hidden />
                  Manual review
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {insight.detail}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
