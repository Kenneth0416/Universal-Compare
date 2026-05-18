# Grok → MiniMax Migration: Provider Abstraction & A/B Test

**Date:** 2026-05-18
**Status:** Design approved

## Summary

Migrate the AI backend from Grok-only to a dual-provider architecture (Grok + MiniMax). Introduce an `AIProvider` abstraction layer, implement a MiniMax provider using M2.7 with tool-calling-based web search and prompt-based JSON output, and build a CLI A/B test script for quality comparison before production use.

## Goals

1. Add MiniMax as a second AI provider alongside Grok
2. A/B test: CLI script to compare output quality, latency, and JSON reliability
3. Dual provider architecture: switch via `AI_PROVIDER` env var, keep both as options
4. Zero frontend changes — provider switching is server-side only

## Non-Goals

- Frontend UI changes
- Streaming output support for MiniMax
- X Search equivalent on MiniMax side
- Auto-scoring or automated quality judgment in A/B test

---

## Architecture

### Provider Interface

```typescript
// server/providers/types.ts
interface AIProvider {
  name: string;  // 'grok' | 'minimax'

  // Phase 1: research with web search
  research(query: string): Promise<string>;

  // Phase 2-4: structured JSON output via chat completion
  chatCompletion(params: {
    messages: ChatMessage[];
    schema: JsonSchema;
    schemaName: string;
    temperature?: number;
  }): Promise<string>;  // returns JSON string
}

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
};

type JsonSchema = Record<string, unknown>;
```

### File Structure

```
server/
  providers/
    types.ts           # AIProvider interface, ChatMessage, JsonSchema types
    grok.ts            # GrokProvider — wraps existing OpenAI SDK logic
    minimax.ts         # MinimaxProvider — M2.7 + tool calling + prompt-based JSON
    index.ts           # createProvider(name) factory function
  index.ts             # reads AI_PROVIDER env var, creates provider, injects into createApp()
  app.ts               # /api/ai route delegates to provider
  aiUsage.ts           # add MiniMax pricing data
scripts/
  ab-test.ts           # CLI A/B test script
  ab-results/          # test output directory (gitignored)
```

---

## GrokProvider Implementation

Wraps existing logic with no behavioral changes:

- `research()`: Calls OpenAI SDK `responses.create()` with `web_search` + `x_search` tools (existing Responses API flow)
- `chatCompletion()`: Calls `chat.completions.create()` with `response_format: { type: 'json_schema' }` (existing flow)
- Models: `grok-4-1-fast-non-reasoning` (research), `grok-4-1-fast-reasoning` (structured output)

---

## MinimaxProvider Implementation

### Authentication

```typescript
const minimax = new OpenAI({
  apiKey: process.env.MINIMAX_API_KEY,  // JWT token from TokenPlan
  baseURL: 'https://api.minimax.io/v1',
});
```

### research() — Web Search via Tool Calling

Flow (encapsulated as single method call):

1. Send chat completion to M2.7 with `tools` containing a `web_search` function definition:
   ```json
   {
     "name": "web_search",
     "description": "Search the web for information",
     "parameters": {
       "type": "object",
       "properties": {
         "query_list": {
           "type": "array",
           "items": { "type": "string" }
         }
       },
       "required": ["query_list"]
     }
   }
   ```
2. Parse M2.7's XML tool call response: `<minimax:tool_call><invoke name="web_search">...</invoke></minimax:tool_call>`
3. Extract search queries from XML
4. Call MiniMax search API: `POST https://api.minimax.io/v1/coding_plan/search` for each query
5. Send search results back as `tool` role message
6. M2.7 generates final research report based on search results

If XML parsing fails, fallback to calling search API directly with the original query.

### chatCompletion() — Prompt-based JSON Output

Flow:

1. Prepend system message with schema definition:
   ```
   You MUST respond with valid JSON matching this exact schema. No markdown, no explanation, just the JSON object.
   Schema: { ... }
   ```
2. Call M2.7 chat completion (no `response_format` — M2.7 ignores it)
3. Extract JSON from response (handle markdown code fence wrapping like ```json ... ```)
4. Validate required fields against schema
5. On validation failure: retry with error feedback message (max 2 retries)
6. After max retries: throw descriptive error

### Model

- All phases: `MiniMax-M2.7`

---

## /api/ai Route Changes

### Current

```typescript
// server/app.ts - directly calls OpenAI SDK
case 'responses':
  response = await openai.responses.create(params);
case 'chat':
  response = await openai.chat.completions.create(params);
```

### New

The `createApp()` options type changes from `openai: AiClient` to `provider: AIProvider`.

The `/api/ai` route maps `callType` to provider methods:
- `callType: 'responses'` → `provider.research()`
- `callType: 'chat'` → `provider.chatCompletion()`

Frontend `apiService.ts` remains unchanged — it still sends `{ callType, params }`.

---

## A/B Test CLI Script

### Usage

```bash
npx tsx scripts/ab-test.ts --items "iPhone,Android" "Tesla,BYD" "React,Vue"
```

### Flow

1. Parse comparison item pairs from CLI args
2. For each pair, run full 4-phase pipeline with both providers:
   - Phase 1: Research (both entities)
   - Phase 2: Framework architecture
   - Phase 3: Multi-dimensional analysis
   - Phase 4: Pros/cons + recommendation
3. Record per-phase metrics: output content, latency (ms), token usage, JSON parse success/failure, retry count
4. Write results to `scripts/ab-results/`

### Output

```
scripts/ab-results/
  2026-05-18-iphone-vs-android/
    grok-result.json      # full ComparisonResult
    minimax-result.json   # full ComparisonResult
    comparison.md         # side-by-side summary
```

`comparison.md` contains:
- Per-phase latency comparison
- Token usage comparison
- JSON reliability stats (MiniMax: parse failures, retries)
- Side-by-side analysis content for each dimension

No auto-scoring — human review only.

---

## Environment Variables

```bash
# .env.local
XAI_API_KEY=your_grok_key           # existing
MINIMAX_API_KEY=eyJ...              # new, JWT token from TokenPlan
AI_PROVIDER=grok                     # grok | minimax, default grok
```

---

## AI Usage Metrics

Add MiniMax pricing to `server/aiUsage.ts`:

```typescript
const MINIMAX_M27_PRICING: ModelPricing = {
  inputUsdPerMillion: 0.3,
  cachedInputUsdPerMillion: 0.15,
  outputUsdPerMillion: 1.2,
};
```

MiniMax returns standard OpenAI-format `usage` field — existing token parsing logic is reusable. Add model name matching for `minimax-m2.7*` in `getKnownPricing()`.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| JWT key returns error 2049 | Blocks all MiniMax calls | A/B script validates key first with hello-world request; prompt user to get `sk-` key if needed |
| M2.7 JSON output malformed | Pipeline failure | Markdown fence extraction + field validation + 2 retries with error feedback |
| XML tool call format changes | Web search breaks | Parser isolated in dedicated function; fallback to direct search API call |
| Higher latency (2-step search) | Slower research phase | A/B report tracks per-phase latency; acceptable trade-off documented |
