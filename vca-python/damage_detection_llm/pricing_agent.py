"""
Dynamic Pricing Agent for vehicle repair cost estimation.

Performs web searches for real-time market repair prices per damaged part,
then uses LLM reasoning (extended thinking mode when available) to produce
accurate, regional cost estimates with confidence intervals.

Designed with graceful degradation:
- If web search is unavailable → LLM uses its own training-data pricing knowledge
- If LLM is unavailable → returns None (caller falls back to YOLO pipeline)
"""
from __future__ import annotations

import json
import logging
from datetime import date
from typing import Any

logger = logging.getLogger(__name__)


def _web_search_part_price(
    part_name: str,
    damage_type: str,
    repair_action: str,
    region: str = "Thailand vehicle repair market",
    currency_code: str = "THB",
    max_results: int = 3,
) -> list[str]:
    """
    Search the web for current market pricing for a specific vehicle part repair.

    Returns a list of relevant text snippets to feed into the LLM for reasoning.
    Returns empty list if duckduckgo-search is not installed or search fails.
    """
    current_year = date.today().year
    previous_year = current_year - 1
    query = (
        f"{part_name} {repair_action.lower()} repair cost {damage_type} "
        f"auto body shop {region} {currency_code} {previous_year} {current_year} price estimate"
    )
    try:
        from duckduckgo_search import DDGS

        snippets: list[str] = []
        with DDGS() as ddgs:
            for result in ddgs.text(query, max_results=max_results):
                body = result.get("body") or result.get("snippet") or ""
                if body:
                    snippets.append(body[:400])
        return sorted(dict.fromkeys(snippets))
    except ImportError:
        logger.debug(
            "duckduckgo-search not installed — skipping web search for pricing. "
            "Install with: pip install duckduckgo-search"
        )
        return []
    except Exception as exc:
        logger.warning("Web search for part pricing failed: %s", exc)
        return []


def _build_pricing_prompt(
    parts: list[dict],
    web_context: dict[str, list[str]],
    *,
    region: str,
    currency_code: str,
    vehicle_profile: dict[str, Any] | None,
) -> str:
    """
    Build a structured LLM prompt that combines visual damage data with
    web-sourced pricing context to produce refined cost estimates.
    """
    parts_text = "\n".join(
        f"- Part: {p.get('part','?')} | Damage: {p.get('damage_type','?')} | "
        f"Severity: {p.get('severity_percent',0)}% | Action: {p.get('repair_action','?')} | "
        f"Initial visual estimate: {currency_code} {p.get('estimated_cost', 0):.2f}"
        for p in parts
    )

    search_text = ""
    for part_name, snippets in web_context.items():
        if snippets:
            search_text += f"\n### Pricing data for '{part_name}':\n"
            for i, s in enumerate(snippets, 1):
                search_text += f"  [{i}] {s}\n"

    vehicle_summary = None
    if isinstance(vehicle_profile, dict):
        vehicle_summary = (
            vehicle_profile.get("display_name")
            or " ".join(
                str(bit).strip()
                for bit in (
                    vehicle_profile.get("year"),
                    vehicle_profile.get("make"),
                    vehicle_profile.get("model"),
                )
                if bit not in (None, "")
            ).strip()
        )
    vehicle_ctx = (
        f"\nVehicle profile: {vehicle_summary}"
        if vehicle_summary
        else "\nVehicle profile: not provided"
    )

    return f"""You are an expert vehicle insurance claims estimator with access to current market data.

A vehicle has been assessed by a computer vision system. Below are the damaged parts identified with initial cost estimates. You also have real-time web search results for current auto body repair pricing.
Target market: {region}
All money fields must be returned in {currency_code}.
Use the declared vehicle profile only when it materially affects parts pricing. Do not vary estimates because of policy or claimant details.

## Damaged Parts (from visual AI assessment):
{parts_text}
{vehicle_ctx}

## Web-sourced market pricing context:
{search_text if search_text else "No web search data available — use your training knowledge for current pricing."}

## Your Task:
For EACH part listed above, provide a REFINED cost estimate based on:
1. The web search pricing data (where available)
2. Current labor and parts pricing for {region}
3. OEM vs aftermarket considerations relevant to {region}
4. Severity percentage impact on total cost
5. Regional market adjustments and taxes where appropriate

Apply extended reasoning to estimate repair complexity. Provide probabilistic cost ranges with a point estimate.

Respond ONLY with this exact JSON format:
{{
  "refined_parts": [
    {{
      "part": "exact part name from above",
      "damage_type": "exact damage type from above",
      "severity_percent": <number>,
      "repair_action": "exact action from above",
      "estimated_cost": <best point estimate as number in {currency_code}>,
      "cost_range_low": <conservative low estimate>,
      "cost_range_high": <upper bound estimate>,
      "pricing_basis": "brief source notes, e.g. 'Front bumper repaint + 3 labour hours in Bangkok market'"
    }}
  ],
  "total_low": <sum of all cost_range_low>,
  "total_high": <sum of all cost_range_high>,
  "total_estimate": <sum of all estimated_cost>,
  "confidence_level": "high|medium|low",
  "pricing_source": "web_search|training_knowledge|mixed",
  "reasoning_summary": "1-2 sentences on key pricing factors applied"
}}"""


