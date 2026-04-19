import type {
  ImageAuthenticityLabel,
  ImageFraudResultItem,
} from "@/lib/api";

const LABELS = {
  genuine: {
    code: "genuine",
    label: "Genuine",
    tone: "green",
  },
  edited: {
    code: "edited",
    label: "Edited / manipulated",
    tone: "amber",
  },
  ai_generated: {
    code: "ai_generated",
    label: "AI-generated",
    tone: "violet",
  },
  stock_internet_sourced: {
    code: "stock_internet_sourced",
    label: "Stock / internet-sourced",
    tone: "sky",
  },
  metadata_stripped: {
    code: "metadata_stripped",
    label: "Screenshot / metadata-stripped",
    tone: "slate",
  },
  staged: {
    code: "staged",
    label: "Staged",
    tone: "rose",
  },
  needs_review: {
    code: "needs_review",
    label: "Needs review",
    tone: "yellow",
  },
  under_review: {
    code: "under_review",
    label: "Under review",
    tone: "yellow",
  },
} satisfies Record<string, ImageAuthenticityLabel>;

type LabelCode = keyof typeof LABELS;

// Risk codes that are mutually contradictory with "genuine".
const DEFINITIVE_RISK_CODES = new Set([
  "ai_generated",
  "stock_internet_sourced",
  "edited",
  "staged",
  "needs_review",
]);

const AI_GENERATED_RE =
  /\b(ai[- ]generated|synthetic|computer[- ]generated|cgi|rendered|midjourney|dall[ -]?e|stable diffusion)\b/i;
const STOCK_RE =
  /\b(stock(?:\s+imag(?:e|ery))?|internet[- ]sourced|reverse image|watermark|catalog imag(?:e|ery)|web image|online source)\b/i;
const METADATA_RE =
  /\b(no exif|metadata[- ]stripped|stripped metadata|screenshot|screen capture|screen grab|downloaded image|missing exif|empty exif)\b/i;
const EDITED_RE =
  /\b(edit(?:ed|ing)?|photoshop|lightroom|gimp|canva|pixelmator|overlay|composite|manipulat(?:ed|ion)?|tamper(?:ed|ing)?|altered)\b/i;
const STAGED_RE =
  /\b(staged|posed|set up|arranged scene|stock imagery or staged|appears staged)\b/i;
const GENUINE_RE =
  /\b(genuine|authentic|real damage|likely genuine|appears genuine|appears authentic|consistent with (?:a )?(?:collision|impact|incident))\b/i;

type LabelSource = Pick<
  ImageFraudResultItem,
  | "authenticity_labels"
  | "exif_json"
  | "signals_json"
  | "llm_notes"
  | "fraud_score"
  | "ela_score"
>;

function normalizeText(value: unknown) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function warningLines(exifJson?: ImageFraudResultItem["exif_json"]) {
  if (!exifJson || !Array.isArray(exifJson.warnings)) return [];
  return exifJson.warnings.map((warning) => normalizeText(warning)).filter(Boolean);
}

function addLabel(labels: ImageAuthenticityLabel[], code: LabelCode) {
  if (labels.some((label) => label.code === code)) return;
  labels.push({ ...LABELS[code] });
}

function isKnownTone(
  tone: string
): tone is ImageAuthenticityLabel["tone"] {
  return [
    "green",
    "amber",
    "violet",
    "sky",
    "slate",
    "rose",
    "yellow",
  ].includes(tone);
}

function normalizeApiLabels(labels?: ImageAuthenticityLabel[] | null) {
  if (!Array.isArray(labels)) return [];
  const normalized: ImageAuthenticityLabel[] = [];
  for (const item of labels) {
    if (!item || typeof item.code !== "string" || typeof item.label !== "string") {
      continue;
    }
    normalized.push({
      code: item.code,
      label: item.label,
      tone: isKnownTone(item.tone) ? item.tone : "yellow",
    });
  }
  return normalized;
}

export function getImageAuthenticityLabels(source: LabelSource) {
  const apiLabels = normalizeApiLabels(source.authenticity_labels);
  if (apiLabels.length > 0) return apiLabels;

  const warnings = warningLines(source.exif_json);
  const software = normalizeText(source.exif_json?.software);
  const llmNotes = normalizeText(source.llm_notes);
  const signalBlob = normalizeText(source.signals_json);
  const exifPresent =
    typeof source.exif_json?.exif_present === "boolean"
      ? source.exif_json.exif_present
      : undefined;
  const combinedText = [llmNotes, software, signalBlob, ...warnings]
    .filter(Boolean)
    .join(" ");

  const labels: ImageAuthenticityLabel[] = [];

  if (AI_GENERATED_RE.test(combinedText)) addLabel(labels, "ai_generated");
  if (STOCK_RE.test(combinedText)) addLabel(labels, "stock_internet_sourced");
  if (exifPresent === false || METADATA_RE.test(combinedText)) {
    addLabel(labels, "metadata_stripped");
  }
  if ((software && EDITED_RE.test(software)) || EDITED_RE.test(combinedText)) {
    addLabel(labels, "edited");
  }
  if (STAGED_RE.test(combinedText)) addLabel(labels, "staged");
  if (GENUINE_RE.test(combinedText)) addLabel(labels, "genuine");

  const fraudScore =
    typeof source.fraud_score === "number" && Number.isFinite(source.fraud_score)
      ? source.fraud_score
      : null;
  const elaScore =
    typeof source.ela_score === "number" && Number.isFinite(source.ela_score)
      ? source.ela_score
      : null;

  if (labels.length === 0) {
    const lowSignal =
      (fraudScore == null || fraudScore <= 25) &&
      (elaScore == null || elaScore <= 10);
    if (lowSignal && warnings.length === 0 && exifPresent !== false) {
      addLabel(labels, "genuine");
    } else if (exifPresent === false || warnings.length > 0) {
      addLabel(labels, "metadata_stripped");
    } else {
      addLabel(labels, "needs_review");
    }
  }

  if (
    fraudScore != null &&
    fraudScore >= 60 &&
    !labels.some((label) =>
      ["ai_generated", "stock_internet_sourced", "edited", "staged"].includes(
        label.code
      )
    )
  ) {
    addLabel(labels, "needs_review");
  }

  // Mirror backend _resolve_contradictions: replace 'genuine' with 'under_review'
  // when any definitive risk code is also present.
  const codes = new Set(labels.map((l) => l.code));
  if (codes.has("genuine")) {
    const riskPresent = [...codes].some((c) => DEFINITIVE_RISK_CODES.has(c));
    if (riskPresent) {
      const resolved = labels.filter((l) => l.code !== "genuine");
      if (!resolved.some((l) => l.code === "under_review")) {
        resolved.push({ ...LABELS.under_review });
      }
      return resolved;
    }
  }

  return labels;
}

export function getImageAuthenticityBadgeClasses(
  tone: ImageAuthenticityLabel["tone"]
) {
  switch (tone) {
    case "green":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "amber":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "violet":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "sky":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "slate":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "rose":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "yellow":
    default:
      return "border-yellow-200 bg-yellow-50 text-yellow-800";
  }
}
