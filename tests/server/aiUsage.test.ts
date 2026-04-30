import assert from 'node:assert/strict';
import test from 'node:test';
import { extractAiUsageMetrics } from '../../server/aiUsage';

test('extracts provider token usage and cost ticks from AI responses', () => {
  const metrics = extractAiUsageMetrics(
    {
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 250,
        total_tokens: 1300,
        prompt_tokens_details: { cached_tokens: 120 },
        completion_tokens_details: { reasoning_tokens: 50 },
        cost_in_usd_ticks: 123_456_789,
        server_side_tool_usage_details: {
          web_search_calls: 2,
          x_search_calls: 1,
          code_interpreter_calls: 0,
        },
      },
    },
    'grok-4-1-fast-reasoning',
  );

  assert.deepEqual(metrics, {
    promptTokens: 1000,
    completionTokens: 250,
    totalTokens: 1300,
    cachedTokens: 120,
    reasoningTokens: 50,
    costUsd: 0.0123456789,
    costSource: 'provider',
    webSearchCount: 2,
    xSearchCount: 1,
    toolUsageJson: '{"web_search_calls":2,"x_search_calls":1}',
  });
});

test('estimates cost for known xAI fast models when provider cost is absent', () => {
  const metrics = extractAiUsageMetrics(
    {
      usage: {
        input_tokens: 1_000_000,
        output_tokens: 200_000,
        total_tokens: 1_250_000,
        input_tokens_details: { cached_tokens: 100_000 },
        output_tokens_details: { reasoning_tokens: 50_000 },
      },
    },
    'grok-4-1-fast-non-reasoning',
  );

  assert.equal(metrics.promptTokens, 1_000_000);
  assert.equal(metrics.completionTokens, 200_000);
  assert.equal(metrics.totalTokens, 1_250_000);
  assert.equal(metrics.cachedTokens, 100_000);
  assert.equal(metrics.reasoningTokens, 50_000);
  assert.equal(metrics.costUsd, 0.31);
  assert.equal(metrics.costSource, 'estimated');
  assert.equal(metrics.webSearchCount, 0);
  assert.equal(metrics.xSearchCount, 0);
  assert.equal(metrics.toolUsageJson, null);
});
