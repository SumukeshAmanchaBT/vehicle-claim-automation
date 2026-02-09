import { httpClient } from "@/lib/httpClient";

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginUser {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
}

export interface LoginResponse {
  token: string;
  user: LoginUser;
  message: string;
}

export async function loginApi(payload: LoginRequest): Promise<LoginResponse> {
  const response = await httpClient.post<LoginResponse>("/login", payload);
  return response.data;
}

