"""
Service layer for vehicle damage assessment.
Handles YOLO damage detection and Keras severity model inference.
"""
import os
import traceback
import warnings

import numpy as np
from pathlib import Path
from django.conf import settings

warnings.filterwarnings("ignore", message=".*input_shape.*input_dim.*")

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

_detection_model = None
_severity_model = None
_severity_load_failed = False


def get_detection_model():
    print(f'Base url {BASE_DIR}')

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
    """
    global _severity_model, _severity_load_failed
    if _severity_load_failed:
        return None
    if _severity_model is None:
        for path in [TRAINED_SEVERITY, API_SEVERITY]:
            if not os.path.exists(path):
                continue
            try:
                from keras.models import load_model
                _severity_model = load_model(path, compile=False)
                break
            except Exception:
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
    from keras.preprocessing.image import load_img, img_to_array

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


def run_damage_assessment(image_path):
    """
    Run damage detection and severity prediction on an image file.
    Returns (damages: list, severity: str) or raises Exception.
    """
    severity_model = get_severity_model()
    if severity_model is not None:
        try:
            severity = predict_severity(image_path, severity_model)
        except Exception:
            severity = "unknown"
    else:
        severity = "unknown"

    detection_model = get_detection_model()
    detection_results = detection_model(image_path)
    damages = []

    for result in detection_results:
        if result.boxes is not None and len(result.boxes) > 0:
            names = getattr(result, "names", {}) or {}
            for i in range(len(result.boxes)):
                try:
                    cls_tensor = result.boxes.cls
                    cls_id = int(cls_tensor[i].item()) if hasattr(cls_tensor[i], "item") else int(cls_tensor[i])
                    if isinstance(names, dict):
                        name = names.get(cls_id, f"damage_{cls_id}")
                    else:
                        name = names[cls_id] if 0 <= cls_id < len(names) else "damage"
                    damages.append(name)
                except (IndexError, TypeError, KeyError, AttributeError):
                    damages.append("damage")

    if not damages:
        damages = ["None"]
        severity = "None"

    return damages, severity
