"""
Service layer for vehicle damage assessment.
Handles YOLO damage detection, Keras severity model, and vision LLM analysis.
"""
import base64
import hashlib
import io
import json
import logging
import os
import traceback
import warnings

import numpy as np
from pathlib import Path
from django.conf import settings
from django.db import IntegrityError

from claims.phase1_runtime import get_claim_market_context, get_claim_vehicle_profile
from damage_detection_llm.image_fraud_service import compute_file_sha256

logger = logging.getLogger(__name__)

warnings.filterwarnings("ignore", message=".*input_shape.*input_dim.*")

# Valid damage types from vision LLM (normalized)
VALID_DAMAGE_TYPES = {"dent", "scratch", "intense-damage", "flooded", "fire", "crack", "broken", "damage"}


def _patch_keras_h5_loader():
    """
    Monkey-patch Keras 3 to fix IndexError when loading legacy H5 models.
    Patches the get_tensor logic in functional_from_config.
    """
    from keras.src.models import functional

    _orig = functional.functional_from_config

    def _patched_functional_from_config(cls, config, custom_objects=None):
        # Inject a safe get_tensor by patching created_layers before map_tensors.
        # We patch each Functional layer's _inbound_nodes to handle out-of-range.
        created_layers = {}
        unprocessed_nodes = {}

        def add_unprocessed_node(layer, node_data):
            if layer not in unprocessed_nodes:
                unprocessed_nodes[layer] = [node_data]
            else:
                unprocessed_nodes[layer].append(node_data)

        def process_node(layer, node_data):
            from keras.src.models.functional import deserialize_node
            args, kwargs = deserialize_node(node_data, created_layers)
            layer(*args, **kwargs)

        def process_layer(layer_data):
            from keras.src.legacy.saving import saving_utils
            layer_name = layer_data["name"]
            if "module" not in layer_data:
                layer = saving_utils.model_from_config(
                    layer_data, custom_objects=custom_objects
                )
            else:
                from keras.src.saving import serialization_lib
                layer = serialization_lib.deserialize_keras_object(
                    layer_data, custom_objects=custom_objects
                )
            from keras.src.ops.operation import Operation
            if not isinstance(layer, Operation):
                raise ValueError(
                    "Unexpected object from deserialization, expected a layer or "
                    f"operation, got a {type(layer)}"
                )
            created_layers[layer_name] = layer
            inbound_nodes_data = layer_data["inbound_nodes"]
            for node_data in inbound_nodes_data:
                add_unprocessed_node(layer, node_data)

        functional_config = {}
        for key in ["layers", "input_layers", "output_layers"]:
            functional_config[key] = config.pop(key)
        for key in ["name", "trainable"]:
            if key in config:
                functional_config[key] = config.pop(key)
            else:
                functional_config[key] = None

        for layer_data in functional_config["layers"]:
            process_layer(layer_data)

        while unprocessed_nodes:
            for layer_data in functional_config["layers"]:
                layer = created_layers[layer_data["name"]]
                if layer in unprocessed_nodes:
                    node_data_list = unprocessed_nodes[layer]
                    node_index = 0
                    while node_index < len(node_data_list):
                        node_data = node_data_list[node_index]
                        try:
                            process_node(layer, node_data)
                        except IndexError:
                            break
                        node_index += 1
                    if node_index < len(node_data_list):
                        unprocessed_nodes[layer] = node_data_list[node_index:]
                    else:
                        del unprocessed_nodes[layer]

        name = functional_config["name"]
        trainable = functional_config["trainable"]

        def get_tensor(layer_name, node_index, tensor_index):
            assert layer_name in created_layers
            layer = created_layers[layer_name]
            if isinstance(layer, functional.Functional):
                node_index -= 1
            nodes = layer._inbound_nodes
            # Fix for legacy H5: node_index may be out of range
            if node_index < 0 or node_index >= len(nodes):
                node_index = max(0, len(nodes) - 1) if nodes else 0
            if not nodes:
                raise ValueError(
                    f"Layer {layer.name} has no inbound nodes"
                )
            return nodes[node_index].output_tensors[tensor_index]

        def map_tensors(tensors):
            if (
                isinstance(tensors, list)
                and len(tensors) == 3
                and isinstance(tensors[0], str)
            ):
                return get_tensor(*tensors)
            if isinstance(tensors, dict):
                return {k: map_tensors(v) for k, v in tensors.items()}
            if isinstance(tensors, tuple):
                return tuple([map_tensors(v) for v in tensors])
            return [map_tensors(v) for v in tensors]

        input_tensors = map_tensors(functional_config["input_layers"])
        output_tensors = map_tensors(functional_config["output_layers"])

        return cls(
            inputs=input_tensors,
            outputs=output_tensors,
            name=name,
            trainable=trainable,
            **config,
        )

    functional.functional_from_config = _patched_functional_from_config

