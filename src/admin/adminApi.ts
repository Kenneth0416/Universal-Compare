import type {
  AdminPeriodDays,
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
const ADMIN_PERIODS: readonly AdminPeriodDays[] = [0, 1, 7, 14, 30];

type RequestOptions = {
  signal?: AbortSignal;
};

export function sanitizeAdminPeriod(value: number): AdminPeriodDays {
  return ADMIN_PERIODS.includes(value as AdminPeriodDays) ? value as AdminPeriodDays : 1;
}

export function sanitizeListLimit(value: number | undefined, fallback: number, maximum = 200) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), maximum);
}

export function sanitizeListOffset(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(Math.trunc(value), 0);
}

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

export async function getAdminSession(options: RequestOptions = {}) {
  try {
    return await request<{ authenticated: boolean }>('/session', { signal: options.signal });
  } catch (error) {
    if (options.signal?.aborted) throw error;
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

export function getAdminSummary(periodDays: number = 1, options: RequestOptions = {}) {
  return request<AdminSummary>(`/summary?period=${sanitizeAdminPeriod(periodDays)}`, { signal: options.signal });
}

export function getAdminRuns(options: RequestOptions = {}) {
  return request<ListResponse<RunListItem>>('/runs?limit=50', { signal: options.signal });
}

export function getAdminCalls(options: RequestOptions = {}) {
  return request<ListResponse<CallListItem>>('/calls?limit=50', { signal: options.signal });
}

export type AdminUsersQuery = {
  type?: 'human' | 'ai' | 'bot';
  minComparisons?: number;
  sort?: 'recent' | 'comparisons' | 'visits';
};

export function getAdminUsers(options: RequestOptions & AdminUsersQuery = {}) {
  const params = new URLSearchParams({ limit: '50' });
  if (options.type) params.set('type', options.type);
  if (options.minComparisons) params.set('minComparisons', String(options.minComparisons));
  if (options.sort) params.set('sort', options.sort);
  return request<ListResponse<UserListItem>>(`/users?${params.toString()}`, { signal: options.signal });
}

export function getAdminReports(options: RequestOptions = {}) {
  return request<ListResponse<ReportListItem>>('/reports?limit=50', { signal: options.signal });
}

export function deleteAdminReport(reportId: string) {
  return request<{ ok: true }>(`/reports/${encodeURIComponent(reportId)}`, { method: 'DELETE' });
}

export function getAdminFeatured(options: RequestOptions = {}) {
  return request<{ items: FeaturedComparison[] }>('/featured', { signal: options.signal });
}

export function addAdminFeatured(
  itemA: string,
  itemB: string,
  language: string,
  description: string,
  reportId?: string,
  idempotencyKey?: string,
) {
  return request<FeaturedComparison>('/featured', {
    method: 'POST',
    body: JSON.stringify({ itemA, itemB, language, description, reportId, idempotencyKey }),
  });
}

export function deleteAdminFeatured(id: number) {
  return request<{ ok: true }>(`/featured/${id}`, { method: 'DELETE' });
}

export function patchAdminFeatured(id: number, reportId: string, options: RequestOptions = {}) {
  return request<{ ok: true }>(`/featured/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ reportId }),
    signal: options.signal,
  });
}

export function backfillSources(reportId: string, idempotencyKey?: string) {
  return request<{
    success: boolean;
    sourcesCount: number;
    dimensionsUpdated: number;
  }>(`/reports/${encodeURIComponent(reportId)}/backfill-sources`, {
    method: 'POST',
    body: JSON.stringify({ idempotencyKey }),
  });
}

export function preflightFeatured(itemA: string, itemB: string, language: string, idempotencyKey?: string) {
  return request<DemandSenseResult>('/featured/preflight', {
    method: 'POST',
    body: JSON.stringify({ itemA, itemB, language, idempotencyKey }),
  });
}

export function getEntities(category?: string, options: RequestOptions = {}) {
  const qs = category ? `?category=${encodeURIComponent(category)}` : '';
  return request<{ items: Entity[]; categories: string[] }>(`/entities${qs}`, { signal: options.signal });
}

export function addEntity(name: string, category: string) {
  return request<Entity>('/entities', {
    method: 'POST',
    body: JSON.stringify({ name, category }),
  });
}

export function bulkAddEntities(csv: string, idempotencyKey?: string) {
  return request<{
    added: Entity[];
    skipped: Array<{ name: string; category: string; reason: 'duplicate' | 'invalid' }>;
  }>('/entities/bulk', {
    method: 'POST',
    body: JSON.stringify({ csv, idempotencyKey }),
  });
}

export function deleteEntity(id: number) {
  return request<{ ok: true }>(`/entities/${id}`, { method: 'DELETE' });
}

export function syncCandidates(category?: string, idempotencyKey?: string) {
  return request<{ created: number; total: number }>('/candidates/sync', {
    method: 'POST',
    body: JSON.stringify({ category, idempotencyKey }),
  });
}

export function listCandidates(opts: {
  category?: string;
  status?: CandidatePairStatus;
  minScore?: number;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
} = {}) {
  const params = new URLSearchParams();
  if (opts.category) params.set('category', opts.category);
  if (opts.status) params.set('status', opts.status);
  if (typeof opts.minScore === 'number') params.set('minScore', String(opts.minScore));
  params.set('limit', String(sanitizeListLimit(opts.limit, 200)));
  params.set('offset', String(sanitizeListOffset(opts.offset)));
  const qs = `?${params.toString()}`;
  return request<{ items: CandidatePair[]; total: number }>(`/candidates${qs}`, { signal: opts.signal });
}

export function bulkPreflightCandidates(pairIds: number[], language: string, idempotencyKey?: string) {
  return request<{ results: BulkPreflightItemResult[] }>('/candidates/bulk-preflight', {
    method: 'POST',
    body: JSON.stringify({ pairIds, language, idempotencyKey }),
  });
}

export function bulkPromoteCandidates(
  pairIds: number[],
  language: string,
  description?: string,
  idempotencyKey?: string,
) {
  return request<BulkPromoteResult>('/candidates/bulk-promote', {
    method: 'POST',
    body: JSON.stringify({ pairIds, language, description, idempotencyKey }),
  });
}
