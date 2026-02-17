import { httpClient } from "@/lib/httpClient";
 
export interface UserSummary {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  role: Role | null;
  permissions: Permission[];
}
 
export interface Role {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
  permission_count: number;
  created_date: string;
  created_by: string | null;
  updated_date: string;
  updated_by: string | null;
}
 
export interface RoleCreateRequest {
  name: string;
  description: string;
  is_active: boolean;
}
 
export type RoleUpdateRequest = Partial<RoleCreateRequest>;
 
export interface Permission {
  id: number;
  codename: string;
  name: string;
  description: string;
  module: string;
  is_active: boolean;
  created_date: string;
  created_by: string | null;
}
 
export interface PermissionAssignRequest {
  permission_ids: number[];
}
 
/** Response shape from GET /core/roles/:id/permissions/ (role-permission join rows) */
export interface RolePermissionRow {
  id: number;
  role: number;
  permission: number;
  permission_codename: string;
  permission_name: string;
  module: string;
}
export interface CreateUserRequest {
  username: string;
  password: string;
  email: string;
  first_name: string;
  last_name: string;
}
 
export interface ResetPasswordRequest {
  new_password: string;
}
 
/** Current user with role and permissions (for testing "which permissions do I have?") */
export interface CurrentUserMe {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  role: { id: number; name: string; description: string } | null;
  permissions: { id: number; codename: string; name: string; module: string }[];
}
 
export async function getCurrentUserMe(): Promise<CurrentUserMe> {
  const res = await httpClient.get<CurrentUserMe>("/core/me/");
  return res.data;
}
 
export async function listUsers(): Promise<UserSummary[]> {
  const res = await httpClient.get<UserSummary[]>("/core/users/");
  return res.data;
}
 
/** Backend create-user response shape */
interface CreateUserResponse {
  user: UserSummary;
  message: string;
}
 
export async function createUser(payload: CreateUserRequest): Promise<UserSummary> {
  const res = await httpClient.post<CreateUserResponse>("/users/create", payload);
  const data = res.data as CreateUserResponse;
  return data.user ?? (data as unknown as UserSummary);
}
 
export async function updateUser(
  id: number,
  payload: Partial<Pick<CreateUserRequest, "email" | "first_name" | "last_name">>
): Promise<UserSummary> {
  const res = await httpClient.patch<UserSummary>(`/users/${id}/`, payload);
  return res.data;
}
 
export async function changeUserRole(
  id: number,
  payload: { role_id: number | null }
): Promise<UserSummary> {
  const res = await httpClient.post<UserSummary>(
    `/core/users/${id}/assign-role/`,
    payload
  );
  return res.data;
}
 
export async function getRoles(): Promise<Role[]> {
  const res = await httpClient.get<Role[]>(`/core/roles/`);
  return res.data;
}
 
export async function createRole(payload: RoleCreateRequest): Promise<Role> {
  const res = await httpClient.post<Role>("/core/roles/", payload);
  return res.data;
}
 
export async function updateRole(
  id: number,
  payload: RoleUpdateRequest
): Promise<Role> {
  const res = await httpClient.patch<Role>(`/core/roles/${id}/`, payload);
  return res.data;
}
 
export async function deleteRole(id: number): Promise<void> {
  await httpClient.delete<void>(`/core/roles/${id}/`);
}
 
export async function listPermissions(): Promise<Permission[]> {
  const res = await httpClient.get<Permission[]>("/core/permissions/");
  return res.data;
}
 
export async function createPermission(
  payload: Omit<Permission, "id" | "created_date" | "created_by">
): Promise<Permission> {
  const res = await httpClient.post<Permission>("/core/permissions/", payload);
  return res.data;
}
 
export async function updatePermission(
  id: number,
  payload: Partial<Omit<Permission, "id" | "created_date" | "created_by">>
): Promise<Permission> {
  const res = await httpClient.patch<Permission>(
    `/core/permissions/${id}/`,
    payload
  );
  return res.data;
}
 
export async function deletePermission(id: number): Promise<void> {
  await httpClient.delete<void>(`/core/permissions/${id}/`);
}
 
export async function getRolePermissions(
  roleId: number
): Promise<RolePermissionRow[]> {
  const res = await httpClient.get<RolePermissionRow[]>(
    `/core/roles/${roleId}/permissions/`
  );
  return res.data;
}
 
export async function assignRolePermissions(
  roleId: number,
  payload: PermissionAssignRequest
): Promise<void> {
  await httpClient.post<void>(
    `/core/roles/${roleId}/permissions/assign/`,
    payload
  );
}
 
 
 
export async function resetUserPassword(
  id: number,
  payload: ResetPasswordRequest
): Promise<{ message: string }> {
  const res = await httpClient.post<{ message: string }>(
    `/users/${id}/reset-password/`,
    payload
  );
  return res.data;
}
 
export async function deactivateUser(
  id: number
): Promise<UserSummary> {
  const res = await httpClient.post<UserSummary>(`/users/${id}/deactivate/`);
  return res.data;
}
 
export async function activateUser(
  id: number
): Promise<UserSummary> {
  const res = await httpClient.post<UserSummary>(`/users/${id}/activate/`);
  return res.data;
}
 
/** Soft delete: sets is_delete=1 so user is hidden from lists. */
export async function softDeleteUser(
  id: number
): Promise<{ message: string }> {
  const res = await httpClient.post<{ message: string }>(
    `/users/${id}/soft-delete/`
  );
  return res.data;
}
 