import type { MarketContext } from "./api";

type MarketHint = {
  keywords: string[];
  country: string;
  city: string;
  currencyCode: string;
  locale: string;
  marketLabel: string;
};

const DEFAULT_MARKET_HINT: MarketHint = {
  keywords: [],
  country: "Thailand",
  city: "Bangkok",
  currencyCode: "THB",
  locale: "th-TH",
  marketLabel: "Thailand vehicle repair market",
};

const MARKET_HINTS: MarketHint[] = [
  DEFAULT_MARKET_HINT,
  {
    keywords: [
      "kuala lumpur",
      "malaysia",
      "selangor",
      "penang",
      "johor",
      "ipoh",
      "malacca",
      "shah alam",
      "petaling jaya",
    ],
    country: "Malaysia",
    city: "Kuala Lumpur",
    currencyCode: "MYR",
    locale: "ms-MY",
    marketLabel: "Malaysia vehicle repair market",
  },
];

function resolveMarketHint(accidentLocation?: string | null): MarketHint {
  const lowered = (accidentLocation ?? "").trim().toLowerCase();
  if (!lowered) return DEFAULT_MARKET_HINT;

  return (
    MARKET_HINTS.find((hint) =>
      hint.keywords.some((keyword) => lowered.includes(keyword))
    ) ?? DEFAULT_MARKET_HINT
  );
}

export function inferCurrencyLocale(currencyCode?: string): string {
  switch ((currencyCode ?? "").toUpperCase()) {
    case "MYR":
      return "ms-MY";
    case "THB":
      return "th-TH";
    default:
      return "en-US";
  }
}

export function inferCurrencyCode(accidentLocation?: string | null): string {
  return resolveMarketHint(accidentLocation).currencyCode;
}

export function inferMarketLabel(accidentLocation?: string | null): string {
  return resolveMarketHint(accidentLocation).marketLabel;
}

export function inferMarketContextFromLocation(
  accidentLocation?: string | null
): MarketContext | null {
  const normalizedLocation = (accidentLocation ?? "").trim();
  if (!normalizedLocation) return null;

  const hint = resolveMarketHint(normalizedLocation);
  return {
    country: hint.country,
    city: hint.city,
    currency_code: hint.currencyCode,
    locale: hint.locale,
    market_label: hint.marketLabel,
    accident_location: normalizedLocation,
  };
}

export function formatCurrency(
  amount: number,
  currencyCode = DEFAULT_MARKET_HINT.currencyCode,
  locale = inferCurrencyLocale(currencyCode)
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${new Intl.NumberFormat(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)} ${currencyCode}`;
  }
}
