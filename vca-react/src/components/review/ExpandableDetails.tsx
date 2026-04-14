import { type ReactNode } from "react";
import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ExpandableDetailsTone =
  | "default"
  | "info"
  | "success"
  | "warning"
  | "destructive";

type ExpandableDetailsProps = {
  children?: ReactNode;
  summary?: ReactNode;
  summaryItems?: string[];
  className?: string;
  summaryClassName?: string;
  contentClassName?: string;
  previewTone?: ExpandableDetailsTone;
  previewLabel?: string;
  previewMeta?: ReactNode;
  hideHeader?: boolean;
};

const toneStyles: Record<
  ExpandableDetailsTone,
  {
    shell: string;
    badge: string;
    summaryDot: string;
  }
> = {
  default: {
    shell: "border-border/45 bg-gradient-to-br from-background via-background to-muted/15",
    badge: "border-primary/15 bg-primary/10 text-primary",
    summaryDot: "bg-primary/60",
  },
  info: {
    shell: "border-info/20 bg-gradient-to-br from-info/5 via-background to-background",
    badge: "border-info/20 bg-info/10 text-info",
    summaryDot: "bg-info/70",
  },
  success: {
    shell: "border-success/20 bg-gradient-to-br from-success/5 via-background to-background",
    badge: "border-success/20 bg-success/10 text-success",
    summaryDot: "bg-success/70",
  },
  warning: {
    shell: "border-warning/25 bg-gradient-to-br from-warning/5 via-background to-background",
    badge: "border-warning/20 bg-warning/10 text-warning",
    summaryDot: "bg-warning/80",
  },
  destructive: {
    shell:
      "border-destructive/25 bg-gradient-to-br from-destructive/5 via-background to-background",
    badge: "border-destructive/20 bg-destructive/10 text-destructive",
    summaryDot: "bg-destructive/80",
  },
};

export function ExpandableDetails({
  children,
  summary,
  summaryItems = [],
  className,
  summaryClassName,
  contentClassName,
  previewTone = "default",
  previewLabel = "Review details",
  previewMeta,
  hideHeader = false,
}: ExpandableDetailsProps) {
  const tone = toneStyles[previewTone];

  const summaryContent =
    summary ??
    (summaryItems.length > 0 ? (
      <ul className="space-y-2">
        {summaryItems.map((item, index) => (
          <li key={`${item}-${index}`} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className={cn("mt-2 h-1.5 w-1.5 shrink-0 rounded-full", tone.summaryDot)}
            />
            <span className="text-sm leading-6 text-foreground/90">{item}</span>
          </li>
        ))}
      </ul>
    ) : null);

  return (
    <div
      className={cn(
        hideHeader
          ? "rounded-lg border border-border/40 bg-background/80"
          : "rounded-xl border border-border/50 shadow-sm",
        tone.shell,
        className
      )}
    >
      <div className={cn("space-y-3", hideHeader ? "p-3" : "p-4")}>
        {!hideHeader ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={cn("gap-1.5 font-medium", tone.badge)}>
                  <Sparkles className="h-3 w-3" />
                  {previewLabel}
                </Badge>
                {previewMeta ? (
                  <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    {previewMeta}
                  </span>
                ) : null}
              </div>
              <div className={cn("min-w-0", summaryClassName)}>
                {summaryContent}
              </div>
            </div>
          </div>
        ) : null}

        {!hideHeader && children ? (
          <div className="border-t border-border/40 pt-3">
            <div
              className={cn(
                "rounded-lg border border-border/35 bg-muted/10 p-3.5 sm:p-4",
                contentClassName
              )}
            >
              {children}
            </div>
          </div>
        ) : null}

        {hideHeader ? (
          <div className={cn("min-w-0", summaryClassName, contentClassName)}>
            {summaryContent ?? children}
          </div>
        ) : null}
      </div>
    </div>
  );
}
