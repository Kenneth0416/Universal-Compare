# Grok → MiniMax Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MiniMax as a second AI provider alongside Grok with a provider abstraction layer, and build a CLI A/B test script for quality comparison.

**Architecture:** Introduce an `AIProvider` interface with `research()` and `chatCompletion()` methods. GrokProvider wraps existing OpenAI SDK logic. MinimaxProvider implements M2.7 tool-calling web search and prompt-based JSON output. A factory function selects the provider based on `AI_PROVIDER` env var. A/B test is a standalone CLI script that runs both providers on the same inputs.

**Tech Stack:** TypeScript, OpenAI SDK (for both providers), Node.js test runner (`tsx --test`), Express

**Spec:** `docs/superpowers/specs/2026-05-18-grok-minimax-migration-design.md`

---

## File Map

```
server/
  providers/
    types.ts           # CREATE - AIProvider interface, ChatMessage type, AiCallMetrics type
    grok.ts            # CREATE - GrokProvider wrapping existing OpenAI SDK
    minimax.ts         # CREATE - MinimaxProvider with M2.7 tool calling + prompt JSON
    jsonExtractor.ts   # CREATE - extract JSON from LLM text, validate required fields
    index.ts           # CREATE - createProvider() factory function
  app.ts               # MODIFY - replace AiClient with AIProvider in createApp()
  index.ts             # MODIFY - use createProvider() instead of raw OpenAI client
  aiUsage.ts           # MODIFY - add MiniMax pricing
tests/
  server/
    providers.test.ts  # CREATE - tests for GrokProvider, MinimaxProvider, jsonExtractor, factory
    app.test.ts        # MODIFY - update createTestApp() to use new provider interface
  server/
    aiUsage.test.ts    # MODIFY - add MiniMax pricing test
scripts/
  ab-test.ts           # CREATE - CLI A/B test script
.gitignore             # MODIFY - add scripts/ab-results/
```

---

### Task 1: Provider Types

**Files:**
- Create: `server/providers/types.ts`
- Test: `tests/server/providers.test.ts`

- [ ] **Step 1: Write the type definitions**

```typescript
// server/providers/types.ts
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
};

export type JsonSchema = Record<string, unknown>;

export type AiCallMetrics = {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
};

export interface AIProvider {
  readonly name: string;

  /** Phase 1: research with web search, returns raw text */
  research(query: string): Promise<{ text: string; metrics: AiCallMetrics }>;

  /** Phase 2-4: structured JSON output via chat completion, returns JSON string */
  chatCompletion(params: {
    messages: ChatMessage[];
    schema: JsonSchema;
    schemaName: string;
    temperature?: number;
  }): Promise<{ json: string; metrics: AiCallMetrics }>;
}
```

- [ ] **Step 2: Write a basic type import test**

```typescript
// tests/server/providers.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import type { AIProvider, ChatMessage, AiCallMetrics } from '../../server/providers/types';

test('AIProvider types are importable', () => {
  // Type-level check: ensure the interface shape is as expected
  const mockProvider: AIProvider = {
    name: 'test',
    research: async () => ({ text: 'result', metrics: { model: 'test', promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 0 } }),
    chatCompletion: async () => ({ json: '{}', metrics: { model: 'test', promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 0 } }),
  };
  assert.equal(mockProvider.name, 'test');
});
```

- [ ] **Step 3: Run test**

Run: `npx tsx --test tests/server/providers.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/providers/types.ts tests/server/providers.test.ts
git commit -m "feat: add AIProvider interface and types"
```

---

### Task 2: JSON Extractor Utility

**Files:**
- Create: `server/providers/jsonExtractor.ts`
- Test: `tests/server/providers.test.ts` (append)

- [ ] **Step 1: Write failing tests for JSON extraction**

Append to `tests/server/providers.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/server/providers.test.ts`
Expected: FAIL — `extractJson` and `validateRequiredFields` not found

- [ ] **Step 3: Implement jsonExtractor**

```typescript
// server/providers/jsonExtractor.ts

/**
 * Extract a JSON object from LLM text output.
 * Handles: raw JSON, markdown code fences, JSON embedded in surrounding text.
 */
export function extractJson(text: string): Record<string, unknown> {
  const trimmed = text.trim();

  // Try raw parse first
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null) return parsed;
  } catch {}

  // Try markdown code fence: ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch {}
  }

  // Try to find first { ... } block
  const braceStart = trimmed.indexOf('{');
  const braceEnd = trimmed.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      const parsed = JSON.parse(trimmed.slice(braceStart, braceEnd + 1));
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch {}
  }

  throw new Error(`Failed to extract valid JSON from response: ${trimmed.slice(0, 200)}`);
}

/**
 * Validate that all required fields from a JSON schema are present in data.
 * Only checks top-level required fields — not nested validation.
 */
export function validateRequiredFields(
  data: Record<string, unknown>,
  schema: Record<string, unknown>,
): void {
  const required = schema.required;
  if (!Array.isArray(required)) return;

  const missing = required.filter(
    (field: string) => !(field in data) || data[field] === undefined,
  );
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/server/providers.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add server/providers/jsonExtractor.ts tests/server/providers.test.ts
git commit -m "feat: add JSON extractor for prompt-based LLM output"
```

---

### Task 3: GrokProvider

**Files:**
- Create: `server/providers/grok.ts`
- Test: `tests/server/providers.test.ts` (append)

- [ ] **Step 1: Write failing test for GrokProvider**

Append to `tests/server/providers.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/server/providers.test.ts`
Expected: FAIL — `GrokProvider` not found

- [ ] **Step 3: Implement GrokProvider**

