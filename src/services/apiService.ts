/**
 * Client for the server-owned, allowlisted comparison agent phases.
 * Prompts, schemas, models, and provider tools are intentionally not accepted here.
 */

const API_BASE = '/api';

type Language = 'en' | 'zh-CN' | 'zh-TW';

interface EntityProfile {
  name: string;
  normalized_name: string;
  category: string;
  subcategory: string;
  likely_domain: string;
  short_definition: string;
  key_attributes: string[];
  __proof?: string;
}

interface Dimension {
  key: string;
  label: string;
  why_it_matters: string;
  comparison_angle: string;
  __proof?: string;
}

interface FrameworkResult {
  relationship: {
    relationship_type: 'same_category' | 'cross_category' | 'alternatives' | 'complements' | 'analogy' | 'not_comparable';
    comparison_goal: string;
    can_directly_compare: boolean;
    reasoning: string;
    __proof?: string;
  };
  dimensions: Dimension[];
}

interface AnalysisResult {
  item_a_summary: string;
  item_b_summary: string;
  key_difference: string;
  better_for: 'A' | 'B' | 'Both' | 'Neither';
  optional_score_a: number;
  optional_score_b: number;
  citations: Source[];
}

interface ProsConsResult {
  item_a_pros: string[];
  item_a_cons: string[];
  item_b_pros: string[];
  item_b_cons: string[];
  __proof?: string;
}

interface RecommendationResult {
  best_for_a: string[];
  best_for_b: string[];
  which_to_choose_first: string;
  when_not_to_compare_directly: string;
  short_verdict: string;
  long_verdict: string;
  __proof?: string;
}

export interface Source {
  url: string;
  title: string;
  snippet?: string;
  /** Opaque server proof that this source came from the research phase. */
  proof?: string;
}

export interface ComparisonResult {
  entityA: Omit<EntityProfile, 'key_attributes'>;
  entityB: Omit<EntityProfile, 'key_attributes'>;
  relationship: FrameworkResult['relationship'];
  dimensions: Array<Dimension & { analysis: AnalysisResult }>;
  prosCons: ProsConsResult;
  recommendation: RecommendationResult;
  sources?: Source[];
  /** Short-lived server grant required when persisting a generated report. */
  reportToken?: string;
}

type AgentPhase = 'researcher' | 'architect' | 'analyst' | 'pros-cons' | 'recommendation' | 'finalize';

function normalizeLanguage(value?: string): Language {
  return value === 'zh-CN' || value === 'zh-TW' ? value : 'en';
}

async function callAgent<T>(
  phase: AgentPhase,
  payload: Record<string, unknown>,
  runId?: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${API_BASE}/ai/phases/${phase}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, ...(runId ? { runId } : {}) }),
    signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
    throw new Error(error.error || `API call failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function runResearcherAgent(
  itemName: string,
  language?: string,
  runId?: string,
  signal?: AbortSignal,
): Promise<{ profile: EntityProfile; sources: Source[] }> {
  return callAgent('researcher', { itemName, language: normalizeLanguage(language) }, runId, signal);
}

export async function runArchitectAgent(
  profileA: EntityProfile,
  profileB: EntityProfile,
  language?: string,
  runId?: string,
  signal?: AbortSignal,
): Promise<FrameworkResult> {
  return callAgent('architect', { profileA, profileB, language: normalizeLanguage(language) }, runId, signal);
}

export async function runAnalystAgent(
  profileA: EntityProfile,
  profileB: EntityProfile,
  dimension: Dimension,
  sources: Source[] = [],
  language?: string,
  runId?: string,
  signal?: AbortSignal,
): Promise<Dimension & { analysis: AnalysisResult }> {
  return callAgent('analyst', { profileA, profileB, dimension, sources, language: normalizeLanguage(language) }, runId, signal);
}

export async function runProsConsAgent(
  profileA: EntityProfile,
  profileB: EntityProfile,
  dimensions: Array<Dimension & { analysis: AnalysisResult }>,
  language?: string,
  runId?: string,
  signal?: AbortSignal,
  sources: Source[] = [],
): Promise<ProsConsResult> {
  return callAgent('pros-cons', { profileA, profileB, dimensions, sources, language: normalizeLanguage(language) }, runId, signal);
}

export async function runRecommendationAgent(
  profileA: EntityProfile,
  profileB: EntityProfile,
  dimensions: Array<Dimension & { analysis: AnalysisResult }>,
  _prosCons: ProsConsResult | null,
  language?: string,
  runId?: string,
  signal?: AbortSignal,
  sources: Source[] = [],
): Promise<RecommendationResult> {
  return callAgent('recommendation', { profileA, profileB, dimensions, sources, language: normalizeLanguage(language) }, runId, signal);
}

export async function runFinalizeAgent(
  result: ComparisonResult,
  language?: string,
  runId?: string,
  signal?: AbortSignal,
): Promise<{ reportToken: string }> {
  return callAgent('finalize', { result, language: normalizeLanguage(language) }, runId, signal);
}

export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += limit) {
    const chunk = items.slice(index, index + limit);
    results.push(...await Promise.all(chunk.map(fn)));
  }
  return results;
}
