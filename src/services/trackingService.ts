const API_BASE = '/api';

export type ComparisonRunStatus = 'completed' | 'failed';

export async function startComparisonRun({
  itemA,
  itemB,
  language,
  signal,
}: {
  itemA: string;
  itemB: string;
  language: string;
  signal?: AbortSignal;
}) {
  const response = await fetch(`${API_BASE}/comparison-runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemA, itemB, language }),
    signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Tracking request failed' }));
    throw new Error(error.error || `Tracking request failed with status ${response.status}`);
  }

  return response.json() as Promise<{ runId: string; visitorId: string }>;
}

export async function finishComparisonRun({
  runId,
  status,
  errorMessage,
  signal,
}: {
  runId: string;
  status: ComparisonRunStatus;
  errorMessage?: string;
  signal?: AbortSignal;
}) {
  const response = await fetch(`${API_BASE}/comparison-runs/${encodeURIComponent(runId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, errorMessage }),
    signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Tracking update failed' }));
    throw new Error(error.error || `Tracking update failed with status ${response.status}`);
  }
}
