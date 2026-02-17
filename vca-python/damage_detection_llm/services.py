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
    Applies a monkey-patch for legacy H5 models that fail with IndexError
    (_inbound_nodes) when loaded with Keras 3.
    """

    print('Checking Model')
    global _severity_model, _severity_load_failed
    if _severity_load_failed:
        print('Severity Load Check Failed returning None')
        return None
    if _severity_model is None:
        print('Severity is None Updating Latest')
        # Apply patch for Keras 3 + legacy H5 IndexError before loading
        _patch_keras_h5_loader()
        for path in [TRAINED_SEVERITY, API_SEVERITY]:
            if not os.path.exists(path):
                print("No Trained LLM")
                continue
            try:
                from tensorflow.keras.models import load_model
                _severity_model = load_model(path, compile=False, safe_mode=False)
                print(f'>>> Here you go severity Model:  {_severity_model}')
                break
            except Exception as e:
                print("-----------------------")
                traceback.print_exc()
                print(f'Something wrong with the severity Model: {e}')
                _severity_model = None
        if _severity_model is None:
            print(f'Severity Model returns NULL ****')
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

    print('Detecting the Image')
    from tensorflow.keras.preprocessing.image import load_img, img_to_array
    img = load_img(image_path, target_size=(256, 256))
    x = img_to_array(img)
    x = np.expand_dims(x, axis=0).astype(np.float32) / 255.0
    pred = model.predict(x, verbose=0)
    print(f'Print Predict1: {pred}')
    pred = np.array(pred)
    print(f'Print Predict2: {pred}')
    if pred.size == 0:
        return "minor"
    pred_flat = pred.flatten()
    print(f'Print Predict3: {pred}')
    idx = int(np.argmax(pred_flat))
    print(f'Prediction Index: {idx}')

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
            print(f'Severity Check: {severity}')
        except Exception as e:
            print(f"Severity prediction failed: {e}")
            severity = "unknown"
    else:
        print(f"No Severity Model detected")
        severity = "unknown"

    print('Model Detection')
    detection_model = get_detection_model()
    detection_results = detection_model(image_path)

    damages = []
    for result in detection_results:
        # print(f'Damage Detection Result: {result}')
        print(f'Check Condition: {result.boxes is not None} and {len(result.boxes) > 0}')
        if result.boxes is not None:
            names = getattr(result, "names", {}) or {}
            print(f'Damage Detection Types: {names}')
            damages.append(list(names.values()))
            # for i in range(len(names)):
            #     try:
            #         cls_tensor = result.boxes.cls
            #         cls_id = int(cls_tensor[i].item()) if hasattr(cls_tensor[i], "item") else int(cls_tensor[i])
            #         if isinstance(names, dict):
            #             name = names.get(cls_id, f"damage_{cls_id}")
            #         else:
            #             name = names[cls_id] if 0 <= cls_id < len(names) else "damage"
            #         damages.append(name)
            #     except (IndexError, TypeError, KeyError, AttributeError):
            #         damages.append("damage")

    # if not damages:
    #     damages = ["None"]
    #     severity = "None"

    return damages, severity