```typescript
// server/providers/grok.ts
import type OpenAI from 'openai';
import type { AIProvider, AiCallMetrics, ChatMessage, JsonSchema } from './types';

export class GrokProvider implements AIProvider {
  readonly name = 'grok';
  private client: OpenAI;

  constructor(client: OpenAI) {
    this.client = client;
  }

  async research(query: string): Promise<{ text: string; metrics: AiCallMetrics }> {
    const model = 'grok-4-1-fast-non-reasoning';
    const start = Date.now();

    const response = await this.client.responses.create({
      model,
      input: [
        {
          role: 'user',
          content: `Research comprehensive information about "${query}".

Use Web Search for authoritative and factual sources:
- Key characteristics and defining attributes
- Historical background and timeline
- Expert analysis and comparisons
- Recent developments or changes
- Relevant facts and data points

Use X Search only if recent public sentiment, controversy, launch reactions, creator/community discussion, or fast-moving social context would materially improve the comparison. Skip X Search for stable reference facts, mature products with well-covered reviews, historical topics, or subjects where social posts are unlikely to add decision-relevant evidence.

Provide detailed, factual information with sources.`,
        },
      ],
      tools: [{ type: 'web_search' }, { type: 'x_search' }],
      tool_choice: 'auto',
    } as any);

    const text = (response as any).output_text || '';
    const usage = (response as any).usage || {};

    return {
      text,
      metrics: {
        model,
        promptTokens: usage.prompt_tokens || usage.input_tokens || 0,
        completionTokens: usage.completion_tokens || usage.output_tokens || 0,
        totalTokens: usage.total_tokens || 0,
        durationMs: Date.now() - start,
      },
    };
  }

  async chatCompletion(params: {
    messages: ChatMessage[];
    schema: JsonSchema;
    schemaName: string;
    temperature?: number;
  }): Promise<{ json: string; metrics: AiCallMetrics }> {
    const model = 'grok-4-1-fast-reasoning';
    const start = Date.now();

    const response = await this.client.chat.completions.create({
      model,
      messages: params.messages as any,
      temperature: params.temperature ?? 0.2,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: params.schemaName,
          strict: true,
          schema: params.schema,
        },
      },
    } as any);

    const content = (response as any).choices?.[0]?.message?.content || '{}';
    const usage = (response as any).usage || {};

    return {
      json: content,
      metrics: {
        model,
        promptTokens: usage.prompt_tokens || usage.input_tokens || 0,
        completionTokens: usage.completion_tokens || usage.output_tokens || 0,
        totalTokens: usage.total_tokens || 0,
        durationMs: Date.now() - start,
      },
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/server/providers.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add server/providers/grok.ts tests/server/providers.test.ts
git commit -m "feat: add GrokProvider wrapping existing OpenAI SDK logic"
```

---

### Task 4: MinimaxProvider

**Files:**
- Create: `server/providers/minimax.ts`
- Test: `tests/server/providers.test.ts` (append)

- [ ] **Step 1: Write failing tests for MinimaxProvider**

Append to `tests/server/providers.test.ts`:

```typescript
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

test('MinimaxProvider.chatCompletion uses prompt-based JSON and extracts result', async () => {
  const mockClient = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: '```json\n{"name":"test"}\n```' } }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
      },
    },
  };

  const provider = new MinimaxProvider(mockClient as any, 'test-search-key');
  const result = await provider.chatCompletion({
    messages: [{ role: 'user', content: 'hello' }],
    schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
    schemaName: 'test_schema',
    temperature: 0.2,
  });

  assert.equal(JSON.parse(result.json).name, 'test');
  assert.equal(result.metrics.model, 'MiniMax-M2.7');
});

test('MinimaxProvider.chatCompletion retries on invalid JSON', async () => {
  let callCount = 0;
  const mockClient = {
    chat: {
      completions: {
        create: async () => {
          callCount++;
          if (callCount === 1) {
            return {
              choices: [{ message: { content: 'Sorry, I cannot do that.' } }],
              usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
            };
          }
          return {
            choices: [{ message: { content: '{"name":"fixed"}' } }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          };
        },
      },
    },
  };

  const provider = new MinimaxProvider(mockClient as any, 'test-search-key');
  const result = await provider.chatCompletion({
    messages: [{ role: 'user', content: 'hello' }],
    schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
    schemaName: 'test_schema',
  });

  assert.equal(JSON.parse(result.json).name, 'fixed');
  assert.equal(callCount, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/server/providers.test.ts`
Expected: FAIL — `MinimaxProvider` and `parseMinimaxToolCall` not found

- [ ] **Step 3: Implement MinimaxProvider**

```typescript
// server/providers/minimax.ts
import type OpenAI from 'openai';
import type { AIProvider, AiCallMetrics, ChatMessage, JsonSchema } from './types';
import { extractJson, validateRequiredFields } from './jsonExtractor';

const MINIMAX_MODEL = 'MiniMax-M2.7';
const MAX_JSON_RETRIES = 2;

const WEB_SEARCH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'web_search',
    description: 'Search the web for current information about a topic',
    parameters: {
      type: 'object',
      properties: {
        query_list: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of search queries to execute',
        },
      },
      required: ['query_list'],
    },
  },
};

export function parseMinimaxToolCall(
  text: string,
): { name: string; arguments: Record<string, unknown> } | null {
  const invokeMatch = text.match(
    /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/,
  );
  if (!invokeMatch) return null;

  const name = invokeMatch[1];
  const paramsBlock = invokeMatch[2];
  const args: Record<string, unknown> = {};

  const paramRegex = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g;
  let match;
  while ((match = paramRegex.exec(paramsBlock)) !== null) {
    const paramName = match[1];
    const paramValue = match[2].trim();
    try {
      args[paramName] = JSON.parse(paramValue);
    } catch {
      args[paramName] = paramValue;
    }
  }

  return { name, arguments: args };
}

async function callMinimaxSearch(
  apiKey: string,
  query: string,
): Promise<string> {
  const response = await fetch('https://api.minimax.io/v1/coding_plan/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    throw new Error(`MiniMax search failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const results = (data as any).results || [];
  return results
    .map(
      (r: any, i: number) =>
        `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet || ''}`,
    )
    .join('\n\n');
}