# Model paths relative to damage_detection_llm app directory
BASE_DIR = Path(__file__).resolve().parent.parent
LLM_APP_DIR = os.path.dirname(os.path.abspath(__file__))
# DAMAGE_DETECTION_MODEL = os.path.join(LLM_APP_DIR, "damage_detection_YOLO_model", "best.pt")
DAMAGE_DETECTION_MODEL = BASE_DIR / "damage_detection_llm" / "damage_detection_YOLO_model" / "best.pt"

API_SEVERITY = os.path.join(LLM_APP_DIR, "damage_severity_model", "ft_model_2.h5")
# Optional: trained model from model_training (if present)
TRAINED_SEVERITY = os.path.join(
    settings.BASE_DIR, "model_training", "outputs", "severity", "severity_best.h5"
)
WORK_DIR = os.path.join(LLM_APP_DIR, "work")

# Extended damage class names (model may have 3; retrain to add flooded, fire)
DAMAGE_NAMES = {
    0: "dent",
    1: "scratch",
    2: "intense-damage",
    3: "flooded",
    4: "fire",
}

_detection_model = None
_severity_model = None
_severity_load_failed = False


def get_detection_model():
    """Lazy-load YOLO damage detection model."""
    global _detection_model
    if _detection_model is None:
        from ultralytics import YOLO
        _detection_model = YOLO(str(DAMAGE_DETECTION_MODEL))
    return _detection_model


def get_severity_model():
    """
    Lazy-load severity model.
    Prefers trained model (Keras 3 compatible). Falls back to API model.
    Applies a monkey-patch for legacy H5 models that fail with IndexError
    (_inbound_nodes) when loaded with Keras 3.
    """

    global _severity_model, _severity_load_failed
    if _severity_load_failed:
        logger.debug("Severity model load previously failed; returning None.")
        return None
    if _severity_model is None:
        # Apply patch for Keras 3 + legacy H5 IndexError before loading
        _patch_keras_h5_loader()
        for path in [TRAINED_SEVERITY, API_SEVERITY]:
            if not os.path.exists(path):
                logger.debug("Severity model path not found: %s", path)
                continue
            try:
                from tensorflow.keras.models import load_model
                _severity_model = load_model(path, compile=False, safe_mode=False)
                break
            except Exception as e:
                traceback.print_exc()
                logger.warning("Failed to load severity model %s: %s", path, e)
                _severity_model = None
        if _severity_model is None:
            _severity_load_failed = True
            return None
    return _severity_model


def allowed_file(filename):
    """Check if uploaded file has an allowed image extension."""
    if not filename or "." not in filename:
        return False
    return filename.rsplit(".", 1)[1].lower() in {"png", "jpg", "jpeg", "webp"}


def predict_severity(image_path, model):
    """Run severity classification on an image using the given Keras model."""
    from tensorflow.keras.preprocessing.image import load_img, img_to_array
    img = load_img(image_path, target_size=(256, 256))
    x = img_to_array(img)
    x = np.expand_dims(x, axis=0).astype(np.float32) / 255.0
    pred = model.predict(x, verbose=0)
    pred = np.array(pred)
    if pred.size == 0:
        return "minor"
    pred_flat = pred.flatten()
    idx = int(np.argmax(pred_flat))

    d = {0: "minor", 1: "moderate", 2: "severe"}
    return d.get(idx, "minor")


FLOOD_KEYWORDS = ("flood", "flooded", "submerged", "inundated", "water damage")


def _encode_image_for_vision_llm(image_path: str) -> tuple[str, str] | None:
    """
    Resize and JPEG-compress before base64 so huge camera originals do not exhaust RAM
    (raw f.read() + base64 can double memory; vision APIs do not need full resolution).
    """
    from PIL import Image

    max_edge = int(os.environ.get("VISION_LLM_MAX_IMAGE_EDGE", "1536"))
    jpeg_quality = int(os.environ.get("VISION_LLM_JPEG_QUALITY", "85"))
    try:
        resample = Image.Resampling.LANCZOS
    except AttributeError:
        resample = Image.LANCZOS
    try:
        with Image.open(image_path) as im:
            rgb = im.convert("RGB")
            rgb.thumbnail((max_edge, max_edge), resample)
            buf = io.BytesIO()
            rgb.save(buf, format="JPEG", quality=jpeg_quality, optimize=True)
            raw = buf.getvalue()
        if not raw:
            return None
        return (base64.b64encode(raw).decode("utf-8"), "image/jpeg")
    except MemoryError as e:
        logger.warning("Vision LLM image encode OOM for %s: %s", image_path, e)
        return None
    except OSError as e:
        logger.warning("Vision LLM image encode failed for %s: %s", image_path, e)
        return None
    except Exception as e:
        logger.warning("Vision LLM image encode failed for %s: %s", image_path, e)
        return None


