/**
 * New-product topic scout, driven by off-site data.
 *
 * On-site data alone cannot sustain 15 publishes/day, and MiniMax web search
 * returned irrelevant corpus for launch queries (verified 2026-08-06), so the
 * scout now uses two external sources that were validated to work:
 *
 *  1. Tech-media RSS feeds (GSMArena, Engadget, 9to5Mac, The Verge) — fresh
 *     launch headlines as the extraction corpus for new product names.
 *  2. Google search autocomplete for "PRODUCT vs" — real user search demand,
 *     turned directly into candidate pairs.
 *
 * A cheap DeepSeek batch triage then rejects implausible pending pairs so the
 * expensive search-based demand scoring only runs on sensible candidates.
 */

import type OpenAI from 'openai';
import type { DemandSensingService } from '../demandSensing';
import type { EntityPoolStore, Entity } from '../entityPool';
import type { CandidatePairStore } from '../candidatePairs';

const RSS_FEEDS = [
  'https://www.gsmarena.com/rss-news-reviews.php3',
  'https://www.engadget.com/rss.xml',
  'https://9to5mac.com/feed/',
  'https://www.theverge.com/rss/index.xml',
];

const FETCH_UA = 'Mozilla/5.0 (compatible; CompareAI-Scout/2.0; +https://compare-anythings.com)';
const MAX_NEW_PRODUCTS_PER_RUN = 10;
const MAX_AUTOCOMPLETE_LOOKUPS = 12;

export type ScoutOptions = {
  entityStore: EntityPoolStore;
  candidateStore: CandidatePairStore;
  demandSensing: DemandSensingService | undefined;
  deepseekClient: OpenAI;
  deepseekModel: string;
  /** Kept for interface compatibility; no longer used for corpus search. */
  minimaxApiKey?: string;
  minimaxBaseUrl?: string;
  maxPairsToScore?: number;
  log?: (message: string) => void;
};

// --- Source 1: RSS launch headlines ---

function decodeXmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchRssHeadlines(log: (m: string) => void): Promise<string[]> {
  const headlines: string[] = [];
  for (const feedUrl of RSS_FEEDS) {
    try {
      const response = await fetch(feedUrl, {
        headers: { 'User-Agent': FETCH_UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        log(`scout: feed ${feedUrl} -> ${response.status}`);
        continue;
      }
      const xml = await response.text();
      // Handles both RSS <item> and Atom <entry>.
      const items = [...xml.matchAll(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/g)].slice(0, 40);
      for (const [item] of items) {
        const title = decodeXmlEntities(item.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] || '');
        const summary = decodeXmlEntities(
          item.match(/<(?:description|summary)[^>]*>([\s\S]*?)<\/(?:description|summary)>/)?.[1] || '',
        ).slice(0, 220);
        if (title) headlines.push(summary ? `${title} — ${summary}` : title);
      }
    } catch (err: any) {
      log(`scout: feed ${feedUrl} failed: ${err?.message || err}`);
    }
  }
  return headlines;
}

const EXTRACTION_RULES = `Rules:
- Only real, concrete consumer products that are being launched, announced, or reviewed as new. Use the exact marketed product name (brand + model).
- category: a short specific product category in lowercase English (e.g. "smartphone", "action camera", "wireless earbuds", "laptop", "smartwatch", "drone", "tablet", "game console", "ai model").
- Never output people, companies alone, software updates without a product, adult content, or vague placeholders.
- Skip an item rather than guessing a model name. Fewer accurate products beat more speculative ones.`;

async function extractNewProducts(
  options: ScoutOptions,
  headlines: string[],
): Promise<Array<{ name: string; category: string }>> {
  if (headlines.length === 0) return [];
  const corpus = headlines.slice(0, 120).map((h) => `- ${h}`).join('\n');
  const completion = await options.deepseekClient.chat.completions.create({
    model: options.deepseekModel,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: `Below are today's tech-media headlines. Extract up to ${MAX_NEW_PRODUCTS_PER_RUN} NEWLY launched or announced consumer products that shoppers would want to compare against predecessors or rivals.\n\n${EXTRACTION_RULES}\n\nReturn JSON: {"products": [{"name": string, "category": string}]}. Return {"products": []} if nothing qualifies.\n\nHEADLINES:\n${corpus}`,
    }],
  }, { signal: AbortSignal.timeout(90_000) });

  const raw = completion.choices?.[0]?.message?.content || '{}';
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed?.products)) return [];
  return parsed.products
    .filter((p: any) => typeof p?.name === 'string' && typeof p?.category === 'string')
    .map((p: any) => ({ name: p.name.trim().slice(0, 120), category: p.category.trim().toLowerCase().slice(0, 60) }))
    .filter((p: { name: string; category: string }) => p.name && p.category)
    .slice(0, MAX_NEW_PRODUCTS_PER_RUN);
}

// --- Source 2: Google autocomplete "X vs" (real search demand) ---