export class MinimaxProvider implements AIProvider {
  readonly name = 'minimax';
  private client: OpenAI;
  private searchApiKey: string;

  constructor(client: OpenAI, searchApiKey: string) {
    this.client = client;
    this.searchApiKey = searchApiKey;
  }

  async research(
    query: string,
  ): Promise<{ text: string; metrics: AiCallMetrics }> {
    const start = Date.now();
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;

    // Step 1: Ask model with web_search tool available
    const messages: any[] = [
      {
        role: 'user',
        content: `Research comprehensive information about "${query}".

Use the web_search tool to find:
- Key characteristics and defining attributes
- Historical background and timeline
- Expert analysis and comparisons
- Recent developments or changes
- Relevant facts and data points

Provide detailed, factual information with sources.`,
      },
    ];

    const firstResponse = await this.client.chat.completions.create({
      model: MINIMAX_MODEL,
      messages,
      tools: [WEB_SEARCH_TOOL],
      tool_choice: 'auto',
    } as any);

    const firstUsage = (firstResponse as any).usage || {};
    totalPromptTokens += firstUsage.prompt_tokens || 0;
    totalCompletionTokens += firstUsage.completion_tokens || 0;
    totalTokens += firstUsage.total_tokens || 0;

    const firstContent =
      (firstResponse as any).choices?.[0]?.message?.content || '';
    const toolCall = parseMinimaxToolCall(firstContent);

    // If no tool call, return direct response
    if (!toolCall) {
      // Fallback: do a direct search and ask model to synthesize
      let searchResults: string;
      try {
        searchResults = await callMinimaxSearch(this.searchApiKey, query);
      } catch {
        return {
          text: firstContent,
          metrics: {
            model: MINIMAX_MODEL,
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            totalTokens,
            durationMs: Date.now() - start,
          },
        };
      }

      const synthesizeResponse = await this.client.chat.completions.create({
        model: MINIMAX_MODEL,
        messages: [
          {
            role: 'user',
            content: `Based on the following search results, provide a comprehensive research summary about "${query}":\n\n${searchResults}`,
          },
        ],
      } as any);

      const synthUsage = (synthesizeResponse as any).usage || {};
      totalPromptTokens += synthUsage.prompt_tokens || 0;
      totalCompletionTokens += synthUsage.completion_tokens || 0;
      totalTokens += synthUsage.total_tokens || 0;

      return {
        text:
          (synthesizeResponse as any).choices?.[0]?.message?.content || '',
        metrics: {
          model: MINIMAX_MODEL,
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          totalTokens,
          durationMs: Date.now() - start,
        },
      };
    }

    // Step 2: Execute search queries
    const queryList = (toolCall.arguments.query_list as string[]) || [query];
    const searchResultTexts = await Promise.all(
      queryList.map((q) =>
        callMinimaxSearch(this.searchApiKey, q).catch(
          (err) => `Search failed for "${q}": ${err.message}`,
        ),
      ),
    );
    const combinedResults = searchResultTexts.join('\n\n---\n\n');

    // Step 3: Send results back to model
    messages.push(
      { role: 'assistant', content: firstContent },
      { role: 'tool', content: combinedResults, tool_call_id: 'web_search_0' },
    );

    const finalResponse = await this.client.chat.completions.create({
      model: MINIMAX_MODEL,
      messages,
    } as any);

    const finalUsage = (finalResponse as any).usage || {};
    totalPromptTokens += finalUsage.prompt_tokens || 0;
    totalCompletionTokens += finalUsage.completion_tokens || 0;
    totalTokens += finalUsage.total_tokens || 0;

    return {
      text: (finalResponse as any).choices?.[0]?.message?.content || '',
      metrics: {
        model: MINIMAX_MODEL,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens,
        durationMs: Date.now() - start,
      },
    };
  }

