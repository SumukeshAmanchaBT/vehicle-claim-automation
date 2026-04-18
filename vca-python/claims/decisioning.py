from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from claims.authenticity_classification import classify_image_authenticity_labels
from claims.models import (
    ClaimDuplicateCandidate,
    ClaimEvaluationResponse,
    ClaimPhase1Valuation,
    DamagePartAssessment,
    FnolClaim,
    ImageFraudResult,
)
from claims.phase1_runtime import (
    get_pricing_config_boolean,
    get_pricing_config_float,
    get_pricing_config_string,
)
from claims.workflow_state import current_damage_assessment_persistence_state

_CLAIM_TYPE_TO_SEVERITY = {
    "SIMPLE": "minor",
    "MEDIUM": "moderate",
    "COMPLEX": "severe",
}

_IMAGE_RISK_SUMMARY_LIMIT = 6

_IMAGE_RISK_CATEGORY_META = {
    "cross_claim_image_reuse": {
        "label": "Cross-claim reused / duplicate",
        "title": "Cross-claim reused / duplicate image detected",
        "tone": "destructive",
        "severity": "critical",
        "source": "claim_duplicate_candidates",
    },
    "ai_generated": {
        "label": "AI-generated",
        "title": "AI-generated vehicle image suspected",
        "tone": "violet",
        "severity": "critical",
        "source": "image_fraud_results.authenticity_labels",
    },
    "edited": {
        "label": "Edited / manipulated",
        "title": "Edited / manipulated image suspected",
        "tone": "amber",
        "severity": "critical",
        "source": "image_fraud_results.authenticity_labels",
    },
    "stock_internet_sourced": {
        "label": "Stock / internet-sourced",
        "title": "Stock / internet-sourced image detected",
        "tone": "sky",
        "severity": "critical",
        "source": "image_fraud_results.authenticity_labels",
    },
    "staged": {
        "label": "Likely staged",
        "title": "Staged image suspected",
        "tone": "rose",
        "severity": "critical",
        "source": "image_fraud_results.authenticity_labels",
    },
    "metadata_stripped": {
        "label": "Screenshot / metadata-stripped",
        "title": "Screenshot / metadata-stripped image detected",
        "tone": "slate",
        "severity": "warning",
        "source": "image_fraud_results.authenticity_labels",
    },
    "needs_review": {
        "label": "Needs review",
        "title": "Image authenticity signals need review",
        "tone": "yellow",
        "severity": "warning",
        "source": "image_fraud_results.authenticity_labels",
    },
    "genuine": {
        "label": "Likely genuine",
        "title": "Image authenticity signals appear genuine",
        "tone": "green",
        "severity": "success",
        "source": "image_fraud_results.authenticity_labels",
    },
}

_INSIGHT_SEVERITY_ORDER = {
    "critical": 3,
    "warning": 2,
    "info": 1,
    "success": 0,
}

_INSIGHT_PRIORITY_ORDER = {
    # Reviewers need claim-to-claim reuse surfaced first because it is both
    # a fraud signal and an explainable cross-claim linkage.
    "cross_claim_image_reuse": 0,
    "ai_generated": 1,
    "edited": 2,
    "stock_internet_sourced": 3,
    "staged": 4,
    "metadata_stripped": 5,
    "needs_review": 6,
    "image_authenticity_review_required": 7,
    "business_rule_validation_failed": 8,
    "business_rule_high_fraud_band": 9,
    "severity_requires_manual_review": 10,
    "damage_assessment_incomplete": 11,
    "image_authenticity_elevated": 12,
}


@dataclass(frozen=True)
class StraightThroughPolicy:
    max_image_fraud_score: float
    block_on_duplicate_candidates: bool
    block_on_failed_business_rules: bool
    block_on_high_business_fraud_band: bool
    require_structured_damage: bool
    allowed_severities: tuple[str, ...]
    blocking_image_risk_codes: tuple[str, ...]


def _parse_config_csv(raw: str | None, default: tuple[str, ...]) -> tuple[str, ...]:
    values = tuple(
        token.strip().lower()
        for token in (raw or "").split(",")
        if token and token.strip()
    )
    return values or default


