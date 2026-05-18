import assert from 'node:assert/strict';
import test from 'node:test';
import type { AIProvider, ChatMessage, AiCallMetrics, ResearchRawParams } from '../../server/providers/types';

test('AIProvider types are importable', () => {
  const mockProvider: AIProvider = {
    name: 'test',
    research: async (_query, _rawParams?) => ({ text: 'result', metrics: { model: 'test', promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 0 } }),
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

test('validateRequiredFields: throws on empty string values', () => {
  const schema = {
    required: ['name', 'definition'],
    properties: { name: { type: 'string' }, definition: { type: 'string' } },
  };
  const data = { name: 'test', definition: '   ' };
  assert.throws(() => validateRequiredFields(data, schema), /Required fields have empty values: definition/);
});

test('validateRequiredFields: passes when string values are non-empty', () => {
  const schema = {
    required: ['name', 'definition'],
    properties: { name: { type: 'string' }, definition: { type: 'string' } },
  };
  const data = { name: 'test', definition: 'A description' };
  assert.doesNotThrow(() => validateRequiredFields(data, schema));
});

import { MinimaxProvider, parseMinimaxToolCall } from '../../server/providers/minimax';

test('parseMinimaxToolCall: extracts function name and params from XML', () => {
  const xml = `<minimax:tool_call>
<invoke name="web_search">
<parameter name="query_list">["cats", "cat breeds"]</parameter>
</invoke>
</minimax:tool_call>`;
  const result = parseMinimaxToolCall(xml);
  assert.equal(result?.name, 'web_search');
  assert.deepEqual(result?.arguments, { query_list: ['cats', 'cat breeds'] });
});

test('parseMinimaxToolCall: returns null for non-tool-call text', () => {
  const result = parseMinimaxToolCall('Just a normal response with no tool calls.');
  assert.equal(result, null);
});

test('MinimaxProvider.chatCompletion uses DeepSeek with json_object and prompt schema', async () => {
  const capturedParams: Record<string, unknown>[] = [];
  const mockChatClient = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          capturedParams.push(params);
          return {
            choices: [{ message: { content: '{"name":"test"}' } }],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          };
        },
      },
    },
  };
  const mockSearchClient = {
    chat: { completions: { create: async () => ({}) } },
  };

  const provider = new MinimaxProvider(mockSearchClient as any, 'test-search-key', { chatClient: mockChatClient as any, chatModel: 'deepseek-v4-pro' });
  const result = await provider.chatCompletion({
    messages: [{ role: 'user', content: 'hello' }],
    schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
    schemaName: 'test_schema',
    temperature: 0.2,
  });

  assert.equal(JSON.parse(result.json).name, 'test');
  assert.equal(result.metrics.model, 'deepseek-v4-pro');
  // Verify json_object mode is used
  const rf = capturedParams[0].response_format as any;
  assert.equal(rf.type, 'json_object');
  // Verify schema is injected into system message
  const messages = capturedParams[0].messages as any[];
  assert.ok(messages[0].role === 'system');
  assert.ok(messages[0].content.includes('"name"'));
});

import { createProvider } from '../../server/providers/index';

test('createProvider returns GrokProvider for "grok"', () => {
  const mockOpenai = {
    responses: { create: async () => ({}) },
    chat: { completions: { create: async () => ({}) } },
  };
  const provider = createProvider('grok', { grokClient: mockOpenai as any });
  assert.equal(provider.name, 'grok');
});

test('createProvider returns MinimaxProvider for "minimax"', () => {
  const mockClient = {
    chat: { completions: { create: async () => ({}) } },
  };
  const provider = createProvider('minimax', {
    minimaxClient: mockClient as any,
    minimaxSearchApiKey: 'test-key',
  });
  assert.equal(provider.name, 'minimax');
});

test('createProvider throws for unknown provider', () => {
  assert.throws(() => createProvider('unknown', {}), /Unknown AI provider: unknown/);
});

import { GrokProvider } from '../../server/providers/grok';

test('GrokProvider.research builds default prompt when no rawParams', async () => {
  const capturedParams: Record<string, unknown>[] = [];
  const mockOpenai = {
    responses: {
      create: async (params: Record<string, unknown>) => {
        capturedParams.push(params);
        return { output_text: 'Research about cats', usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } };
      },
    },
    chat: { completions: { create: async () => ({}) } },
  };

  const provider = new GrokProvider(mockOpenai as any);
  const result = await provider.research('cats');
  assert.equal(result.text, 'Research about cats');
  assert.equal(result.metrics.model, 'grok-4-1-fast-non-reasoning');
  // Should build its own prompt containing the query
  const input = capturedParams[0].input as any[];
  assert.ok(input[0].content.includes('"cats"'));
});

test('GrokProvider.research passes rawParams through when provided', async () => {
  const capturedParams: Record<string, unknown>[] = [];
  const mockOpenai = {
    responses: {
      create: async (params: Record<string, unknown>) => {
        capturedParams.push(params);
        return { output_text: 'Custom research', usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } };
      },
    },
    chat: { completions: { create: async () => ({}) } },
  };

  const customInput = [{ role: 'user', content: 'Custom research prompt about cats with X Search disabled' }];
  const customTools = [{ type: 'web_search' }];

  const provider = new GrokProvider(mockOpenai as any);
  const result = await provider.research('cats', {
    input: customInput,
    tools: customTools,
    tool_choice: 'auto',
  });

  assert.equal(result.text, 'Custom research');
  // Should pass through the raw params, not build its own prompt
  const input = capturedParams[0].input as any[];
  assert.equal(input[0].content, 'Custom research prompt about cats with X Search disabled');
  const tools = capturedParams[0].tools as any[];
  assert.equal(tools.length, 1);
  assert.equal(tools[0].type, 'web_search');
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