def _analyze_damage_with_vision_llm(image_path: str) -> tuple[list[str], str] | None:
    """
    Analyze vehicle damage image using Azure OpenAI or OpenAI vision (env-configured).
    Returns (damages: list, severity: str) or None if no LLM configured or call fails.
    """
    from claim_automation.llm_client import get_chat_completion_client_and_model

    client, model = get_chat_completion_client_and_model()
    if client is None or not model:
        return None
    if not os.path.isfile(image_path):
        return None
    encoded = _encode_image_for_vision_llm(image_path)
    if not encoded:
        return None
    image_data, mime = encoded
    prompt = """Analyze this vehicle damage image. List ONLY the damage types you actually see.

- FIRE: burnt, charred, melted, smoke, soot - include "fire" ONLY if clearly visible
- FLOODED: water damage, submerged, water stains - include "flooded" ONLY if clearly visible
- Fire and flooded are mutually exclusive - do NOT include both unless both are clearly present
- Other types: dent, scratch, intense-damage, crack, broken

If no damage visible, respond with damages: ["none"].

Respond in this exact JSON format only, no other text:
{"damages": ["dent"], "severity": "moderate"}
Severity: minor, moderate, or severe."""
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_data}"}},
                    ],
                }
            ],
            max_tokens=200,
        )
        text = (resp.choices[0].message.content or "").strip()
        if not text:
            return None
        # Extract JSON from response (handle markdown code blocks)
        start = text.find("{")
        if start >= 0:
            end = text.rfind("}")
            if end > start:
                text = text[start : end + 1]
        data = json.loads(text)
        damages = data.get("damages") or []
        severity = str(data.get("severity", "unknown")).strip().lower() or "unknown"
        if severity not in ("minor", "moderate", "severe"):
            severity = "unknown"
        # Normalize damage types
        out = []
        for d in damages:
            d = str(d).strip().lower().replace(" ", "-").replace("_", "-")
            if d and d != "none":
                if d in VALID_DAMAGE_TYPES:
                    out.append(d)
                elif "flood" in d or "submerged" in d or "water-damage" in d or "water damage" in d:
                    out.append("flooded")
                elif "fire" in d or "burn" in d:
                    out.append("fire")
                elif "dent" in d:
                    out.append("dent")
                elif "scratch" in d:
                    out.append("scratch")
                elif "severe" in d or "intense" in d or "major" in d:
                    out.append("intense-damage")
                elif d:
                    out.append(d)
        return (list(dict.fromkeys(out)), severity)
    except Exception as e:
        traceback.print_exc()
        return None


def _is_flood_indicated(incident_description: str | None, flood_coverage: bool = False) -> bool:
    """Check if incident description or flood_coverage indicates flood damage."""
    if flood_coverage:
        return True
    if not incident_description or not isinstance(incident_description, str):
        return False
    desc_lower = incident_description.strip().lower()
    return any(kw in desc_lower for kw in FLOOD_KEYWORDS)


def run_damage_assessment(image_path, incident_description=None, flood_coverage=False, image_url=None):
    """
    Run damage detection and severity prediction on an image file.
    Uses vision LLM when Azure OpenAI or OpenAI is configured (see .env.example); otherwise YOLO + Keras.
    incident_description: optional claim description; if flood keywords found, adds "flooded".
    flood_coverage: if True, adds "flooded" to damages.
    image_url: optional URL/path hint; if contains "fire" or "flood", adds that type when YOLO misses it.
    Returns (damages: list, severity: str) or raises Exception.
    """
    # 1. Try vision LLM first - analyzes image content (flooded, fire, etc.)
    source = (image_url or image_path or "").lower()
    llm_result = _analyze_damage_with_vision_llm(image_path)
    if llm_result:
        damages, severity = llm_result
        if damages or severity != "unknown":
            # Do NOT add flooded from claim when image URL indicates fire (mutually exclusive)
            if _is_flood_indicated(incident_description, flood_coverage) and "flooded" not in damages and "fire" not in source:
                damages = list(damages) + ["flooded"]
            if not damages and severity and str(severity).strip().lower() not in ("unknown", ""):
                damages = ["damage"]
            return (damages, severity)

    # 2. Fallback: YOLO + Keras severity model
    severity_model = get_severity_model()
    if severity_model is not None:
        try:
            severity = predict_severity(image_path, severity_model)
        except Exception as e:
            logger.warning("Severity prediction failed: %s", e)
            severity = "unknown"
    else:
        severity = "unknown"

    detection_model = get_detection_model()
    detection_results = detection_model(image_path, conf=0.01)

    damages = []
    for result in detection_results:
        model_names = getattr(result, "names", {}) or {}
        # Merge with DAMAGE_NAMES: fixes trailing commas, adds flooded (3), fire (4)
        names = dict(DAMAGE_NAMES)
        for k, v in model_names.items():
            names[k] = str(v).replace(",", "").strip()
        if result.boxes is None or len(result.boxes) == 0:
            continue
        # Use result.boxes.data: each row is [x1, y1, x2, y2, conf, cls] - most reliable
        data = result.boxes.data
        if data is not None and len(data) > 0:
            for i in range(len(data)):
                try:
                    row = data[i]
                    cls_id = int(row[5].item() if hasattr(row[5], "item") else row[5])
                    label = names.get(cls_id, f"damage_{cls_id}")
                    if label and label.lower() != "none":
                        damages.append(label)
                except (IndexError, TypeError, KeyError, AttributeError):
                    pass
        else:
            # Fallback: iterate boxes, use .item() for scalar tensors
            for box in result.boxes:
                try:
                    cls_val = box.cls
                    cls_id = int(cls_val.item() if hasattr(cls_val, "item") else cls_val)
                    label = names.get(cls_id, f"damage_{cls_id}")
                    if label and label.lower() != "none":
                        damages.append(label)
                except (IndexError, TypeError, KeyError, AttributeError):
                    pass

    # Unique damage types only
    damages = list(dict.fromkeys(damages))

    # Image URL/path hint - fire and flood are mutually exclusive
    source = (image_url or image_path or "").lower()
    if "fire" in source and "fire" not in damages:
        damages.append("fire")
        damages = [d for d in damages if d != "scratch"]  # YOLO misclassifies fire as scratch
        # Do NOT add flooded when image is clearly fire
    elif "flood" in source and "flooded" not in damages:
        damages.append("flooded")
    # Add flooded from claim context ONLY when image URL does NOT indicate fire
    elif _is_flood_indicated(incident_description, flood_coverage) and "flooded" not in damages:
        damages.append("flooded")

    # Fallback: severity model detected damage but YOLO returned empty - ensure non-empty
    if not damages and severity and str(severity).strip().lower() not in ("unknown", ""):
        damages = ["damage"]

    return damages, severity


