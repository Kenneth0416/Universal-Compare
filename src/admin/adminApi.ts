import type { AdminSummary, CallListItem, ListResponse, RunListItem, UserListItem } from './types';

const API_BASE = '/api/admin';

async function request<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function getAdminSession() {
  try {
    return await request<{ authenticated: boolean }>('/session');
  } catch {
    return { authenticated: false };
  }
}

export function loginAdmin(password: string) {
  return request<{ authenticated: boolean }>('/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export function logoutAdmin() {
  return request<{ authenticated: boolean }>('/logout', { method: 'POST' });
}

export function getAdminSummary() {
  return request<AdminSummary>('/summary');
}

export function getAdminRuns() {
  return request<ListResponse<RunListItem>>('/runs?limit=50');
}

export function getAdminCalls() {
  return request<ListResponse<CallListItem>>('/calls?limit=50');
}

export function getAdminUsers() {
  return request<ListResponse<UserListItem>>('/users?limit=50');
}
