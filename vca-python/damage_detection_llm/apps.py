import os

from django.apps import AppConfig

# Avoid TensorFlow/OpenMP conflict on some systems
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")


class DamageDetectionLlmConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'damage_detection_llm'
    verbose_name = 'Damage Detection (LLM)'
