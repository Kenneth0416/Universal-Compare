/**
 * Auto-publisher: keeps the public comparison library growing toward
 * AUTOPUBLISH_TOTAL_TARGET without manual work.
 *
 * Per run (intended daily via systemd timer):
 *   1. Generate reports for featured rows that have no report yet.
 *   2. If quota remains, promote the best demand-scored candidate pairs and
 *      generate for them.
 *   3. If quota still remains, scout newly launched products into fresh
 *      candidates for the next runs.
 *   4. Ping IndexNow with every URL published this run.
 *
 * Generation drives the same /api/ai/phases HTTP pipeline the browser uses, so
 * prompts, schemas, proof chain, and telemetry stay in one place. Requests
 * authenticate as the internal batch via the x-internal-batch header
 * (loopback-only, see server/internalBatch.ts).
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import path from 'node:path';
import Database from 'better-sqlite3';
import OpenAI from 'openai';
import { createFeaturedStore, type FeaturedComparison } from '../featured';
import { createEntityPoolStore } from '../entityPool';
import { createCandidatePairStore } from '../candidatePairs';
import { DemandSensingService } from '../demandSensing';
import { runTopicScout } from './topicScout';

const API_BASE = process.env.AUTOPUBLISH_API_BASE || 'http://127.0.0.1:3001';
const BATCH_SECRET = process.env.BATCH_INTERNAL_SECRET || '';
const DAILY_TARGET = envInt('AUTOPUBLISH_DAILY_TARGET', 15, 1, 100);
const TOTAL_TARGET = envInt('AUTOPUBLISH_TOTAL_TARGET', 500, 1, 100_000);
const MIN_DEMAND_SCORE = envInt('AUTOPUBLISH_MIN_SCORE', 7, 0, 10);
const SITE_URL = process.env.SITE_URL || 'https://compare-anythings.com';

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function log(message: string) {
  console.log(`[autopublish ${new Date().toISOString()}] ${message}`);
}

// --- HTTP client with cookie jar, batch header, and retry on 429/503 ---

const cookieJar = new Map<string, string>();

function cookieHeader(): string {
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function storeCookies(response: Response) {
  const setCookies: string[] = (response.headers as any).getSetCookie?.() || [];
  for (const line of setCookies) {
    const [pair] = line.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) cookieJar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

async function apiCall<T>(pathname: string, body: unknown, timeoutMs = 240_000): Promise<T> {
  const delays = [0, 5_000, 15_000, 30_000, 60_000];
  let lastError: Error = new Error('unreachable');
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${pathname}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-batch': BATCH_SECRET,
          ...(cookieJar.size ? { cookie: cookieHeader() } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: any) {
      lastError = new Error(`network error on ${pathname}: ${err?.message || err}`);
      continue;
    }
    storeCookies(response);
    if (response.ok) return await response.json() as T;
    const errorBody = await response.json().catch(() => ({})) as { error?: string };
    lastError = new Error(`${pathname} -> ${response.status}: ${errorBody.error || 'unknown'}`);
    // Retry transient saturation; anything else is a real failure.
    if (response.status !== 429 && response.status !== 503 && response.status !== 502) throw lastError;
  }
  throw lastError;
}

// --- Comparison generation (mirrors src/services/geminiService.ts) ---

type Source = { url: string; title: string; snippet?: string; proof?: string };

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

async function generateReport(itemA: string, itemB: string, language: string): Promise<string> {
  const [resA, resB] = await Promise.all([
    apiCall<{ profile: any; sources: Source[] }>('/api/ai/phases/researcher', { itemName: itemA, language }),
    apiCall<{ profile: any; sources: Source[] }>('/api/ai/phases/researcher', { itemName: itemB, language }),
  ]);
  const allSources = interleaveValidSources(resA.sources, resB.sources);

  const framework = await apiCall<{ relationship: any; dimensions: any[] }>('/api/ai/phases/architect', {
    profileA: resA.profile, profileB: resB.profile, language,
  });

  const analyzedDimensions = await mapConcurrent(framework.dimensions, 2, (dimension) =>
    apiCall<any>('/api/ai/phases/analyst', {
      profileA: resA.profile, profileB: resB.profile, dimension, sources: allSources, language,
    }));

  const [prosCons, recommendation] = await Promise.all([
    apiCall<any>('/api/ai/phases/pros-cons', {
      profileA: resA.profile, profileB: resB.profile, dimensions: analyzedDimensions, sources: allSources, language,
    }),
    apiCall<any>('/api/ai/phases/recommendation', {
      profileA: resA.profile, profileB: resB.profile, dimensions: analyzedDimensions, sources: allSources, language,
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

  const { reportToken } = await apiCall<{ reportToken: string }>('/api/ai/phases/finalize', { result, language });

  const saved = await apiCall<{ reportId: string; url: string }>('/api/reports', {
    itemA, itemB, language, result: { ...result, reportToken }, reportToken,
  }, 60_000);
  return saved.reportId;
}

// --- IndexNow ---

async function pingIndexNow(slugs: string[]) {
  const key = process.env.INDEXNOW_KEY;
  if (!key || slugs.length === 0) return;
  const host = new URL(SITE_URL).hostname;
  try {
    const response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host,
        key,
        keyLocation: `${SITE_URL}/indexnow-key.txt`,
        urlList: slugs.map((slug) => `${SITE_URL}/compare/${slug}`),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    log(`indexnow: submitted ${slugs.length} urls -> ${response.status}`);
  } catch (err: any) {
    log(`indexnow: ping failed: ${err?.message || err}`);
  }
}

// --- Main ---

async function main() {
  if (!BATCH_SECRET) {
    log('BATCH_INTERNAL_SECRET is not set; aborting (phases would hit public rate limits).');
    process.exitCode = 1;
    return;
  }

  const dbPath = process.env.ANALYTICS_DB_PATH || path.resolve(process.cwd(), 'server', 'compareai-analytics.db');
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 10000');
  const featuredStore = createFeaturedStore(db as any);
  const entityStore = createEntityPoolStore(db as any);
  const candidateStore = createCandidatePairStore(db as any);

  const publishedCount = () => (db.prepare(
    'SELECT COUNT(DISTINCT report_id) AS c FROM featured_comparisons WHERE report_id IS NOT NULL',
  ).get() as { c: number }).c;

  const startCount = publishedCount();
  log(`published=${startCount} target=${TOTAL_TARGET} dailyTarget=${DAILY_TARGET}`);
  if (startCount >= TOTAL_TARGET) {
    log('total target reached; nothing to do. Raise AUTOPUBLISH_TOTAL_TARGET to continue growing.');
    return;
  }

  const quota = Math.min(DAILY_TARGET, TOTAL_TARGET - startCount);

  // 1. Featured rows awaiting a report (from earlier promotions or failed runs).
  const workList: FeaturedComparison[] = featuredStore
    .listFeatured()
    .filter((item) => !item.reportId && item.slug)
    .slice(0, quota);

  // 2. Top scored candidates fill the remaining quota.
  if (workList.length < quota) {
    const candidates = candidateStore.listCandidates({
      status: 'scored',
      minScore: MIN_DEMAND_SCORE,
      limit: quota - workList.length,
    });
    for (const candidate of candidates.items) {
      const promotion = candidateStore.promoteCandidate(candidate.id, (pair) =>
        featuredStore.addFeatured(pair.itemAName, pair.itemBName, { language: 'en' }));
      if (promotion.promoted) {
        workList.push(promotion.value);
        log(`promoted candidate #${candidate.id}: ${candidate.itemAName} vs ${candidate.itemBName} (score ${candidate.demandScore})`);
      }
    }
  }

  // 3. Generate sequentially; a failure leaves the row report-less for the next run.
  const publishedSlugs: string[] = [];
  let failures = 0;
  for (const item of workList) {
    const label = `${item.itemA} vs ${item.itemB}`;
    try {
      log(`generating: ${label}`);
      const reportId = await generateReport(item.itemA, item.itemB, item.language || 'en');
      if (!featuredStore.updateReportId(item.id, reportId)) {
        throw new Error(`updateReportId failed for featured #${item.id}`);
      }
      publishedSlugs.push(item.slug as string);
      log(`published: ${label} -> ${reportId} (/compare/${item.slug})`);
    } catch (err: any) {
      failures += 1;
      log(`FAILED: ${label}: ${err?.message || err}`);
      if (failures >= 5) {
        log('too many consecutive failures; stopping generation for this run.');
        break;
      }
    }
  }

  // 4. Scout new launches so the next runs have fresh candidates.
  const deepseekClient = process.env.DEEPSEEK_API_KEY
    ? new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' })
    : undefined;
  const minimaxBaseUrl = (process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1').replace('/v1', '');
  if (deepseekClient && process.env.MINIMAX_API_KEY) {
    const demandSensing = new DemandSensingService({
      minimaxSearchApiKey: process.env.MINIMAX_API_KEY,
      minimaxSearchBaseUrl: minimaxBaseUrl,
      deepseekClient,
      deepseekModel: process.env.DEEPSEEK_MODEL,
    });
    try {
      const scout = await runTopicScout({
        entityStore,
        candidateStore,
        demandSensing,
        deepseekClient,
        deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
        minimaxApiKey: process.env.MINIMAX_API_KEY,
        minimaxBaseUrl,
        log,
      });
      log(`scout done: ${scout.scoutedPairs} pairs scouted, ${scout.scoredPairs} scored`);
    } catch (err: any) {
      log(`scout failed: ${err?.message || err}`);
    }
  } else {
    log('scout skipped: DEEPSEEK_API_KEY or MINIMAX_API_KEY missing');
  }

  await pingIndexNow(publishedSlugs);

  log(`run complete: published=${publishedSlugs.length} failed=${failures} total=${publishedCount()}/${TOTAL_TARGET}`);
}

main().catch((err) => {
  log(`fatal: ${err?.stack || err}`);
  process.exitCode = 1;
});