# =============================================================================
# Detailed damage breakdown with part-level assessment
# =============================================================================

CANONICAL_DAMAGE_ASSESSMENT_VERSION = "phase1-image-assessment-v1"


def _json_safe(value):
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            return value
    return value


def _build_damage_assessment_context(
    *, market_context: dict | None, vehicle_profile: dict | None
) -> dict:
    market_context = market_context or {}
    vehicle_profile = vehicle_profile or {}
    return {
        "version": CANONICAL_DAMAGE_ASSESSMENT_VERSION,
        "market_context": {
            "country": market_context.get("country"),
            "city": market_context.get("city"),
            "currency_code": market_context.get("currency_code"),
            "market_label": market_context.get("market_label"),
        },
        "vehicle_profile": {
            "make": vehicle_profile.get("make"),
            "model": vehicle_profile.get("model"),
            "year": vehicle_profile.get("year"),
        },
    }


def _compute_damage_assessment_context_key(context: dict) -> str:
    payload = json.dumps(_json_safe(context), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _part_breakdown_sort_key(part: dict) -> tuple:
    return (
        str(part.get("part") or "").strip().lower(),
        str(part.get("damage_type") or "").strip().lower(),
        str(part.get("repair_action") or "").strip().upper(),
        int(part.get("severity_percent") or 0),
        round(float(part.get("estimated_cost") or 0), 2),
    )


def _normalize_part_breakdown(part_breakdown: list[dict] | None) -> list[dict]:
    normalized: list[dict] = []
    seen: set[tuple] = set()
    for raw in part_breakdown or []:
        if not isinstance(raw, dict):
            continue
        part = str(raw.get("part", "")).strip()
        if not part:
            continue
        damage_type = str(raw.get("damage_type", "")).strip().lower()
        repair_action = str(raw.get("repair_action", "REPAIR")).strip().upper()
        if repair_action not in ("REPAIR", "REPLACE", "PAINT", "NONE"):
            repair_action = "REPAIR"
        try:
            severity_percent = int(float(raw.get("severity_percent", 0) or 0))
        except (TypeError, ValueError):
            severity_percent = 0
        severity_percent = max(0, min(100, severity_percent))
        try:
            estimated_cost = round(float(raw.get("estimated_cost", 0) or 0), 2)
        except (TypeError, ValueError):
            estimated_cost = 0.0

        entry = {
            "part": part,
            "damage_type": damage_type,
            "severity_percent": severity_percent,
            "repair_action": repair_action,
            "estimated_cost": estimated_cost,
        }
        dedupe_key = (
            entry["part"].lower(),
            entry["damage_type"],
            entry["severity_percent"],
            entry["repair_action"],
            entry["estimated_cost"],
        )
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        normalized.append(entry)

    return sorted(normalized, key=_part_breakdown_sort_key)


def _rows_to_part_breakdown(rows) -> list[dict]:
    return _normalize_part_breakdown(
        [
            {
                "part": row.part_name,
                "damage_type": row.damage_type,
                "severity_percent": float(row.severity_percent or 0),
                "repair_action": row.repair_action,
                "estimated_cost": float(row.estimated_amount or 0),
            }
            for row in rows
        ]
    )


def _build_reuse_pipeline_metadata(
    *,
    base_metadata: dict | None,
    analysis_source: str,
    source_claim_id: str | None,
    source_photo_path: str | None,
    currency_code: str,
) -> dict:
    metadata = dict(base_metadata or {})
    metadata.setdefault("currency_code", currency_code)
    metadata["consistency_source"] = analysis_source
    metadata["canonical_reuse"] = analysis_source != "fresh_llm_assessment"
    if source_claim_id:
        metadata["canonical_source_claim_id"] = source_claim_id
    if source_photo_path:
        metadata["canonical_source_photo_path"] = source_photo_path
    return _json_safe(metadata)


def _find_seeded_canonical_snapshot(
    *,
    sha256_hex: str,
    context_key: str,
    currency_code: str,
) -> dict | None:
    from claims.models import DamagePartAssessment, FnolClaim, ImageFraudResult

    candidate_rows = (
        ImageFraudResult.objects.filter(sha256_hex=sha256_hex)
        .select_related("complaint")
        .order_by("created_at", "complaint_id", "id")
    )

    for fraud_row in candidate_rows:
        source_claim = fraud_row.complaint
        source_context_key = _compute_damage_assessment_context_key(
            _build_damage_assessment_context(
                market_context=get_claim_market_context(claim=source_claim),
                vehicle_profile=get_claim_vehicle_profile(claim=source_claim),
            )
        )
        if source_context_key != context_key:
            continue

        part_rows = list(
            DamagePartAssessment.objects.filter(
                complaint=source_claim,
                source_image_url=fraud_row.photo_path,
            ).order_by("sort_order", "id")
        )
        if not part_rows:
            continue

        part_breakdown = _rows_to_part_breakdown(part_rows)
        if not part_breakdown:
            continue

        return {
            "analysis_source": "seeded_from_exact_image_claim",
            "source_claim_id": source_claim.complaint_id,
            "source_photo_path": fraud_row.photo_path,
            "part_breakdown": part_breakdown,
            "currency_code": currency_code,
            "pipeline_metadata": _build_reuse_pipeline_metadata(
                base_metadata={
                    "pipeline": "canonical_exact_image_reuse",
                    "pricing_source": "stored_exact_image_assessment",
                    "confidence_level": "high",
                    "web_search_used": False,
                    "reasoning_summary": (
                        "Reused part-level assessment from an exact image match "
                        f"already persisted on claim {source_claim.complaint_id}."
                    ),
                },
                analysis_source="seeded_from_exact_image_claim",
                source_claim_id=source_claim.complaint_id,
                source_photo_path=fraud_row.photo_path,
                currency_code=currency_code,
            ),
        }

    return None


def _resolve_part_breakdown_for_image(
    *,
    image_path: str,
    complaint_id: str,
    incident_description: str | None,
    flood_coverage: bool,
    image_url: str,
    market_context: dict,
    vehicle_profile: dict,
    enable_web_search: bool,
    prefer_agentic_pipeline: bool = True,
) -> tuple[list[str], str, list[dict], dict]:
    from claims.models import CanonicalImageDamageAssessment
    from damage_detection_llm.agentic_pipeline import (
        get_agentic_pipeline_runtime_status,
        run_agentic_pipeline,
    )

    damages, severity = run_damage_assessment(
        image_path,
        incident_description=incident_description,
        flood_coverage=flood_coverage,
        image_url=image_url,
    )

    currency_code = (market_context.get("currency_code") or "THB").upper()
    image_sha256 = compute_file_sha256(image_path)
    assessment_context = _build_damage_assessment_context(
        market_context=market_context,
        vehicle_profile=vehicle_profile,
    )
    context_key = _compute_damage_assessment_context_key(assessment_context)

    canonical = CanonicalImageDamageAssessment.objects.filter(
        sha256_hex=image_sha256,
        assessment_context_key=context_key,
    ).first()
    if canonical and canonical.part_breakdown_json:
        return (
            damages,
            severity,
            _normalize_part_breakdown(canonical.part_breakdown_json),
            _build_reuse_pipeline_metadata(
                base_metadata=canonical.pipeline_metadata_json,
                analysis_source=canonical.analysis_source or "canonical_snapshot",
                source_claim_id=canonical.source_claim_id or None,
                source_photo_path=canonical.source_photo_path or None,
                currency_code=canonical.currency_code or currency_code,
            ),
        )

    seeded = _find_seeded_canonical_snapshot(
        sha256_hex=image_sha256,
        context_key=context_key,
        currency_code=currency_code,
    )
    if seeded:
        try:
            canonical = CanonicalImageDamageAssessment.objects.create(
                sha256_hex=image_sha256,
                assessment_context_key=context_key,
                assessment_context_json=assessment_context,
                analysis_source=seeded["analysis_source"],
                source_claim_id=seeded["source_claim_id"],
                source_photo_path=seeded["source_photo_path"],
                part_breakdown_json=seeded["part_breakdown"],
                total_estimated_cost=round(
                    sum(p.get("estimated_cost", 0) for p in seeded["part_breakdown"]), 2
                ),
                currency_code=seeded["currency_code"],
                pipeline_metadata_json=seeded["pipeline_metadata"],
            )
        except IntegrityError:
            canonical = CanonicalImageDamageAssessment.objects.get(
                sha256_hex=image_sha256,
                assessment_context_key=context_key,
            )
        return (
            damages,
            severity,
            _normalize_part_breakdown(canonical.part_breakdown_json),
            _build_reuse_pipeline_metadata(
                base_metadata=canonical.pipeline_metadata_json,
                analysis_source=canonical.analysis_source or seeded["analysis_source"],
                source_claim_id=canonical.source_claim_id or seeded["source_claim_id"],
                source_photo_path=canonical.source_photo_path
                or seeded["source_photo_path"],
                currency_code=canonical.currency_code or seeded["currency_code"],
            ),
        )

    part_breakdown: list[dict] = []
    pipeline_metadata: dict = {}
    agentic_result = None
    agentic_runtime = get_agentic_pipeline_runtime_status(
        enable_web_search=enable_web_search,
        prefer_agentic_pipeline=prefer_agentic_pipeline,
    )
    if prefer_agentic_pipeline and agentic_runtime.get("available"):
        try:
            agentic_result = run_agentic_pipeline(
                image_path=image_path,
                complaint_id=complaint_id,
                incident_description=incident_description,
                region=market_context["market_label"],
                currency_code=currency_code,
                vehicle_profile=vehicle_profile,
                market_context=market_context,
                enable_web_search=enable_web_search,
            )
        except Exception as agentic_err:
            logger.debug(
                "Agentic pipeline import/exec error (will fall back): %s", agentic_err
            )

    if agentic_result and agentic_result.get("final_parts"):
        part_breakdown = _normalize_part_breakdown(agentic_result["final_parts"])
        pipeline_metadata = dict(agentic_result.get("pipeline_metadata", {}) or {})
        pipeline_metadata.setdefault("orchestration_runtime", agentic_runtime)
        logger.info(
            "run_damage_assessment_detailed: agentic pipeline produced %d parts for %s",
            len(part_breakdown),
            complaint_id,
        )
    else:
        fallback_runtime = dict(agentic_runtime)
        if prefer_agentic_pipeline and fallback_runtime.get("available"):
            fallback_runtime["selected_mode"] = "vision_llm_direct"
            fallback_runtime["selection_reason"] = (
                "agentic pipeline produced no reusable output; using Vision LLM direct analysis."
            )
            advisory_notes = list(fallback_runtime.get("advisory_notes") or [])
            advisory_notes.append(
                "agentic pipeline produced no reusable output; using Vision LLM direct analysis."
            )
            fallback_runtime["advisory_notes"] = advisory_notes

        part_breakdown = _analyze_damage_part_level(
            image_path,
            market_context=market_context,
            vehicle_profile=vehicle_profile,
        ) or []
        part_breakdown = _normalize_part_breakdown(part_breakdown)
        pipeline_metadata = {
            "pipeline": "vision_llm_direct",
            "pricing_source": "vision_llm_initial",
            "confidence_level": "medium",
            "cost_range": None,
            "web_search_used": False,
            "reasoning_summary": str(
                fallback_runtime.get("selection_reason")
                or "LangGraph pipeline unavailable; using Vision LLM direct analysis."
            ),
            "regional_context": market_context["market_label"],
            "currency_code": currency_code,
            "vehicle_profile": vehicle_profile,
            "orchestration_runtime": fallback_runtime,
        }
        if part_breakdown:
            logger.info(
                "run_damage_assessment_detailed: fallback Vision LLM produced %d parts for %s",
                len(part_breakdown),
                complaint_id,
            )

    persisted_pipeline_metadata = _build_reuse_pipeline_metadata(
        base_metadata=pipeline_metadata,
        analysis_source="fresh_llm_assessment",
        source_claim_id=complaint_id,
        source_photo_path=image_url,
        currency_code=currency_code,
    )

    fresh_part_breakdown = _normalize_part_breakdown(part_breakdown)
    if canonical:
        canonical_part_breakdown = _normalize_part_breakdown(
            canonical.part_breakdown_json
        )
    else:
        canonical_part_breakdown = []

    if canonical_part_breakdown:
        part_breakdown = canonical_part_breakdown
        persisted_pipeline_metadata = _build_reuse_pipeline_metadata(
            base_metadata=canonical.pipeline_metadata_json,
            analysis_source=canonical.analysis_source or "canonical_snapshot",
            source_claim_id=canonical.source_claim_id or None,
            source_photo_path=canonical.source_photo_path or None,
            currency_code=canonical.currency_code or currency_code,
        )
    elif canonical and not fresh_part_breakdown:
        part_breakdown = canonical_part_breakdown
        persisted_pipeline_metadata = _build_reuse_pipeline_metadata(
            base_metadata=canonical.pipeline_metadata_json,
            analysis_source=canonical.analysis_source or "canonical_snapshot",
            source_claim_id=canonical.source_claim_id or None,
            source_photo_path=canonical.source_photo_path or None,
            currency_code=canonical.currency_code or currency_code,
        )
    else:
        canonical, _ = CanonicalImageDamageAssessment.objects.update_or_create(
            sha256_hex=image_sha256,
            assessment_context_key=context_key,
            defaults={
                "assessment_context_json": assessment_context,
                "analysis_source": "fresh_llm_assessment",
                "source_claim_id": complaint_id,
                "source_photo_path": image_url,
                "part_breakdown_json": fresh_part_breakdown,
                "total_estimated_cost": round(
                    sum(p.get("estimated_cost", 0) for p in fresh_part_breakdown), 2
                ),
                "currency_code": currency_code,
                "pipeline_metadata_json": persisted_pipeline_metadata,
            },
        )
        part_breakdown = _normalize_part_breakdown(canonical.part_breakdown_json)

    return damages, severity, part_breakdown, persisted_pipeline_metadata

def _analyze_damage_part_level(
    image_path: str,
    *,
    market_context: dict | None = None,
    vehicle_profile: dict | None = None,
) -> list[dict] | None:
    """
    Analyze image using vision LLM for part-level damage breakdown.

    Returns list of dicts with:
    - part: str (e.g., "Front Bumper", "Left Door")
    - damage_type: str (scratch, dent, crack, etc.)
    - severity_percent: int (0-100)
    - repair_action: str (REPAIR, REPLACE, PAINT, NONE)
    - estimated_cost: float
    """
    from claim_automation.llm_client import get_chat_completion_client_and_model

    client, model = get_chat_completion_client_and_model()
    if client is None or not model:
        return None
    if not os.path.isfile(image_path):
        return None

    try:
        with open(image_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode("utf-8")
    except OSError:
        return None

    ext = Path(image_path).suffix.lower() or ".jpg"
    mime = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png" if ext == ".png" else "image/webp"

    market_context = market_context or {}
    currency_code = (market_context.get("currency_code") or "THB").upper()
    market_label = (
        market_context.get("market_label") or "Thailand vehicle repair market"
    )
    market_location = (
        market_context.get("accident_location")
        or market_context.get("city")
        or "Bangkok, Thailand"
    )
    vehicle_profile = vehicle_profile or {}
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
        or "not provided"
    )

    prompt = f"""Analyze this vehicle damage image and provide a detailed breakdown of damaged parts.

Vehicle profile: {vehicle_summary}
Use the vehicle profile only when it materially affects parts pricing. Do not infer policy-specific pricing.

For each visible damage, provide:
- part: The specific vehicle part (e.g., "Front Bumper", "Left Front Door", "Hood", "Rear Quarter Panel", "Windshield", "Headlight", "Taillight")
- damage_type: The type of damage (scratch, dent, crack, chip, scuff, deformation, tear)
- severity_percent: Severity as a percentage from 0-100 (25 = minor, 50 = moderate, 75 = major, 100 = severe/total loss)
- repair_action: Recommended action (REPAIR for fixable damage, REPLACE for broken/severely damaged parts, PAINT for cosmetic damage, NONE if unsure)
- estimated_cost: Estimated repair cost in {currency_code} for this specific damage, using current pricing in the {market_label} around {market_location}

Respond in this exact JSON format:
{{
    "damages": [
        {{
            "part": "Front Bumper",
            "damage_type": "scratch",
            "severity_percent": 25,
            "repair_action": "PAINT",
            "estimated_cost": 180.00
        }}
    ]
}}

If no damage visible, respond with damages: []."""

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_data}"}},
                    ],
                }
            ],
            max_tokens=800,
            temperature=0.1,
        )
        text = (resp.choices[0].message.content or "").strip()
        if not text:
            return None

        # Extract JSON from response
        start = text.find("{")
        if start >= 0:
            end = text.rfind("}")
            if end > start:
                text = text[start : end + 1]

        data = json.loads(text)
        damages = data.get("damages") or []

        # Normalize and validate
        valid_damages = []
        for d in damages:
            if not isinstance(d, dict):
                continue
            part = str(d.get("part", "")).strip()
            if not part:
                continue

            damage_type = str(d.get("damage_type", "")).strip().lower()
            severity = int(d.get("severity_percent", 50) or 50)
            severity = max(0, min(100, severity))

            repair_action = str(d.get("repair_action", "REPAIR")).strip().upper()
            if repair_action not in ("REPAIR", "REPLACE", "PAINT", "NONE"):
                repair_action = "REPAIR"

            try:
                estimated_cost = float(d.get("estimated_cost", 0) or 0)
            except (ValueError, TypeError):
                estimated_cost = 0.0

            valid_damages.append({
                "part": part,
                "damage_type": damage_type,
                "severity_percent": severity,
                "repair_action": repair_action,
                "estimated_cost": estimated_cost,
            })

        return valid_damages

    except Exception:
        traceback.print_exc()
        return None


