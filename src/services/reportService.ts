import { ComparisonResult } from './geminiService';

const API_BASE = '/api';

export interface SaveReportInput {
  runId?: string;
  itemA: string;
  itemB: string;
  language: string;
  result: ComparisonResult;
}

export interface SaveReportResponse {
  reportId: string;
  url: string;
}

export interface ReportData {
  reportId: string;
  runId: string | null;
  itemA: string;
  itemB: string;
  language: string;
  result: ComparisonResult;
  visitorId: string;
  createdAt: string;
  viewCount: number;
}

export async function saveReport(input: SaveReportInput): Promise<SaveReportResponse> {
  const response = await fetch(`${API_BASE}/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Failed to save report: ${response.status}`);
  }

  return response.json();
}

export async function getReport(reportId: string): Promise<ReportData> {
  const response = await fetch(`${API_BASE}/reports/${encodeURIComponent(reportId)}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Report not found');
    }
    throw new Error(`Failed to load report: ${response.status}`);
  }

  return response.json();
}
