import json
import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import (
    ClaimEvaluationResponse,
    ClaimInvoiceAnalysis,
    ClaimPhase1Valuation,
    ClaimValuationExplanation,
    ClaimVideoAnalysisResult,
    DigitizationDocument,
    DigitizationExtraction,
    DigitizationPartLine,
    FnolClaim,
)
from .phase1_runtime import get_claim_market_context

logger = logging.getLogger(__name__)


def _json_safe(value: Any) -> Any:
    """Convert model values into JSON-friendly primitives."""
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(v) for v in value]
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def _decimal_to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _latest_phase1_valuation(claim: FnolClaim) -> ClaimPhase1Valuation | None:
    return ClaimPhase1Valuation.objects.filter(complaint=claim).first()


def _latest_valuation_explanation(claim: FnolClaim) -> ClaimValuationExplanation | None:
    return ClaimValuationExplanation.objects.filter(complaint=claim).first()


def _latest_digitization_document(claim: FnolClaim) -> DigitizationDocument | None:
    documents = list(
        DigitizationDocument.objects.filter(complaint_id=claim.complaint_id).order_by(
            "-created_date", "-id"
        )
    )
    if not documents:
        return None

    preferred = next(
        (
            doc
            for doc in documents
            if (doc.document_category == DigitizationDocument.DOCUMENT_CATEGORY_REPAIR)
            or "invoice" in (doc.document_type or "").lower()
        ),
        None,
    )
    return preferred or documents[0]


def _latest_completed_extraction(document: DigitizationDocument | None) -> DigitizationExtraction | None:
    if not document:
        return None
    extraction = getattr(document, "extraction", None)
    if extraction and extraction.status == DigitizationExtraction.STATUS_COMPLETED:
        return extraction
    return None


def _serialize_phase1_valuation(
    claim: FnolClaim, valuation: ClaimPhase1Valuation | None
) -> dict[str, Any]:
    market_context = get_claim_market_context(claim=claim)
    payload = {
        "gross_estimate": _decimal_to_float(valuation.gross_estimate) if valuation else None,
        "excess_amount": _decimal_to_float(valuation.excess_amount) if valuation else None,
        "net_payable": _decimal_to_float(valuation.net_payable) if valuation else None,
        "currency_code": (valuation.currency_code if valuation and valuation.currency_code else market_context.get("currency_code") or "").upper(),
        "breakdown": _json_safe((valuation.breakdown_json if valuation else []) or []),
        "market_context": _json_safe(market_context),
        "updated_at": valuation.updated_at.isoformat() if valuation and valuation.updated_at else None,
    }
    return payload


def _serialize_explanation(
    claim: FnolClaim,
    valuation: ClaimPhase1Valuation | None,
    explanation: ClaimValuationExplanation | None,
) -> dict[str, Any]:
    if explanation:
        payload = {
            "pricing_source": explanation.pricing_source or "persisted_explanation",
            "confidence_level": explanation.confidence_level or "",
            "reasoning_summary": explanation.reasoning_summary or "",
            "explanation_json": _json_safe(explanation.explanation_json or {}),
            "pricing_rule_snapshot_json": _json_safe(
                explanation.pricing_rule_snapshot_json or {}
            ),
            "updated_at": explanation.updated_at.isoformat() if explanation.updated_at else None,
            "status": "persisted",
        }
    else:
        valuation_payload = _serialize_phase1_valuation(claim, valuation)
        payload = {
            "pricing_source": "phase1_valuation",
            "confidence_level": "derived",
            "reasoning_summary": (
                "Derived from the persisted phase-1 valuation snapshot and claim excess."
            ),
            "explanation_json": {
                "gross_estimate": valuation_payload["gross_estimate"],
                "excess_amount": valuation_payload["excess_amount"],
                "net_payable": valuation_payload["net_payable"],
                "breakdown": valuation_payload["breakdown"],
            },
            "pricing_rule_snapshot_json": {
                "market_context": valuation_payload["market_context"],
            },
            "updated_at": valuation_payload["updated_at"],
            "status": "derived",
        }

    payload["valuation"] = _serialize_phase1_valuation(claim, valuation)
    return payload


def _serialize_digitization_document(document: DigitizationDocument | None) -> dict[str, Any] | None:
    if not document:
        return None
    return {
        "id": document.id,
        "complaint_id": document.complaint_id,
        "document_category": document.document_category,
        "document_type": document.document_type,
        "original_filename": document.original_filename,
        "created_date": document.created_date.isoformat() if document.created_date else None,
    }


