import assert from 'node:assert/strict';
import test from 'node:test';
import type { AIProvider, ChatMessage, AiCallMetrics } from '../../server/providers/types';

test('AIProvider types are importable', () => {
  const mockProvider: AIProvider = {
    name: 'test',
    research: async () => ({ text: 'result', metrics: { model: 'test', promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 0 } }),
    chatCompletion: async () => ({ json: '{}', metrics: { model: 'test', promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 0 } }),
  };
  assert.equal(mockProvider.name, 'test');
});

import { extractJson, validateRequiredFields } from '../../server/providers/jsonExtractor';

test('extractJson: extracts raw JSON object', () => {
  const input = '{"name": "test", "value": 42}';
  assert.deepEqual(extractJson(input), { name: 'test', value: 42 });
});

test('extractJson: extracts JSON from markdown code fence', () => {
  const input = '```json\n{"name": "test"}\n```';
  assert.deepEqual(extractJson(input), { name: 'test' });
});

test('extractJson: extracts JSON from code fence without language tag', () => {
  const input = '```\n{"name": "test"}\n```';
  assert.deepEqual(extractJson(input), { name: 'test' });
});

test('extractJson: extracts JSON surrounded by extra text', () => {
  const input = 'Here is the result:\n{"name": "test"}\nDone!';
  assert.deepEqual(extractJson(input), { name: 'test' });
});

test('extractJson: throws on invalid JSON', () => {
  assert.throws(() => extractJson('not json at all'), /Failed to extract valid JSON/);
});

test('validateRequiredFields: passes when all required fields present', () => {
  const schema = {
    required: ['name', 'value'],
    properties: { name: { type: 'string' }, value: { type: 'number' } },
  };
  const data = { name: 'test', value: 42 };
  assert.doesNotThrow(() => validateRequiredFields(data, schema));
});

test('validateRequiredFields: throws listing missing fields', () => {
  const schema = {
    required: ['name', 'value', 'extra'],
    properties: {},
  };
  const data = { name: 'test' };
  assert.throws(() => validateRequiredFields(data, schema), /Missing required fields: value, extra/);
});
