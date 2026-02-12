import axios, { type AxiosRequestHeaders } from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const API_MEDIA_URL = import.meta.env.VITE_API_MEDIA_URL;

export const httpClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Attach auth token (from login) to every request
httpClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("vca_token");
  if (token) {
    config.headers = (config.headers ?? {}) as AxiosRequestHeaders;
    (config.headers as any).Authorization = `Token ${token}`;
  }
  return config;
});

export default API_MEDIA_URL;