from django.urls import path

from .views import (
    get_fnol,
    list_fnol,
    login,
    process_claim,
    run_fraud_detection,
    save_fnol,
    create_user,
    list_users,
    edit_user,
    change_role,
    reset_password,
    deactivate_user,
    claim_type_master_collection,
    claim_type_master_detail,
    claim_rule_master_collection,
    claim_rule_master_detail,
    damage_code_master_collection,
    damage_code_master_detail,
)

urlpatterns = [
    path("login", login, name="login"),
    path("users/", list_users, name="list_users"),
    path("users/create", create_user, name="create_user"),
    path("users/<int:pk>", edit_user, name="edit_user"),
    path("users/<int:pk>/change-role", change_role, name="change_role"),
    path("users/<int:pk>/reset-password", reset_password, name="reset_password"),
    path("users/<int:pk>/deactivate", deactivate_user, name="deactivate_user"),
    path("save-fnol", save_fnol, name="save_fnol"),
    path("process-claim", process_claim, name="process_claim"),
    path("fnol/<str:complaint_id>/run-fraud-detection", run_fraud_detection, name="run_fraud_detection"),
    path("fnol", list_fnol, name="list_fnol"),
    path("fnol/<str:pk>/", get_fnol, name="get_fnol"),

    # Master tables CRUD
    path("masters/claim-types", claim_type_master_collection, name="claim_type_master_collection"),
    path("masters/claim-types/<int:pk>", claim_type_master_detail, name="claim_type_master_detail"),
    path("masters/claim-rules", claim_rule_master_collection, name="claim_rule_master_collection"),
    path("masters/claim-rules/<int:pk>", claim_rule_master_detail, name="claim_rule_master_detail"),
    path("masters/damage-codes", damage_code_master_collection, name="damage_code_master_collection"),
    path("masters/damage-codes/<int:pk>", damage_code_master_detail, name="damage_code_master_detail"),
]
