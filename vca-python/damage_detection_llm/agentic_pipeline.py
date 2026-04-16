"""
LangGraph Agentic Pipeline for vehicle damage assessment.

Orchestrates a multi-stage pipeline:
  Node A: Part Segmentation  — Vision LLM identifies damaged parts from image
  Node B: Pricing Agent      — Web search + LLM reasoning for market pricing
  Node C: Estimation Agent   — Aggregates into final structured claim output

Designed for 100% graceful degradation:
- If langgraph is not installed → ImportError caught by caller, falls back to existing Vision LLM path
- If any node fails → previous-stage data is returned (never None if Part Segmentation succeeds)
- Pipeline metadata is always included for UI transparency

Usage:
    from damage_detection_llm.agentic_pipeline import run_agentic_pipeline
    result = run_agentic_pipeline(image_path, complaint_id, incident_description)
    # result is None if langgraph unavailable → caller uses existing _analyze_damage_part_level()
"""
from __future__ import annotations

import importlib.util
import logging
from typing import Any, TypedDict

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# LangGraph State definition
# ---------------------------------------------------------------------------

class DamageState(TypedDict, total=False):
    """Shared state passed between LangGraph pipeline nodes."""
    image_path: str
    complaint_id: str
    incident_description: str | None
    region: str
    currency_code: str
    enable_web_search: bool
    vehicle_profile: dict | None
    market_context: dict | None
    agentic_runtime: dict[str, Any]

    # After Part Segmentation node
    initial_parts: list[dict]
    segmentation_success: bool

    # After Pricing Agent node
    pricing_result: dict | None
    pricing_success: bool

    # After Estimation node
    final_parts: list[dict]
    pipeline_metadata: dict
    total_estimated_cost: float


def _module_available(module_name: str) -> bool:
    try:
        return importlib.util.find_spec(module_name) is not None
    except (ImportError, ModuleNotFoundError, ValueError):
        return False


def get_agentic_pipeline_runtime_status(
    *,
    enable_web_search: bool = True,
    prefer_agentic_pipeline: bool = True,
) -> dict[str, Any]:
    from claim_automation.llm_client import llm_configured

    langgraph_available = _module_available("langgraph")
    web_search_available = _module_available("duckduckgo_search")
    llm_available = llm_configured()

    blocking_reasons: list[str] = []
    advisory_notes: list[str] = []
    if prefer_agentic_pipeline and not langgraph_available:
        blocking_reasons.append("langgraph is not installed.")
    if prefer_agentic_pipeline and not llm_available:
        blocking_reasons.append("LLM client is not configured.")
    if enable_web_search and not web_search_available:
        advisory_notes.append(
            "duckduckgo-search is not installed; pricing agent will use model knowledge only."
        )

    if not prefer_agentic_pipeline:
        selected_mode = "vision_llm_direct"
        selection_reason = "agentic pipeline preference is disabled."
        available = False
    elif blocking_reasons:
        selected_mode = "vision_llm_direct"
        selection_reason = "; ".join(blocking_reasons)
        available = False
    elif enable_web_search and web_search_available:
        selected_mode = "langgraph_full"
        selection_reason = ""
        available = True
    else:
        selected_mode = "langgraph_no_web_search"
        selection_reason = "; ".join(advisory_notes)
        available = True

    return {
        "requested": "langgraph_agentic" if prefer_agentic_pipeline else "vision_llm_direct",
        "selected_mode": selected_mode,
        "available": available,
        "langgraph_available": langgraph_available,
        "llm_available": llm_available,
        "web_search_requested": bool(enable_web_search),
        "web_search_available": web_search_available,
        "blocking_reasons": blocking_reasons,
        "advisory_notes": advisory_notes,
        "selection_reason": selection_reason,
    }


# ---------------------------------------------------------------------------
# Pipeline Nodes
# ---------------------------------------------------------------------------

