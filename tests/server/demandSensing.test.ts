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

test('partial: search1 fails, search2 succeeds → partial=true, score still returned', async () => {
  const searchFn: any = async (_key: string, query: string) => {
    if (query.endsWith(' reddit')) {
      return {
        text: 'reddit',
        sources: [{ url: 'https://reddit.com/x', title: 'r/x thread', snippet: '' }],
      };
    }
    throw new Error('SERP search failed');
  };

  const service = new DemandSensingService({
    minimaxSearchApiKey: 'fake-key',
    deepseekClient: makeMockDeepseekClient(JSON.stringify({
      score: 5,
      recommendation: 'consider',
      signals: {
        existing_articles_count: 0,
        has_reddit_discussion: true,
        has_authoritative_source: false,
        competition_level: 'low',
        freshness: 'recent',
      },
      reasoning: 'Reddit-only signal.',
    })) as any,
    searchFn,
  });

  const result = await service.scorePair('Foo', 'Bar', 'en');
  assert.equal(result.partial, true);
  assert.equal(result.score, 5);
  assert.equal(result.topSources[0].url, 'https://reddit.com/x');
});

test('partial: search2 fails, search1 succeeds → partial=true', async () => {
  const searchFn: any = async (_key: string, query: string) => {
    if (query.endsWith(' reddit')) throw new Error('reddit search failed');
    return {
      text: 'serp',
      sources: [{ url: 'https://example.com', title: 'A vs B', snippet: '' }],
    };
  };

  const service = new DemandSensingService({
    minimaxSearchApiKey: 'fake-key',
    deepseekClient: makeMockDeepseekClient(JSON.stringify({
      score: 6,
      recommendation: 'good',
      signals: {
        existing_articles_count: 3,
        has_reddit_discussion: false,
        has_authoritative_source: false,
        competition_level: 'medium',
        freshness: 'recent',
      },
      reasoning: 'SERP-only signal.',
    })) as any,
    searchFn,
  });

  const result = await service.scorePair('Foo', 'Bar', 'en');
  assert.equal(result.partial, true);
  assert.equal(result.score, 6);
  assert.equal(result.topSources[0].url, 'https://example.com');
});

test('both searches fail → throws DemandSensingError 502', async () => {
  const service = new DemandSensingService({
    minimaxSearchApiKey: 'fake-key',
    deepseekClient: makeMockDeepseekClient('{}') as any,
    searchFn: async () => {
      throw new Error('upstream unavailable');
    },
  });

  await assert.rejects(
    () => service.scorePair('Foo', 'Bar', 'en'),
    (err: any) =>
      err.name === 'DemandSensingError' &&
      err.statusCode === 502 &&
      /Both MiniMax searches failed/.test(err.message),
  );
});

test('prompt notes "(search unavailable)" when search1 fails', async () => {
  let capturedPrompt = '';
  const deepseekClient = {
    chat: {
      completions: {
        create: async (params: any) => {
          capturedPrompt = params.messages[0].content;
          return {
            choices: [{ message: { content: JSON.stringify({
              score: 5, recommendation: 'consider',
              signals: { existing_articles_count: 0, has_reddit_discussion: false, has_authoritative_source: false, competition_level: 'low', freshness: 'recent' },
              reasoning: 'x',
            }) } }],
            usage: { total_tokens: 100 },
          };
        },
      },
    },
  };
  const service = new DemandSensingService({
    minimaxSearchApiKey: 'fake-key',
    deepseekClient: deepseekClient as any,
    searchFn: async (_k, q) => {
      if (q.endsWith(' reddit')) {
        return { text: '', sources: [{ url: 'https://reddit.com/x', title: 'thread', snippet: '' }] };
      }
      throw new Error('failed');
    },
  });

  await service.scorePair('A', 'B', 'en');
  assert.ok(
    capturedPrompt.includes('(search unavailable)'),
    `Expected prompt to flag unavailable search. Got: ${capturedPrompt.slice(0, 200)}`,
  );
});
