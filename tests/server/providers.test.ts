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

import { GrokProvider } from '../../server/providers/grok';

test('GrokProvider.research calls responses.create and returns output_text', async () => {
  const mockOpenai = {
    responses: {
      create: async (params: Record<string, unknown>) => {
        return { output_text: 'Research about cats', usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } };
      },
    },
    chat: { completions: { create: async () => ({}) } },
  };

  const provider = new GrokProvider(mockOpenai as any);
  const result = await provider.research('cats');
  assert.equal(result.text, 'Research about cats');
  assert.equal(result.metrics.model, 'grok-4-1-fast-non-reasoning');
});

test('GrokProvider.chatCompletion calls chat.completions.create with json_schema', async () => {
  const capturedParams: Record<string, unknown>[] = [];
  const mockOpenai = {
    responses: { create: async () => ({}) },
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          capturedParams.push(params);
          return {
            choices: [{ message: { content: '{"name":"test"}' } }],
            usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
          };
        },
      },
    },
  };

  const provider = new GrokProvider(mockOpenai as any);
  const result = await provider.chatCompletion({
    messages: [{ role: 'user', content: 'hello' }],
    schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
    schemaName: 'test_schema',
    temperature: 0.2,
  });

  assert.equal(result.json, '{"name":"test"}');
  assert.equal(capturedParams[0].model, 'grok-4-1-fast-reasoning');
  const rf = capturedParams[0].response_format as any;
  assert.equal(rf.type, 'json_schema');
  assert.equal(rf.json_schema.name, 'test_schema');
});