def _serialize_digitization_extraction(
    extraction: DigitizationExtraction | None,
) -> dict[str, Any] | None:
    if not extraction:
        return None
    parts = []
    for part in extraction.parts.all().order_by("line_index"):
        parts.append(
            {
                "line_index": part.line_index,
                "description": part.description,
                "quantity": _decimal_to_float(part.quantity),
                "unit_price": _decimal_to_float(part.unit_price),
                "amount": _decimal_to_float(part.amount),
            }
        )
    payload = {
        "status": extraction.status,
        "error_message": extraction.error_message,
        "claim_number": extraction.claim_number,
        "vehicle_number": extraction.vehicle_number,
        "engine_number": extraction.engine_number,
        "chassis_number": extraction.chassis_number,
        "make_model": extraction.make_model,
        "total_amount": _decimal_to_float(extraction.total_amount),
        "parts": parts,
        "created_date": extraction.created_date.isoformat() if extraction.created_date else None,
        "updated_date": extraction.updated_date.isoformat() if extraction.updated_date else None,
    }
    try:
        payload["raw_json"] = _json_safe(json.loads(extraction.extracted_json or "{}"))
    except Exception:
        payload["raw_json"] = {}
    return payload


def _serialize_invoice_analysis(analysis: ClaimInvoiceAnalysis | None) -> dict[str, Any] | None:
    if not analysis:
        return None
    return {
        "id": analysis.id,
        "status": analysis.status,
        "invoice_total": _decimal_to_float(analysis.invoice_total),
        "valuation_total": _decimal_to_float(analysis.valuation_total),
        "discrepancy_amount": _decimal_to_float(analysis.discrepancy_amount),
        "requires_manual_review": bool(analysis.requires_manual_review),
        "summary_text": analysis.summary_text,
        "extracted_payload_json": _json_safe(analysis.extracted_payload_json or {}),
        "discrepancy_json": _json_safe(analysis.discrepancy_json or {}),
        "created_at": analysis.created_at.isoformat() if analysis.created_at else None,
        "updated_at": analysis.updated_at.isoformat() if analysis.updated_at else None,
        "document": _serialize_digitization_document(analysis.document),
        "extraction": _serialize_digitization_extraction(analysis.extraction),
    }


def _serialize_video_analysis(result: ClaimVideoAnalysisResult | None) -> dict[str, Any] | None:
    if not result:
        return None
    return {
        "id": result.id,
        "job_id": result.job_id,
        "status": result.status,
        "summary_text": result.summary_text,
        "analysis_context_json": _json_safe(result.analysis_context_json or {}),
        "keyframes_json": _json_safe(result.keyframes_json or []),
        "timeline_json": _json_safe(result.timeline_json or []),
        "metrics_json": _json_safe(result.metrics_json or {}),
        "motion_summary_json": _json_safe(result.motion_summary_json or {}),
        "scenario_summary_json": _json_safe(result.scenario_summary_json or {}),
        "fraud_signals_json": _json_safe(result.fraud_signals_json or {}),
        "decision_support_json": _json_safe(result.decision_support_json or {}),
        "progress_json": _json_safe(result.progress_json or {}),
        "error_json": _json_safe(result.error_json or {}),
        "processing_started_at": result.processing_started_at.isoformat()
        if result.processing_started_at
        else None,
        "processing_completed_at": result.processing_completed_at.isoformat()
        if result.processing_completed_at
        else None,
        "created_at": result.created_at.isoformat() if result.created_at else None,
        "updated_at": result.updated_at.isoformat() if result.updated_at else None,
    }


def _build_invoice_analysis_payload(
    claim: FnolClaim,
    document: DigitizationDocument | None,
    extraction: DigitizationExtraction | None,
) -> dict[str, Any]:
    valuation = _latest_phase1_valuation(claim)
    valuation_total = _decimal_to_float(valuation.gross_estimate) if valuation else None
    invoice_total = None
    parts = []
    extracted_payload = {}

    if extraction:
        try:
            extracted_payload = json.loads(extraction.extracted_json or "{}")
        except Exception:
            extracted_payload = {}
        parts = [
            {
                "line_index": part.line_index,
                "description": part.description,
                "quantity": _decimal_to_float(part.quantity),
                "unit_price": _decimal_to_float(part.unit_price),
                "amount": _decimal_to_float(part.amount),
            }
            for part in extraction.parts.all().order_by("line_index")
        ]
        invoice_total = _decimal_to_float(extraction.total_amount)
        if invoice_total is None:
            invoice_total = round(
                sum(float(part["amount"] or 0) for part in parts),
                2,
            )

    discrepancy = None
    discrepancy_json: dict[str, Any] = {}
    requires_manual_review = False
    status_text = ClaimInvoiceAnalysis.Status.COMPLETED
    summary_text = "Invoice analysis completed from the latest completed extraction."

    if invoice_total is None or valuation_total is None:
        requires_manual_review = True
        status_text = ClaimInvoiceAnalysis.Status.FAILED
        summary_text = "Invoice analysis is incomplete because invoice or valuation totals are missing."
        discrepancy_json = {
            "reason": "missing_totals",
            "has_invoice_total": invoice_total is not None,
            "has_valuation_total": valuation_total is not None,
        }
    else:
        discrepancy = round(invoice_total - valuation_total, 2)
        discrepancy_json = {
            "invoice_total": invoice_total,
            "valuation_total": valuation_total,
            "discrepancy_amount": discrepancy,
            "absolute_difference": round(abs(discrepancy), 2),
            "direction": "above_estimate" if discrepancy > 0 else "below_estimate" if discrepancy < 0 else "aligned",
        }
        requires_manual_review = abs(discrepancy) > 0.01
        if requires_manual_review:
            summary_text = (
                "Invoice total differs from the phase-1 valuation and should be reviewed."
            )
        else:
            summary_text = "Invoice total aligns with the phase-1 valuation snapshot."

    analysis = ClaimInvoiceAnalysis.objects.create(
        complaint=claim,
        document=document,
        extraction=extraction,
        status=status_text,
        invoice_total=invoice_total,
        valuation_total=valuation_total,
        discrepancy_amount=discrepancy,
        requires_manual_review=requires_manual_review,
        summary_text=summary_text,
        extracted_payload_json=_json_safe(extracted_payload),
        discrepancy_json=_json_safe(discrepancy_json),
    )

    return {
        "analysis": _serialize_invoice_analysis(analysis),
        "status": analysis.status,
        "document": _serialize_digitization_document(document),
        "extraction": _serialize_digitization_extraction(extraction),
        "invoice_total": _decimal_to_float(analysis.invoice_total),
        "valuation_total": _decimal_to_float(analysis.valuation_total),
        "discrepancy_amount": _decimal_to_float(analysis.discrepancy_amount),
        "requires_manual_review": analysis.requires_manual_review,
        "summary_text": analysis.summary_text,
        "parts": parts,
        "discrepancy_json": _json_safe(discrepancy_json),
    }


def _build_reasoning_summary_payload(claim: FnolClaim) -> dict[str, Any]:
    valuation = _latest_phase1_valuation(claim)
    explanation = _latest_valuation_explanation(claim)
    invoice_analysis = ClaimInvoiceAnalysis.objects.filter(complaint=claim).order_by(
        "-created_at", "-id"
    ).first()
    evaluation = (
        ClaimEvaluationResponse.objects.filter(complaint_id=claim.complaint_id, is_latest=True)
        .order_by("-version", "-created_date")
        .first()
    )
    video_analysis = ClaimVideoAnalysisResult.objects.filter(complaint=claim).order_by(
        "-created_at", "-id"
    ).first()

    valuation_payload = _serialize_phase1_valuation(claim, valuation)
    explanation_payload = _serialize_explanation(claim, valuation, explanation)
    invoice_payload = _serialize_invoice_analysis(invoice_analysis)
    video_payload = _serialize_video_analysis(video_analysis)

    points: list[dict[str, Any]] = []
    summary_bits: list[str] = []

    if evaluation:
        points.append(
            {
                "type": "evaluation",
                "decision": evaluation.decision,
                "claim_status": evaluation.claim_status,
                "claim_type": evaluation.claim_type,
                "reason": evaluation.reason,
            }
        )
        if evaluation.decision:
            summary_bits.append(f"Decision: {evaluation.decision}.")
        if evaluation.reason:
            summary_bits.append(evaluation.reason)

    if explanation_payload.get("reasoning_summary"):
        points.append(
            {
                "type": "pricing_explanation",
                "pricing_source": explanation_payload.get("pricing_source"),
                "confidence_level": explanation_payload.get("confidence_level"),
                "summary": explanation_payload.get("reasoning_summary"),
            }
        )
        summary_bits.append(str(explanation_payload.get("reasoning_summary")))

    if invoice_payload:
        points.append(
            {
                "type": "invoice_analysis",
                "status": invoice_payload.get("status"),
                "requires_manual_review": invoice_payload.get("requires_manual_review"),
                "discrepancy_amount": invoice_payload.get("discrepancy_amount"),
            }
        )
        summary_bits.append(str(invoice_payload.get("summary_text")))

    if video_payload:
        points.append(
            {
                "type": "video_analysis",
                "status": video_payload.get("status"),
                "summary_text": video_payload.get("summary_text"),
            }
        )
        if video_payload.get("summary_text"):
            summary_bits.append(str(video_payload.get("summary_text")))

    if not summary_bits:
        summary_bits.append("No persisted phase-2 evidence is available yet.")

    return {
        "complaint_id": claim.complaint_id,
        "claim_context": _json_safe(
            {
                "policy_number": claim.policy_number,
                "policy_holder_name": claim.policy_holder_name,
                "vehicle_make": claim.vehicle_make,
                "vehicle_model": claim.vehicle_model,
                "incident_type": claim.incident_type,
                "incident_description": claim.incident_description,
                "market_context": get_claim_market_context(claim=claim),
            }
        ),
        "valuation": valuation_payload,
        "pricing_explanation": explanation_payload,
        "invoice_analysis": invoice_payload,
        "video_analysis": video_payload,
        "reasoning_points": _json_safe(points),
        "summary_text": " ".join(s.strip() for s in summary_bits if s and s.strip()),
        "decision": evaluation.decision if evaluation else None,
        "claim_status": evaluation.claim_status if evaluation else None,
        "claim_type": evaluation.claim_type if evaluation else None,
        "evaluation": _json_safe(
            {
                "id": evaluation.id if evaluation else None,
                "version": evaluation.version if evaluation else None,
                "is_latest": evaluation.is_latest if evaluation else None,
                "damage_confidence": _decimal_to_float(evaluation.damage_confidence) if evaluation else None,
                "estimated_amount": _decimal_to_float(evaluation.estimated_amount) if evaluation else None,
                "claim_amount": _decimal_to_float(evaluation.claim_amount) if evaluation else None,
                "decision": evaluation.decision if evaluation else None,
                "reason": evaluation.reason if evaluation else None,
            }
        ),
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def pricing_explain(request, complaint_id: str):
    """GET pricing explanation for a claim."""
    claim = get_object_or_404(FnolClaim, complaint_id=complaint_id)
    valuation = _latest_phase1_valuation(claim)
    explanation = _latest_valuation_explanation(claim)
    if not valuation and not explanation:
        return Response(
            {"error": "Pricing explanation is not available for this claim."},
            status=status.HTTP_404_NOT_FOUND,
        )

    return Response(
        {
            "complaint_id": claim.complaint_id,
            "pricing_explanation": _serialize_explanation(claim, valuation, explanation),
        },
        status=status.HTTP_200_OK,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def invoice_analyze(request, complaint_id: str):
    """POST invoice analysis for the latest digitization document linked to a claim."""
    claim = get_object_or_404(FnolClaim, complaint_id=complaint_id)
    document = _latest_digitization_document(claim)
    if not document:
        return Response(
            {"error": "No digitization document is available for this claim."},
            status=status.HTTP_404_NOT_FOUND,
        )

    extraction = _latest_completed_extraction(document)
    with transaction.atomic():
        payload = _build_invoice_analysis_payload(claim, document, extraction)

    http_status = (
        status.HTTP_200_OK
        if payload["status"] == ClaimInvoiceAnalysis.Status.COMPLETED
        else status.HTTP_409_CONFLICT
    )
    return Response(
        {
            "complaint_id": claim.complaint_id,
            **payload,
        },
        status=http_status,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def reasoning_summary(request, complaint_id: str):
    """POST a JSON-safe summary of the claim reasoning chain."""
    claim = get_object_or_404(FnolClaim, complaint_id=complaint_id)
    return Response(_build_reasoning_summary_payload(claim), status=status.HTTP_200_OK)


# Keep exported names stable for URL wiring and lightweight reflection in tests.
pricing_explain.__name__ = "pricing_explain"
invoice_analyze.__name__ = "invoice_analyze"
reasoning_summary.__name__ = "reasoning_summary"
