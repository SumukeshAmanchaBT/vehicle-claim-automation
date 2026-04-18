import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { DamageAssessmentCardSummaryView } from "@/components/damage-assessment/DamageAssessmentCardSummary";
import { DamageAssessmentDetailsDrawer } from "@/components/damage-assessment/DamageAssessmentDetailsDrawer";
import { damageAssessmentCardsKey } from "@/components/damage-assessment/damageAssessmentQueryKeys";
import { ApiErrorState } from "@/components/ui/request-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { getDamageAssessmentCards } from "@/lib/api";
import { claimScopedQueryDefaults } from "@/lib/claimScopedCache";
import { getApiErrorSummary } from "@/lib/httpClient";
import type { DamageAssessmentCardSummary } from "@/models/damageAssessmentCards";
import { cn } from "@/lib/utils";

/** Preferred display order for summary cards (backend may return any order). */
const DAMAGE_ASSESSMENT_CARD_ORDER = [
  "image_authenticity",
  "duplicate_screening",
  "estimated_value",
  "damage_detection",
] as const;

function sortCardsByContractOrder(
  cards: DamageAssessmentCardSummary[]
): (DamageAssessmentCardSummary | null)[] {
  const byKey = new Map(cards.map((card) => [card.card_key, card]));
  return DAMAGE_ASSESSMENT_CARD_ORDER.map((key) => byKey.get(key) ?? null);
}

function MissingSummarySlot({ cardKey }: { cardKey: string }) {
  const label = cardKey.replace(/_/g, " ");
  return (
    <div className="flex h-full min-h-[14rem] flex-col rounded-xl border border-dashed border-muted-foreground/30 bg-muted/10 p-5">
      <p className="text-[15px] font-semibold capitalize text-foreground">
        {label}
      </p>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        This summary was not returned for this claim.
      </p>
      <p className="mt-auto pt-5 text-sm text-muted-foreground">
        View details is unavailable until the service returns this card.
      </p>
    </div>
  );
}

function SummaryCardGrid({
  ordered,
  activeCardKey,
  onViewDetails,
}: {
  ordered: (DamageAssessmentCardSummary | null)[];
  activeCardKey: string | null;
  onViewDetails: (cardKey: string) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 md:items-stretch">
      {ordered.map((card, idx) =>
        card ? (
          <DamageAssessmentCardSummaryView
            key={card.card_key}
            card={card}
            isSelected={activeCardKey === card.card_key}
            onViewDetails={onViewDetails}
          />
        ) : (
          <MissingSummarySlot
            key={`missing-${DAMAGE_ASSESSMENT_CARD_ORDER[idx]}`}
            cardKey={DAMAGE_ASSESSMENT_CARD_ORDER[idx]}
          />
        )
      )}
    </div>
  );
}

function SummaryGridSkeleton() {
  return (
    <div className="grid gap-5 md:grid-cols-2 md:items-stretch">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="flex min-h-[14rem] flex-col rounded-xl border bg-card p-5 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <Skeleton className="mt-4 h-12 w-full" />
          <Skeleton className="mt-4 h-16 w-full rounded-xl" />
          <Skeleton className="mt-auto h-5 w-24" />
        </div>
      ))}
    </div>
  );
}

type Props = {
  complaintId: string;
  /** Controlled selection — parent owns state for the unified findings area below the grid on desktop */
  selectedCardKey: string | null;
  onSelectedCardKeyChange: (
    key: string | null,
    card?: DamageAssessmentCardSummary | null
  ) => void;
  /** Merged below API detail in the mobile sheet (image authenticity / damage detection) */
  supplementaryContent?: ReactNode;
  className?: string;
};

export function DamageAssessmentCardsPanel({
  complaintId,
  selectedCardKey,
  onSelectedCardKeyChange,
  supplementaryContent,
  className,
}: Props) {
  const isMobile = useIsMobile();

  const cardsQuery = useQuery({
    queryKey: damageAssessmentCardsKey(complaintId),
    queryFn: () => getDamageAssessmentCards(complaintId),
    enabled: Boolean(complaintId),
    ...claimScopedQueryDefaults,
  });

  const ordered = useMemo(
    () =>
      cardsQuery.data?.cards?.length
        ? sortCardsByContractOrder(cardsQuery.data.cards)
        : [],
    [cardsQuery.data?.cards]
  );

  const errSummary = cardsQuery.error
    ? getApiErrorSummary(cardsQuery.error)
    : null;

  const openDetails = (cardKey: string) => {
    const card =
      ordered.find((c) => c?.card_key === cardKey) ?? null;
    onSelectedCardKeyChange(cardKey, card);
  };

  const onDrawerOpenChange = (open: boolean) => {
    if (!open) {
      onSelectedCardKeyChange(null);
    }
  };

  return (
    <div
      className={cn("space-y-5", className)}
      data-testid="damage-assessment-cards-panel"
    >
      {cardsQuery.isLoading ? <SummaryGridSkeleton /> : null}

      {cardsQuery.isError && errSummary ? (
        <ApiErrorState
          title="Could not load damage assessment cards"
          error={errSummary}
          onRetry={() => cardsQuery.refetch()}
        />
      ) : null}

      {cardsQuery.isSuccess && ordered.length > 0 ? (
        <>
          <SummaryCardGrid
            ordered={ordered}
            activeCardKey={selectedCardKey}
            onViewDetails={openDetails}
          />
          {isMobile ? (
            <DamageAssessmentDetailsDrawer
              complaintId={complaintId}
              cardKey={selectedCardKey}
              open={Boolean(selectedCardKey)}
              onOpenChange={onDrawerOpenChange}
              mode="sheet"
              supplementaryContent={supplementaryContent}
            />
          ) : null}
        </>
      ) : null}

      {cardsQuery.isSuccess && ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No damage assessment summary cards were returned for this claim.
        </p>
      ) : null}
    </div>
  );
}
