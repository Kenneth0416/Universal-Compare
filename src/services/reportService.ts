import { ComparisonResult } from './geminiService';

const API_BASE = '/api';

export interface SaveReportInput {
  runId?: string;
  itemA: string;
  itemB: string;
  language: string;
  result: ComparisonResult;
  signal?: AbortSignal;
}

export interface SaveReportResponse {
  reportId: string;
  url: string;
}

export interface ReportData {
  reportId: string;
  itemA: string;
  itemB: string;
  language: string;
  result: ComparisonResult;
  createdAt: string;
  viewCount: number;
}

export async function saveReport(input: SaveReportInput): Promise<SaveReportResponse> {
  const { signal, ...body } = input;
  const reportToken = input.result.reportToken;
  const response = await fetch(`${API_BASE}/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, reportToken }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to save report: ${response.status}`);
  }

  return response.json();
}

export async function getReport(reportId: string, signal?: AbortSignal): Promise<ReportData> {
  const response = await fetch(`${API_BASE}/reports/${encodeURIComponent(reportId)}`, { signal });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Report not found');
    }
    throw new Error(`Failed to load report: ${response.status}`);
  }

  return response.json();
}

export async function getReportBySlug(slug: string, signal?: AbortSignal): Promise<ReportData> {
  const response = await fetch(`${API_BASE}/reports/by-slug/${encodeURIComponent(slug)}`, { signal });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Report not found');
    }
    throw new Error(`Failed to load report: ${response.status}`);
  }

  return response.json();
}