def _node_part_segmentation(state: DamageState) -> DamageState:
    """
    Node A: Run Vision LLM part-level segmentation on the image.
    Populates state['initial_parts'].
    """
    from damage_detection_llm.services import _analyze_damage_part_level

    image_path = state.get("image_path", "")
    logger.debug("LangGraph node A (part_segmentation): analyzing %s", image_path)

    try:
        parts = _analyze_damage_part_level(
            image_path,
            market_context=state.get("market_context"),
            vehicle_profile=state.get("vehicle_profile"),
        )
        if parts:
            return {
                **state,
                "initial_parts": parts,
                "segmentation_success": True,
            }
        else:
            return {**state, "initial_parts": [], "segmentation_success": False}
    except Exception as exc:
        logger.warning("Part segmentation node failed: %s", exc)
        return {**state, "initial_parts": [], "segmentation_success": False}


def _node_pricing_agent(state: DamageState) -> DamageState:
    """
    Node B: Run the Dynamic Pricing Agent to enrich part costs with market data.
    Populates state['pricing_result'].
    """
    from damage_detection_llm.pricing_agent import run_pricing_agent

    initial_parts = state.get("initial_parts") or []
    if not initial_parts:
        return {**state, "pricing_result": None, "pricing_success": False}

    logger.debug("LangGraph node B (pricing_agent): processing %d parts", len(initial_parts))

    try:
        result = run_pricing_agent(
            initial_parts=initial_parts,
            incident_description=state.get("incident_description"),
            region=state.get("region", "Thailand vehicle repair market"),
            currency_code=state.get("currency_code", "THB"),
            vehicle_profile=state.get("vehicle_profile"),
            enable_web_search=state.get("enable_web_search", True),
        )
        if result and result.get("refined_parts"):
            return {**state, "pricing_result": result, "pricing_success": True}
        else:
            return {**state, "pricing_result": None, "pricing_success": False}
    except Exception as exc:
        logger.warning("Pricing agent node failed: %s", exc)
        return {**state, "pricing_result": None, "pricing_success": False}


def _node_estimation_agent(state: DamageState) -> DamageState:
    """
    Node C: Claims Estimation Agent — merges segmentation and pricing into final output.
    Populates state['final_parts'] and state['pipeline_metadata'].
    """
    pricing_result = state.get("pricing_result")
    initial_parts = state.get("initial_parts") or []
    agentic_runtime = dict(state.get("agentic_runtime") or {})

    if pricing_result and pricing_result.get("refined_parts"):
        # Use pricing-enriched parts
        final_parts = []
        for rp in pricing_result["refined_parts"]:
            final_parts.append({
                "part": rp["part"],
                "damage_type": rp["damage_type"],
                "severity_percent": rp["severity_percent"],
                "repair_action": rp["repair_action"],
                "estimated_cost": rp["estimated_cost"],
                # Range fields stored in pipeline_metadata only, not in DB rows
            })

        total = pricing_result.get("total_estimate", 0.0)
        pipeline_meta = {
            "pipeline": "langgraph_agentic",
            "nodes_executed": ["part_segmentation", "pricing_agent", "estimation_agent"],
            "pricing_source": pricing_result.get("pricing_source", "unknown"),
            "confidence_level": pricing_result.get("confidence_level", "medium"),
            "cost_range": {
                "low": pricing_result.get("total_low", 0.0),
                "high": pricing_result.get("total_high", 0.0),
            },
            "web_search_used": pricing_result.get("web_search_used", False),
            "parts_searched": pricing_result.get("parts_searched", []),
            "reasoning_summary": pricing_result.get("reasoning_summary", ""),
            "regional_context": state.get("region", "Thailand vehicle repair market"),
            "currency_code": state.get("currency_code", "THB"),
            "part_level_ranges": [
                {
                    "part": rp["part"],
                    "estimated_cost": rp["estimated_cost"],
                    "cost_range_low": rp.get("cost_range_low", 0),
                    "cost_range_high": rp.get("cost_range_high", 0),
                    "pricing_basis": rp.get("pricing_basis", ""),
                }
                for rp in pricing_result["refined_parts"]
            ],
            "orchestration_runtime": agentic_runtime,
        }
    else:
        # Pricing failed/unavailable — use initial vision LLM parts as-is
        final_parts = initial_parts
        total = sum(p.get("estimated_cost", 0) for p in initial_parts)
        pipeline_meta = {
            "pipeline": "langgraph_agentic",
            "nodes_executed": ["part_segmentation", "estimation_agent"],
            "pricing_source": "vision_llm_initial",
            "confidence_level": "medium",
            "cost_range": None,
            "web_search_used": False,
            "reasoning_summary": "Pricing agent unavailable; using initial vision LLM cost estimates.",
            "regional_context": state.get("region", "Thailand vehicle repair market"),
            "currency_code": state.get("currency_code", "THB"),
            "part_level_ranges": [],
            "orchestration_runtime": agentic_runtime,
        }

    return {
        **state,
        "final_parts": final_parts,
        "pipeline_metadata": pipeline_meta,
        "total_estimated_cost": round(total, 2),
    }


