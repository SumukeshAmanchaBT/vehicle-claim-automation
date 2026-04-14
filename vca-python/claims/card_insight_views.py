"""
Authenticated FNOL-scoped APIs for damage-assessment card summaries and drawer payloads.
"""

from __future__ import annotations

import logging

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from claims.card_insights import (
    CARD_KEYS,
    build_card_details_payload,
    build_card_summary_payload,
    fallback_summary_card,
    normalize_card_key,
    upsert_card_insight,
)
from claims.models import ClaimCardInsight, ClaimEvaluationResponse, FnolClaim
from claims.serializers import (
    DamageAssessmentCardDetailsSerializer,
    DamageAssessmentCardsResponseSerializer,
)

logger = logging.getLogger(__name__)


def _get_claim(complaint_id: str) -> FnolClaim | None:
    return FnolClaim.objects.filter(complaint_id=complaint_id).first()


def _latest_evaluation(complaint_id: str) -> ClaimEvaluationResponse | None:
    return (
        ClaimEvaluationResponse.objects.filter(
            complaint_id=complaint_id, is_latest=True
        ).first()
    )


def _response_cards_payload(complaint_id: str) -> dict:
    claim = _get_claim(complaint_id)
    if not claim:
        return {}
    latest = _latest_evaluation(complaint_id)
    insights = {
        row.card_key: row
        for row in ClaimCardInsight.objects.filter(claim=claim)
    }
    cards = []
    for key in CARD_KEYS:
        try:
            cards.append(
                build_card_summary_payload(
                    claim, key, latest, insight=insights.get(key)
                )
            )
        except Exception:
            logger.exception("damage_assessment_cards summary failed for %s", key)
            cards.append(fallback_summary_card(claim, key))
    return {"complaint_id": complaint_id, "cards": cards}


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def damage_assessment_cards(request, complaint_id: str):
    """
    GET /api/fnol/<complaint_id>/damage-assessment/cards
    """
    claim = _get_claim(complaint_id)
    if not claim:
        return Response(
            {
                "error": "not_found",
                "detail": f"Claim {complaint_id} not found",
            },
            status=status.HTTP_404_NOT_FOUND,
        )
    body = _response_cards_payload(complaint_id)
    ser = DamageAssessmentCardsResponseSerializer(data=body)
    ser.is_valid(raise_exception=True)
    return Response(ser.validated_data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def damage_assessment_card_details(request, complaint_id: str, card_key: str):
    """
    GET /api/fnol/<complaint_id>/damage-assessment/cards/<card_key>/details
    """
    normalized = normalize_card_key(card_key)
    if not normalized:
        return Response(
            {
                "error": "invalid_card_key",
                "detail": f"Unknown card_key {card_key!r}",
                "allowed": list(CARD_KEYS),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    claim = _get_claim(complaint_id)
    if not claim:
        return Response(
            {
                "error": "not_found",
                "detail": f"Claim {complaint_id} not found",
            },
            status=status.HTTP_404_NOT_FOUND,
        )
    latest = _latest_evaluation(complaint_id)
    insight = ClaimCardInsight.objects.filter(
        claim=claim, card_key=normalized
    ).first()
    detail = build_card_details_payload(
        claim, normalized, latest, insight=insight
    )
    ser = DamageAssessmentCardDetailsSerializer(data=detail)
    ser.is_valid(raise_exception=True)
    return Response(ser.validated_data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def damage_assessment_card_refresh(request, complaint_id: str, card_key: str):
    """
    POST /api/fnol/<complaint_id>/damage-assessment/cards/<card_key>/refresh
    Rebuilds ClaimCardInsight from current DB state. Grounded fields are analyzer-only;
    narrative may use optional LLM when CARD_AI_NARRATIVE_ENABLED and chat client are set.
    """
    normalized = normalize_card_key(card_key)
    if not normalized:
        return Response(
            {
                "error": "invalid_card_key",
                "detail": f"Unknown card_key {card_key!r}",
                "allowed": list(CARD_KEYS),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    claim = _get_claim(complaint_id)
    if not claim:
        return Response(
            {
                "error": "not_found",
                "detail": f"Claim {complaint_id} not found",
            },
            status=status.HTTP_404_NOT_FOUND,
        )
    latest = _latest_evaluation(complaint_id)
    try:
        _insight, detail = upsert_card_insight(claim, normalized, latest)
    except Exception:
        logger.exception("damage_assessment_card_refresh failed")
        return Response(
            {
                "error": "refresh_failed",
                "detail": "Could not refresh card insight from persisted data.",
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
    ser = DamageAssessmentCardDetailsSerializer(data=detail)
    ser.is_valid(raise_exception=True)
    return Response(ser.validated_data, status=status.HTTP_200_OK)
