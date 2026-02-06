from django.urls import path

from .views import (
    get_fnol,
    list_fnol,
    process_claim,
    save_fnol,
)

urlpatterns = [
    path("save-fnol/", save_fnol),
    path("process-claim/", process_claim),
    path("fnol/", list_fnol),
    path("fnol/<int:pk>/", get_fnol),
]
