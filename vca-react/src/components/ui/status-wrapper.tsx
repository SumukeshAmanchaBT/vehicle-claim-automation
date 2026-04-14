import { useEffect, useRef, useState, type ReactNode } from "react";

import type { ApiErrorSummary } from "@/lib/httpClient";
import { DEFAULT_TIMEOUT_MS } from "@/lib/httpClient";

import { ApiErrorState, ApiLoadingState } from "@/components/ui/request-state";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Status = "loading" | "error" | "success";

export type StatusWrapperProps = {
  status: Status;
  /** Shown while loading (skeleton layout). */
  loading: ReactNode;
  /** After this many ms in "loading" state, replace the skeleton with the
   *  animated ApiLoadingState progress bar. Defaults to 3 000 ms. */
  loadingFallbackMs?: number;
  /** Title shown inside ApiLoadingState when the skeleton fallback triggers. */
  loadingTitle?: string;
  /** Description inside the ApiLoadingState fallback. */
  loadingDescription?: string;
  /** Timeout budget forwarded to the ApiLoadingState progress bar. */
  timeoutMs?: number;
  /** Error card title (e.g. "Could not load dashboard"). */
  errorTitle?: string;
  error?: ApiErrorSummary | null;
  onRetry?: () => void;
  children: ReactNode;
};

/**
 * Unified page-region wrapper: skeleton loading → animated progress (on slow loads),
 * standardized error card, or success content.
 *
 * Lifecycle:
 *   1. Immediately renders the `loading` skeleton for the first `loadingFallbackMs` ms.
 *   2. If still loading after that threshold, swaps to `ApiLoadingState` so users see
 *      a progress bar + elapsed timer instead of an unresponsive skeleton.
 *   3. On error: shows `ApiErrorState` with developer details hidden in an accordion.
 *   4. On success: renders `children`.
 */
export function StatusWrapper({
  status,
  loading,
  loadingFallbackMs = 3_000,
  loadingTitle = "Loading…",
  loadingDescription,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  errorTitle = "Something went wrong",
  error,
  onRetry,
  children,
}: StatusWrapperProps) {
  const [showProgress, setShowProgress] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (status !== "loading") {
      setShowProgress(false);
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }
    // Reset: start fresh every time we enter loading state
    setShowProgress(false);
    timerRef.current = setTimeout(() => setShowProgress(true), loadingFallbackMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [status, loadingFallbackMs]);

  if (status === "loading") {
    return showProgress ? (
      <ApiLoadingState
        title={loadingTitle}
        description={loadingDescription}
        timeoutMs={timeoutMs}
      />
    ) : (
      <>{loading}</>
    );
  }

  if (status === "error" && error) {
    return (
      <ApiErrorState title={errorTitle} error={error} onRetry={onRetry} />
    );
  }

  return <>{children}</>;
}

/** Default skeleton block for dashboard-style pages (metrics + panels). */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading content">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="space-y-3 p-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="space-y-3 p-6">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-[220px] w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 p-6">
          <Skeleton className="h-5 w-56" />
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Skeleton for claims list table + toolbar. */
export function ClaimsListSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading claims">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-10 w-40" />
      </div>
      <Card>
        <CardContent className="space-y-2 p-4">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/** Skeleton for fraud review (summary cards + filters + table header). */
export function FraudReviewSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading fraud review">
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="space-y-3 p-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-8 w-12" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="flex flex-col gap-4 p-4 lg:flex-row">
          <Skeleton className="h-10 w-full max-w-xl" />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-28" />
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-2 p-4">
          <Skeleton className="h-8 w-48" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/** Generic table skeleton for list pages (invoice history, reports, etc.). */
export function TablePageSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading data">
      <Skeleton className="h-10 w-full max-w-md" />
      <Card>
        <CardContent className="space-y-2 p-4">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
