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
import type { DemandSenseResult, DemandSensingService } from '../demandSensing';
import type { EntityPoolStore, Entity } from '../entityPool';
import type { CandidatePairSource, CandidatePairStore } from '../candidatePairs';

const RSS_FEEDS = [
  'https://www.gsmarena.com/rss-news-reviews.php3',
  'https://www.engadget.com/rss.xml',
  'https://9to5mac.com/feed/',
  'https://www.theverge.com/rss/index.xml',
  'https://www.dpreview.com/feeds/news',
  'https://www.androidauthority.com/feed/',
  // TYPO3 "type=100" variant; verified to return application/xml RSS.
  'https://www.notebookcheck.net/News.152.100.html',
];

const FETCH_UA = 'Mozilla/5.0 (compatible; CompareAI-Scout/2.0; +https://compare-anythings.com)';
const MAX_NEW_PRODUCTS_PER_RUN = 10;
const MAX_AUTOCOMPLETE_LOOKUPS = 30;
/** Sources whose demand is already proven by real user queries; they skip the expensive scoring. */
const FAST_TRACK_SOURCES: ReadonlySet<CandidatePairSource> = new Set<CandidatePairSource>([
  'autocomplete',
  'user-demand',
]);

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
  /**
   * Extra products to expand via autocomplete alongside the RSS launches.
   * Category 'user-demand' marks entities taken from real visitor comparisons;
   * anything else is treated as an entity-pool rotation seed.
   */
  extraSeedEntities?: Array<{ name: string; category: string }>;
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
  const perFeed: string[][] = [];
  for (const feedUrl of RSS_FEEDS) {
    const headlines: string[] = [];
    perFeed.push(headlines);
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
  // Round-robin across feeds: the extractor only reads the first ~120 headlines,
  // so a flat concat would let the first feeds crowd out the newer verticals.
  const interleaved: string[] = [];
  const longest = Math.max(0, ...perFeed.map((items) => items.length));
  for (let index = 0; index < longest; index += 1) {
    for (const items of perFeed) {
      if (index < items.length) interleaved.push(items[index]);
    }
  }
  return interleaved;
}

const EXTRACTION_RULES = `Rules:
- Only real, concrete consumer products that are being launched, announced, or reviewed as new. Use the exact marketed product name (brand + model).
- category: a short specific product category in lowercase English. Electronics are welcome (e.g. "smartphone", "action camera", "mirrorless camera", "wireless earbuds", "laptop", "smartwatch", "drone", "tablet", "game console", "ai model"), and so are non-electronics verticals that shoppers compare just as hard: "skincare", "beauty", "hair care", "book", "running shoes", "kitchen appliance", "coffee machine", "audio gear", "headphones", "speaker", "e-reader", "fitness equipment".
- Do not restrict yourself to gadgets: a newly launched serum, novel, running shoe, air fryer, or e-reader is as valuable as a phone.
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

// Google suggests query tails, not clean product names ("... vs pixel 10 camera",
// "... vs s25 reddit"), so the tail has to be stripped back to the product.
const JUNK_PHRASES = ['which is better', 'which one is better', 'which is best', 'what is better'];
const TRAILING_JUNK = ['comparison', 'review', 'reviews', 'specs', 'spec', 'price', 'reddit', 'gsmarena', 'camera'];
const LEADING_JUNK = TRAILING_JUNK.filter((token) => token !== 'camera');
const GENERIC_WORDS = new Set([
  'which', 'what', 'is', 'are', 'better', 'best', 'one', 'or', 'and', 'the', 'a', 'an', 'vs', 'versus',
  'difference', 'differences', 'compare', 'comparison', 'review', 'reviews', 'specs', 'spec', 'price',
  'reddit', 'gsmarena', 'camera', 'worth', 'it', 'buy', 'good', 'bad', 'new', 'old',
]);

/** Reduce a raw autocomplete tail to a usable product name, or null if it is only query filler. */
function cleanCounterpart(raw: string): string | null {
  let text = raw.replace(/[?!.,;:]+$/g, '').trim();
  for (const phrase of JUNK_PHRASES) {
    text = text.replace(new RegExp(phrase.replace(/\s+/g, '\\s+'), 'gi'), ' ');
  }

  let words = text.split(/\s+/).filter(Boolean);
  let stripped = true;
  while (stripped && words.length > 0) {
    stripped = false;
    if (TRAILING_JUNK.includes(words[words.length - 1].toLowerCase())) {
      words = words.slice(0, -1);
      stripped = true;
    } else if (LEADING_JUNK.includes(words[0].toLowerCase())) {
      words = words.slice(1);
      stripped = true;
    }
  }

  const cleaned = words.join(' ');
  if (cleaned.length < 3) return null;
  if (words.every((word) => GENERIC_WORDS.has(word.toLowerCase()))) return null;
  return cleaned.slice(0, 120);
}

async function autocompleteCounterparts(productName: string, log: (m: string) => void): Promise<string[]> {
  try {
    const query = encodeURIComponent(`${productName} vs`);
    const response = await fetch(
      `https://suggestqueries.google.com/complete/search?client=firefox&q=${query}`,
      { headers: { 'User-Agent': FETCH_UA }, signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) {
      log(`scout: autocomplete for "${productName}" -> HTTP ${response.status}`);
      return [];
    }
    const data = await response.json() as [string, string[]];
    const suggestions = Array.isArray(data?.[1]) ? data[1] : [];
    const counterparts: string[] = [];
    for (const suggestion of suggestions) {
      // Google normalizes the query ("Fold8" -> "fold 8", brand swaps), so a
      // strict prefix match drops everything; split on " vs " instead.
      const text = String(suggestion);
      const vsIndex = text.toLowerCase().indexOf(' vs ');
      if (vsIndex < 0) continue;
      const raw = text.slice(vsIndex + 4).trim();
      if (!raw) continue;
      const counterpart = cleanCounterpart(raw);
      if (!counterpart) continue;
      // Skip fragments referring back to the same product line ("... vs 5 pro",
      // "... vs ultra"): require a digit or at least two words.
      if (/^\d/.test(counterpart)) continue;
      if (!/\d/.test(counterpart) && counterpart.split(/\s+/).length < 2) continue;
      counterparts.push(counterpart);
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
  // Read the NEWEST pending pairs (listCandidates pages id-ASC): the fast-track
  // step right after this promotes freshly scouted pairs from the same tail, so
  // triaging the old backlog instead would let untriaged junk straight through.
  const pendingTotal = options.candidateStore.listCandidates({ status: 'pending', limit: 1 }).total;
  const pending = options.candidateStore.listCandidates({
    status: 'pending',
    limit: 30,
    offset: Math.max(0, pendingTotal - 30),
  });
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
  }, { signal: AbortSignal.timeout(180_000) });

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

