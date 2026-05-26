import assert from 'node:assert/strict';
import test from 'node:test';
import { DemandSensingService } from '../../server/demandSensing';
import type { Source } from '../../server/providers/types';

function makeMockSearchFn(
  results: Record<string, { text: string; sources: Source[] }>,
) {
  return async (_apiKey: string, query: string) => {
    const found = results[query];
    if (!found) throw new Error(`No mock configured for query: ${query}`);
    return found;
  };
}

function makeMockDeepseekClient(content: string) {
  return {
    chat: {
      completions: {
        create: async (_params: Record<string, unknown>) => ({
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        }),
      },
    },
  };
}

test('happy path: dual search succeeds, DeepSeek returns valid score', async () => {
  const searchFn = makeMockSearchFn({
    'ChatGPT vs Claude': {
      text: 'SERP results',
      sources: [
        { url: 'https://example.com/a', title: 'ChatGPT vs Claude 2026', snippet: '' },
        { url: 'https://example.com/b', title: 'AI comparison', snippet: '' },
      ],
    },
    'ChatGPT vs Claude reddit': {
      text: 'Reddit results',
      sources: [
        { url: 'https://reddit.com/r/x/1', title: 'r/ChatGPT discussion', snippet: '' },
      ],
    },
  });

  const deepseekContent = JSON.stringify({
    score: 8.5,
    recommendation: 'excellent',
    signals: {
      existing_articles_count: 12,
      has_reddit_discussion: true,
      has_authoritative_source: true,
      competition_level: 'high',
      freshness: 'fresh',
    },
    reasoning: 'Strong demand with many articles and active community.',
  });

  const service = new DemandSensingService({
    minimaxSearchApiKey: 'fake-key',
    deepseekClient: makeMockDeepseekClient(deepseekContent) as any,
    searchFn,
  });

  const result = await service.scorePair('ChatGPT', 'Claude', 'en');

  assert.equal(result.score, 8.5);
  assert.equal(result.recommendation, 'excellent');
  assert.equal(result.signals.existing_articles_count, 12);
  assert.equal(result.signals.has_reddit_discussion, true);
  assert.equal(result.partial, false);
  assert.equal(result.topSources.length, 2);
  assert.equal(result.topSources[0].url, 'https://example.com/a');
  assert.ok(result.metrics.durationMs >= 0);
  assert.ok(result.metrics.totalTokens > 0);
});

function makeService() {
  return new DemandSensingService({
    minimaxSearchApiKey: 'fake-key',
    deepseekClient: makeMockDeepseekClient('{}') as any,
    searchFn: async () => ({ text: '', sources: [] }),
  });
}

test('rejects empty itemA', async () => {
  const service = makeService();
  await assert.rejects(
    () => service.scorePair('', 'Claude', 'en'),
    /itemA and itemB must be non-empty strings/,
  );
});

test('rejects empty itemB', async () => {
  const service = makeService();
  await assert.rejects(
    () => service.scorePair('ChatGPT', '   ', 'en'),
    /itemA and itemB must be non-empty strings/,
  );
});

test('rejects identical items after trim+lowercase', async () => {
  const service = makeService();
  await assert.rejects(
    () => service.scorePair('  ChatGPT  ', 'chatgpt', 'en'),
    /itemA and itemB must be different/,
  );
});

test('truncates inputs longer than 200 chars', async () => {
  const longA = 'A'.repeat(250);
  const longB = 'B'.repeat(250);
  const queries: string[] = [];

  const service = new DemandSensingService({
    minimaxSearchApiKey: 'fake-key',
    deepseekClient: makeMockDeepseekClient(JSON.stringify({
      score: 5,
      recommendation: 'consider',
      signals: {
        existing_articles_count: 0,
        has_reddit_discussion: false,
        has_authoritative_source: false,
        competition_level: 'low',
        freshness: 'stale',
      },
      reasoning: 'Limited signal.',
    })) as any,
    searchFn: async (_key, query) => {
      queries.push(query);
      return { text: '', sources: [] };
    },
  });

  await service.scorePair(longA, longB, 'en');

  assert.equal(queries.length, 2);
  queries.forEach((q) => {
    assert.match(
      q,
      /^A{200} vs B{200}( reddit)?$/,
      `Expected truncated query, got: ${q.slice(0, 80)}...`,
    );
  });
});
