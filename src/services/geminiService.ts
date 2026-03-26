/**
 * Gemini Service - Facade for AI agent pipeline
 * Delegates all AI calls to apiService (which proxies to backend)
 */

// Re-export all agent functions and helpers from apiService
export {
  runResearcherAgent,
  runArchitectAgent,
  runAnalystAgent,
  runProsConsAgent,
  runRecommendationAgent,
  mapConcurrent,
} from './apiService';

import * as apiService from './apiService';
import type { ComparisonResult } from './apiService';

// Re-export ComparisonResult type
export type { ComparisonResult } from './apiService';

/**
 * Main comparison pipeline - orchestrates all AI agents
 */
export async function generateComparison(
  itemA: string,
  itemB: string,
  onProgress?: (step: string) => void,
  onPhaseComplete?: (phase: string, data: any) => void,
  language?: string
): Promise<ComparisonResult> {

  // Phase 1: Dual-Track Research
  onProgress?.("Phase 1: Researching entities concurrently...");
  const [profileA, profileB] = await Promise.all([
    apiService.runResearcherAgent(itemA, language),
    apiService.runResearcherAgent(itemB, language)
  ]);
  onPhaseComplete?.('entities', { entityA: profileA, entityB: profileB });

  // Phase 2: Framework Architecture
  onProgress?.("Phase 2: Architecting comparison framework...");
  const framework = await apiService.runArchitectAgent(profileA, profileB, language);
  onPhaseComplete?.('framework', { relationship: framework.relationship, dimensionCount: framework.dimensions.length });

  // Phase 3: Multi-Dimensional Analysis (Concurrent)
  onProgress?.(`Phase 3: Analyzing ${framework.dimensions.length} dimensions concurrently...`);
  // Limit concurrency to 6 for faster processing
  const analyzedDimensions = await apiService.mapConcurrent(framework.dimensions, 6, async (dim) => {
    const result = await apiService.runAnalystAgent(profileA, profileB, dim, language);
    onPhaseComplete?.('dimension', result);
    return result;
  });

  // Phase 4: Synthesis & Verdict (Concurrent)
  onProgress?.("Phase 4: Synthesizing final verdict and pros/cons...");
  const [prosCons, recommendation] = await Promise.all([
    apiService.runProsConsAgent(profileA, profileB, analyzedDimensions, language),
    apiService.runRecommendationAgent(profileA, profileB, analyzedDimensions, null, language)
  ]);
  onPhaseComplete?.('verdict', { prosCons, recommendation });

  // Assemble Final Result
  onProgress?.("Finalizing report...");
  return {
    entityA: profileA,
    entityB: profileB,
    relationship: framework.relationship,
    dimensions: analyzedDimensions,
    prosCons,
    recommendation
  };
}
