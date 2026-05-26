import type {
  AdminSummary,
  BulkPreflightItemResult,
  BulkPromoteResult,
  CallListItem,
  CandidatePair,
  CandidatePairStatus,
  DemandSenseResult,
  Entity,
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

export function getEntities(category?: string) {
  const qs = category ? `?category=${encodeURIComponent(category)}` : '';
  return request<{ items: Entity[]; categories: string[] }>(`/entities${qs}`);
}

export function addEntity(name: string, category: string) {
  return request<Entity>('/entities', {
    method: 'POST',
    body: JSON.stringify({ name, category }),
  });
}

export function bulkAddEntities(csv: string) {
  return request<{
    added: Entity[];
    skipped: Array<{ name: string; category: string; reason: 'duplicate' | 'invalid' }>;
  }>('/entities/bulk', {
    method: 'POST',
    body: JSON.stringify({ csv }),
  });
}

export function deleteEntity(id: number) {
  return request<{ ok: true }>(`/entities/${id}`, { method: 'DELETE' });
}

export function syncCandidates(category?: string) {
  return request<{ created: number; total: number }>('/candidates/sync', {
    method: 'POST',
    body: JSON.stringify({ category }),
  });
}

export function listCandidates(opts: {
  category?: string;
  status?: CandidatePairStatus;
  minScore?: number;
  limit?: number;
  offset?: number;
} = {}) {
  const params = new URLSearchParams();
  if (opts.category) params.set('category', opts.category);
  if (opts.status) params.set('status', opts.status);
  if (typeof opts.minScore === 'number') params.set('minScore', String(opts.minScore));
  if (typeof opts.limit === 'number') params.set('limit', String(opts.limit));
  if (typeof opts.offset === 'number') params.set('offset', String(opts.offset));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return request<{ items: CandidatePair[]; total: number }>(`/candidates${qs}`);
}

export function bulkPreflightCandidates(pairIds: number[], language: string) {
  return request<{ results: BulkPreflightItemResult[] }>('/candidates/bulk-preflight', {
    method: 'POST',
    body: JSON.stringify({ pairIds, language }),
  });
}

export function bulkPromoteCandidates(pairIds: number[], language: string, description?: string) {
  return request<BulkPromoteResult>('/candidates/bulk-promote', {
    method: 'POST',
    body: JSON.stringify({ pairIds, language, description }),
  });
}
