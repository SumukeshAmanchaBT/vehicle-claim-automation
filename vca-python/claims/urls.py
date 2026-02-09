from django.urls import path

from .views import (
    get_fnol,
    list_fnol,
    login,
    process_claim,
    save_fnol,
    create_user,
    list_users,
    edit_user,
    change_role,
    reset_password,
    deactivate_user,
)

urlpatterns = [
    path("login", login, name="login"),
    path("users/", list_users, name="list_users"),
    path("users/create/", create_user, name="create_user"),
    path("users/<int:pk>/", edit_user, name="edit_user"),
    path("users/<int:pk>/change-role/", change_role, name="change_role"),
    path("users/<int:pk>/reset-password/", reset_password, name="reset_password"),
    path("users/<int:pk>/deactivate/", deactivate_user, name="deactivate_user"),
    path("save-fnol/", save_fnol, name="save_fnol"),
    path("process-claim/", process_claim, name="process_claim"),
    path("fnol", list_fnol, name="list_fnol"),
    path("fnol/<int:pk>/", get_fnol, name="get_fnol"),
]
