import assert from 'node:assert/strict';
import test from 'node:test';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { DemandSensingService } from '../../server/demandSensing';

dotenv.config({ path: '.env.local' });

const RUN_REAL = process.env.RUN_REAL_API_TESTS === '1';
const HAS_KEYS = !!(process.env.MINIMAX_API_KEY && process.env.DEEPSEEK_API_KEY);
const SKIP_REASON = !RUN_REAL
  ? 'set RUN_REAL_API_TESTS=1 to enable'
  : !HAS_KEYS
    ? 'MINIMAX_API_KEY and DEEPSEEK_API_KEY required in .env.local'
    : undefined;

function makeRealService(): DemandSensingService {
  const minimaxBaseUrl = process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1';
  const deepseekClient = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY!,
    baseURL: 'https://api.deepseek.com',
  });
  return new DemandSensingService({
    minimaxSearchApiKey: process.env.MINIMAX_API_KEY!,
    minimaxSearchBaseUrl: minimaxBaseUrl.replace('/v1', ''),
    deepseekClient,
    deepseekModel: process.env.DEEPSEEK_MODEL,
  });
}

test('real API: hot pair ChatGPT vs Claude (en) scores >= 6', { skip: SKIP_REASON }, async () => {
  const service = makeRealService();
  const result = await service.scorePair('ChatGPT', 'Claude', 'en');

  console.log('  → score:', result.score, 'recommendation:', result.recommendation);
  console.log('  → reasoning:', result.reasoning);
  console.log('  → topSources:', result.topSources.map((s) => s.url));

  assert.ok(result.score >= 6, `Expected score >= 6 for ChatGPT vs Claude, got ${result.score}`);
  assert.ok(result.signals.existing_articles_count > 0, 'Expected existing articles');
  assert.equal(typeof result.signals.has_reddit_discussion, 'boolean');
  assert.ok(result.metrics.durationMs < 60_000, `Took ${result.metrics.durationMs}ms`);
  assert.equal(result.partial, false);
});

test('real API: hot pair ChatGPT vs Claude (zh-Hans) reasoning is Chinese', { skip: SKIP_REASON }, async () => {
  const service = makeRealService();
  const result = await service.scorePair('ChatGPT', 'Claude', 'zh-Hans');

  console.log('  → reasoning (zh-Hans):', result.reasoning);

  assert.ok(result.score >= 6);
  assert.match(result.reasoning, /[一-鿿]/, `Expected Chinese reasoning, got: ${result.reasoning}`);
});

test('real API: obscure pair scores <= 4', { skip: SKIP_REASON }, async () => {
  const service = makeRealService();
  const result = await service.scorePair(
    'FooBarXYZ_AI_v1_test',
    'QuuxQux_v2_internal_only',
    'en',
  );

  console.log('  → score:', result.score, 'recommendation:', result.recommendation);

  assert.ok(result.score <= 4, `Expected score <= 4 for obscure pair, got ${result.score}`);
  assert.ok(
    ['skip', 'consider'].includes(result.recommendation),
    `Expected skip or consider, got ${result.recommendation}`,
  );
});

test('real API: response parses on first attempt + sources returned', { skip: SKIP_REASON }, async () => {
  const service = makeRealService();
  const result = await service.scorePair('Notion', 'Obsidian', 'en');

  console.log('  → duration:', result.metrics.durationMs, 'tokens:', result.metrics.totalTokens);
  assert.ok(result.metrics.durationMs < 20_000, `First-attempt duration ${result.metrics.durationMs}ms`);
  assert.ok(result.topSources.length >= 1, 'Expected at least 1 topSource');
});
