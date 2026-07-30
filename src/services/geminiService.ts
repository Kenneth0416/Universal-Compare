/**
 * Gemini Service - Facade for AI agent pipeline
 * Delegates all AI calls to apiService (which proxies to backend)
 */

import * as apiService from './apiService';
import type { ComparisonResult, Source } from './apiService';

export type { ComparisonResult, Source } from './apiService';

export interface ComparisonProgress {
  key: 'researching' | 'architecting' | 'analyzing' | 'synthesizing' | 'finalizing';
  count?: number;
}

// Re-export all agent functions and helpers from apiService
export {
  runResearcherAgent,
  runArchitectAgent,
  runAnalystAgent,
  runProsConsAgent,
  runRecommendationAgent,
  runFinalizeAgent,
  mapConcurrent,
} from './apiService';

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
        // Provider URLs are untrusted; malformed and non-HTTP(S) sources are omitted.
      }
    }
  }

  return balanced;
}

/**
 * Main comparison pipeline - orchestrates all AI agents
 */
export async function generateComparison(
  itemA: string,
  itemB: string,
  onProgress?: (progress: ComparisonProgress) => void,
  onPhaseComplete?: (phase: string, data: any) => void,
  language?: string,
  runId?: string,
  signal?: AbortSignal,
): Promise<ComparisonResult> {

  // Phase 1: Dual-Track Research (now returns sources)
  onProgress?.({ key: 'researching' });
  const [resA, resB] = await Promise.all([
    apiService.runResearcherAgent(itemA, language, runId, signal),
    apiService.runResearcherAgent(itemB, language, runId, signal),
  ]);
  const profileA = resA.profile;
  const profileB = resB.profile;
  const allSources = interleaveValidSources(resA.sources, resB.sources);
  onPhaseComplete?.('entities', { entityA: profileA, entityB: profileB });

  // Phase 2: Framework Architecture
  onProgress?.({ key: 'architecting' });
  const framework = await apiService.runArchitectAgent(profileA, profileB, language, runId, signal);
  onPhaseComplete?.('framework', { relationship: framework.relationship, dimensionCount: framework.dimensions.length });

  // Phase 3: Multi-Dimensional Analysis — passes sources to analyst
  onProgress?.({ key: 'analyzing', count: framework.dimensions.length });
  const analyzedDimensions = await apiService.mapConcurrent(framework.dimensions, 3, async (dim) => {
    const result = await apiService.runAnalystAgent(profileA, profileB, dim, allSources, language, runId, signal);
    onPhaseComplete?.('dimension', result);
    return result;
  });

  // Phase 4: Synthesis & Verdict (Concurrent)
  onProgress?.({ key: 'synthesizing' });
  const [prosCons, recommendation] = await Promise.all([
    apiService.runProsConsAgent(profileA, profileB, analyzedDimensions, language, runId, signal, allSources),
    apiService.runRecommendationAgent(profileA, profileB, analyzedDimensions, null, language, runId, signal, allSources),
  ]);
  onPhaseComplete?.('verdict', { prosCons, recommendation });

  // Assemble Final Result — includes sources
  onProgress?.({ key: 'finalizing' });
  const result: ComparisonResult = {
    entityA: profileA,
    entityB: profileB,
    relationship: framework.relationship,
    dimensions: analyzedDimensions,
    prosCons,
    recommendation,
    sources: allSources,
  };
  const { reportToken } = await apiService.runFinalizeAgent(result, language, runId, signal);
  return { ...result, reportToken };
}
