import type {
  AdminSummary,
  CallListItem,
  DemandSenseResult,
  FeaturedComparison,
  ListResponse,
  ReportListItem,
  RunListItem,
  UserListItem,
} from './types';

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

export function getAdminSummary(periodDays = 1) {
  return request<AdminSummary>(`/summary?period=${periodDays}`);
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

export function getAdminReports() {
  return request<ListResponse<ReportListItem>>('/reports?limit=50');
}

export function deleteAdminReport(reportId: string) {
  return request<{ ok: true }>(`/reports/${encodeURIComponent(reportId)}`, { method: 'DELETE' });
}

export function getAdminFeatured() {
  return request<{ items: FeaturedComparison[] }>('/featured');
}

export function addAdminFeatured(itemA: string, itemB: string, language: string, description: string, reportId?: string) {
  return request<FeaturedComparison>('/featured', {
    method: 'POST',
    body: JSON.stringify({ itemA, itemB, language, description, reportId }),
  });
}

export function deleteAdminFeatured(id: number) {
  return request<{ ok: true }>(`/featured/${id}`, { method: 'DELETE' });
}

export function patchAdminFeatured(id: number, reportId: string) {
  return request<{ ok: true }>(`/featured/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ reportId }),
  });
}

export async function backfillSources(reportId: string): Promise<{
  success: boolean;
  sourcesCount: number;
  dimensionsUpdated: number;
}> {
  const res = await fetch(`/api/admin/reports/${reportId}/backfill-sources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Backfill failed' }));
    throw new Error(err.error);
  }
  return res.json();
}

export function preflightFeatured(itemA: string, itemB: string, language: string) {
  return request<DemandSenseResult>('/featured/preflight', {
    method: 'POST',
    body: JSON.stringify({ itemA, itemB, language }),
  });
}
