import type { ImageFraudResultItem } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import {
  getImageAuthenticityBadgeClasses,
  getImageAuthenticityLabels,
} from "@/lib/imageAuthenticity";
import { cn } from "@/lib/utils";

type Props = {
  result: Pick<
    ImageFraudResultItem,
    | "authenticity_labels"
    | "exif_json"
    | "signals_json"
    | "llm_notes"
    | "fraud_score"
    | "ela_score"
  >;
  className?: string;
};

export function ImageAuthenticityClassificationBadges({
  result,
  className,
}: Props) {
  const labels = getImageAuthenticityLabels(result).sort((left, right) => {
    const priority: Record<string, number> = {
      ai_generated: 0,
      edited: 1,
      stock_internet_sourced: 2,
      staged: 3,
      metadata_stripped: 4,
      needs_review: 5,
      genuine: 6,
    };

    return (priority[left.code] ?? 99) - (priority[right.code] ?? 99);
  });
  if (labels.length === 0) return null;

  const primary = labels[0];
  const secondary = labels[1];
  const hiddenCount = Math.max(0, labels.length - (secondary ? 2 : 1));
  const allLabelsText = labels.map((label) => label.label).join(", ");
  const hiddenLabelsText = labels
    .slice(secondary ? 2 : 1)
    .map((label) => label.label)
    .join(", ");

  return (
    <div
      className={cn("flex flex-wrap items-center gap-2", className)}
      aria-label={`Image authenticity signals: ${allLabelsText}`}
      title={allLabelsText}
    >
      <Badge
        key={primary.code}
        variant="outline"
        className={cn(
          "border px-2.5 py-1 text-[11px] font-semibold shadow-none",
          getImageAuthenticityBadgeClasses(primary.tone)
        )}
      >
        {primary.label}
      </Badge>
      {secondary ? (
        <Badge
          key={secondary.code}
          variant="outline"
          className="border border-border/60 bg-background px-2.5 py-1 text-[11px] font-semibold text-muted-foreground shadow-none"
        >
          {secondary.label}
        </Badge>
      ) : null}
      {hiddenCount > 0 ? (
        <span
          className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground"
          aria-label={`${hiddenCount} additional authenticity signals: ${hiddenLabelsText}`}
          title={hiddenLabelsText}
        >
          +{hiddenCount} more signal{hiddenCount === 1 ? "" : "s"}
        </span>
      ) : null}
      {hiddenCount > 0 ? (
        <span className="sr-only">Additional signals: {hiddenLabelsText}</span>
      ) : null}
    </div>
  );
}