def get_straight_through_policy() -> StraightThroughPolicy:
    allowed = _parse_config_csv(
        get_pricing_config_string("STP_ALLOWED_SEVERITIES", "minor,moderate"),
        ("minor", "moderate"),
    )
    blocking_image_risk_codes = _parse_config_csv(
        get_pricing_config_string(
            "STP_BLOCKING_IMAGE_RISK_CODES",
            "ai_generated,edited,staged,stock_internet_sourced",
        ),
        ("ai_generated", "edited", "staged", "stock_internet_sourced"),
    )

    return StraightThroughPolicy(
        max_image_fraud_score=get_pricing_config_float(
            "STP_MAX_IMAGE_FRAUD_SCORE", 59.0
        ),
        block_on_duplicate_candidates=get_pricing_config_boolean(
            "STP_BLOCK_ON_DUPLICATE_CANDIDATES", True
        ),
        block_on_failed_business_rules=get_pricing_config_boolean(
            "STP_BLOCK_ON_FAILED_BUSINESS_RULES", True
        ),
        block_on_high_business_fraud_band=get_pricing_config_boolean(
            "STP_BLOCK_ON_HIGH_FRAUD_BAND", True
        ),
        require_structured_damage=get_pricing_config_boolean(
            "STP_REQUIRE_STRUCTURED_DAMAGE", True
        ),
        allowed_severities=allowed,
        blocking_image_risk_codes=blocking_image_risk_codes,
    )


def _parse_llm_damages(raw: str | None) -> list[str]:
    if not raw or not str(raw).strip():
        return []
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
    if isinstance(parsed, list):
        return [str(item).strip() for item in parsed if str(item).strip()]
    if isinstance(parsed, str) and parsed.strip():
        return [parsed.strip()]
    return []


def _fnol_list_stage_lower(claim: FnolClaim | None) -> str:
    """Claim list / detail stage from fnol_claims → claim_status FK (authoritative for UI)."""
    if not claim:
        return ""
    try:
        cs = getattr(claim, "claim_status", None)
        if cs is not None:
            name = getattr(cs, "status_name", None)
            if name:
                return str(name).strip().lower()
    except Exception:
        return ""
    return ""


def _stage_implies_business_rules_passed(stage_lower: str) -> bool | None:
    """
    Stages that only occur after successful BRV (or that explicitly mean failure).

    When ``fraud_rule_results`` is empty, we still infer pass/fail from list/eval
    stages that *unambiguously* reflect BRV outcome. We do **not** infer pass from
    terminal workflow labels such as "Recommendation shared" — those can be set by
    other API paths without a persisted rule snapshot (see LLM damage assessment).
    """
    if not (stage_lower or "").strip():
        return None
    s = stage_lower.strip().lower()
    if any(
        marker in s
        for marker in ("validation-fail", "fraudulent", "rejected")
    ):
        return False
    if any(
        marker in s
        for marker in (
            "business rule validation-pass",
            "pending damage detection",
            "pending_damage_detection",
        )
    ):
        return True
    return None


def _infer_business_rules_passed(
    latest_eval: ClaimEvaluationResponse | None,
    *,
    claim: FnolClaim | None = None,
) -> tuple[bool | None, list[dict[str, Any]]]:
    if not latest_eval:
        return None, []

    rules = latest_eval.fraud_rule_results
    if not isinstance(rules, list):
        rules = []

    normalized_rules: list[dict[str, Any]] = []
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        normalized_rules.append(rule)

    if normalized_rules:
        return all(bool(rule.get("passed")) for rule in normalized_rules), normalized_rules

    decision = (latest_eval.decision or "").strip().lower()
    if decision == "reject":
        return False, normalized_rules

    claim_status = (latest_eval.claim_status or "").strip().lower()
    if "validation-fail" in claim_status or claim_status == "rejected":
        return False, normalized_rules
    if "validation-pass" in claim_status:
        return True, normalized_rules

    hint = _stage_implies_business_rules_passed(claim_status)
    if hint is True:
        return True, normalized_rules
    if hint is False:
        return False, normalized_rules

    fnol_stage = _fnol_list_stage_lower(claim)
    hint_fnol = _stage_implies_business_rules_passed(fnol_stage)
    if hint_fnol is True:
        return True, normalized_rules
    if hint_fnol is False:
        return False, normalized_rules

    return None, normalized_rules


def _normalize_similarity_percent(value: Any) -> int:
    try:
        raw = float(value or 0)
    except (TypeError, ValueError):
        return 0
    if raw <= 1.0:
        raw *= 100.0
    return int(round(raw))