def save_part_assessments(
    complaint_id: str,
    part_data_list: list[dict],
    image_url: str = "",
    *,
    replace_scope: str = "image",
):
    """
    Save part-level damage assessments to DamagePartAssessment model.

    Args:
        complaint_id: The claim ID
        part_data_list: List of part assessment dicts from _analyze_damage_part_level
        image_url: Source image path/URL for reference (used to scope replacements)
        replace_scope:
            - ``image`` (default): remove existing rows for this claim with the same
              ``source_image_url``, then append new rows after current max ``sort_order``.
              Use this when one claim has multiple photos so later images do not wipe earlier parts.
            - ``claim``: delete all part rows for the claim, then insert from 0 (single-image / full reset).
    """
    from django.db.models import Max

    from claims.models import FnolClaim, DamagePartAssessment

    normalized_parts = _normalize_part_breakdown(part_data_list)
    if not normalized_parts:
        return 0

    try:
        claim = FnolClaim.objects.filter(complaint_id=complaint_id).first()
        if not claim:
            logger.warning(f"Cannot save part assessments: claim {complaint_id} not found")
            return 0

        if replace_scope == "claim":
            DamagePartAssessment.objects.filter(complaint=claim).delete()
            start_order = 0
        elif replace_scope == "image":
            DamagePartAssessment.objects.filter(
                complaint=claim, source_image_url=image_url
            ).delete()
            agg = DamagePartAssessment.objects.filter(complaint=claim).aggregate(
                m=Max("sort_order")
            )
            start_order = (agg["m"] if agg["m"] is not None else -1) + 1
        else:
            raise ValueError(f"Unknown replace_scope: {replace_scope}")

        created_count = 0
        for idx, part_data in enumerate(normalized_parts):
            DamagePartAssessment.objects.create(
                complaint=claim,
                part_name=part_data["part"],
                damage_type=part_data["damage_type"],
                severity_percent=part_data["severity_percent"],
                repair_action=part_data["repair_action"],
                estimated_amount=part_data["estimated_cost"],
                source_image_url=image_url,
                sort_order=start_order + idx,
            )
            created_count += 1

        return created_count

    except Exception:
        logger.exception("Failed to save part assessments")
        return 0


