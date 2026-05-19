/**
 * Gemini Service - Facade for AI agent pipeline
 * Delegates all AI calls to apiService (which proxies to backend)
 */

import * as apiService from './apiService';
import type { ComparisonResult, Source } from './apiService';

export type { ComparisonResult, Source } from './apiService';

// Re-export all agent functions and helpers from apiService
export {
  runResearcherAgent,
  runArchitectAgent,
  runAnalystAgent,
  runProsConsAgent,
  runRecommendationAgent,
  mapConcurrent,
} from './apiService';

function deduplicateSourcesByUrl(sources: Source[]): Source[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    const normalized = s.url.replace(/\/+$/, '').toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

/**
 * Main comparison pipeline - orchestrates all AI agents
 */
export async function generateComparison(
  itemA: string,
  itemB: string,
  onProgress?: (step: string) => void,
  onPhaseComplete?: (phase: string, data: any) => void,
  language?: string,
  runId?: string
): Promise<ComparisonResult> {

  // Phase 1: Dual-Track Research (now returns sources)
  onProgress?.("Phase 1: Researching entities concurrently...");
  const [resA, resB] = await Promise.all([
    apiService.runResearcherAgent(itemA, language, runId),
    apiService.runResearcherAgent(itemB, language, runId)
  ]);
  const profileA = resA.profile;
  const profileB = resB.profile;
  const allSources = deduplicateSourcesByUrl([...resA.sources, ...resB.sources]).slice(0, 20);
  onPhaseComplete?.('entities', { entityA: profileA, entityB: profileB });

  // Phase 2: Framework Architecture
  onProgress?.("Phase 2: Architecting comparison framework...");
  const framework = await apiService.runArchitectAgent(profileA, profileB, language, runId);
  onPhaseComplete?.('framework', { relationship: framework.relationship, dimensionCount: framework.dimensions.length });

  // Phase 3: Multi-Dimensional Analysis — passes sources to analyst
  onProgress?.(`Phase 3: Analyzing ${framework.dimensions.length} dimensions concurrently...`);
  const analyzedDimensions = await apiService.mapConcurrent(framework.dimensions, 6, async (dim) => {
    const result = await apiService.runAnalystAgent(profileA, profileB, dim, allSources, language, runId);
    onPhaseComplete?.('dimension', result);
    return result;
  });

  // Phase 4: Synthesis & Verdict (Concurrent)
  onProgress?.("Phase 4: Synthesizing final verdict and pros/cons...");
  const [prosCons, recommendation] = await Promise.all([
    apiService.runProsConsAgent(profileA, profileB, analyzedDimensions, language, runId),
    apiService.runRecommendationAgent(profileA, profileB, analyzedDimensions, null, language, runId)
  ]);
  onPhaseComplete?.('verdict', { prosCons, recommendation });

  // Assemble Final Result — includes sources
  onProgress?.("Finalizing report...");
  return {
    entityA: profileA,
    entityB: profileB,
    relationship: framework.relationship,
    dimensions: analyzedDimensions,
    prosCons,
    recommendation,
    sources: allSources,
  };
}