def _insight(
    *,
    code: str,
    severity: str,
    title: str,
    detail: str,
    blocking: bool,
    source: str,
) -> dict[str, Any]:
    return {
        "code": code,
        "severity": severity,
        "title": title,
        "detail": detail,
        "blocking": blocking,
        "source": source,
    }


def _insight_sort_key(item: dict[str, Any]) -> tuple[int, int, int, str]:
    return (
        0 if item["blocking"] else 1,
        -_INSIGHT_SEVERITY_ORDER.get(item["severity"], 0),
        _INSIGHT_PRIORITY_ORDER.get(str(item.get("code") or ""), 99),
        item["title"],
    )


def _image_risk_category_meta(code: str, label: str | None = None) -> dict[str, Any]:
    meta = dict(_IMAGE_RISK_CATEGORY_META.get(code, {}))
    if not meta:
        normalized_label = (label or code.replace("_", " ").strip()).strip()
        meta = {
            "label": normalized_label or "Image risk",
            "title": f"{normalized_label or 'Image risk'} detected",
            "tone": "yellow",
            "severity": "warning",
            "source": "image_fraud_results.authenticity_labels",
        }
    return meta


def _image_risk_count_label(code: str, count: int) -> str:
    if code == "cross_claim_image_reuse":
        return f"{count} match{'' if count == 1 else 'es'}"
    return f"{count} photo{'' if count == 1 else 's'}"


def _image_risk_sort_key(item: dict[str, Any]) -> tuple[int, int, int, str]:
    return (
        0 if item["blocking"] else 1,
        -_INSIGHT_SEVERITY_ORDER.get(str(item.get("severity") or ""), 0),
        _INSIGHT_PRIORITY_ORDER.get(str(item.get("code") or ""), 99),
        str(item.get("label") or ""),
    )


def _format_category_count_label(count: int) -> str:
    return (
        f"{count} image-risk category surfaced"
        if count == 1
        else f"{count} image-risk categories surfaced"
    )


