# Generated manually for PricingConfig

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('claims', '0002_claimrulemaster_claimtypemaster_damagecodemaster'),
    ]

    operations = [
        migrations.CreateModel(
            name='PricingConfig',
            fields=[
                ('config_id', models.BigAutoField(primary_key=True, serialize=False)),
                ('config_key', models.CharField(max_length=100, unique=True)),
                ('config_name', models.CharField(max_length=255)),
                ('config_value', models.TextField()),
                ('config_type', models.CharField(default='string', help_text='string, number, decimal, json, boolean', max_length=50)),
                ('description', models.TextField(blank=True)),
                ('is_active', models.BooleanField(default=True)),
                ('created_date', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.CharField(blank=True, max_length=150, null=True)),
                ('updated_date', models.DateTimeField(auto_now=True)),
                ('updated_by', models.CharField(blank=True, max_length=150, null=True)),
            ],
            options={
                'db_table': 'pricing_config',
                'ordering': ['config_key'],
            },
        ),
    ]
