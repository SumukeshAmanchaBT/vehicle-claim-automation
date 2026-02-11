import { httpClient } from "@/lib/httpClient";

export type UserRole = "admin" | "user";
export type UserStatus = "active" | "inactive";

export interface UserSummary {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  status: UserStatus;
  claims_handled: number;
  last_login: string | null;
}

export interface ListUsersResponse {
  results: UserSummary[] | UserSummary[];
}

export interface CreateUserRequest {
  username: string;
  password: string;
  email: string;
  first_name: string;
  last_name: string;
  role: UserRole;
}

export interface ChangeRoleRequest {
  role: UserRole;
}

export interface ResetPasswordRequest {
  new_password: string;
}

export async function listUsers(): Promise<UserSummary[]> {
  const res = await httpClient.get<UserSummary[] | ListUsersResponse>("/users/");
  // Support both plain array and paginated { results: [] }
  if (Array.isArray(res.data)) {
    return res.data;
  }
  return res.data.results;
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
  payload: ChangeRoleRequest
): Promise<UserSummary> {
  const res = await httpClient.post<UserSummary>(`/users/${id}/change-role/`, payload);
  return res.data;
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

