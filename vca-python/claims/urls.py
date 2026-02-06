from django.urls import path
from .views import save_fnol, process_claim

urlpatterns = [
    path('save-fnol/', save_fnol),
    path('process-claim/', process_claim),
]