def _aggregate_image_risk_summary(
    *,
    fraud_rows: list[ImageFraudResult],
    duplicate_count: int,
    policy: StraightThroughPolicy,
) -> tuple[dict[str, Any] | None, list[dict[str, Any]], int]:
    analyzed_photo_keys: set[str] = set()
    material_risk_photo_keys: set[str] = set()
    aggregated: dict[str, dict[str, Any]] = {}

    for row in fraud_rows:
        photo_key = (row.photo_path or "").strip() or f"row:{row.id}"
        analyzed_photo_keys.add(photo_key)
        labels = classify_image_authenticity_labels(
            exif_json=row.exif_json,
            llm_notes=row.llm_authenticity_notes,
            fraud_score=float(row.fraud_score) if row.fraud_score is not None else None,
            ela_score=row.ela_score,
            signals_json=row.signals_json,
        )
        codes_on_photo: set[str] = set()
        for label in labels:
            code = str(label.get("code") or "").strip()
            if not code or code in codes_on_photo:
                continue
            codes_on_photo.add(code)
            meta = _image_risk_category_meta(code, str(label.get("label") or ""))
            entry = aggregated.setdefault(
                code,
                {
                    "code": code,
                    "label": meta["label"],
                    "title": meta["title"],
                    "tone": meta["tone"],
                    "severity": meta["severity"],
                    "blocking": code in policy.blocking_image_risk_codes,
                    "source": meta["source"],
                    "_photo_keys": set(),
                },
            )
            entry["_photo_keys"].add(photo_key)
            if code != "genuine":
                material_risk_photo_keys.add(photo_key)

    has_specific_material_category = any(
        code
        for code in aggregated
        if code not in {"genuine", "needs_review"}
    )
    if has_specific_material_category:
        aggregated.pop("needs_review", None)

    has_non_genuine_category = any(code for code in aggregated if code != "genuine")
    if has_non_genuine_category:
        aggregated.pop("genuine", None)

    if duplicate_count > 0:
        meta = _image_risk_category_meta("cross_claim_image_reuse")
        aggregated["cross_claim_image_reuse"] = {
            "code": "cross_claim_image_reuse",
            "label": meta["label"],
            "title": meta["title"],
            "tone": meta["tone"],
            "severity": meta["severity"],
            "blocking": policy.block_on_duplicate_candidates,
            "source": meta["source"],
            "count": duplicate_count,
            "count_label": _image_risk_count_label(
                "cross_claim_image_reuse", duplicate_count
            ),
        }

    categories: list[dict[str, Any]] = []
    for code, entry in aggregated.items():
        if code != "cross_claim_image_reuse":
            photo_count = len(entry.pop("_photo_keys", set()))
            if photo_count <= 0:
                continue
            entry["count"] = photo_count
            entry["count_label"] = _image_risk_count_label(code, photo_count)
        categories.append(entry)

    categories.sort(key=_image_risk_sort_key)

    if not categories:
        return None, categories, len(analyzed_photo_keys)

    summary_status_tone = "critical"
    if not any(
        str(category.get("severity") or "") == "critical" for category in categories
    ):
        summary_status_tone = "warning"
    if not any(bool(category.get("blocking")) for category in categories):
        summary_status_tone = (
            "warning" if summary_status_tone == "warning" else "info"
        )

    analyzed_photo_count = len(analyzed_photo_keys)
    material_photo_count = len(material_risk_photo_keys)
    blocking_category_count = sum(
        1 for category in categories if bool(category.get("blocking"))
    )
    critical_category_count = sum(
        1
        for category in categories
        if str(category.get("severity") or "") == "critical"
    )
    summary_detail_bits: list[str] = []
    if analyzed_photo_count > 0:
        if material_photo_count > 0:
            summary_detail_bits.append(
                f"{material_photo_count} of {analyzed_photo_count} analyzed photo"
                f"{'' if analyzed_photo_count == 1 else 's'} carry authenticity-risk markers"
            )
        else:
            summary_detail_bits.append(
                f"{analyzed_photo_count} analyzed photo"
                f"{'' if analyzed_photo_count == 1 else 's'} were reviewed for image risk"
            )
    summary_detail_bits.append(
        f"{len(categories)} top image-risk categor"
        f"{'y' if len(categories) == 1 else 'ies'} surfaced for this claim"
    )
    summary_card_detail_bits: list[str] = []
    if analyzed_photo_count > 0:
        summary_card_detail_bits.append(
            f"{material_photo_count or analyzed_photo_count} of {analyzed_photo_count} analyzed photo"
            f"{'' if analyzed_photo_count == 1 else 's'} flagged"
        )
    if blocking_category_count > 0:
        summary_card_detail_bits.append(
            f"{blocking_category_count} blocking signal"
            f"{'' if blocking_category_count == 1 else 's'} require review"
        )

    return (
        {
            "status_tone": summary_status_tone,
            "title": "Image risk highlights",
            "detail": ". ".join(summary_detail_bits) + ".",
            "analyzed_photo_count": analyzed_photo_count,
            "material_photo_count": material_photo_count,
            "blocking_category_count": blocking_category_count,
            "critical_category_count": critical_category_count,
            "categories": categories[:_IMAGE_RISK_SUMMARY_LIMIT],
            "additional_category_count": max(
                0, len(categories) - _IMAGE_RISK_SUMMARY_LIMIT
            ),
            "summary_card": {
                "title": "Image risk signals",
                "headline": _format_category_count_label(len(categories)),
                "detail": ". ".join(summary_card_detail_bits) + "."
                if summary_card_detail_bits
                else "Stored photo-level authenticity and duplicate signals are present.",
                "tone": summary_status_tone,
            },
        },
        categories,
        analyzed_photo_count,
    )


def _current_lifecycle_started_at(
    latest_eval: ClaimEvaluationResponse | None,
):
    return getattr(latest_eval, "created_date", None) if latest_eval else None


def _current_image_analysis_rows(
    *,
    claim: FnolClaim,
    latest_eval: ClaimEvaluationResponse | None,
) -> tuple[list[ClaimDuplicateCandidate], list[ImageFraudResult]]:
    """
    Only treat image-analysis artifacts as current if they were produced after
    the latest BRV run started.

    This keeps stale image-fraud / duplicate rows from earlier runs from
    leaking back into a fresh BRV-only claim summary.
    """
    started_at = _current_lifecycle_started_at(latest_eval)
    if started_at is None:
        return [], []

    duplicate_rows = list(
        ClaimDuplicateCandidate.objects.filter(
            complaint=claim,
            created_at__gte=started_at,
        ).order_by("-similarity_score", "-created_at")
    )
    fraud_rows = list(
        ImageFraudResult.objects.filter(
            complaint=claim,
            created_at__gte=started_at,
        ).order_by("-fraud_score", "-created_at")
    )
    return duplicate_rows, fraud_rows


