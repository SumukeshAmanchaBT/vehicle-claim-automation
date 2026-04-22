"""
Context-aware damage enrichment for vehicle claims.

When the visual DA pipeline produces zero part-level output — typically for
non-exterior or non-collision incidents (flood/submersion, fire, rollover,
electrical/mechanical failure, etc.) — this module reasons from all available
claim evidence to produce a structured, probable-damage assessment.

Design principles:
  - Fully evidence-driven: uses LLM reasoning, never hardcodes damage per
    incident type.  The same function handles flood, fire, rollover, electrical
    failure, and any future scenario without code changes.
  - Additive only: called after all visual pipelines have been exhausted.
    Collision claims that already produce visual parts never reach this layer.
  - Explainable: every call records the evidence basis and confidence level in
    the pipeline_metadata so reviewers can audit the reasoning chain.
  - Graceful degradation: returns None when LLM is unavailable or evidence is
    too thin to support a reliable assessment.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from claim_automation.llm_client import get_chat_completion_client_and_model_for_task

logger = logging.getLogger(__name__)


def _build_evidence_summary(
    *,
    incident_type: str | None,
    incident_description: str | None,
    detected_damage_types: list[str],
    severity: str,
    vehicle_profile: dict[str, Any],
) -> tuple[str, bool]:
    """
    Assemble all available evidence into a structured text summary.

    Returns:
        (evidence_text, should_enrich):  should_enrich is False when there is
        genuinely no signal to reason from.
    """
    lines: list[str] = []

    if incident_type and incident_type.strip():
        lines.append(f"Incident type: {incident_type.strip()}")

    if incident_description and incident_description.strip():
        desc = incident_description.strip()
        # Truncate to avoid token overruns in light-profile calls
        lines.append(f"Incident narrative: {desc[:800]}")

    visible_types = [
        str(d).replace("-", " ").replace("_", " ").strip()
        for d in (detected_damage_types or [])
        if str(d).strip().lower() not in ("none", "")
    ]
    if visible_types:
        lines.append(f"Visual analysis detected: {', '.join(visible_types)}")

    if severity and severity.strip().lower() not in ("unknown", ""):
        lines.append(f"Overall severity indicator: {severity.strip()}")

    if isinstance(vehicle_profile, dict):
        vehicle_summary = vehicle_profile.get("display_name") or " ".join(
            str(b).strip()
            for b in (
                vehicle_profile.get("year"),
                vehicle_profile.get("make"),
                vehicle_profile.get("model"),
            )
            if b not in (None, "")
        ).strip()
        if vehicle_summary:
            lines.append(f"Vehicle: {vehicle_summary}")

    evidence_text = "\n".join(f"  • {l}" for l in lines)
    return evidence_text, bool(lines)


def enrich_parts_from_claim_context(
    *,
    incident_type: str | None = None,
    incident_description: str | None = None,
    detected_damage_types: list[str],
    severity: str = "unknown",
    vehicle_profile: dict[str, Any],
    market_context: dict[str, Any],
    currency_code: str = "THB",
) -> list[dict] | None:
    """
    Reason from claim context to produce probable part-level damage assessments.

    Called when the visual DA pipeline returns no parts but claim evidence
    (incident type, narrative, detected image signals, vehicle) indicates that
    significant damage is present.

    The LLM acts as a senior vehicle loss adjuster.  It is instructed to:
      - Only list components supported by the available evidence
      - Include mechanically probable non-visible components (e.g. engine/
        electrical contamination after submersion) when the evidence warrants it
      - Never invent damage without a supporting signal

    Args:
        incident_type:         FnolClaim.incident_type (may be None).
        incident_description:  FnolClaim.incident_description (may be None).
        detected_damage_types: Damage type strings from run_damage_assessment()
                               (e.g. ["flooded", "fire"]).  May be empty.
        severity:              Overall severity label from vision/YOLO pass.
        vehicle_profile:       Dict from get_claim_vehicle_profile().
        market_context:        Dict from get_claim_market_context().
        currency_code:         ISO 4217 code (default "THB").

    Returns:
        List of part-assessment dicts with keys: part, damage_type,
        severity_percent, repair_action, estimated_cost.
        Returns None when LLM is unavailable or evidence is insufficient.
    """
    evidence_text, should_enrich = _build_evidence_summary(
        incident_type=incident_type,
        incident_description=incident_description,
        detected_damage_types=detected_damage_types,
        severity=severity,
        vehicle_profile=vehicle_profile,
    )

    if not should_enrich:
        logger.debug("Context enrichment: no evidence to reason from — skipping.")
        return None

    client, model = get_chat_completion_client_and_model_for_task("heavy_reasoning")
    if client is None or not model:
        logger.debug("Context enrichment: LLM not configured — skipping.")
        return None

    mc = market_context or {}
    currency_code = (mc.get("currency_code") or currency_code or "THB").upper()
    market_label = mc.get("market_label") or "Thailand vehicle repair market"
    market_location = (
        mc.get("accident_location") or mc.get("city") or "Bangkok, Thailand"
    )

    prompt = f"""You are a senior vehicle loss adjuster performing a damage assessment for an insurance claim.