# ---------------------------------------------------------------------------
# Pipeline Construction + Execution
# ---------------------------------------------------------------------------

def _build_graph():
    """
    Build and compile the LangGraph state machine.
    Raises ImportError if langgraph is not installed (caught by run_agentic_pipeline).
    """
    from langgraph.graph import StateGraph, END

    workflow = StateGraph(DamageState)

    workflow.add_node("part_segmentation", _node_part_segmentation)
    workflow.add_node("pricing_agent", _node_pricing_agent)
    workflow.add_node("estimation_agent", _node_estimation_agent)

    workflow.set_entry_point("part_segmentation")
    workflow.add_edge("part_segmentation", "pricing_agent")
    workflow.add_edge("pricing_agent", "estimation_agent")
    workflow.add_edge("estimation_agent", END)

    return workflow.compile()


def run_agentic_pipeline(
    image_path: str,
    complaint_id: str = "",
    incident_description: str | None = None,
    region: str = "Thailand vehicle repair market",
    currency_code: str = "THB",
    vehicle_profile: dict | None = None,
    market_context: dict | None = None,
    enable_web_search: bool = True,
) -> dict[str, Any] | None:
    """
    Run the full LangGraph agentic pipeline for vehicle damage assessment.

    Args:
        image_path:           Absolute path to the image file on disk.
        complaint_id:         Claim identifier (used for logging only in this pipeline).
        incident_description: Optional claim description to give LLMs context.
        region:               Market region string for pricing.
        currency_code:        ISO 4217 currency code for pricing output.
        enable_web_search:    Set False to skip DuckDuckGo calls (test environments).

    Returns:
        Dict with keys:
            - 'final_parts'       : list[dict] — replacement for _analyze_damage_part_level output
            - 'pipeline_metadata' : dict       — transparency/confidence data
            - 'total_estimated_cost': float
        Returns None if:
            - langgraph is not installed (caller falls back to Vision LLM path)
            - Part segmentation returns no parts (no visible damage)

    Never raises — all exceptions are caught and result in None return.
    """
    runtime_status = get_agentic_pipeline_runtime_status(
        enable_web_search=enable_web_search,
        prefer_agentic_pipeline=True,
    )
    if not runtime_status.get("available"):
        logger.info(
            "LangGraph agentic pipeline unavailable (%s); caller should use fallback.",
            runtime_status.get("selection_reason") or "runtime prerequisites not met",
        )
        return None

    try:
        graph = _build_graph()
    except Exception as exc:
        logger.warning("Failed to build LangGraph pipeline: %s", exc)
        return None

    initial_state: DamageState = {
        "image_path": image_path,
        "complaint_id": complaint_id,
        "incident_description": incident_description,
        "region": region,
        "currency_code": currency_code,
        "enable_web_search": enable_web_search,
        "vehicle_profile": vehicle_profile,
        "market_context": market_context,
        "agentic_runtime": runtime_status,
    }

    try:
        logger.info(
            "LangGraph agentic pipeline starting for complaint_id=%s image=%s",
            complaint_id, image_path,
        )
        final_state = graph.invoke(initial_state)

        final_parts = final_state.get("final_parts") or []
        if not final_parts:
            logger.debug("Agentic pipeline returned no parts — falling back.")
            return None

        logger.info(
            "LangGraph agentic pipeline complete: %d parts, total=%.2f, source=%s",
            len(final_parts),
            final_state.get("total_estimated_cost", 0),
            final_state.get("pipeline_metadata", {}).get("pricing_source", "?"),
        )

        return {
            "final_parts": final_parts,
            "pipeline_metadata": final_state.get("pipeline_metadata", {}),
            "total_estimated_cost": final_state.get("total_estimated_cost", 0.0),
        }

    except Exception as exc:
        logger.warning("LangGraph pipeline execution failed: %s", exc)
        return None