def run_pricing_agent(
    initial_parts: list[dict],
    incident_description: str | None = None,
    region: str = "Thailand vehicle repair market",
    currency_code: str = "THB",
    vehicle_profile: dict[str, Any] | None = None,
    enable_web_search: bool = True,
) -> dict[str, Any] | None:
    """
    Run the Dynamic Pricing Agent on a list of initially-assessed damage parts.

    Args:
        initial_parts: List of dicts from _analyze_damage_part_level (part, damage_type,
                       severity_percent, repair_action, estimated_cost).
        incident_description: Optional claim description for context.
        region: Market region string for price context.
        currency_code: ISO 4217 currency code used in prompts and returned estimates.
        enable_web_search: Whether to perform web searches (can be disabled for test envs).

    Returns:
        Dict with 'refined_parts', totals, confidence_level, pricing_source,
        and 'reasoning_summary'. Returns None if LLM is not configured.

    Graceful degradation: always returns something or None — never raises.
    """
    if not initial_parts:
        return None

    from claim_automation.llm_client import get_chat_completion_client_and_model

    client, model = get_chat_completion_client_and_model()
    if client is None or not model:
        logger.debug("Pricing agent: LLM not configured, skipping refined pricing.")
        return None

    # Step 1: Web search for pricing context per part
    web_context: dict[str, list[str]] = {}
    if enable_web_search:
        for part in initial_parts:
            part_name = part.get("part", "")
            damage_type = part.get("damage_type", "")
            repair_action = part.get("repair_action", "REPAIR")
            if part_name:
                snippets = _web_search_part_price(
                    part_name,
                    damage_type,
                    repair_action,
                    region,
                    currency_code,
                )
                if snippets:
                    web_context[part_name] = snippets

    # Step 2: LLM reasoning with market context
    prompt = _build_pricing_prompt(
        initial_parts,
        web_context,
        region=region,
        currency_code=currency_code,
        vehicle_profile=vehicle_profile,
    )

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2000,
            temperature=0.1,  # Low temperature for consistent pricing
        )

        text = (resp.choices[0].message.content or "").strip()
        if not text:
            return None

        # Extract JSON from markdown code blocks if present
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            text = text[start : end + 1]

        data = json.loads(text)

        # Validate and normalise refined_parts list
        refined = []
        for rp in data.get("refined_parts", []):
            if not isinstance(rp, dict):
                continue
            part_name = str(rp.get("part", "")).strip()
            if not part_name:
                continue

            try:
                estimated_cost = float(rp.get("estimated_cost", 0) or 0)
            except (ValueError, TypeError):
                estimated_cost = 0.0

            try:
                cost_low = float(rp.get("cost_range_low", estimated_cost * 0.8) or 0)
            except (ValueError, TypeError):
                cost_low = estimated_cost * 0.8

            try:
                cost_high = float(rp.get("cost_range_high", estimated_cost * 1.25) or 0)
            except (ValueError, TypeError):
                cost_high = estimated_cost * 1.25

            severity = int(rp.get("severity_percent", 50) or 50)
            severity = max(0, min(100, severity))

            repair_action = str(rp.get("repair_action", "REPAIR")).strip().upper()
            if repair_action not in ("REPAIR", "REPLACE", "PAINT", "NONE"):
                repair_action = "REPAIR"

            refined.append({
                "part": part_name,
                "damage_type": str(rp.get("damage_type", "")).strip().lower(),
                "severity_percent": severity,
                "repair_action": repair_action,
                "estimated_cost": estimated_cost,
                "cost_range_low": round(cost_low, 2),
                "cost_range_high": round(cost_high, 2),
                "pricing_basis": str(rp.get("pricing_basis", "")).strip()[:300],
            })

        if not refined:
            return None

        total_estimate = sum(p["estimated_cost"] for p in refined)
        total_low = sum(p["cost_range_low"] for p in refined)
        total_high = sum(p["cost_range_high"] for p in refined)

        confidence = str(data.get("confidence_level", "medium")).strip().lower()
        if confidence not in ("high", "medium", "low"):
            confidence = "medium"

        pricing_source = str(data.get("pricing_source", "training_knowledge")).strip().lower()
        if web_context:
            pricing_source = "mixed" if "training" in pricing_source else "web_search"
        else:
            pricing_source = "training_knowledge"

        return {
            "refined_parts": refined,
            "total_estimate": round(total_estimate, 2),
            "total_low": round(total_low, 2),
            "total_high": round(total_high, 2),
            "confidence_level": confidence,
            "pricing_source": pricing_source,
            "reasoning_summary": str(data.get("reasoning_summary", ""))[:500],
            "web_search_used": bool(web_context),
            "parts_searched": list(web_context.keys()),
        }

    except json.JSONDecodeError as exc:
        logger.warning("Pricing agent: failed to parse LLM JSON response: %s", exc)
        return None
    except Exception as exc:
        logger.warning("Pricing agent: unexpected error: %s", exc)
        return None