  async chatCompletion(params: {
    messages: ChatMessage[];
    schema: JsonSchema;
    schemaName: string;
    temperature?: number;
  }): Promise<{ json: string; metrics: AiCallMetrics }> {
    const start = Date.now();
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;

    const schemaInstruction = `You MUST respond with valid JSON matching this exact schema. No markdown code fences, no explanation, no extra text — ONLY the raw JSON object.

Schema:
${JSON.stringify(params.schema, null, 2)}`;

    const messages: any[] = [
      { role: 'system', content: schemaInstruction },
      ...params.messages,
    ];

    for (let attempt = 0; attempt <= MAX_JSON_RETRIES; attempt++) {
      const response = await this.client.chat.completions.create({
        model: MINIMAX_MODEL,
        messages,
        temperature: params.temperature ?? 0.2,
      } as any);

      const usage = (response as any).usage || {};
      totalPromptTokens += usage.prompt_tokens || 0;
      totalCompletionTokens += usage.completion_tokens || 0;
      totalTokens += usage.total_tokens || 0;

      const content =
        (response as any).choices?.[0]?.message?.content || '';

      try {
        const parsed = extractJson(content);
        validateRequiredFields(parsed, params.schema);
        return {
          json: JSON.stringify(parsed),
          metrics: {
            model: MINIMAX_MODEL,
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            totalTokens,
            durationMs: Date.now() - start,
          },
        };
      } catch (err) {
        if (attempt === MAX_JSON_RETRIES) {
          throw new Error(
            `MiniMax JSON extraction failed after ${MAX_JSON_RETRIES + 1} attempts: ${(err as Error).message}`,
          );
        }
        // Add error feedback for retry
        messages.push(
          { role: 'assistant', content },
          {
            role: 'user',
            content: `Your previous response was not valid JSON or was missing required fields. Error: ${(err as Error).message}\n\nPlease try again. Respond with ONLY the raw JSON object, no markdown, no explanation.`,
          },
        );
      }
    }

    // Unreachable, but satisfies TypeScript
    throw new Error('MiniMax JSON extraction failed');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/server/providers.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add server/providers/minimax.ts tests/server/providers.test.ts
git commit -m "feat: add MinimaxProvider with tool-calling web search and prompt-based JSON"
```

---

### Task 5: Provider Factory

**Files:**
- Create: `server/providers/index.ts`
- Test: `tests/server/providers.test.ts` (append)

- [ ] **Step 1: Write failing tests for factory**

Append to `tests/server/providers.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/server/providers.test.ts`
Expected: FAIL — `createProvider` not found

- [ ] **Step 3: Implement factory**

```typescript
// server/providers/index.ts
import type OpenAI from 'openai';
import type { AIProvider } from './types';
import { GrokProvider } from './grok';
import { MinimaxProvider } from './minimax';

export type { AIProvider, AiCallMetrics, ChatMessage, JsonSchema } from './types';

type ProviderOptions = {
  grokClient?: OpenAI;
  minimaxClient?: OpenAI;
  minimaxSearchApiKey?: string;
};

export function createProvider(
  name: string,
  options: ProviderOptions,
): AIProvider {
  switch (name) {
    case 'grok': {
      if (!options.grokClient) throw new Error('grokClient is required for Grok provider');
      return new GrokProvider(options.grokClient);
    }
    case 'minimax': {
      if (!options.minimaxClient) throw new Error('minimaxClient is required for MiniMax provider');
      if (!options.minimaxSearchApiKey) throw new Error('minimaxSearchApiKey is required for MiniMax provider');
      return new MinimaxProvider(options.minimaxClient, options.minimaxSearchApiKey);
    }
    default:
      throw new Error(`Unknown AI provider: ${name}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/server/providers.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add server/providers/index.ts tests/server/providers.test.ts
git commit -m "feat: add provider factory function"
```

---

### Task 6: Integrate Provider into Server

**Files:**
- Modify: `server/app.ts` (lines 32-55 types, lines 278-338 route)
- Modify: `server/index.ts` (lines 17-38)
- Modify: `tests/server/app.test.ts` (lines 16-55)

- [ ] **Step 1: Update app.test.ts to use provider interface**

In `tests/server/app.test.ts`, replace the `createTestApp()` function (lines 16-55). Change the `openai` mock to a `provider` mock:

Replace:
```typescript
    openai: {
      responses: {
        create: async () => ({ output_text: 'ok' }),
      },
      chat: {
        completions: {
          create: async () => ({
            id: 'chatcmpl_test',
            choices: [],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 25,
              total_tokens: 130,
              prompt_tokens_details: { cached_tokens: 10 },
              completion_tokens_details: { reasoning_tokens: 5 },
              cost_in_usd_ticks: 2_500_000,
              server_side_tool_usage_details: {
                web_search_calls: 2,
                x_search_calls: 1,
              },
            },
          }),
        },
      },
    },
```

With:
```typescript
    provider: {
      name: 'test',
      research: async () => ({
        text: 'ok',
        metrics: { model: 'test-model', promptTokens: 100, completionTokens: 25, totalTokens: 130, durationMs: 50 },
      }),
      chatCompletion: async () => ({
        json: '{}',
        metrics: { model: 'test-model', promptTokens: 100, completionTokens: 25, totalTokens: 130, durationMs: 50 },
      }),
    },
```

- [ ] **Step 2: Update server/app.ts — types and options**

In `server/app.ts`, replace the `AiClient` type (lines 32-41) and update `CreateAppOptions` (line 51):

Remove:
```typescript
type AiClient = {
  responses: {
    create: (params: Record<string, unknown>) => Promise<unknown>;
  };
  chat: {
    completions: {
      create: (params: Record<string, unknown>) => Promise<unknown>;
    };
  };
};
```

Replace `openai: AiClient;` in `CreateAppOptions` with:
```typescript
import type { AIProvider } from './providers/types';
```
(add at top of file)

And change the type:
```typescript
type CreateAppOptions = {
  analyticsStore: AnalyticsStore;
  reportStore: ReportStore;
  featuredStore: FeaturedStore;
  provider: AIProvider;
  adminPassword?: string;
  adminSessionSecret: string;
  siteUrl?: string;
};
```

- [ ] **Step 3: Update server/app.ts — /api/ai route**

Update the `createApp` destructuring (line 87) to use `provider` instead of `openai`.

Replace the `/api/ai` route handler (lines 278-338) with:

```typescript
  app.post('/api/ai', async (req: RequestWithVisitor, res) => {
    const { callType, params, runId } = req.body || {};

    if (!callType || !params) {
      res.status(400).json({ error: 'Missing callType or params' });
      return;
    }

    const startedAt = Date.now();
    const resolvedRunId = typeof runId === 'string' ? runId : undefined;

    try {
      let response: unknown;
      let model = '';

      switch (callType) {
        case 'responses': {
          const input = params.input || [];
          const query =
            input.length > 0 && typeof input[0].content === 'string'
              ? input[0].content
              : '';
          const result = await provider.research(query);
          model = result.metrics.model;
          response = { output_text: result.text };
          break;
        }

        case 'chat': {
          const result = await provider.chatCompletion({
            messages: params.messages || [],
            schema: params.response_format?.json_schema?.schema || {},
            schemaName: params.response_format?.json_schema?.name || 'response',
            temperature: params.temperature,
          });
          model = result.metrics.model;
          response = {
            choices: [{ message: { content: result.json } }],
            usage: {
              prompt_tokens: result.metrics.promptTokens,
              completion_tokens: result.metrics.completionTokens,
              total_tokens: result.metrics.totalTokens,
            },
          };
          break;
        }

        default:
          res.status(400).json({ error: `Unknown callType: ${callType}` });
          return;
      }

      analyticsStore.logAiCall({
        runId: resolvedRunId,
        visitorId: req.visitorId,
        callType,
        model,
        status: 'success',
        statusCode: 200,
        durationMs: Date.now() - startedAt,
        ...extractAiUsageMetrics(response, model),
      });

      res.json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI API call failed';
      console.error('AI API error:', error);
      analyticsStore.logAiCall({
        runId: resolvedRunId,
        visitorId: req.visitorId,
        callType,
        model: '',
        status: 'error',
        statusCode: 500,
        durationMs: Date.now() - startedAt,
        errorMessage: message,
      });

      res.status(500).json({ error: message });
    }
  });
```

- [ ] **Step 4: Update server/index.ts — use createProvider**

Replace `server/index.ts` content:

```typescript
/**
 * AI Comparison Server
 * Supports Grok and MiniMax providers via AI_PROVIDER env var.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import path from 'node:path';
import OpenAI from 'openai';
import { createAnalyticsStore } from './analytics';
import { createFeaturedStore } from './featured';
import { createReportStore } from './reports';
import { createProvider } from './providers/index';
import { createApp } from './app';

const PORT = process.env.API_SERVER_PORT || 3001;
const AI_PROVIDER = process.env.AI_PROVIDER || 'grok';

const grokClient = process.env.XAI_API_KEY
  ? new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: 'https://api.x.ai/v1' })
  : undefined;

const minimaxClient = process.env.MINIMAX_API_KEY
  ? new OpenAI({ apiKey: process.env.MINIMAX_API_KEY, baseURL: 'https://api.minimax.io/v1' })
  : undefined;

const provider = createProvider(AI_PROVIDER, {
  grokClient,
  minimaxClient,
  minimaxSearchApiKey: process.env.MINIMAX_API_KEY,
});

const analyticsDbPath =
  process.env.ANALYTICS_DB_PATH || path.resolve(process.cwd(), 'server', 'compareai-analytics.db');
const adminSessionSecret =
  process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || process.env.XAI_API_KEY || 'dev-admin-secret';

const analyticsStore = createAnalyticsStore(analyticsDbPath, adminSessionSecret);
const reportStore = createReportStore(analyticsStore.getDb());
const featuredStore = createFeaturedStore(analyticsStore.getDb());
const app = createApp({
  analyticsStore,
  reportStore,
  featuredStore,
  provider,
  adminPassword: process.env.ADMIN_PASSWORD,
  adminSessionSecret,
  siteUrl: process.env.SITE_URL || process.env.APP_URL,
});

app.listen(PORT, () => {
  console.log(`AI comparison server running on port ${PORT} (provider: ${AI_PROVIDER})`);
});
```

- [ ] **Step 5: Run all existing tests**

Run: `npx tsx --test tests/server/app.test.ts tests/server/providers.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add server/app.ts server/index.ts tests/server/app.test.ts
git commit -m "feat: integrate AIProvider into server, replace direct OpenAI SDK calls"
```

---

### Task 7: Add MiniMax Pricing to aiUsage

**Files:**
- Modify: `server/aiUsage.ts` (lines 55-61)
- Modify: `tests/server/aiUsage.test.ts` (append)

- [ ] **Step 1: Write failing test for MiniMax pricing**

Append to `tests/server/aiUsage.test.ts`:

```typescript
test('estimates cost for MiniMax M2.7 model when provider cost is absent', () => {
  const metrics = extractAiUsageMetrics(
    {
      usage: {
        prompt_tokens: 1_000_000,
        completion_tokens: 200_000,
        total_tokens: 1_200_000,
      },
    },
    'MiniMax-M2.7',
  );

  assert.equal(metrics.promptTokens, 1_000_000);
  assert.equal(metrics.completionTokens, 200_000);
  assert.equal(metrics.costSource, 'estimated');
  // Cost: 1M input * $0.3/M + 200K output * $1.2/M = $0.3 + $0.24 = $0.54
  assert.equal(metrics.costUsd, 0.54);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/server/aiUsage.test.ts`
Expected: FAIL — costSource is 'unavailable' because MiniMax model not in pricing table

- [ ] **Step 3: Add MiniMax pricing**

In `server/aiUsage.ts`, add after the `XAI_FAST_PRICING` constant (line 28):

```typescript
const MINIMAX_M27_PRICING: ModelPricing = {
  inputUsdPerMillion: 0.3,
  cachedInputUsdPerMillion: 0.15,
  outputUsdPerMillion: 1.2,
};
```

Update `getKnownPricing` function (lines 55-61) to:

```typescript
function getKnownPricing(model: string): ModelPricing | null {
  const normalized = model.toLowerCase();
  if (normalized.startsWith('grok-4-1-fast') || normalized.startsWith('grok-4-fast')) {
    return XAI_FAST_PRICING;
  }
  if (normalized.startsWith('minimax-m2')) {
    return MINIMAX_M27_PRICING;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/server/aiUsage.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add server/aiUsage.ts tests/server/aiUsage.test.ts
git commit -m "feat: add MiniMax M2.7 pricing to AI usage metrics"
```

---

### Task 8: A/B Test CLI Script

**Files:**
- Create: `scripts/ab-test.ts`
- Modify: `.gitignore` (append)

- [ ] **Step 1: Add ab-results to gitignore**

Append to `.gitignore`:

```
scripts/ab-results/
```

- [ ] **Step 2: Write the A/B test script**

```typescript
// scripts/ab-test.ts
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { createProvider } from '../server/providers/index';
import type { AIProvider, AiCallMetrics } from '../server/providers/types';

// --- Schema definitions (copied from apiService.ts for standalone use) ---

const entitySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    normalized_name: { type: 'string' },
    category: { type: 'string' },
    subcategory: { type: 'string' },
    likely_domain: { type: 'string' },
    short_definition: { type: 'string' },
    key_attributes: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'normalized_name', 'category', 'subcategory', 'likely_domain', 'short_definition', 'key_attributes'],
};

const frameworkSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    relationship: {
      type: 'object',
      additionalProperties: false,
      properties: {
        relationship_type: { type: 'string' },
        comparison_goal: { type: 'string' },
        can_directly_compare: { type: 'boolean' },
        reasoning: { type: 'string' },
      },
      required: ['relationship_type', 'comparison_goal', 'can_directly_compare', 'reasoning'],
    },
    dimensions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string' },
          label: { type: 'string' },
          why_it_matters: { type: 'string' },
          comparison_angle: { type: 'string' },
        },
        required: ['key', 'label', 'why_it_matters', 'comparison_angle'],
      },
    },
  },
  required: ['relationship', 'dimensions'],
};

const analysisSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    item_a_summary: { type: 'string' },
    item_b_summary: { type: 'string' },
    key_difference: { type: 'string' },
    better_for: { type: 'string' },
    optional_score_a: { type: 'number' },
    optional_score_b: { type: 'number' },
  },
  required: ['item_a_summary', 'item_b_summary', 'key_difference', 'better_for', 'optional_score_a', 'optional_score_b'],
};

const prosConsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    item_a_pros: { type: 'array', items: { type: 'string' } },
    item_a_cons: { type: 'array', items: { type: 'string' } },
    item_b_pros: { type: 'array', items: { type: 'string' } },
    item_b_cons: { type: 'array', items: { type: 'string' } },
  },
  required: ['item_a_pros', 'item_a_cons', 'item_b_pros', 'item_b_cons'],
};

const recommendationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    best_for_a: { type: 'array', items: { type: 'string' } },
    best_for_b: { type: 'array', items: { type: 'string' } },
    which_to_choose_first: { type: 'string' },
    when_not_to_compare_directly: { type: 'string' },
    short_verdict: { type: 'string' },
    long_verdict: { type: 'string' },
  },
  required: ['best_for_a', 'best_for_b', 'which_to_choose_first', 'when_not_to_compare_directly', 'short_verdict', 'long_verdict'],
};

// --- Pipeline runner ---

type PhaseResult = {
  phase: string;
  durationMs: number;
  metrics: AiCallMetrics;
  success: boolean;
  error?: string;
  retries?: number;
  data: unknown;
};

async function runPipeline(
  provider: AIProvider,
  itemA: string,
  itemB: string,
): Promise<{ result: Record<string, unknown> | null; phases: PhaseResult[] }> {
  const phases: PhaseResult[] = [];

  // Phase 1: Research
  console.log(`  [${provider.name}] Phase 1: Researching ${itemA} and ${itemB}...`);
  let profileA: Record<string, unknown> = {};
  let profileB: Record<string, unknown> = {};

  try {
    const start = Date.now();
    const [researchA, researchB] = await Promise.all([
      provider.research(itemA),
      provider.research(itemB),
    ]);

    // Profile A
    const profA = await provider.chatCompletion({
      messages: [{
        role: 'user',
        content: `Based on the following research information, create a structured profile for "${itemA}":\n\nRESEARCH RESULTS:\n${researchA.text}\n\nExtract: normalized name, category, subcategory, domain, definition, key attributes.`,
      }],
      schema: entitySchema,
      schemaName: 'entity_response',
      temperature: 0.1,
    });

    // Profile B
    const profB = await provider.chatCompletion({
      messages: [{
        role: 'user',
        content: `Based on the following research information, create a structured profile for "${itemB}":\n\nRESEARCH RESULTS:\n${researchB.text}\n\nExtract: normalized name, category, subcategory, domain, definition, key attributes.`,
      }],
      schema: entitySchema,
      schemaName: 'entity_response',
      temperature: 0.1,
    });

    profileA = JSON.parse(profA.json);
    profileB = JSON.parse(profB.json);

    phases.push({
      phase: 'research',
      durationMs: Date.now() - start,
      metrics: { ...researchA.metrics, promptTokens: researchA.metrics.promptTokens + researchB.metrics.promptTokens + profA.metrics.promptTokens + profB.metrics.promptTokens, completionTokens: researchA.metrics.completionTokens + researchB.metrics.completionTokens + profA.metrics.completionTokens + profB.metrics.completionTokens, totalTokens: researchA.metrics.totalTokens + researchB.metrics.totalTokens + profA.metrics.totalTokens + profB.metrics.totalTokens },
      success: true,
      data: { profileA, profileB },
    });
  } catch (err) {
    phases.push({ phase: 'research', durationMs: 0, metrics: { model: provider.name, promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 0 }, success: false, error: (err as Error).message, data: null });
    return { result: null, phases };
  }

  // Phase 2: Framework
  console.log(`  [${provider.name}] Phase 2: Architecting framework...`);
  let framework: Record<string, unknown> = {};
  try {
    const start = Date.now();
    const fw = await provider.chatCompletion({
      messages: [{
        role: 'user',
        content: `You are an Architect Agent. Based on the following entity profiles, determine their relationship and generate 4 to 6 key dimensions to compare them on.\n\nFirst entity: ${JSON.stringify(profileA)}\nSecond entity: ${JSON.stringify(profileB)}\n\nAnalyze their nature and generate dimensions specifically tailored to these entities. Always refer to them by name ("${profileA.name}" and "${profileB.name}").`,
      }],
      schema: frameworkSchema,
      schemaName: 'framework_response',
      temperature: 0.2,
    });
    framework = JSON.parse(fw.json);
    phases.push({ phase: 'framework', durationMs: Date.now() - start, metrics: fw.metrics, success: true, data: framework });
  } catch (err) {
    phases.push({ phase: 'framework', durationMs: 0, metrics: { model: provider.name, promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 0 }, success: false, error: (err as Error).message, data: null });
    return { result: null, phases };
  }

  // Phase 3: Analysis
  console.log(`  [${provider.name}] Phase 3: Analyzing dimensions...`);
  const dimensions = (framework.dimensions as any[]) || [];
  const analyzedDimensions: unknown[] = [];
  try {
    const start = Date.now();
    let totalMetrics = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    for (const dim of dimensions) {
      const an = await provider.chatCompletion({
        messages: [{
          role: 'user',
          content: `You are an Analyst Agent. Compare "${profileA.name}" and "${profileB.name}" on dimension: "${dim.label}".\n\n${profileA.name}: ${profileA.short_definition}\n${profileB.name}: ${profileB.short_definition}\nDimension Context: ${dim.why_it_matters}\nComparison Angle: ${dim.comparison_angle}\n\nProvide scores out of 10 where higher = more favorable.`,
        }],
        schema: analysisSchema,
        schemaName: 'analysis_response',
        temperature: 0.2,
      });
      analyzedDimensions.push({ ...dim, analysis: JSON.parse(an.json) });
      totalMetrics.promptTokens += an.metrics.promptTokens;
      totalMetrics.completionTokens += an.metrics.completionTokens;
      totalMetrics.totalTokens += an.metrics.totalTokens;
    }
    phases.push({ phase: 'analysis', durationMs: Date.now() - start, metrics: { model: provider.name, ...totalMetrics, durationMs: Date.now() - start }, success: true, data: analyzedDimensions });
  } catch (err) {
    phases.push({ phase: 'analysis', durationMs: 0, metrics: { model: provider.name, promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 0 }, success: false, error: (err as Error).message, data: null });
    return { result: null, phases };
  }

  // Phase 4: Synthesis
  console.log(`  [${provider.name}] Phase 4: Synthesizing verdict...`);
  try {
    const start = Date.now();
    const [pc, rec] = await Promise.all([
      provider.chatCompletion({
        messages: [{
          role: 'user',
          content: `You are a Judge Agent. Extract key strengths and weaknesses for both entities.\n\n${profileA.name}: ${profileA.short_definition}\n${profileB.name}: ${profileB.short_definition}\nAnalysis: ${JSON.stringify(analyzedDimensions)}\n\nAlways refer to entities by name.`,
        }],
        schema: prosConsSchema,
        schemaName: 'proscons_response',
        temperature: 0.2,
      }),
      provider.chatCompletion({
        messages: [{
          role: 'user',
          content: `You are a Judge Agent. Provide a final verdict and recommendation.\n\n${profileA.name}: ${profileA.short_definition}\n${profileB.name}: ${profileB.short_definition}\nAnalysis: ${JSON.stringify(analyzedDimensions)}\n\nAlways refer to entities by name.`,
        }],
        schema: recommendationSchema,
        schemaName: 'recommendation_response',
        temperature: 0.2,
      }),
    ]);

    const prosCons = JSON.parse(pc.json);
    const recommendation = JSON.parse(rec.json);

    phases.push({
      phase: 'synthesis',
      durationMs: Date.now() - start,
      metrics: { model: provider.name, promptTokens: pc.metrics.promptTokens + rec.metrics.promptTokens, completionTokens: pc.metrics.completionTokens + rec.metrics.completionTokens, totalTokens: pc.metrics.totalTokens + rec.metrics.totalTokens, durationMs: Date.now() - start },
      success: true,
      data: { prosCons, recommendation },
    });

    return {
      result: {
        entityA: profileA,
        entityB: profileB,
        relationship: framework.relationship,
        dimensions: analyzedDimensions,
        prosCons,
        recommendation,
      },
      phases,
    };
  } catch (err) {
    phases.push({ phase: 'synthesis', durationMs: 0, metrics: { model: provider.name, promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 0 }, success: false, error: (err as Error).message, data: null });
    return { result: null, phases };
  }
}

// --- Report generator ---

function generateComparisonMd(
  itemA: string,
  itemB: string,
  grokPhases: PhaseResult[],
  minimaxPhases: PhaseResult[],
): string {
  const lines: string[] = [
    `# A/B Test: ${itemA} vs ${itemB}`,
    `**Date:** ${new Date().toISOString()}`,
    '',
    '## Phase Comparison',
    '',
    '| Phase | Grok Duration | MiniMax Duration | Grok Tokens | MiniMax Tokens | Grok Success | MiniMax Success |',
    '|-------|--------------|-----------------|-------------|---------------|-------------|----------------|',
  ];

  const phaseNames = ['research', 'framework', 'analysis', 'synthesis'];
  for (const name of phaseNames) {
    const gp = grokPhases.find((p) => p.phase === name);
    const mp = minimaxPhases.find((p) => p.phase === name);
    lines.push(
      `| ${name} | ${gp?.durationMs ?? '-'}ms | ${mp?.durationMs ?? '-'}ms | ${gp?.metrics.totalTokens ?? '-'} | ${mp?.metrics.totalTokens ?? '-'} | ${gp?.success ? 'YES' : gp?.error || 'NO'} | ${mp?.success ? 'YES' : mp?.error || 'NO'} |`,
    );
  }

  const grokTotal = grokPhases.reduce((sum, p) => sum + p.durationMs, 0);
  const minimaxTotal = minimaxPhases.reduce((sum, p) => sum + p.durationMs, 0);
  const grokTokens = grokPhases.reduce((sum, p) => sum + p.metrics.totalTokens, 0);
  const minimaxTokens = minimaxPhases.reduce((sum, p) => sum + p.metrics.totalTokens, 0);

  lines.push('', `**Total:** Grok ${grokTotal}ms / MiniMax ${minimaxTotal}ms`);
  lines.push(`**Total Tokens:** Grok ${grokTokens} / MiniMax ${minimaxTokens}`);

  return lines.join('\n');
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const itemsIndex = args.indexOf('--items');
  if (itemsIndex === -1 || itemsIndex + 1 >= args.length) {
    console.error('Usage: npx tsx scripts/ab-test.ts --items "ItemA,ItemB" "ItemC,ItemD"');
    process.exit(1);
  }

  const pairs = args.slice(itemsIndex + 1).map((pair) => {
    const [a, b] = pair.split(',').map((s) => s.trim());
    if (!a || !b) {
      console.error(`Invalid pair format: "${pair}". Use "ItemA,ItemB"`);
      process.exit(1);
    }
    return { itemA: a, itemB: b };
  });

  // Validate env vars
  if (!process.env.XAI_API_KEY) {
    console.error('Missing XAI_API_KEY in .env.local');
    process.exit(1);
  }
  if (!process.env.MINIMAX_API_KEY) {
    console.error('Missing MINIMAX_API_KEY in .env.local');
    process.exit(1);
  }

  // Create providers
  const grokClient = new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: 'https://api.x.ai/v1' });
  const minimaxClient = new OpenAI({ apiKey: process.env.MINIMAX_API_KEY, baseURL: 'https://api.minimax.io/v1' });

  const grokProvider = createProvider('grok', { grokClient });
  const minimaxProvider = createProvider('minimax', { minimaxClient, minimaxSearchApiKey: process.env.MINIMAX_API_KEY });

  // Validate MiniMax key with a simple request
  console.log('Validating MiniMax API key...');
  try {
    await minimaxClient.chat.completions.create({
      model: 'MiniMax-M2.7',
      messages: [{ role: 'user', content: 'Say "hello" in one word.' }],
      max_tokens: 10,
    } as any);
    console.log('MiniMax API key valid.');
  } catch (err) {
    console.error(`MiniMax API key validation failed: ${(err as Error).message}`);
    console.error('Your JWT token may not be compatible. Try getting an sk- format key from the MiniMax platform.');
    process.exit(1);
  }

  // Run A/B tests
  const resultsBase = path.resolve(process.cwd(), 'scripts', 'ab-results');
  mkdirSync(resultsBase, { recursive: true });

  for (const { itemA, itemB } of pairs) {
    const slug = `${new Date().toISOString().slice(0, 10)}-${itemA.toLowerCase().replace(/\s+/g, '-')}-vs-${itemB.toLowerCase().replace(/\s+/g, '-')}`;
    const outDir = path.join(resultsBase, slug);
    mkdirSync(outDir, { recursive: true });

    console.log(`\n=== Testing: ${itemA} vs ${itemB} ===`);

    console.log('\n--- Grok ---');
    const grok = await runPipeline(grokProvider, itemA, itemB);

    console.log('\n--- MiniMax ---');
    const minimax = await runPipeline(minimaxProvider, itemA, itemB);

    writeFileSync(path.join(outDir, 'grok-result.json'), JSON.stringify(grok, null, 2));
    writeFileSync(path.join(outDir, 'minimax-result.json'), JSON.stringify(minimax, null, 2));
    writeFileSync(path.join(outDir, 'comparison.md'), generateComparisonMd(itemA, itemB, grok.phases, minimax.phases));

    console.log(`\nResults written to ${outDir}/`);
  }

  console.log('\nA/B test complete.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Run type check**

Run: `npx tsx --test scripts/ab-test.ts --help 2>&1 || true`
(Just verify it compiles — actual run needs API keys)

- [ ] **Step 4: Commit**

```bash
git add scripts/ab-test.ts .gitignore
git commit -m "feat: add A/B test CLI script for Grok vs MiniMax comparison"
```

---

### Task 9: Add MINIMAX_API_KEY to .env.local

**Files:**
- Modify: `.env.local` (add key)

- [ ] **Step 1: Add the MiniMax API key**

Add to `.env.local`:

```bash
MINIMAX_API_KEY=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJHcm91cE5hbWUiOiJFRFVISyIsIlVzZXJOYW1lIjoiRURVSEsiLCJBY2NvdW50IjoiIiwiU3ViamVjdElEIjoiMTk5Mzk0NDU3NDkyMTI4MjIxMSIsIlBob25lIjoiMTM2MzE5NjMzMDUiLCJHcm91cElEIjoiMTk5Mzk0NDU3NDkxMjg5MzYwMyIsIlBhZ2VOYW1lIjoiIiwiTWFpbCI6IiIsIkNyZWF0ZVRpbWUiOiIyMDI1LTExLTI4IDE1OjI2OjEzIiwiVG9rZW5UeXBlIjo0LCJpc3MiOiJtaW5pbWF4In0.PPBYbVCJDl9hSLSI3uVclXStOUx-fcvewq90a5HdomlYHKQIe5eAz5cfuFbXbYHQhid0kzAwJK59nTPTTDIQzxDLAhyToEWDWM3UWoEyt39HpwhWILikFDznDwHBCSvY0UqNgQtttXqsbRSbz3RVbaWvQfnvJDeYiYsF4RIP442kE4rFU0wN8wpzf3aPo5SiIidxQjckWOsxPNFF8b7aDQdw2goGbYJ_FDxsQqopr6oA7zLOuezeliPgi7DoHlwQkS9Iqkz3VdKrMQX5Iupl7LsVAKsr1kFrDQbgp1N9dXiNrl0WXkWeEJkNF5yaxrYJsdbGaeyRPYihA1awyLoqsQ
AI_PROVIDER=grok
```

Note: `.env*` is in `.gitignore` so this won't be committed.

- [ ] **Step 2: No commit needed** (env files are gitignored)

---

### Task 10: Run Full Test Suite

- [ ] **Step 1: Run all tests**

Run: `npx tsx --test tests/server/providers.test.ts tests/server/app.test.ts tests/server/aiUsage.test.ts tests/server/analytics.test.ts tests/server/adminAuth.test.ts tests/services/researchConfig.test.ts`
Expected: All PASS

- [ ] **Step 2: Run type check**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds
