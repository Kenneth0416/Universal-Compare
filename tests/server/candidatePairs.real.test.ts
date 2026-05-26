import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { createAnalyticsStore } from '../../server/analytics';
import { createFeaturedStore } from '../../server/featured';
import { createEntityPoolStore } from '../../server/entityPool';
import { createCandidatePairStore } from '../../server/candidatePairs';
import { DemandSensingService } from '../../server/demandSensing';
import { mapConcurrent } from '../../server/concurrency';

dotenv.config({ path: '.env.local' });

const RUN_REAL = process.env.RUN_REAL_API_TESTS === '1';
const HAS_KEYS = !!(process.env.MINIMAX_API_KEY && process.env.DEEPSEEK_API_KEY);
const SKIP_REASON = !RUN_REAL
  ? 'set RUN_REAL_API_TESTS=1 to enable'
  : !HAS_KEYS
    ? 'MINIMAX_API_KEY and DEEPSEEK_API_KEY required in .env.local'
    : undefined;

test('real API: bulk preflight 5 pairs concurrently writes scores without race', { skip: SKIP_REASON }, async () => {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'candidate-real-')), 'analytics.db');
  const analyticsStore = createAnalyticsStore(dbPath, 'test-secret');
  createFeaturedStore(analyticsStore.getDb());  // ensures featured_comparisons table exists for sync's JOIN
  const entityStore = createEntityPoolStore(analyticsStore.getDb());
  const candidateStore = createCandidatePairStore(analyticsStore.getDb());

  for (const name of ['ChatGPT', 'Claude', 'Gemini', 'Grok']) {
    entityStore.addEntity(name, 'AI Assistant');
  }
  candidateStore.syncFromEntityPool();
  const all = candidateStore.listCandidates({}).items;
  const pairs = all.slice(0, 5);

  const minimaxBaseUrl = process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1';
  const deepseekClient = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY!,
    baseURL: 'https://api.deepseek.com',
  });
  const service = new DemandSensingService({
    minimaxSearchApiKey: process.env.MINIMAX_API_KEY!,
    minimaxSearchBaseUrl: minimaxBaseUrl.replace('/v1', ''),
    deepseekClient,
    deepseekModel: process.env.DEEPSEEK_MODEL,
  });

  const start = Date.now();
  const results = await mapConcurrent(pairs, 5, async (p) => {
    try {
      const r = await service.scorePair(p.itemAName, p.itemBName, 'en');
      candidateStore.updateScore(p.id, r);
      return { id: p.id, status: 'scored' as const, score: r.score };
    } catch (e) {
      return { id: p.id, status: 'error' as const, error: (e as Error).message };
    }
  });
  const elapsed = Date.now() - start;

  console.log(`  → batch of ${pairs.length} pairs took ${elapsed}ms`);
  for (const r of results) {
    if (r.status === 'scored') console.log(`    id ${r.id}: ${r.score}`);
    else console.log(`    id ${r.id}: ERROR ${r.error}`);
  }

  assert.equal(results.length, pairs.length);
  const scored = results.filter((r) => r.status === 'scored');
  assert.ok(scored.length >= 3, `Expected at least 3 of 5 scored, got ${scored.length}`);
  assert.ok(elapsed < 60_000, `Expected < 60s for concurrent batch, got ${elapsed}ms`);

  for (const p of pairs) {
    const updated = candidateStore.getCandidate(p.id)!;
    const matchingResult = results.find((r) => r.id === p.id);
    if (matchingResult?.status === 'scored') {
      assert.equal(updated.status, 'scored');
      assert.equal(typeof updated.demandScore, 'number');
    }
  }
});
