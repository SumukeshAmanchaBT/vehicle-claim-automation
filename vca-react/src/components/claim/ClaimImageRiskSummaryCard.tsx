import { AlertTriangle } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ImageRiskCategorySummary, ImageRiskSummaryBlock } from "@/lib/api";
import { cn } from "@/lib/utils";

function cardToneClasses(tone?: string) {
  switch (tone) {
    case "critical":
      return {
        card: "border-destructive/45 bg-destructive/5",
        iconBox: "bg-destructive/15",
        icon: "text-destructive",
        headline: "text-destructive",
      };
    case "warning":
      return {
        card: "border-warning/45 bg-warning/5",
        iconBox: "bg-warning/15",
        icon: "text-warning",
        headline: "text-warning",
      };
    case "success":
      return {
        card: "border-success/45 bg-success/5",
        iconBox: "bg-success/15",
        icon: "text-success",
        headline: "text-success",
      };
    default:
      return {
        card: "border-primary/25 bg-primary/[0.04]",
        iconBox: "bg-primary/10",
        icon: "text-primary",
        headline: "text-foreground",
      };
  }
}

function categoryToneClasses(category: ImageRiskCategorySummary): string {
  if (category.blocking || category.severity === "critical") {
    return "border-destructive/35 bg-destructive/10 text-destructive";
  }
  if (category.severity === "warning") {
    return "border-warning/35 bg-warning/10 text-warning";
  }
  return "border-border bg-muted/45 text-foreground";
}

type Props = {
  imageRiskSummary: ImageRiskSummaryBlock | null | undefined;
  className?: string;
};

export function ClaimImageRiskSummaryCard({
  imageRiskSummary,
  className,
}: Props) {
  const summaryCard = imageRiskSummary?.summary_card;
  if (!imageRiskSummary || !summaryCard) {
    return null;
  }

  const categories = imageRiskSummary.categories ?? [];
  const extra = imageRiskSummary.additional_category_count ?? 0;
  const toneClasses = cardToneClasses(summaryCard.tone);

  return (
    <Card
      data-testid="claim-image-risk-card"
      className={cn("card-elevated border-2", toneClasses.card, className)}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
              toneClasses.iconBox
            )}
          >
            <AlertTriangle className={cn("h-5 w-5", toneClasses.icon)} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">{summaryCard.title}</p>
            <p className={cn("text-xl font-bold", toneClasses.headline)}>
              {summaryCard.headline}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {summaryCard.detail}
            </p>
          </div>
        </div>

        {categories.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {categories.map((category) => (
              <Badge
                key={category.code}
                variant="outline"
                className={cn(
                  "max-w-full px-2 py-0.5 text-[10px] font-medium",
                  categoryToneClasses(category)
                )}
                title={category.title}
              >
                <span className="truncate">{category.label}</span>
              </Badge>
            ))}
            {extra > 0 ? (
              <Badge variant="secondary" className="text-[10px] font-medium">
                +{extra} more
              </Badge>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
