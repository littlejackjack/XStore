/**
 * API client for the XStore backend.
 *
 * - Base URL comes from NEXT_PUBLIC_API_URL (same-origin `/api` behind Caddy
 *   by default, so no hard-coded hostnames and no CORS issues in production).
 * - The access token is attached as a Bearer header.
 * - On 401 the client transparently rotates the refresh token once and retries.
 * - No secret ever lives in this bundle: API keys are never returned by the API.
 */

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

const ACCESS_TOKEN_KEY = 'xstore_access_token';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function setAccessToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
  else window.localStorage.removeItem(ACCESS_TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

async function rawRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.auth !== false) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include', // refresh token cookie
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(response.status, (payload as any)?.message ?? `Request failed (${response.status})`);
  }
  return payload as T;
}

/** Request with one automatic token-rotation retry on 401. */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await rawRequest<T>(path, options);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && options.auth !== false) {
      const refreshed = await refreshAccessToken();
      if (refreshed) return rawRequest<T>(path, options);
    }
    throw error;
  }
}

let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!response.ok) return false;
      const payload = (await response.json()) as { accessToken?: string };
      if (payload.accessToken) {
        setAccessToken(payload.accessToken);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

// ---------- Typed endpoint helpers ----------

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  priceIdr: number;
  durationDays: number;
  dataLimitGb: number | null;
  features: string[];
}

export interface AvailableServer {
  id: string;
  name: string;
  location: string | null;
  status: 'ONLINE' | 'OFFLINE' | 'MAINTENANCE';
  activeUsers: number;
  maxCapacity: number | null;
  remainingCapacity: number | null;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN' | 'SUPER_ADMIN';
}

export const endpoints = {
  login: (email: string, password: string) =>
    api<{ user: User; accessToken: string }>(
      '/auth/login',
      { method: 'POST', body: { email, password }, auth: false },
    ),
  register: (email: string, password: string, name: string) =>
    api<{ user: User; accessToken: string }>(
      '/auth/register',
      { method: 'POST', body: { email, password, name }, auth: false },
    ),
  logout: () => api<void>('/auth/logout', { method: 'POST' }),
  me: () => api<{ user: User }>('/me'),
  settings: () =>
    api<{ siteName: string; tagline: string; currency: string; registrationEnabled: boolean }>('/settings/public', {
      auth: false,
    }),
  products: () => api<Product[]>('/products', { auth: false }),
  serversAvailable: () => api<AvailableServer[]>('/servers/available', { auth: false }),
  createOrder: (body: { productId: string; serverId: string }) =>
    api<{ order: unknown; paymentUrl: string }>('/orders', { method: 'POST', body }),
  myOrders: () => api<unknown[]>('/orders/me'),
  mySubscriptions: () => api<unknown[]>('/subscriptions/me'),
};