def _build_primary_image_risk_insight(
    categories: list[dict[str, Any]],
) -> dict[str, Any] | None:
    candidates = [
        category
        for category in categories
        if category.get("code") != "cross_claim_image_reuse"
        and category.get("code") != "genuine"
    ]
    if not candidates:
        return None

    primary = candidates[0]
    n_cat = len(candidates)
    cat_word = "category" if n_cat == 1 else "categories"
    # Keep the banner concise; labels live in Screening findings / image-risk UI.
    detail = (
        f"Authenticity screening flagged {n_cat} risk {cat_word} "
        f"on {primary['count_label']}. See Screening findings for labels."
    )

    return _insight(
        code=str(primary["code"]),
        severity=str(primary["severity"]),
        title=str(primary["title"]),
        detail=detail,
        blocking=bool(primary["blocking"]),
        source=str(primary["source"]),
    )


def _format_failed_business_rule_detail(failed_rules: list[dict[str, Any]]) -> str:
    failed_rule_names = [
        str(rule.get("rule_type") or "Rule").strip()
        for rule in failed_rules
        if str(rule.get("rule_type") or "").strip()
    ]
    detail = (
        f"{len(failed_rules)} business-rule check(s) failed: "
        f"{', '.join(failed_rule_names[:3])}."
    )
    if len(failed_rule_names) > 3:
        detail += " Additional failed checks are present."
    return detail


def _build_business_rule_summary(
    *,
    business_rules_passed: bool | None,
    failed_rules: list[dict[str, Any]],
    fraud_band: str,
) -> dict[str, Any]:
    normalized_band = (fraud_band or "").strip().lower()
    if failed_rules or business_rules_passed is False:
        return {
            "status_tone": "critical",
            "title": "Business Rule Validation Failed",
            "headline": "High Risk",
            "detail": _format_failed_business_rule_detail(failed_rules),
            "fraud_band": fraud_band or None,
            "failed_rule_count": len(failed_rules),
            "validation_passed": business_rules_passed,
        }

    if normalized_band == "high":
        return {
            "status_tone": "critical",
            "title": (
                "Business Rule Validation Passed"
                if business_rules_passed is True
                else "Business Rule Validation Completed"
            ),
            "headline": "High Risk",
            "detail": "Business-rule fraud screening classified this claim as high risk.",
            "fraud_band": fraud_band or None,
            "failed_rule_count": 0,
            "validation_passed": business_rules_passed,
        }

    if normalized_band in {"medium", "warning"}:
        return {
            "status_tone": "warning",
            "title": (
                "Business Rule Validation Passed"
                if business_rules_passed is True
                else "Business Rule Validation Completed"
            ),
            "headline": "Review Required",
            "detail": "Business-rule fraud screening returned a medium-risk result.",
            "fraud_band": fraud_band or None,
            "failed_rule_count": 0,
            "validation_passed": business_rules_passed,
        }

    if business_rules_passed is True:
        return {
            "status_tone": "success",
            "title": "Business Rule Validation Passed",
            "headline": "Low Risk",
            "detail": "All configured business and fraud rules passed.",
            "fraud_band": fraud_band or None,
            "failed_rule_count": 0,
            "validation_passed": True,
        }

    return {
        "status_tone": "info",
        "title": "Business Rule Validation Pending",
        "headline": "Pending",
        "detail": "Run business-rule validation to evaluate policy and fraud rules.",
        "fraud_band": fraud_band or None,
        "failed_rule_count": 0,
        "validation_passed": business_rules_passed,
    }


