"""
Django REST Framework views for Vehicle Damage Assessment API.
"""
import os
import traceback

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .services import (
    allowed_file,
    run_damage_assessment,
    DAMAGE_DETECTION_MODEL,
    API_SEVERITY,
    TRAINED_SEVERITY,
    WORK_DIR,
)


@api_view(["POST"])
@permission_classes([AllowAny])  # Adjust to IsAuthenticated if needed
def damage_assessment(request):
    """
    Accept a multipart form with 'image' file.
    Returns damages (list) and severity (str).
    """
    if "image" not in request.FILES:
        return Response(
            {"error": "No image file provided."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    image_file = request.FILES["image"]
    if not allowed_file(image_file.name):
        return Response(
            {"error": "Invalid file type. Only png, jpg, jpeg, webp allowed."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not os.path.exists(DAMAGE_DETECTION_MODEL):
        return Response(
            {"error": f"Damage model not found: {DAMAGE_DETECTION_MODEL}"},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    os.makedirs(WORK_DIR, exist_ok=True)
    input_path = os.path.join(WORK_DIR, "damage_input.jpg")

    try:
        with open(input_path, "wb") as f:
            for chunk in image_file.chunks():
                f.write(chunk)
    except Exception as e:
        return Response(
            {"error": f"Failed to save image: {str(e)}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    try:
        damages, severity = run_damage_assessment(input_path)
        return Response({"damages": damages, "severity": severity})
    except Exception as e:
        return Response(
            {
                "error": f"Damage detection failed: {str(e)}",
                "traceback": traceback.format_exc(),
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    """
    Health check endpoint showing model availability.
    """
    return Response(
        {
            "status": "ok",
            "models": {
                "damage": os.path.exists(DAMAGE_DETECTION_MODEL),
                "severity_trained": os.path.exists(TRAINED_SEVERITY),
                "severity_api": os.path.exists(API_SEVERITY),
            },
        }
    )