// --- Fast track for pairs whose demand is already proven ---

function fastTrackResult(): DemandSenseResult {
  return {
    score: 6,
    recommendation: 'good',
    signals: {
      existing_articles_count: 0,
      has_reddit_discussion: false,
      has_authoritative_source: false,
      competition_level: 'low',
      freshness: 'fresh',
    },
    reasoning: 'Fast-tracked: pair sourced from Google autocomplete (search demand already proven).',
    topSources: [],
    partial: false,
    metrics: { durationMs: 0, totalTokens: 0 },
  };
}

// --- Main ---

export async function runTopicScout(options: ScoutOptions): Promise<{
  scoutedPairs: number;
  scoredPairs: number;
  fastTrackedPairs: number;
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

  // 3. Expand seeds into real-demand pairs via Google autocomplete. Fresh RSS
  // launches go first; caller-supplied seeds share the remaining lookup budget.
  const seeds: Array<{ name: string; category: string; source: CandidatePairSource }> = [
    ...newProducts.map((product) => ({ ...product, source: 'autocomplete' as const })),
    ...(options.extraSeedEntities || []).map((seed) => ({
      ...seed,
      source: (seed.category === 'user-demand' ? 'user-demand' : 'pool') as CandidatePairSource,
    })),
  ];
  log(`scout: expanding ${seeds.length} seeds (${newProducts.length} from RSS, ${seeds.length - newProducts.length} supplied)`);

  let scoutedPairs = 0;
  let lookups = 0;
  const seenSeeds = new Set<string>();
  for (const seed of seeds) {
    if (lookups >= MAX_AUTOCOMPLETE_LOOKUPS) break;
    const seedKey = seed.name.toLowerCase();
    if (seenSeeds.has(seedKey)) continue;
    seenSeeds.add(seedKey);
    lookups += 1;
    const seedEntity = getOrCreateEntity(options.entityStore, seed.name, seed.category);
    if (!seedEntity) continue;
    const counterparts = await autocompleteCounterparts(seed.name, log);
    for (const counterpartName of counterparts) {
      const counterpartEntity = getOrCreateEntity(options.entityStore, counterpartName, seed.category);
      if (!counterpartEntity) continue;
      const { created } = options.candidateStore.addDirectPair(seedEntity.id, counterpartEntity.id, seed.source);
      if (created) {
        scoutedPairs += 1;
        log(`scout: demand pair "${seed.name}" vs "${counterpartName}" [${seed.source}]`);
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

  // listCandidates pages id-ASC; jump to the last page so freshly scouted
  // demand pairs (highest ids) are handled before the old backlog.
  const readPendingTail = () => {
    const total = options.candidateStore.listCandidates({ status: 'pending', limit: 1 }).total;
    return options.candidateStore.listCandidates({
      status: 'pending',
      limit: 500,
      offset: Math.max(0, total - 500),
    });
  };

  // 5. Autocomplete/user-demand pairs are literally queries real people typed,
  // so their demand needs no verification — score them synthetically and spend
  // the search budget on pairs we actually know nothing about.
  let fastTrackedPairs = 0;
  for (const candidate of readPendingTail().items) {
    if (!FAST_TRACK_SOURCES.has(candidate.source)) continue;
    options.candidateStore.updateScore(candidate.id, fastTrackResult());
    fastTrackedPairs += 1;
  }
  if (fastTrackedPairs > 0) {
    log(`scout: fast-tracked ${fastTrackedPairs} search-proven pairs (score 6, no search spend)`);
  }

  // 6. Demand-score the remaining pending pairs (newest first so fresh launches lead).
  let scoredPairs = 0;
  if (options.demandSensing) {
    const pending = readPendingTail();
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

  return { scoutedPairs, scoredPairs, fastTrackedPairs };
}