def build_claim_decision_summary(
    *,
    claim: FnolClaim,
    latest_eval: ClaimEvaluationResponse | None = None,
) -> dict[str, Any]:
    if latest_eval is None:
        latest_eval = ClaimEvaluationResponse.objects.filter(
            complaint_id=claim.complaint_id, is_latest=True
        ).first()

    policy = get_straight_through_policy()
    business_rules_passed, rules_snapshot = _infer_business_rules_passed(
        latest_eval, claim=claim
    )
    failed_rules = [rule for rule in rules_snapshot if not bool(rule.get("passed"))]

    fraud_band = (latest_eval.fraud_band or "").strip() if latest_eval else ""
    business_rule_summary = _build_business_rule_summary(
        business_rules_passed=business_rules_passed,
        failed_rules=failed_rules,
        fraud_band=fraud_band,
    )
    claim_type = (latest_eval.claim_type or "").strip().upper() if latest_eval else ""
    raw_llm_severity = (
        (latest_eval.llm_severity or "").strip().lower() if latest_eval else ""
    )
    llm_damages = _parse_llm_damages(latest_eval.llm_damages if latest_eval else None)
    damage_state = current_damage_assessment_persistence_state(claim, latest_eval)
    current_part_count = int(damage_state["current_part_count"])
    has_current_valuation = bool(damage_state["current_valuation_ready"])
    has_current_damage_evidence = bool(damage_state["has_current_evidence"])

    duplicate_rows, fraud_rows = _current_image_analysis_rows(
        claim=claim,
        latest_eval=latest_eval,
    )
    duplicate_count = len(duplicate_rows)
    top_duplicate = duplicate_rows[0] if duplicate_rows else None

    fraud_scores = [
        float(row.fraud_score)
        for row in fraud_rows
        if row.fraud_score is not None
    ]
    max_image_fraud_score = max(fraud_scores) if fraud_scores else None
    high_risk_image_count = sum(
        1
        for score in fraud_scores
        if score >= policy.max_image_fraud_score
    )

    severity = raw_llm_severity or (
        _CLAIM_TYPE_TO_SEVERITY.get(claim_type, "")
        if has_current_damage_evidence
        else ""
    )
    has_valid_damage = (
        current_part_count > 0
        or any(damage.lower() not in {"", "none", "unknown"} for damage in llm_damages)
    ) if has_current_damage_evidence else False
    assessment_ready = bool(
        has_current_valuation
        and (
            current_part_count > 0
            or raw_llm_severity
            or has_valid_damage
        )
    )
    image_risk_summary, image_risk_categories, analyzed_photo_count = (
        _aggregate_image_risk_summary(
            fraud_rows=fraud_rows,
            duplicate_count=duplicate_count,
            policy=policy,
        )
    )

    insights: list[dict[str, Any]] = []
    blockers: list[dict[str, Any]] = []

    if failed_rules:
        insight = _insight(
            code="business_rule_validation_failed",
            severity="critical",
            title="Business rule validation failed",
            detail=_format_failed_business_rule_detail(failed_rules),
            blocking=policy.block_on_failed_business_rules,
            source="claim_evaluation_response.fraud_rule_results",
        )
        insights.append(insight)
        if insight["blocking"]:
            blockers.append(insight)

    if fraud_band.lower() == "high":
        detail = (
            latest_eval.reason.strip()
            if latest_eval and latest_eval.reason
            else "Business-rule validation classified this claim as high fraud risk."
        )
        insight = _insight(
            code="business_rule_high_fraud_band",
            severity="critical",
            title="High fraud risk from business-rule validation",
            detail=detail,
            blocking=policy.block_on_high_business_fraud_band,
            source="claim_evaluation_response.fraud_band",
        )
        insights.append(insight)
        if insight["blocking"]:
            blockers.append(insight)

    duplicate_insight: dict[str, Any] | None = None
    if duplicate_count > 0:
        top_duplicate_text = ""
        if top_duplicate:
            top_duplicate_text = (
                f" Top match: {top_duplicate.other_complaint_id} "
                f"({_normalize_similarity_percent(top_duplicate.similarity_score)}% similarity)."
            )
        duplicate_insight = _insight(
            code="cross_claim_image_reuse",
            severity="critical",
            title="Potential cross-claim image reuse detected",
            detail=(
                f"{duplicate_count} similar image"
                f"{'' if duplicate_count == 1 else 's'} matched other claims."
                f"{top_duplicate_text}"
            ),
            blocking=policy.block_on_duplicate_candidates,
            source="claim_duplicate_candidates",
        )
        insights.append(duplicate_insight)
        if duplicate_insight["blocking"]:
            blockers.append(duplicate_insight)

    primary_image_risk_insight = _build_primary_image_risk_insight(
        image_risk_categories
    )
    if primary_image_risk_insight:
        insights.append(primary_image_risk_insight)
        if primary_image_risk_insight["blocking"]:
            blockers.append(primary_image_risk_insight)

    image_authenticity_threshold_insight: dict[str, Any] | None = None
    if max_image_fraud_score is not None:
        rounded_score = round(max_image_fraud_score, 2)
        if rounded_score >= policy.max_image_fraud_score:
            image_authenticity_threshold_insight = _insight(
                code="image_authenticity_review_required",
                severity="critical",
                title="Image authenticity review required",
                detail=(
                    f"Highest image fraud score {rounded_score} exceeds the "
                    f"straight-through threshold of {policy.max_image_fraud_score}."
                ),
                blocking=True,
                source="image_fraud_results.fraud_score",
            )
            insights.append(image_authenticity_threshold_insight)
            blockers.append(image_authenticity_threshold_insight)
        elif rounded_score >= 40:
            insights.append(
                _insight(
                    code="image_authenticity_elevated",
                    severity="warning",
                    title="Elevated image authenticity signals",
                    detail=(
                        f"Highest image fraud score {rounded_score} was recorded for this claim."
                    ),
                    blocking=False,
                    source="image_fraud_results.fraud_score",
                )
            )

    if assessment_ready and severity and severity not in policy.allowed_severities:
        insight = _insight(
            code="severity_requires_manual_review",
            severity="warning",
            title="Severity requires manual review",
            detail=(
                f"Severity '{severity}' is outside the configured "
                f"straight-through severity set ({', '.join(policy.allowed_severities)})."
            ),
            blocking=True,
            source="claim_evaluation_response.llm_severity",
        )
        insights.append(insight)
        blockers.append(insight)

    if assessment_ready and policy.require_structured_damage and not has_valid_damage:
        insight = _insight(
            code="damage_assessment_incomplete",
            severity="warning",
            title="Damage assessment needs reviewer confirmation",
            detail=(
                "No structured damage lines or valid damage tags are available to support "
                "automatic approval."
            ),
            blocking=True,
            source="damage_part_assessments",
        )
        insights.append(insight)
        blockers.append(insight)

    persisted_decision = (latest_eval.decision or "").strip() if latest_eval else ""

    blockers.sort(key=_insight_sort_key)
    insights.sort(key=_insight_sort_key)

    summary_card_present = bool(
        image_risk_summary and image_risk_summary.get("summary_card")
    )
    # Single surface for image-risk: summary_card + category chips. Do not also
    # emit the same signals as duplicate banner rows below the cards.
    if summary_card_present and image_authenticity_threshold_insight:
        sc = image_risk_summary["summary_card"]
        threshold_note = (image_authenticity_threshold_insight.get("detail") or "").strip()
        existing = (sc.get("detail") or "").strip()
        if threshold_note and threshold_note not in existing:
            sc["detail"] = f"{existing} {threshold_note}".strip() if existing else threshold_note

    if summary_card_present:
        drop_codes = {
            "cross_claim_image_reuse",
            "image_authenticity_review_required",
        }
        if primary_image_risk_insight:
            drop_codes.add(str(primary_image_risk_insight.get("code") or ""))
        insights = [
            i
            for i in insights
            if str(i.get("code") or "") not in drop_codes
        ]
        insights.sort(key=_insight_sort_key)

    image_risk_highlights: list[dict[str, Any]] = []
    if not summary_card_present:
        if duplicate_insight:
            image_risk_highlights.append(duplicate_insight)
        if primary_image_risk_insight:
            image_risk_highlights.append(primary_image_risk_insight)
        elif image_authenticity_threshold_insight:
            image_risk_highlights.append(image_authenticity_threshold_insight)

    if image_risk_summary is not None:
        image_risk_summary["highlights"] = image_risk_highlights

    # Keep image-specific banners in the dedicated image-risk block so the
    # generic top-insights list can focus on additional decision signals.
    image_risk_highlight_codes = {
        str(insight.get("code") or "")
        for insight in image_risk_highlights
        if str(insight.get("code") or "")
    }
    top_insights = [
        insight
        for insight in insights
        if str(insight.get("code") or "") not in image_risk_highlight_codes
    ][:3]

    if latest_eval and persisted_decision.lower() == "reject":
        approval_state = "rejected"
        decision = "Reject"
        status_tone = "critical"
        status_title = "Claim rejected"
        status_detail = (
            latest_eval.reason.strip()
            if latest_eval.reason
            else "Business-rule validation rejected this claim."
        )
        stp_eligible = False
    elif blockers:
        first_blocker = blockers[0]
        approval_state = "manual_review_required"
        decision = "Manual Review"
        status_tone = "critical" if first_blocker["severity"] == "critical" else "warning"
        status_title = "Manual review required"
        status_detail = (first_blocker.get("detail") or "").strip()
        if len(blockers) > 1:
            n_more = len(blockers) - 1
            tail = (
                "One more blocking item is listed in the assessment summary."
                if n_more == 1
                else f"{n_more} more blocking items are listed in the assessment summary."
            )
            status_detail = f"{status_detail} {tail}".strip()
        stp_eligible = False
    elif not assessment_ready:
        approval_state = "pending_damage_assessment"
        decision = persisted_decision or None
        status_tone = "info"
        status_title = "Damage assessment pending"
        status_detail = (
            "Run or complete damage assessment before automated approval can be determined."
        )
        stp_eligible = False
    elif business_rules_passed is False:
        approval_state = "manual_review_required"
        decision = "Manual Review"
        status_tone = "warning"
        status_title = "Manual review required"
        status_detail = "Business-rule validation did not pass for this claim."
        stp_eligible = False
    else:
        approval_state = "straight_through_eligible"
        decision = "Auto Approve"
        status_tone = "success"
        status_title = "Eligible for straight-through processing"
        status_detail = "Automated approval criteria met."
        stp_eligible = True

    if approval_state in {"rejected", "manual_review_required"}:
        risk_level = "high" if status_tone == "critical" else "warning"
    elif approval_state == "straight_through_eligible":
        risk_level = "low"
    else:
        risk_level = "warning" if insights else "info"

    if risk_level == "high":
        risk_label = "High Risk"
    elif risk_level == "warning":
        risk_label = "Review Required"
    elif risk_level == "low":
        risk_label = "Low Risk"
    else:
        risk_label = "Pending"

    return {
        "approval_state": approval_state,
        "decision": decision,
        "stp_eligible": stp_eligible,
        "status_tone": status_tone,
        "status_title": status_title,
        "status_detail": status_detail,
        "risk_level": risk_level,
        "risk_label": risk_label,
        "business_rule_validation_passed": business_rules_passed,
        "business_rule_summary": business_rule_summary,
        "image_risk_summary": image_risk_summary,
        "blocking_insights": blockers,
        "top_insights": top_insights,
        "signals": {
            "fraud_band": fraud_band or None,
            "failed_business_rule_count": len(failed_rules),
            "max_image_fraud_score": round(max_image_fraud_score, 2)
            if max_image_fraud_score is not None
            else None,
            "high_risk_image_count": high_risk_image_count,
            "duplicate_candidate_count": duplicate_count,
            "top_duplicate_candidate": {
                "other_complaint_id": top_duplicate.other_complaint_id,
                "similarity_percent": _normalize_similarity_percent(
                    top_duplicate.similarity_score
                ),
                "match_reason": top_duplicate.match_reason,
            }
            if top_duplicate
            else None,
            "severity": severity or None,
            "part_count": current_part_count,
            "has_structured_damage": has_valid_damage,
            "assessment_ready": assessment_ready,
            "image_risk_category_count": len(image_risk_categories),
            "image_risk_codes": [category["code"] for category in image_risk_categories],
            "blocking_image_risk_codes": [
                category["code"]
                for category in image_risk_categories
                if category["code"] != "cross_claim_image_reuse"
                and bool(category.get("blocking"))
            ],
            "image_risk_photo_count": analyzed_photo_count,
            "allowed_severities": list(policy.allowed_severities),
            "stp_max_image_fraud_score": policy.max_image_fraud_score,
        },
    }


def sync_claim_evaluation_decision_state(
    *,
    complaint_id: str,
    latest_eval: ClaimEvaluationResponse | None = None,
) -> dict[str, Any] | None:
    claim = FnolClaim.objects.filter(complaint_id=complaint_id).first()
    if not claim:
        return None

    if latest_eval is None:
        latest_eval = ClaimEvaluationResponse.objects.filter(
            complaint_id=complaint_id, is_latest=True
        ).first()

    summary = build_claim_decision_summary(claim=claim, latest_eval=latest_eval)
    if not latest_eval:
        return summary

    if summary["approval_state"] not in {
        "straight_through_eligible",
        "manual_review_required",
        "rejected",
    }:
        return summary

    desired_decision = summary["decision"]
    desired_reason = summary["status_detail"]
    update_fields: list[str] = []

    if desired_decision and latest_eval.decision != desired_decision:
        latest_eval.decision = desired_decision[:20]
        update_fields.append("decision")
    if desired_reason and latest_eval.reason != desired_reason:
        latest_eval.reason = desired_reason
        update_fields.append("reason")

    if update_fields:
        update_fields.append("updated_date")
        latest_eval.save(update_fields=update_fields)

    return summary