async function autocompleteCounterparts(productName: string, log: (m: string) => void): Promise<string[]> {
  try {
    const query = encodeURIComponent(`${productName} vs`);
    const response = await fetch(
      `https://suggestqueries.google.com/complete/search?client=firefox&q=${query}`,
      { headers: { 'User-Agent': FETCH_UA }, signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) return [];
    const data = await response.json() as [string, string[]];
    const suggestions = Array.isArray(data?.[1]) ? data[1] : [];
    const prefix = `${productName.toLowerCase()} vs `;
    const counterparts: string[] = [];
    for (const suggestion of suggestions) {
      const lower = String(suggestion).toLowerCase();
      if (!lower.startsWith(prefix)) continue;
      const counterpart = String(suggestion).slice(prefix.length).trim();
      // Skip fragments referring back to the same product line ("... vs 5 pro").
      if (!counterpart || counterpart.length < 3 || /^\d/.test(counterpart)) continue;
      counterparts.push(counterpart.slice(0, 120));
    }
    return [...new Set(counterparts)].slice(0, 4);
  } catch (err: any) {
    log(`scout: autocomplete for "${productName}" failed: ${err?.message || err}`);
    return [];
  }
}

// --- Entity helpers ---

function getOrCreateEntity(store: EntityPoolStore, name: string, category: string): Entity | null {
  try {
    return store.addEntity(name, category);
  } catch {
    const existing = store.listEntities(category).find(
      (entity) => entity.name.toLowerCase() === name.toLowerCase().slice(0, 200),
    );
    return existing || null;
  }
}

// --- Junk triage before expensive scoring ---

async function triagePendingPairs(options: ScoutOptions, log: (m: string) => void): Promise<number> {
  const pending = options.candidateStore.listCandidates({ status: 'pending', limit: 60 });
  if (pending.items.length === 0) return 0;
  const listing = pending.items
    .map((c) => `${c.id}: "${c.itemAName}" vs "${c.itemBName}" (category: ${c.category})`)
    .join('\n');
  const completion = await options.deepseekClient.chat.completions.create({
    model: options.deepseekModel,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: `For each candidate comparison below, judge if it is PLAUSIBLE: two real, comparable things a consumer might genuinely search "A vs B" for. Mark implausible: mismatched categories (a car vs a fuel additive), nonsense, adult content, private persons or local shops, or placeholder-like names.\n\nReturn JSON: {"implausible_ids": [numbers]}.\n\nCANDIDATES:\n${listing}`,
    }],
  }, { signal: AbortSignal.timeout(90_000) });

  const raw = completion.choices?.[0]?.message?.content || '{}';
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 0;
  }
  const ids = Array.isArray(parsed?.implausible_ids) ? parsed.implausible_ids : [];
  const validIds = new Set(pending.items.map((c) => c.id));
  let rejected = 0;
  for (const id of ids) {
    if (typeof id === 'number' && validIds.has(id) && options.candidateStore.markRejected(id)) rejected += 1;
  }
  if (rejected > 0) log(`scout: triage rejected ${rejected}/${pending.items.length} implausible pending pairs`);
  return rejected;
}

// --- Main ---

export async function runTopicScout(options: ScoutOptions): Promise<{
  scoutedPairs: number;
  scoredPairs: number;
}> {
  const log = options.log || (() => {});

  // 1. Off-site corpus: launch headlines from tech media RSS.
  const headlines = await fetchRssHeadlines(log);
  log(`scout: fetched ${headlines.length} headlines from ${RSS_FEEDS.length} feeds`);

  // 2. Extract newly launched products.
  let newProducts: Array<{ name: string; category: string }> = [];
  try {
    newProducts = await extractNewProducts(options, headlines);
    log(`scout: extracted ${newProducts.length} new products: ${newProducts.map((p) => p.name).join(', ') || '(none)'}`);
  } catch (err: any) {
    log(`scout: product extraction failed: ${err?.message || err}`);
  }

  // 3. Expand each new product into real-demand pairs via Google autocomplete.
  let scoutedPairs = 0;
  let lookups = 0;
  for (const product of newProducts) {
    if (lookups >= MAX_AUTOCOMPLETE_LOOKUPS) break;
    lookups += 1;
    const productEntity = getOrCreateEntity(options.entityStore, product.name, product.category);
    if (!productEntity) continue;
    const counterparts = await autocompleteCounterparts(product.name, log);
    for (const counterpartName of counterparts) {
      const counterpartEntity = getOrCreateEntity(options.entityStore, counterpartName, product.category);
      if (!counterpartEntity) continue;
      const { created } = options.candidateStore.addDirectPair(productEntity.id, counterpartEntity.id);
      if (created) {
        scoutedPairs += 1;
        log(`scout: demand pair "${product.name}" vs "${counterpartName}"`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  // 4. Cheap triage rejects junk before expensive search-based scoring.
  try {
    await triagePendingPairs(options, log);
  } catch (err: any) {
    log(`scout: triage failed: ${err?.message || err}`);
  }

  // 5. Demand-score surviving pending pairs (newest first so fresh launches lead).
  let scoredPairs = 0;
  if (options.demandSensing) {
    const pending = options.candidateStore.listCandidates({
      status: 'pending',
      limit: 500,
    });
    const newestFirst = [...pending.items].sort((a, b) => b.id - a.id).slice(0, options.maxPairsToScore ?? 20);
    for (const candidate of newestFirst) {
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
    log('scout: demand sensing unavailable; pairs stay pending');
  }

  return { scoutedPairs, scoredPairs };
}