def run_damage_assessment_detailed(
    image_path: str,
    complaint_id: str,
    incident_description: str | None = None,
    flood_coverage: bool = False,
    image_url: str = "",
    enable_web_search: bool = True,
    persist_claim_rows: bool = True,
    prefer_agentic_pipeline: bool = True,
) -> dict:
    """
    Run detailed damage assessment with part-level breakdown.

    Orchestration hierarchy (graceful degradation):
      1. LangGraph Agentic Pipeline (Part Segmentation → Pricing Agent → Estimation)
         — uses web search + LLM reasoning for market-accurate costs.
         — requires: pip install langgraph duckduckgo-search
      2. Existing Vision LLM (_analyze_damage_part_level) — current behaviour.
      3. YOLO + Keras severity only (no cost breakdown, part_breakdown=[]).

    Args:
        image_path: Path to the image file on disk.
        complaint_id: Claim ID to associate assessments with.
        incident_description: Optional claim description for LLM context.
        flood_coverage: Whether flood coverage applies.
        image_url: Source image URL / storage key (used for DB scoping).
        enable_web_search: Pass False to disable live pricing searches (test envs).
        prefer_agentic_pipeline: When False, skip the LangGraph agentic path and use
            Vision LLM / downstream fallbacks only (additive; default preserves behaviour).

    Returns:
        Dict with:
          - damages, severity: from YOLO/LLM (unchanged)
          - part_breakdown: list[dict] with part, damage_type, severity_percent,
                            repair_action, estimated_cost (and persisted to DB)
          - total_parts, total_estimated_cost
          - pipeline_metadata (new, additive): transparency data from agentic pipeline
    """
    market_context = get_claim_market_context(complaint_id=complaint_id)
    vehicle_profile = get_claim_vehicle_profile(complaint_id=complaint_id)
    currency_code = market_context["currency_code"]

    damages, severity, part_breakdown, pipeline_metadata = _resolve_part_breakdown_for_image(
        image_path=image_path,
        complaint_id=complaint_id,
        incident_description=incident_description,
        flood_coverage=flood_coverage,
        image_url=image_url,
        market_context=market_context,
        vehicle_profile=vehicle_profile,
        enable_web_search=enable_web_search,
        prefer_agentic_pipeline=prefer_agentic_pipeline,
    )

    # Persist part assessments (per-image scope — multi-photo claims accumulate rows)
    if persist_claim_rows and part_breakdown and complaint_id:
        save_part_assessments(
            complaint_id, part_breakdown, image_url, replace_scope="image"
        )

    total_cost = sum(p.get("estimated_cost", 0) for p in part_breakdown)

    return {
        "damages": damages,
        "severity": severity,
        "part_breakdown": part_breakdown,
        "total_parts": len(part_breakdown),
        "total_estimated_cost": total_cost,
        "currency_code": currency_code,
        "market_context": market_context,
        "pipeline_metadata": pipeline_metadata,
    }
