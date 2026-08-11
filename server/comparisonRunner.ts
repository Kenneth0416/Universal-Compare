/**
 * Server-side comparison runner.
 *
 * Runs the full comparison pipeline on behalf of a visitor so that closing the
 * tab, locking the phone, or backgrounding the browser no longer kills the
 * generation (previously ~10% of runs died this way, almost all on mobile).
 * The client starts a run and polls progress; the report is saved under the
 * visitor's id so anonymous users can find it again via their signed cookie.
 *
 * Phases are driven through the same /api/ai/phases HTTP pipeline the browser
 * uses (prompts, schemas, and the proof chain stay in one place), marked with
 * the internal-batch header so public rate limits do not double-count them —
 * the run itself is budgeted at start time in app.ts.
 */

import type { createAnalyticsStore } from './analytics';
import type { createReportStore } from './reports';

type AnalyticsStore = ReturnType<typeof createAnalyticsStore>;
type ReportStore = ReturnType<typeof createReportStore>;

type Source = { url: string; title: string; snippet?: string; proof?: string };

export type RunnerStepKey = 'researching' | 'architecting' | 'analyzing' | 'synthesizing' | 'finalizing';

export type RunnerProgress = {
  status: 'running' | 'completed' | 'failed';
  stepKey: RunnerStepKey;
  dimensionCount?: number;
  partial: {
    entityA?: unknown;
    entityB?: unknown;
    relationship?: unknown;
    dimensions: unknown[];
    prosCons?: unknown;
    recommendation?: unknown;
  };
  result?: unknown;
  reportId?: string;
  reportUrl?: string;
  error?: string;
  updatedAt: number;
};

export type StartRunInput = {
  runId: string;
  itemA: string;
  itemB: string;
  language: string;
  visitorId?: string;
};

const PROGRESS_TTL_MS = 30 * 60 * 1_000;

function interleaveValidSources(left: Source[], right: Source[]): Source[] {
  const seen = new Set<string>();
  const balanced: Source[] = [];
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength && balanced.length < 20; index += 1) {
    for (const source of [left[index], right[index]]) {
      if (!source) continue;
      try {
        const url = new URL(source.url);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
        const normalized = url.toString().replace(/\/+$/, '').toLowerCase();
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        balanced.push({ ...source, url: url.toString() });
      } catch {
        // skip malformed source URLs
      }
    }
  }
  return balanced;
}

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += limit) {
    const chunk = items.slice(index, index + limit);
    results.push(...await Promise.all(chunk.map(fn)));
  }
  return results;
}

