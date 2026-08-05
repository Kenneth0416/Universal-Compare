/**
 * New-product topic scout.
 *
 * Finds freshly launched products via web search, extracts safe comparison
 * pairs (new product vs predecessor or direct competitor), stores them in the
 * entity pool / candidate pairs, and demand-scores the pending pairs so the
 * publisher can promote the winners. Rationale: batch-generating head terms
 * (React vs Angular tier) was tried in 2026-07 and produced ~zero traffic;
 * fresh long-tail comparisons are the only pattern that ranks.
 */

import type OpenAI from 'openai';
import { callMinimaxSearch } from '../providers/minimax';
import type { DemandSensingService } from '../demandSensing';
import type { EntityPoolStore } from '../entityPool';
import type { CandidatePairStore } from '../candidatePairs';

const DEFAULT_CATEGORIES = [
  'smartphone',
  'action camera',
  'pocket gimbal camera',
  'drone',
  'laptop',
  'wireless earbuds',
  'smartwatch',
  'mirrorless camera',
  'handheld game console',
  'robot vacuum',
  'tablet',
  'e-reader',
  'portable power station',
  'VR headset',
  'AI consumer gadget',
];

export type ScoutedPair = { itemA: string; itemB: string; category: string };

type ScoutOptions = {
  entityStore: EntityPoolStore;
  candidateStore: CandidatePairStore;
  demandSensing: DemandSensingService | undefined;
  deepseekClient: OpenAI;
  deepseekModel: string;
  minimaxApiKey: string;
  minimaxBaseUrl?: string;
  categoriesPerRun?: number;
  maxPairsToScore?: number;
  log?: (message: string) => void;
};

function rotatingCategories(count: number): string[] {
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  const picked: string[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    picked.push(DEFAULT_CATEGORIES[(dayIndex * count + offset) % DEFAULT_CATEGORIES.length]);
  }
  return [...new Set(picked)];
}

const EXTRACTION_RULES = `Rules:
- Only real, concrete consumer products that are publicly announced or released. Use the exact marketed product name (brand + model).
- item_a must be a product launched or announced within roughly the last 90 days; item_b is its direct predecessor or closest current competitor.
- Never output people, companies alone, adult content, rumors without a named product, or placeholder names.
- Skip a pair rather than guessing a model name. Fewer accurate pairs beat more speculative ones.`;

async function extractPairsForCategory(
  options: ScoutOptions,
  category: string,
): Promise<ScoutedPair[]> {
  const now = new Date();
  const monthYear = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const query = `newly launched ${category} ${monthYear} release announcement specs`;
  const search = await callMinimaxSearch(
    options.minimaxApiKey,
    query,
    options.minimaxBaseUrl,
    AbortSignal.timeout(60_000),
  );
  const corpus = [
    search.text?.slice(0, 12_000) || '',
    ...search.sources.slice(0, 10).map((s) => `- ${s.title}: ${s.snippet || ''}`),
  ].join('\n');
  if (!corpus.trim()) return [];

  const completion = await options.deepseekClient.chat.completions.create({
    model: options.deepseekModel,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: `From the search results below about the "${category}" category, extract up to 6 comparison pairs of the form "newly launched product vs predecessor-or-competitor" that shoppers would realistically search for.\n\n${EXTRACTION_RULES}\n\nReturn JSON: {"pairs": [{"item_a": string, "item_b": string}]}. Return {"pairs": []} if nothing qualifies.\n\nSEARCH RESULTS:\n${corpus}`,
    }],
  }, { signal: AbortSignal.timeout(90_000) });

  const raw = completion.choices?.[0]?.message?.content || '{}';
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed?.pairs)) return [];
  return parsed.pairs
    .filter((p: any) => typeof p?.item_a === 'string' && typeof p?.item_b === 'string')
    .map((p: any) => ({
      itemA: p.item_a.trim().slice(0, 200),
      itemB: p.item_b.trim().slice(0, 200),
      category,
    }))
    .filter((p: ScoutedPair) => p.itemA && p.itemB && p.itemA.toLowerCase() !== p.itemB.toLowerCase())
    .slice(0, 6);
}

export async function runTopicScout(options: ScoutOptions): Promise<{
  scoutedPairs: number;
  scoredPairs: number;
}> {
  const log = options.log || (() => {});
  const categories = rotatingCategories(options.categoriesPerRun ?? 3);
  log(`scout: categories today = ${categories.join(', ')}`);

  let scoutedPairs = 0;
  for (const category of categories) {
    try {
      const pairs = await extractPairsForCategory(options, category);
      for (const pair of pairs) {
        for (const name of [pair.itemA, pair.itemB]) {
          try {
            options.entityStore.addEntity(name, category);
          } catch (err: any) {
            if (!/duplicate/i.test(err?.message || '')) throw err;
          }
        }
        scoutedPairs += 1;
      }
      options.candidateStore.syncFromEntityPool(category);
      log(`scout: ${category} -> ${pairs.length} pairs`);
    } catch (err: any) {
      log(`scout: ${category} failed: ${err?.message || err}`);
    }
  }

  let scoredPairs = 0;
  if (options.demandSensing) {
    const pending = options.candidateStore.listCandidates({
      status: 'pending',
      limit: options.maxPairsToScore ?? 20,
    });
    for (const candidate of pending.items) {
      try {
        const result = await options.demandSensing.scorePair(
          candidate.itemAName,
          candidate.itemBName,
          'en',
          AbortSignal.timeout(120_000),
        );
        options.candidateStore.updateScore(candidate.id, result);
        scoredPairs += 1;
        log(`scout: scored ${candidate.itemAName} vs ${candidate.itemBName} = ${result.score}`);
      } catch (err: any) {
        log(`scout: scoring failed for #${candidate.id}: ${err?.message || err}`);
      }
    }
  } else {
    log('scout: demand sensing unavailable (missing DEEPSEEK_API_KEY/MINIMAX_API_KEY); pairs stay pending');
  }

  return { scoutedPairs, scoredPairs };
}