The automated visual inspection system analysed the claim photos but produced no structured part-level damage breakdown. However, the following evidence is available:

Evidence:
{evidence_text}

Your task: Based ONLY on the available evidence above, identify ALL probable vehicle components that are likely damaged.

Include components that:
  - Are directly visible from any visual cue mentioned in the evidence
  - Are mechanically/physically probable given the incident type and narrative
  - Would typically be affected by this type of incident even if not directly photographable

Do NOT:
  - Invent damage not supported by any evidence signal
  - Include components that are unlikely given the incident
  - Make assumptions without evidence

For each probable damaged component provide:
  - part: specific component name (e.g. "Engine", "Electrical Wiring Harness", "Interior Carpet", "Front Bumper", "Fuel System", "Transmission")
  - damage_type: most specific applicable type —
      cosmetic/structural: scratch, dent, crack, deformation, broken, tear
      environmental: flood-contamination, water-ingress, corrosion, heat-damage, smoke-damage, soot
      mechanical/internal: engine-damage, electrical-damage, transmission-damage, fuel-system-damage, fire-damage
  - severity_percent: 0–100 (25=possible/minor, 50=probable/moderate, 75=severe/likely, 90+=replace or total-loss risk)
  - repair_action: REPAIR / REPLACE / PAINT / NONE
  - estimated_cost: conservative, evidence-based estimate in {currency_code} for {market_label} near {market_location}

Market pricing: Use current {market_label} repair market costs. Conservative but realistic estimates.

Respond ONLY in this exact JSON format, no other text:
{{
    "assessment_basis": "brief description of the evidence that drove this assessment",
    "confidence": "high|medium|low",
    "damages": [
        {{
            "part": "...",
            "damage_type": "...",
            "severity_percent": <number>,
            "repair_action": "...",
            "estimated_cost": <number>
        }}
    ]
}}

If the evidence does not support any probable damage (no meaningful signals at all), return:
{{"assessment_basis": "insufficient evidence", "confidence": "low", "damages": []}}"""

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1200,
            temperature=0.1,
        )
        text = (resp.choices[0].message.content or "").strip()
        if not text:
            return None

        # Extract JSON even if wrapped in code fences
        start = text.find("{")
        if start >= 0:
            end = text.rfind("}")
            if end > start:
                text = text[start : end + 1]

        data = json.loads(text)
        raw_damages = data.get("damages") or []

        enriched: list[dict] = []
        for d in raw_damages:
            if not isinstance(d, dict):
                continue
            part = str(d.get("part", "")).strip()
            if not part:
                continue

            damage_type = str(d.get("damage_type", "")).strip().lower() or "damage"

            try:
                severity_percent = max(
                    0, min(100, int(float(d.get("severity_percent", 50) or 50)))
                )
            except (TypeError, ValueError):
                severity_percent = 50

            repair_action = str(d.get("repair_action", "REPAIR")).strip().upper()
            if repair_action not in ("REPAIR", "REPLACE", "PAINT", "NONE"):
                repair_action = "REPAIR"

            try:
                estimated_cost = max(0.0, float(d.get("estimated_cost", 0) or 0))
            except (TypeError, ValueError):
                estimated_cost = 0.0

            enriched.append(
                {
                    "part": part,
                    "damage_type": damage_type,
                    "severity_percent": severity_percent,
                    "repair_action": repair_action,
                    "estimated_cost": estimated_cost,
                }
            )

        if enriched:
            confidence = str(data.get("confidence", "medium")).lower()
            basis = str(data.get("assessment_basis", "claim context reasoning")).strip()
            logger.info(
                "Context enrichment produced %d parts (confidence=%s basis=%r)",
                len(enriched),
                confidence,
                basis[:120],
            )

        return enriched if enriched else None

    except Exception:
        logger.warning("Context enrichment LLM call failed", exc_info=True)
        return None
