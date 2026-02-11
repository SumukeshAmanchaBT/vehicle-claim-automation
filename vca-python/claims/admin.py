from django.contrib import admin
from .models import PricingConfig


@admin.register(PricingConfig)
class PricingConfigAdmin(admin.ModelAdmin):
    list_display = ["config_key", "config_name", "config_type", "config_value", "is_active"]
