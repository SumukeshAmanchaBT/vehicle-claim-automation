import type { FnolResponse } from "@/models/fnol";

import {
  inferCurrencyCode,
  inferCurrencyLocale,
  formatCurrency,
} from "@/lib/market";
import {
  isClaimAutoApprovedStatus,
  isClaimManualProcessingStatus,
  normalizeClaimStatus,
} from "@/lib/claimStatus";

export type ProcessingTimePoint = {
  week: string;
  automated: number | null;
  manual: number | null;
};

type ProcessingSample = {
  hours: number;
  resolvedAt: Date;
  bucket: "automated" | "manual";
};

function parseDate(value?: string | null): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfIsoWeek(value: Date): Date {
  const date = new Date(value);
  const weekday = (date.getDay() + 6) % 7;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - weekday);
  return date;
}

function getWeekLabel(value: Date): string {
  return value.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function getClaimCreatedAt(claim: FnolResponse): Date | null {
  return parseDate(
    claim.created_date ??
      claim.incident_date_time ??
      claim.raw_response?.incident?.date_time_of_loss
  );
}

function getClaimResolvedAt(claim: FnolResponse): Date | null {
  return parseDate(claim.updated_date);
}

function getProcessingSample(claim: FnolResponse): ProcessingSample | null {
  const statusKey = normalizeClaimStatus(claim.status);
  const createdAt = getClaimCreatedAt(claim);
  const resolvedAt = getClaimResolvedAt(claim);

  if (!createdAt || !resolvedAt || resolvedAt <= createdAt) {
    return null;
  }

  if (isClaimAutoApprovedStatus(statusKey)) {
    return {
      hours: (resolvedAt.getTime() - createdAt.getTime()) / 3_600_000,
      resolvedAt,
      bucket: "automated",
    };
  }

  if (isClaimManualProcessingStatus(statusKey)) {
    return {
      hours: (resolvedAt.getTime() - createdAt.getTime()) / 3_600_000,
      resolvedAt,
      bucket: "manual",
    };
  }

  return null;
}

function getProcessingSamples(claims: FnolResponse[]): ProcessingSample[] {
  return claims
    .map(getProcessingSample)
    .filter((sample): sample is ProcessingSample => Boolean(sample));
}

export function getAverageResolutionHours(claims: FnolResponse[]): number | null {
  return average(getProcessingSamples(claims).map((sample) => sample.hours));
}

export function getResolvedClaimCount(claims: FnolResponse[]): number {
  return getProcessingSamples(claims).length;
}

export function buildProcessingTimeSeries(
  claims: FnolResponse[],
  bucketCount = 6
): ProcessingTimePoint[] {
  const samples = getProcessingSamples(claims);
  const anchor = samples.reduce<Date>(
    (latest, sample) => (sample.resolvedAt > latest ? sample.resolvedAt : latest),
    new Date()
  );
  const lastWeekStart = startOfIsoWeek(anchor);
  const weekStarts = Array.from({ length: bucketCount }, (_, index) => {
    const weekStart = new Date(lastWeekStart);
    weekStart.setDate(lastWeekStart.getDate() - (bucketCount - index - 1) * 7);
    return weekStart;
  });

  const buckets = new Map(
    weekStarts.map((weekStart) => [
      weekStart.toISOString(),
      { automated: [] as number[], manual: [] as number[] },
    ])
  );

  for (const sample of samples) {
    const weekStart = startOfIsoWeek(sample.resolvedAt).toISOString();
    const bucket = buckets.get(weekStart);
    if (!bucket) {
      continue;
    }
    bucket[sample.bucket].push(sample.hours);
  }

  return weekStarts.map((weekStart) => {
    const bucket = buckets.get(weekStart.toISOString());
    return {
      week: getWeekLabel(weekStart),
      automated: average(bucket?.automated ?? []),
      manual: average(bucket?.manual ?? []),
    };
  });
}

export function getSettlementCurrencyCodes(claims: FnolResponse[]): string[] {
  return Array.from(
    new Set(
      claims.map((claim) =>
        inferCurrencyCode(
          claim.accident_location ??
            claim.raw_response?.incident?.accident_location ??
            claim.raw_response?.accident_location
        )
      )
    )
  );
}

export function formatReportAmount(
  amount: number,
  currencyCodes: string[]
): string {
  if (currencyCodes.length === 1) {
    const [currencyCode] = currencyCodes;
    return formatCurrency(amount, currencyCode, inferCurrencyLocale(currencyCode));
  }

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
