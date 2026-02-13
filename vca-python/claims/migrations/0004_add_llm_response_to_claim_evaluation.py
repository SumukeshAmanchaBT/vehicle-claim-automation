# Add llm_damages and llm_severity to claim_evaluation_response for LLM damage assessment results

from django.db import migrations


def add_columns(apps, schema_editor):
    """Add llm_damages and llm_severity columns if they don't exist."""
    # Use raw SQL for compatibility with existing tables
    from django.db import connection
    with connection.cursor() as cursor:
        # Check and add llm_damages (MySQL and SQLite)
        try:
            cursor.execute(
                "ALTER TABLE claim_evaluation_response ADD COLUMN llm_damages TEXT NULL"
            )
        except Exception:
            # Column may already exist
            pass
        try:
            cursor.execute(
                "ALTER TABLE claim_evaluation_response ADD COLUMN llm_severity VARCHAR(20) NULL"
            )
        except Exception:
            pass


def remove_columns(apps, schema_editor):
    from django.db import connection
    with connection.cursor() as cursor:
        try:
            cursor.execute("ALTER TABLE claim_evaluation_response DROP COLUMN llm_damages")
        except Exception:
            pass
        try:
            cursor.execute("ALTER TABLE claim_evaluation_response DROP COLUMN llm_severity")
        except Exception:
            pass


class Migration(migrations.Migration):

    dependencies = [
        ('claims', '0003_pricingconfig'),
    ]

    operations = [
        migrations.RunPython(add_columns, remove_columns),
    ]
