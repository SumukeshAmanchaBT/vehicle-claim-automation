"""
URL configuration for damage_detection_llm app.
"""
from django.urls import path

from . import views

app_name = "damage_detection_llm"

urlpatterns = [
    path("damage_assessment", views.damage_assessment, name="damage_assessment"),
    path("health", views.health, name="health"),
]