export function createComparisonRunner({
  analyticsStore,
  reportStore,
  apiBase,
  batchSecret,
  maxConcurrent = 3,
}: {
  analyticsStore: AnalyticsStore;
  reportStore: ReportStore;
  apiBase: string;
  batchSecret: string;
  maxConcurrent?: number;
}) {
  const progressByRun = new Map<string, RunnerProgress>();
  const inFlight = new Set<string>();

  const prune = () => {
    const cutoff = Date.now() - PROGRESS_TTL_MS;
    for (const [runId, progress] of progressByRun) {
      if (progress.status !== 'running' && progress.updatedAt < cutoff) progressByRun.delete(runId);
    }
  };

  const update = (runId: string, patch: Partial<RunnerProgress>) => {
    const current = progressByRun.get(runId);
    if (!current) return;
    progressByRun.set(runId, { ...current, ...patch, updatedAt: Date.now() });
  };

  const callPhase = async <T>(phase: string, body: unknown): Promise<T> => {
    const delays = [0, 4_000, 12_000, 30_000];
    let lastError: Error = new Error('unreachable');
    for (const delay of delays) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      let response: Response;
      try {
        response = await fetch(`${apiBase}/api/ai/phases/${phase}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-batch': batchSecret },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(240_000),
        });
      } catch (err: any) {
        lastError = new Error(`network error on ${phase}: ${err?.message || err}`);
        continue;
      }
      if (response.ok) return await response.json() as T;
      const errorBody = await response.json().catch(() => ({})) as { error?: string };
      lastError = new Error(errorBody.error || `${phase} failed with status ${response.status}`);
      if (response.status !== 429 && response.status !== 503 && response.status !== 502) throw lastError;
    }
    throw lastError;
  };

  const execute = async (input: StartRunInput) => {
    const { runId, itemA, itemB, language } = input;
    try {
      const [resA, resB] = await Promise.all([
        callPhase<{ profile: any; sources: Source[] }>('researcher', { itemName: itemA, language, runId }),
        callPhase<{ profile: any; sources: Source[] }>('researcher', { itemName: itemB, language, runId }),
      ]);
      const allSources = interleaveValidSources(resA.sources, resB.sources);
      update(runId, {
        stepKey: 'architecting',
        partial: { ...progressByRun.get(runId)!.partial, entityA: resA.profile, entityB: resB.profile },
      });

      const framework = await callPhase<{ relationship: any; dimensions: any[] }>('architect', {
        profileA: resA.profile, profileB: resB.profile, language, runId,
      });
      update(runId, {
        stepKey: 'analyzing',
        dimensionCount: framework.dimensions.length,
        partial: { ...progressByRun.get(runId)!.partial, relationship: framework.relationship },
      });

      const analyzedDimensions = await mapConcurrent(framework.dimensions, 3, async (dimension) => {
        const analyzed = await callPhase<any>('analyst', {
          profileA: resA.profile, profileB: resB.profile, dimension, sources: allSources, language, runId,
        });
        const current = progressByRun.get(runId);
        if (current) {
          update(runId, { partial: { ...current.partial, dimensions: [...current.partial.dimensions, analyzed] } });
        }
        return analyzed;
      });

      update(runId, { stepKey: 'synthesizing' });
      const [prosCons, recommendation] = await Promise.all([
        callPhase<any>('pros-cons', {
          profileA: resA.profile, profileB: resB.profile, dimensions: analyzedDimensions, sources: allSources, language, runId,
        }),
        callPhase<any>('recommendation', {
          profileA: resA.profile, profileB: resB.profile, dimensions: analyzedDimensions, sources: allSources, language, runId,
        }),
      ]);

      const result = {
        entityA: resA.profile,
        entityB: resB.profile,
        relationship: framework.relationship,
        dimensions: analyzedDimensions,
        prosCons,
        recommendation,
        sources: allSources,
      };
      update(runId, {
        stepKey: 'finalizing',
        partial: { ...progressByRun.get(runId)!.partial, prosCons, recommendation },
      });

      // The runner is trusted server code: persist directly under the visitor's
      // identity instead of round-tripping a report grant token.
      const saved = reportStore.saveReport({
        runId,
        itemA,
        itemB,
        language,
        result,
        visitorId: input.visitorId,
      });
      if (!saved) throw new Error('Generated result failed validation on save');

      analyticsStore.finishComparisonRun({ runId, status: 'completed' });
      update(runId, {
        status: 'completed',
        result,
        reportId: saved.reportId,
        reportUrl: saved.url,
      });
    } catch (err: any) {
      const message = err?.message || 'Comparison generation failed';
      analyticsStore.finishComparisonRun({ runId, status: 'failed', errorMessage: message });
      update(runId, { status: 'failed', error: message });
    } finally {
      inFlight.delete(runId);
      prune();
    }
  };

  const start = (input: StartRunInput): { started: boolean; reason?: 'already_running' | 'busy' } => {
    prune();
    if (inFlight.has(input.runId)) return { started: false, reason: 'already_running' };
    if (inFlight.size >= maxConcurrent) return { started: false, reason: 'busy' };
    inFlight.add(input.runId);
    progressByRun.set(input.runId, {
      status: 'running',
      stepKey: 'researching',
      partial: { dimensions: [] },
      updatedAt: Date.now(),
    });
    void execute(input);
    return { started: true };
  };

  const getProgress = (runId: string): RunnerProgress | null => progressByRun.get(runId) || null;

  return { start, getProgress };
}

export type ComparisonRunner = ReturnType<typeof createComparisonRunner>;
