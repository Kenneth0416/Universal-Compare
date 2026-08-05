/**
 * Client for server-side comparison generation. The server runs the pipeline
 * and survives tab closes / phone locks; the client only starts and polls.
 */

import type { ComparisonResult } from './apiService';

export class ServerGenerationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerGenerationUnavailableError';
  }
}

export interface ServerGenerationHandlers {
  onProgress?: (progress: { key: 'researching' | 'architecting' | 'analyzing' | 'synthesizing' | 'finalizing'; count?: number }) => void;
  onPhaseComplete?: (phase: string, data: any) => void;
  signal?: AbortSignal;
  /** Attach to an already-running generation instead of starting one. */
  skipStart?: boolean;
  /** Give up immediately (as unavailable) when the server has no state for the run. */
  bailOnUnknown?: boolean;
}

export interface ServerGenerationOutcome {
  result: ComparisonResult;
  reportId?: string;
  reportUrl?: string;
}

type ProgressResponse = {
  status: 'running' | 'completed' | 'failed' | 'unknown';
  stepKey?: 'researching' | 'architecting' | 'analyzing' | 'synthesizing' | 'finalizing';
  dimensionCount?: number;
  partial?: {
    entityA?: unknown;
    entityB?: unknown;
    relationship?: unknown;
    dimensions?: unknown[];
    prosCons?: unknown;
    recommendation?: unknown;
  };
  result?: ComparisonResult;
  reportId?: string;
  reportUrl?: string;
  error?: string;
};

const POLL_INTERVAL_MS = 1_500;
const MAX_UNKNOWN_POLLS = 15;

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(new DOMException('Aborted', 'AbortError'));
  }, { once: true });
});

export async function generateViaServer(
  runId: string,
  handlers: ServerGenerationHandlers = {},
): Promise<ServerGenerationOutcome> {
  const { onProgress, onPhaseComplete, signal } = handlers;

  if (!handlers.skipStart) {
    const startResponse = await fetch(`/api/comparison-runs/${encodeURIComponent(runId)}/generate`, {
      method: 'POST',
      signal,
    });
    if (!startResponse.ok) {
      const body = await startResponse.json().catch(() => ({})) as { error?: string };
      throw new ServerGenerationUnavailableError(body.error || `Server generation start failed (${startResponse.status})`);
    }
    const started = await startResponse.json() as { started: boolean; reportId?: string };
    if (!started.started && !started.reportId) {
      throw new ServerGenerationUnavailableError('Server generation did not start');
    }
  }

  const emitted = { entities: false, framework: false, dimensions: 0, verdict: false };
  let unknownPolls = 0;

  for (;;) {
    await sleep(POLL_INTERVAL_MS, signal);
    let response: Response;
    try {
      response = await fetch(`/api/comparison-runs/${encodeURIComponent(runId)}/progress`, { signal });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      continue; // transient network hiccup — the run continues server-side
    }
    if (!response.ok) {
      unknownPolls += 1;
      if (unknownPolls > MAX_UNKNOWN_POLLS) throw new Error('Lost track of the comparison run');
      continue;
    }
    const progress = await response.json() as ProgressResponse;

    const partial = progress.partial;
    if (partial && onPhaseComplete) {
      if (!emitted.entities && partial.entityA && partial.entityB) {
        emitted.entities = true;
        onPhaseComplete('entities', { entityA: partial.entityA, entityB: partial.entityB });
      }
      if (!emitted.framework && partial.relationship) {
        emitted.framework = true;
        onPhaseComplete('framework', { relationship: partial.relationship, dimensionCount: progress.dimensionCount });
      }
      const dimensions = partial.dimensions || [];
      while (emitted.dimensions < dimensions.length) {
        onPhaseComplete('dimension', dimensions[emitted.dimensions]);
        emitted.dimensions += 1;
      }
      if (!emitted.verdict && partial.prosCons && partial.recommendation) {
        emitted.verdict = true;
        onPhaseComplete('verdict', { prosCons: partial.prosCons, recommendation: partial.recommendation });
      }
    }

    if (progress.status === 'running' && progress.stepKey) {
      onProgress?.({ key: progress.stepKey, count: progress.stepKey === 'analyzing' ? progress.dimensionCount : undefined });
      unknownPolls = 0;
      continue;
    }
    if (progress.status === 'completed') {
      if (!progress.result) throw new Error('Comparison completed but the result is unavailable');
      return { result: progress.result, reportId: progress.reportId, reportUrl: progress.reportUrl };
    }
    if (progress.status === 'failed') {
      throw new Error(progress.error || 'Comparison generation failed');
    }
    // status 'unknown': runner state lost (e.g. server restart before any phase persisted)
    if (handlers.bailOnUnknown) {
      throw new ServerGenerationUnavailableError('No server-side state for this run');
    }
    unknownPolls += 1;
    if (unknownPolls > MAX_UNKNOWN_POLLS) {
      throw new Error(progress.error || 'The comparison run was interrupted — please try again');
    }
  }
}

export interface MyActivity {
  reports: Array<{
    reportId: string;
    itemA: string;
    itemB: string;
    language: string;
    createdAt: string;
    url: string;
  }>;
  activeRuns: Array<{
    runId: string;
    itemA: string;
    itemB: string;
    startedAt: string;
  }>;
}

export async function getMyActivity(signal?: AbortSignal): Promise<MyActivity> {
  const response = await fetch('/api/me/activity', { signal });
  if (!response.ok) return { reports: [], activeRuns: [] };
  return await response.json() as MyActivity;
}
