# Phase 0 Demand Sensing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only `POST /api/admin/featured/preflight` endpoint that scores a `(itemA, itemB)` candidate pair for SEO/GEO demand before the admin commits it to `featured_comparisons`.

**Architecture:** Backend `DemandSensingService` runs two parallel MiniMax web searches (general SERP + Reddit), passes results to DeepSeek for JSON structured scoring (0-10 + signals). Service is dependency-injected into `createApp()` and exposed at one new endpoint. Admin UI gains a `[Check Demand]` button next to the existing Add Featured form. Advisory only — no hard gate.

**Tech Stack:** Node `node:test` + `node:assert/strict`, `tsx`, Express, OpenAI SDK (DeepSeek-compatible), MiniMax search REST API, React 19 + TypeScript on the admin side.

**Spec:** `docs/superpowers/specs/2026-05-26-demand-sensing-design.md`

---

## File Map

**New backend files:**
- `server/demandSensing.ts` — Service class, types, error class
- `tests/server/demandSensing.test.ts` — Unit tests (mocked deps)
- `tests/server/demandSensing.real.test.ts` — Real API tests (gated by env)

**New frontend deliverable:** (no new file, modifications only)

**Modified:**
- `server/providers/minimax.ts` — Export `callMinimaxSearch` for reuse
- `server/app.ts` — Inject `DemandSensingService`, add preflight endpoint
- `server/index.ts` — Instantiate service, pass to `createApp`
- `tests/server/app.test.ts` — Add endpoint tests
- `src/admin/types.ts` — Add `DemandSenseResult` + `DemandSenseSignals` types
- `src/admin/adminApi.ts` — Add `preflightFeatured()` client
- `src/admin/AdminApp.tsx` — Wire Check Demand UI into existing Add Featured form
- `package.json` — Add `test:real` script

---

## Conventions

- Every test uses `import assert from 'node:assert/strict'; import test from 'node:test';`
- Mocked OpenAI client shape: `{ chat: { completions: { create: async (params) => ({...}) } } }`
- Run unit tests: `npm test` (must finish < 5 seconds)
- Run real API tests: `npm run test:real` (after `RUN_REAL_API_TESTS=1` is wired)
- Commit after every cycle's green phase
- TDD discipline: every cycle is `red test → confirm fail → minimal impl → confirm pass → commit`

---

## Task 1: Cycle 1 — Happy path (unit, mocked)

**Files:**
- Create: `server/demandSensing.ts`
- Create: `tests/server/demandSensing.test.ts`

- [ ] **Step 1.1: Write the failing happy-path test**

Create `tests/server/demandSensing.test.ts`:

```typescript
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
```

- [ ] **Step 1.2: Run test, verify failure**

Run: `npm test -- --test-name-pattern="happy path"`

Expected: FAIL with `Cannot find module '../../server/demandSensing'` (because the file doesn't exist yet).

- [ ] **Step 1.3: Write minimal implementation**

Create `server/demandSensing.ts`:

```typescript
import type OpenAI from 'openai';
import type { Source } from './providers/types';

export type DemandSenseSignals = {
  existing_articles_count: number;
  has_reddit_discussion: boolean;
  has_authoritative_source: boolean;
  competition_level: 'low' | 'medium' | 'high';
  freshness: 'stale' | 'recent' | 'fresh';
};

export type DemandSenseResult = {
  score: number;
  recommendation: 'skip' | 'consider' | 'good' | 'excellent';
  signals: DemandSenseSignals;
  reasoning: string;
  topSources: Array<{ url: string; title: string }>;
  partial: boolean;
  metrics: { durationMs: number; totalTokens: number };
};

export type MinimaxSearchFn = (
  apiKey: string,
  query: string,
  baseUrl?: string,
) => Promise<{ text: string; sources: Source[] }>;

export type DemandSensingDependencies = {
  minimaxSearchApiKey: string;
  minimaxSearchBaseUrl?: string;
  deepseekClient: OpenAI;
  deepseekModel?: string;
  searchFn?: MinimaxSearchFn;
};

export class DemandSensingError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'DemandSensingError';
  }
}

function dedupeByUrl(sources: Source[]): Source[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    const normalized = (s.url || '').toLowerCase().replace(/\/+$/, '');
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function formatSearchBlock(label: string, query: string, result: { sources: Source[] } | null): string {
  if (!result) return `=== ${label}: "${query}" ===\n(search unavailable)`;
  const lines = result.sources.slice(0, 10).map((s, i) =>
    `[${i + 1}] ${s.title}\n    ${s.url}\n    ${s.snippet || ''}`
  );
  return `=== ${label}: "${query}" ===\n${lines.join('\n\n')}`;
}

function buildPrompt(
  itemA: string,
  itemB: string,
  language: string,
  search1: { sources: Source[] } | null,
  search2: { sources: Source[] } | null,
): string {
  const generalQuery = `${itemA} vs ${itemB}`;
  const redditQuery = `${itemA} vs ${itemB} reddit`;
  const langName = language === 'zh-CN' || language === 'zh-Hans' ? 'Simplified Chinese'
    : language === 'zh-TW' || language === 'zh-Hant' ? 'Traditional Chinese'
    : 'English';

  return `You are a SEO/GEO demand analyst. Given search results for the pair "${itemA} vs ${itemB}", judge whether this comparison has real demand for a comparison website.

Scoring rubric (0-10):
- 0-3 (skip): No existing articles, no community discussion. Obscure or nonsensical.
- 4-5 (consider): Some articles exist but quality low or topic niche.
- 6-7 (good): Clear demand — multiple articles, some community discussion, not over-saturated.
- 8-10 (excellent): Strong demand — many articles, active Reddit, authoritative sources.

Signals to extract:
- existing_articles_count: distinct comparison articles in Search 1
- has_reddit_discussion: any Reddit thread with substantive discussion in Search 2
- has_authoritative_source: G2/Capterra/Wirecutter/Wikipedia/major-press in Search 1
- competition_level: low/medium/high (quality + diversity of coverage)
- freshness: stale (>2y), recent (last 2y), fresh (last 6mo)

Reasoning: 1-2 sentences in ${langName} explaining the score.

Output JSON only matching this schema (fields: score, recommendation, signals{existing_articles_count, has_reddit_discussion, has_authoritative_source, competition_level, freshness}, reasoning). No markdown.

Search results:
${formatSearchBlock('Search 1 (General SERP)', generalQuery, search1)}

${formatSearchBlock('Search 2 (Reddit)', redditQuery, search2)}`;
}

export class DemandSensingService {
  private searchFn: MinimaxSearchFn;
  private deepseekClient: OpenAI;
  private deepseekModel: string;
  private minimaxSearchApiKey: string;
  private minimaxSearchBaseUrl: string | undefined;

  constructor(deps: DemandSensingDependencies) {
    if (!deps.searchFn) {
      throw new Error('searchFn must be provided (or wire callMinimaxSearch in production)');
    }
    this.searchFn = deps.searchFn;
    this.deepseekClient = deps.deepseekClient;
    this.deepseekModel = deps.deepseekModel || 'deepseek-v4-flash';
    this.minimaxSearchApiKey = deps.minimaxSearchApiKey;
    this.minimaxSearchBaseUrl = deps.minimaxSearchBaseUrl;
  }

  async scorePair(itemA: string, itemB: string, language = 'en'): Promise<DemandSenseResult> {
    const start = Date.now();
    const generalQuery = `${itemA} vs ${itemB}`;
    const redditQuery = `${itemA} vs ${itemB} reddit`;

    const [r1, r2] = await Promise.allSettled([
      this.searchFn(this.minimaxSearchApiKey, generalQuery, this.minimaxSearchBaseUrl),
      this.searchFn(this.minimaxSearchApiKey, redditQuery, this.minimaxSearchBaseUrl),
    ]);

    const search1 = r1.status === 'fulfilled' ? r1.value : null;
    const search2 = r2.status === 'fulfilled' ? r2.value : null;
    const partial = !search1 || !search2;

    if (!search1 && !search2) {
      throw new DemandSensingError('Both MiniMax searches failed', 502);
    }

    const prompt = buildPrompt(itemA, itemB, language, search1, search2);

    const response = await this.deepseekClient.chat.completions.create({
      model: this.deepseekModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    } as any);

    const content = (response as any).choices?.[0]?.message?.content || '';
    const usage = (response as any).usage || {};
    const totalTokens = usage.total_tokens || 0;

    const parsed = JSON.parse(content);

    const sourcePool = search1?.sources ?? search2?.sources ?? [];
    const topSources = dedupeByUrl(sourcePool).slice(0, 5).map((s) => ({
      url: s.url,
      title: s.title,
    }));

    return {
      score: parsed.score,
      recommendation: parsed.recommendation,
      signals: parsed.signals,
      reasoning: parsed.reasoning,
      topSources,
      partial,
      metrics: { durationMs: Date.now() - start, totalTokens },
    };
  }
}
```

- [ ] **Step 1.4: Run test, verify pass**

Run: `npm test -- --test-name-pattern="happy path"`

Expected: PASS — one test passes.

Also run the full suite to verify no regression: `npm test`

Expected: all existing tests pass + new happy path test.

- [ ] **Step 1.5: Commit**

```bash
git add server/demandSensing.ts tests/server/demandSensing.test.ts
git commit -m "$(cat <<'EOF'
feat(demand-sensing): scaffold service with happy-path test

DemandSensingService with dual-search + DeepSeek scoring. Cycle 1 of
TDD plan — happy path only, mocked search and chat clients.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Cycle 2 — Input validation

**Files:**
- Modify: `tests/server/demandSensing.test.ts`
- Modify: `server/demandSensing.ts`

- [ ] **Step 2.1: Add failing input-validation tests**

Append to `tests/server/demandSensing.test.ts`:

```typescript
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
  let capturedQuery = '';

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
      capturedQuery = query;
      return { text: '', sources: [] };
    },
  });

  await service.scorePair(longA, longB, 'en');

  // 200 + ' vs ' + 200 = 404 chars max
  assert.ok(capturedQuery.length <= 405, `Query is ${capturedQuery.length} chars`);
  assert.ok(capturedQuery.startsWith('A'.repeat(200)));
});
```

- [ ] **Step 2.2: Run tests, verify failure**

Run: `npm test -- --test-name-pattern="rejects|truncates"`

Expected: FAIL — `rejects` tests fail because `scorePair` doesn't validate yet (it tries to call mock searchFn which returns empty, then DeepSeek fails on `{}` parse). `truncates` test fails because no truncation happens.

- [ ] **Step 2.3: Add validation + truncation to `scorePair`**

Replace the start of the `scorePair` method in `server/demandSensing.ts` (before the `Promise.allSettled`) with:

```typescript
  async scorePair(itemA: string, itemB: string, language = 'en'): Promise<DemandSenseResult> {
    if (typeof itemA !== 'string' || typeof itemB !== 'string' || !itemA.trim() || !itemB.trim()) {
      throw new DemandSensingError('itemA and itemB must be non-empty strings', 400);
    }

    const trimmedA = itemA.trim().slice(0, 200);
    const trimmedB = itemB.trim().slice(0, 200);

    if (trimmedA.toLowerCase() === trimmedB.toLowerCase()) {
      throw new DemandSensingError('itemA and itemB must be different', 400);
    }

    const start = Date.now();
    const generalQuery = `${trimmedA} vs ${trimmedB}`;
    const redditQuery = `${trimmedA} vs ${trimmedB} reddit`;
```

Also update the `buildPrompt` call lower in the method to use `trimmedA`/`trimmedB`:

```typescript
    const prompt = buildPrompt(trimmedA, trimmedB, language, search1, search2);
```

- [ ] **Step 2.4: Run tests, verify pass**

Run: `npm test`

Expected: all existing tests + Cycle 1 + 4 new validation tests all PASS.

- [ ] **Step 2.5: Commit**

```bash
git add server/demandSensing.ts tests/server/demandSensing.test.ts
git commit -m "$(cat <<'EOF'
feat(demand-sensing): input validation and truncation

Reject empty/duplicate inputs (400). Truncate strings beyond 200 chars
silently before search.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Cycle 3 — Partial degradation

**Files:**
- Modify: `tests/server/demandSensing.test.ts`
- Modify: `server/demandSensing.ts` (already supports partial via `Promise.allSettled` — tests confirm + add observable assertion)

- [ ] **Step 3.1: Add failing partial-degradation tests**

Append to `tests/server/demandSensing.test.ts`:

```typescript
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
```

- [ ] **Step 3.2: Run tests, verify pass (most) and locate any fail**

Run: `npm test -- --test-name-pattern="partial|both searches|search unavailable"`

Expected: Tests for `partial` and `both fail` already pass (the implementation from Task 1 handles them). The `search unavailable` test should ALSO pass because `formatSearchBlock` already returns that string when `result` is null.

If all pass: proceed to Step 3.3. If any fail: read error, fix in `demandSensing.ts`, re-run.

- [ ] **Step 3.3: Commit**

```bash
git add tests/server/demandSensing.test.ts
git commit -m "$(cat <<'EOF'
test(demand-sensing): partial degradation cases

Verify single-search-failure returns partial=true, both-fail throws
502, and DeepSeek prompt flags missing search blocks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Cycle 4 — DeepSeek JSON retry

**Files:**
- Modify: `tests/server/demandSensing.test.ts`
- Modify: `server/demandSensing.ts`

- [ ] **Step 4.1: Add failing retry tests**

Append to `tests/server/demandSensing.test.ts`:

```typescript
function makeRetryDeepseekClient(responses: string[]) {
  let i = 0;
  const calls: any[] = [];
  return {
    calls,
    client: {
      chat: {
        completions: {
          create: async (params: any) => {
            calls.push(params);
            const content = responses[Math.min(i, responses.length - 1)];
            i++;
            return {
              choices: [{ message: { content } }],
              usage: { total_tokens: 100 },
            };
          },
        },
      },
    },
  };
}

test('deepseek invalid JSON: retries once and succeeds on second attempt', async () => {
  const validJson = JSON.stringify({
    score: 7, recommendation: 'good',
    signals: {
      existing_articles_count: 5, has_reddit_discussion: true,
      has_authoritative_source: false, competition_level: 'medium', freshness: 'recent',
    },
    reasoning: 'Good signal.',
  });
  const { client, calls } = makeRetryDeepseekClient(['not json at all', validJson]);

  const service = new DemandSensingService({
    minimaxSearchApiKey: 'fake-key',
    deepseekClient: client as any,
    searchFn: async () => ({ text: '', sources: [] }),
  });

  const result = await service.scorePair('A', 'B', 'en');
  assert.equal(result.score, 7);
  assert.equal(calls.length, 2);
  // Retry prompt should be stricter
  const secondCallMessages = calls[1].messages;
  const lastMessage = secondCallMessages[secondCallMessages.length - 1].content;
  assert.match(lastMessage, /previous response was invalid|raw JSON object/i);
});

test('deepseek invalid JSON twice: throws DemandSensingError 502', async () => {
  const { client } = makeRetryDeepseekClient(['not json', 'still not json']);

  const service = new DemandSensingService({
    minimaxSearchApiKey: 'fake-key',
    deepseekClient: client as any,
    searchFn: async () => ({ text: '', sources: [] }),
  });

  await assert.rejects(
    () => service.scorePair('A', 'B', 'en'),
    (err: any) =>
      err.name === 'DemandSensingError' &&
      err.statusCode === 502 &&
      /DeepSeek/.test(err.message),
  );
});

test('deepseek missing required field (score): retries with stricter prompt', async () => {
  const missingScore = JSON.stringify({
    recommendation: 'good',
    signals: {
      existing_articles_count: 5, has_reddit_discussion: true,
      has_authoritative_source: false, competition_level: 'medium', freshness: 'recent',
    },
    reasoning: 'No score.',
  });
  const validJson = JSON.stringify({
    score: 7, recommendation: 'good',
    signals: {
      existing_articles_count: 5, has_reddit_discussion: true,
      has_authoritative_source: false, competition_level: 'medium', freshness: 'recent',
    },
    reasoning: 'Good signal.',
  });
  const { client, calls } = makeRetryDeepseekClient([missingScore, validJson]);

  const service = new DemandSensingService({
    minimaxSearchApiKey: 'fake-key',
    deepseekClient: client as any,
    searchFn: async () => ({ text: '', sources: [] }),
  });

  const result = await service.scorePair('A', 'B', 'en');
  assert.equal(result.score, 7);
  assert.equal(calls.length, 2);
});
```

- [ ] **Step 4.2: Run tests, verify failure**

Run: `npm test -- --test-name-pattern="deepseek invalid|deepseek missing"`

Expected: FAIL — current implementation has no retry, throws `SyntaxError` from `JSON.parse` on first invalid response.

- [ ] **Step 4.3: Add retry logic**

Replace the DeepSeek call block in `server/demandSensing.ts` (the section starting `const response = await this.deepseekClient...` through `const parsed = JSON.parse(content);` and through the existing `return { score: parsed.score, ... }`) with this expanded version:

```typescript
    const { scoring, totalTokens } = await this.callDeepseekWithRetry(prompt);

    const sourcePool = search1?.sources ?? search2?.sources ?? [];
    const topSources = dedupeByUrl(sourcePool).slice(0, 5).map((s) => ({
      url: s.url,
      title: s.title,
    }));

    return {
      score: scoring.score,
      recommendation: scoring.recommendation,
      signals: scoring.signals,
      reasoning: scoring.reasoning,
      topSources,
      partial,
      metrics: { durationMs: Date.now() - start, totalTokens },
    };
  }

  private async callDeepseekWithRetry(
    prompt: string,
  ): Promise<{ scoring: any; totalTokens: number }> {
    const messages: any[] = [{ role: 'user', content: prompt }];
    let totalTokens = 0;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.deepseekClient.chat.completions.create({
          model: this.deepseekModel,
          messages,
          temperature: 0.2,
          response_format: { type: 'json_object' },
        } as any);

        const content = (response as any).choices?.[0]?.message?.content || '';
        const usage = (response as any).usage || {};
        totalTokens += usage.total_tokens || 0;

        const scoring = JSON.parse(content);
        this.validateScoringResponse(scoring);
        return { scoring, totalTokens };
      } catch (err) {
        lastError = err as Error;
        if (attempt === 0) {
          messages.push(
            { role: 'assistant', content: '' },
            {
              role: 'user',
              content:
                'Your previous response was invalid (parse error or missing required fields). Respond with ONLY a raw JSON object containing: score, recommendation, signals{existing_articles_count, has_reddit_discussion, has_authoritative_source, competition_level, freshness}, reasoning. No markdown, no commentary.',
            },
          );
        }
      }
    }

    throw new DemandSensingError(
      `DeepSeek failed after retry: ${lastError?.message || 'unknown'}`,
      502,
    );
  }

  private validateScoringResponse(parsed: any): void {
    const required = ['score', 'recommendation', 'signals', 'reasoning'];
    const missing = required.filter((k) => parsed[k] === undefined || parsed[k] === null);
    if (missing.length) {
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }
    if (typeof parsed.score !== 'number') {
      throw new Error('score must be a number');
    }
    const signals = parsed.signals;
    const sigRequired = [
      'existing_articles_count',
      'has_reddit_discussion',
      'has_authoritative_source',
      'competition_level',
      'freshness',
    ];
    const sigMissing = sigRequired.filter((k) => signals[k] === undefined);
    if (sigMissing.length) {
      throw new Error(`Missing required signals: ${sigMissing.join(', ')}`);
    }
  }
}
```

(Note: the previous `scorePair` method body ends — keep the validation/setup/search part before this, replace only the DeepSeek call + result return + add the two new private methods.)

- [ ] **Step 4.4: Run tests, verify pass**

Run: `npm test`

Expected: all Cycle 1-3 tests + 3 new retry tests PASS.

- [ ] **Step 4.5: Commit**

```bash
git add server/demandSensing.ts tests/server/demandSensing.test.ts
git commit -m "$(cat <<'EOF'
feat(demand-sensing): DeepSeek JSON retry with schema validation

One retry on parse failure or missing required field, with stricter
follow-up prompt. Throws DemandSensingError(502) after two failed
attempts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Cycle 5 — Endpoint integration

**Files:**
- Modify: `server/app.ts` — Inject service, add endpoint
- Modify: `tests/server/app.test.ts` — Add endpoint tests

- [ ] **Step 5.1: Write failing endpoint tests**

Add to `tests/server/app.test.ts` (find the existing imports and `createTestApp` function — extend `createTestApp` to accept an optional `demandSensingService` override, then add 4 new tests at the end of the file):

First, modify `createTestApp` (around line 16-41 of `tests/server/app.test.ts`) to accept and pass a demand sensing service. Replace the function with:

```typescript
function createTestApp(overrides?: {
  demandSensingService?: { scorePair: (a: string, b: string, lang?: string) => Promise<any> };
}) {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'compareai-app-')), 'analytics.db');
  const analyticsStore = createAnalyticsStore(dbPath, 'test-secret');
  const reportStore = createReportStore(analyticsStore.getDb());
  const featuredStore = createFeaturedStore(analyticsStore.getDb());
  const app = createApp({
    analyticsStore,
    reportStore,
    featuredStore,
    adminPassword: 'admin-password',
    adminSessionSecret: 'session-secret',
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
    demandSensingService: overrides?.demandSensingService,
  });

  return { app, analyticsStore, reportStore, featuredStore };
}
```

Then add a new import line near the other imports at the top of `tests/server/app.test.ts` (after `import { createReportStore } from '../../server/reports';`):

```typescript
import { DemandSensingError } from '../../server/demandSensing';
```

And append these tests at the end of `tests/server/app.test.ts`:

```typescript
async function loginAsAdmin(baseUrl: string): Promise<string> {
  const resp = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'admin-password' }),
  });
  assert.equal(resp.status, 200);
  return extractCookie(resp.headers.get('set-cookie') || '', ADMIN_SESSION_COOKIE);
}

test('POST /api/admin/featured/preflight requires admin auth', async () => {
  const { app } = createTestApp();
  await withServer(app, async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/api/admin/featured/preflight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itemA: 'A', itemB: 'B', language: 'en' }),
    });
    assert.equal(resp.status, 401);
  });
});

test('POST /api/admin/featured/preflight: 200 with DemandSenseResult', async () => {
  const mockResult = {
    score: 8,
    recommendation: 'good',
    signals: {
      existing_articles_count: 5,
      has_reddit_discussion: true,
      has_authoritative_source: true,
      competition_level: 'medium',
      freshness: 'fresh',
    },
    reasoning: 'Strong demand.',
    topSources: [{ url: 'https://example.com', title: 'Test' }],
    partial: false,
    metrics: { durationMs: 1000, totalTokens: 200 },
  };
  const { app } = createTestApp({
    demandSensingService: { scorePair: async () => mockResult },
  });

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAsAdmin(baseUrl);
    const resp = await fetch(`${baseUrl}/api/admin/featured/preflight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ itemA: 'ChatGPT', itemB: 'Claude', language: 'en' }),
    });
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.score, 8);
    assert.equal(body.recommendation, 'good');
    assert.equal(body.signals.existing_articles_count, 5);
  });
});

test('POST /api/admin/featured/preflight: 400 when itemA missing', async () => {
  const { app } = createTestApp({
    demandSensingService: {
      scorePair: async () => {
        throw new DemandSensingError('itemA and itemB must be non-empty strings', 400);
      },
    },
  });

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAsAdmin(baseUrl);
    const resp = await fetch(`${baseUrl}/api/admin/featured/preflight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ itemB: 'Claude', language: 'en' }),
    });
    assert.equal(resp.status, 400);
  });
});

test('POST /api/admin/featured/preflight: 502 when service throws DemandSensingError(502)', async () => {
  const { app } = createTestApp({
    demandSensingService: {
      scorePair: async () => {
        throw new DemandSensingError('upstream failed', 502);
      },
    },
  });

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAsAdmin(baseUrl);
    const resp = await fetch(`${baseUrl}/api/admin/featured/preflight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ itemA: 'A', itemB: 'B', language: 'en' }),
    });
    assert.equal(resp.status, 502);
    const body = await resp.json();
    assert.match(body.error, /upstream failed/);
  });
});

test('POST /api/admin/featured/preflight: 503 when service not configured', async () => {
  const { app } = createTestApp();  // no demandSensingService
  await withServer(app, async (baseUrl) => {
    const cookie = await loginAsAdmin(baseUrl);
    const resp = await fetch(`${baseUrl}/api/admin/featured/preflight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ itemA: 'A', itemB: 'B', language: 'en' }),
    });
    assert.equal(resp.status, 503);
  });
});
```

- [ ] **Step 5.2: Run tests, verify failure**

Run: `npm test -- --test-name-pattern="preflight"`

Expected: All 5 preflight tests FAIL — endpoint and service injection don't exist yet.

- [ ] **Step 5.3: Modify `createApp` signature and add endpoint**

In `server/app.ts`, find the `createApp` function signature and its options type. Add `demandSensingService` as an optional dependency.

Step 5.3a — Add import at the top of `server/app.ts`:

```typescript
import { DemandSensingError, type DemandSensingService } from './demandSensing';
```

Step 5.3b — In `server/app.ts`, find the `type CreateAppOptions = { ... }` block (currently lines 43-51). Add a property:

```typescript
type CreateAppOptions = {
  analyticsStore: AnalyticsStore;
  reportStore: ReportStore;
  featuredStore: FeaturedStore;
  provider: AIProvider;
  demandSensingService?: Pick<DemandSensingService, 'scorePair'>;
  adminPassword?: string;
  adminSessionSecret: string;
  siteUrl?: string;
};
```

(Using `Pick` so test mocks don't need to construct a full service.)

Step 5.3c — In the `createApp({...})` destructuring signature (currently lines 81-89), add the new parameter:

```typescript
export function createApp({
  analyticsStore,
  reportStore,
  featuredStore,
  provider,
  demandSensingService,
  adminPassword,
  adminSessionSecret,
  siteUrl = process.env.SITE_URL || process.env.APP_URL,
}: CreateAppOptions) {
```

Step 5.3d — Add the new endpoint **after the existing `app.patch('/api/admin/featured/:id', ...)` handler** (around line 538):

```typescript
  app.post('/api/admin/featured/preflight', async (req, res) => {
    if (!demandSensingService) {
      res.status(503).json({ error: 'Demand sensing service is not configured' });
      return;
    }

    const { itemA, itemB, language } = req.body || {};

    try {
      const result = await demandSensingService.scorePair(itemA, itemB, language);
      res.json(result);
    } catch (err) {
      if (err instanceof DemandSensingError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Preflight unexpected error:', err);
      res.status(502).json({ error: 'Demand sensing failed' });
    }
  });
```

- [ ] **Step 5.4: Run tests, verify pass**

Run: `npm test`

Expected: all earlier tests + 5 new preflight tests PASS.

- [ ] **Step 5.5: Commit**

```bash
git add server/app.ts tests/server/app.test.ts
git commit -m "$(cat <<'EOF'
feat(server): POST /api/admin/featured/preflight endpoint

Admin-only endpoint that runs demand sensing for a candidate pair
before commit to featured. 503 when service unconfigured, 400/502
for service errors, 200 with DemandSenseResult on success.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Cycle 6 — Wire production deps + real API tests

**Files:**
- Modify: `server/providers/minimax.ts` — Export `callMinimaxSearch`
- Modify: `server/demandSensing.ts` — Default searchFn to `callMinimaxSearch`
- Modify: `server/index.ts` — Instantiate `DemandSensingService`
- Modify: `package.json` — Add `test:real` script + dotenv to devDependencies if not present
- Create: `tests/server/demandSensing.real.test.ts`

- [ ] **Step 6.1: Export `callMinimaxSearch` from `server/providers/minimax.ts`**

In `server/providers/minimax.ts`, change the function declaration on around line 37 from:

```typescript
async function callMinimaxSearch(
```

to:

```typescript
export async function callMinimaxSearch(
```

- [ ] **Step 6.2: Default `searchFn` in `DemandSensingService`**

In `server/demandSensing.ts`, replace the import at the top with:

```typescript
import type OpenAI from 'openai';
import type { Source } from './providers/types';
import { callMinimaxSearch } from './providers/minimax';
```

And replace the constructor in `DemandSensingService`:

```typescript
  constructor(deps: DemandSensingDependencies) {
    this.searchFn = deps.searchFn ?? callMinimaxSearch;
    this.deepseekClient = deps.deepseekClient;
    this.deepseekModel = deps.deepseekModel || 'deepseek-v4-flash';
    this.minimaxSearchApiKey = deps.minimaxSearchApiKey;
    this.minimaxSearchBaseUrl = deps.minimaxSearchBaseUrl;
  }
```

(Removes the `throw if !searchFn` guard from Task 1.)

- [ ] **Step 6.3: Wire into `server/index.ts`**

Add this block to `server/index.ts` after the existing client definitions (after `deepseekClient` is defined, before `createProvider` is called). Find the existing line `const provider = createProvider(...)` and add **before** it:

```typescript
import { DemandSensingService } from './demandSensing';
```
(at the top with other imports)

Then after the env-derived clients but before `createApp`:

```typescript
const demandSensingService = deepseekClient && process.env.MINIMAX_API_KEY
  ? new DemandSensingService({
      minimaxSearchApiKey: process.env.MINIMAX_API_KEY,
      minimaxSearchBaseUrl: minimaxBaseUrl.replace('/v1', ''),
      deepseekClient,
      deepseekModel: process.env.DEEPSEEK_MODEL,
    })
  : undefined;
```

And update the `createApp({...})` call to include it:

```typescript
const app = createApp({
  analyticsStore,
  reportStore,
  featuredStore,
  provider,
  demandSensingService,
  adminPassword: process.env.ADMIN_PASSWORD,
  adminSessionSecret,
  siteUrl: process.env.SITE_URL || process.env.APP_URL,
});
```

- [ ] **Step 6.4: Add `test:real` script to `package.json`**

In `package.json`, modify the `scripts` section. Replace:

```json
    "test": "tsx --test",
```

with:

```json
    "test": "tsx --test tests/server/*.test.ts",
    "test:real": "RUN_REAL_API_TESTS=1 tsx --test tests/server/demandSensing.real.test.ts",
```

(The change in `test` to be explicit about path makes sure the test discovery is predictable.)

- [ ] **Step 6.5: Verify lint passes after wiring changes**

Run: `npm run lint`

Expected: PASS — no TS errors.

If `npm run lint` errors with `'demandSensingService' is declared but its value is never read` or similar, double-check that Step 6.3 actually passes the value into `createApp`.

- [ ] **Step 6.6: Verify unit tests still pass**

Run: `npm test`

Expected: all tests from Tasks 1-5 PASS.

- [ ] **Step 6.7: Create real API test file**

Create `tests/server/demandSensing.real.test.ts`:

```typescript
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
  // Heuristic: contains at least one CJK char
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

test('real API: response parses on first attempt (no retry needed)', { skip: SKIP_REASON }, async () => {
  const service = makeRealService();
  // No retry assertion possible without internal hook — proxy: assert duration < ~20s for single-call latency
  const result = await service.scorePair('Notion', 'Obsidian', 'en');

  console.log('  → duration:', result.metrics.durationMs, 'tokens:', result.metrics.totalTokens);
  assert.ok(result.metrics.durationMs < 20_000, `First-attempt duration ${result.metrics.durationMs}ms`);
  assert.ok(result.topSources.length >= 1, 'Expected at least 1 topSource');
});
```

- [ ] **Step 6.8: Verify unit tests still skip real tests**

Run: `npm test`

Expected: all Task 1-5 tests pass. The 4 real-API tests show as `# skipped` in output with the reason `set RUN_REAL_API_TESTS=1 to enable`.

- [ ] **Step 6.9: Run real API tests**

Confirm `.env.local` has valid `MINIMAX_API_KEY`, `DEEPSEEK_API_KEY`, `MINIMAX_BASE_URL`, `DEEPSEEK_MODEL`.

Run: `npm run test:real`

Expected: 4 tests run, each takes ~5-15 seconds. All PASS. Console output shows real score, reasoning, sources.

If a test fails with assertion on score thresholds: read the actual score in output — the DeepSeek model may judge differently than expected. Verify the reasoning is sensible. If the score is wrong, **don't lower the threshold blindly** — investigate whether prompt needs to be sharpened (and update tests + spec together).

If `dotenv` is not in devDependencies and import fails: `npm install --save-dev dotenv` (it's already in dependencies per package.json — should work).

- [ ] **Step 6.10: Commit**

```bash
git add server/providers/minimax.ts server/demandSensing.ts server/index.ts tests/server/demandSensing.real.test.ts package.json
git commit -m "$(cat <<'EOF'
feat(demand-sensing): wire production deps + real API test suite

Export callMinimaxSearch from minimax provider so DemandSensingService
defaults to it. Instantiate service in index.ts when DEEPSEEK and
MINIMAX keys present. Add npm run test:real (gated by
RUN_REAL_API_TESTS=1) covering hot pair, language switching, and
obscure pair scoring against live APIs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Cycle 7 — Admin UI

**Files:**
- Modify: `src/admin/types.ts` — Add `DemandSenseResult` types
- Modify: `src/admin/adminApi.ts` — Add `preflightFeatured()`
- Modify: `src/admin/AdminApp.tsx` — Add Check Demand button + result panel

No new tests this cycle (no frontend test framework). Smoke testing is the final step.

- [ ] **Step 7.1: Add types**

Add to the end of `src/admin/types.ts`:

```typescript
export type DemandSenseSignals = {
  existing_articles_count: number;
  has_reddit_discussion: boolean;
  has_authoritative_source: boolean;
  competition_level: 'low' | 'medium' | 'high';
  freshness: 'stale' | 'recent' | 'fresh';
};

export type DemandSenseResult = {
  score: number;
  recommendation: 'skip' | 'consider' | 'good' | 'excellent';
  signals: DemandSenseSignals;
  reasoning: string;
  topSources: Array<{ url: string; title: string }>;
  partial: boolean;
  metrics: { durationMs: number; totalTokens: number };
};
```

- [ ] **Step 7.2: Add API client**

In `src/admin/adminApi.ts`, add this import to the existing type import block at the top:

```typescript
import type {
  AdminSummary,
  CallListItem,
  DemandSenseResult,
  FeaturedComparison,
  ListResponse,
  ReportListItem,
  RunListItem,
  UserListItem,
} from './types';
```

Then append at the bottom of the file:

```typescript
export function preflightFeatured(itemA: string, itemB: string, language: string) {
  return request<DemandSenseResult>('/featured/preflight', {
    method: 'POST',
    body: JSON.stringify({ itemA, itemB, language }),
  });
}
```

- [ ] **Step 7.3: Add Check Demand UI to `AdminApp.tsx`**

In `src/admin/AdminApp.tsx`:

Step 7.3a — Add `preflightFeatured` to the existing import from `./adminApi` (line ~33-47):

```typescript
import {
  getAdminCalls,
  getAdminFeatured,
  getAdminReports,
  getAdminRuns,
  getAdminSession,
  getAdminSummary,
  getAdminUsers,
  loginAdmin,
  logoutAdmin,
  deleteAdminReport,
  addAdminFeatured,
  deleteAdminFeatured,
  patchAdminFeatured,
  backfillSources,
  preflightFeatured,
} from './adminApi';
```

Step 7.3b — Add the `DemandSenseResult` type to the existing imports from `./types`:

```typescript
import type {
  AdminSummary,
  CallListItem,
  DemandSenseResult,
  FeaturedComparison,
  ReportListItem,
  RunListItem,
  UserListItem,
} from './types';
```

Step 7.3c — Add an icon import. Find the existing `lucide-react` import block (line ~2-20) and add `Activity` is already there; we need `Gauge` (or use existing `Activity`). Add `Gauge` to the imports:

```typescript
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Check,
  Clock3,
  Database,
  Eye,
  FileText,
  Gauge,
  GitCompareArrows,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
```

Step 7.3d — Add state variables. Find the existing block with `useState('')` calls for `newItemA`/`newItemB`/`newLang`/`newDesc` (line 358-361) and add after them:

```typescript
  type PreflightState =
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'success'; result: DemandSenseResult }
    | { kind: 'error'; message: string };
  const [preflightState, setPreflightState] = useState<PreflightState>({ kind: 'idle' });
```

Step 7.3e — Add the handler. Place this **above** the existing `handleAddFeatured` (line ~455):

```typescript
  const handleCheckDemand = async () => {
    if (!newItemA.trim() || !newItemB.trim()) return;
    setPreflightState({ kind: 'loading' });
    try {
      const result = await preflightFeatured(newItemA.trim(), newItemB.trim(), newLang);
      setPreflightState({ kind: 'success', result });
    } catch (err: any) {
      setPreflightState({
        kind: 'error',
        message: err.message || 'Demand check failed',
      });
    }
  };
```

Step 7.3f — Reset preflight state when admin successfully adds a featured item. In `handleAddFeatured` (line ~455-474), after `setNewDesc('');` add:

```typescript
      setPreflightState({ kind: 'idle' });
```

Step 7.3g — Add the UI. Find the existing Add Featured `<form>` (around line 725-770). Replace the entire form block (`<form onSubmit={handleAddFeatured} ...>` through `</form>`) with:

```typescript
              <form onSubmit={handleAddFeatured} className="mb-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newItemA}
                    onChange={(e) => setNewItemA(e.target.value)}
                    placeholder="Item A"
                    className="h-9 flex-1 rounded-lg border border-white/10 bg-neutral-900 px-3 text-sm text-white outline-none focus:border-indigo-400"
                    required
                  />
                  <span className="text-xs text-neutral-500 font-mono">vs</span>
                  <input
                    type="text"
                    value={newItemB}
                    onChange={(e) => setNewItemB(e.target.value)}
                    placeholder="Item B"
                    className="h-9 flex-1 rounded-lg border border-white/10 bg-neutral-900 px-3 text-sm text-white outline-none focus:border-indigo-400"
                    required
                  />
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={newLang}
                    onChange={(e) => setNewLang(e.target.value)}
                    className="h-9 rounded-lg border border-white/10 bg-neutral-900 px-3 text-sm text-white outline-none focus:border-indigo-400"
                  >
                    <option value="en">EN</option>
                    <option value="zh-CN">简体</option>
                    <option value="zh-TW">繁体</option>
                  </select>
                  <input
                    type="text"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="Short description (optional)"
                    className="h-9 flex-1 rounded-lg border border-white/10 bg-neutral-900 px-3 text-sm text-white outline-none focus:border-indigo-400"
                  />
                  <button
                    type="button"
                    onClick={handleCheckDemand}
                    disabled={preflightState.kind === 'loading' || !newItemA.trim() || !newItemB.trim()}
                    className="flex h-9 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 text-sm font-medium text-neutral-200 transition hover:bg-white/10 disabled:opacity-50"
                  >
                    {preflightState.kind === 'loading' ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Gauge size={14} />
                    )}
                    Check Demand
                  </button>
                  <button
                    type="submit"
                    className="flex h-9 items-center gap-1 rounded-lg bg-indigo-600 px-3 text-sm font-medium text-white transition hover:bg-indigo-500"
                  >
                    <Plus size={14} />
                    Add
                  </button>
                </div>
                {preflightState.kind === 'error' && (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
                    {preflightState.message}
                  </div>
                )}
                {preflightState.kind === 'success' && (
                  <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-xs text-neutral-300">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-md px-2 py-0.5 font-mono text-sm font-semibold ${
                            preflightState.result.score >= 8
                              ? 'bg-green-500/20 text-green-300'
                              : preflightState.result.score >= 6
                              ? 'bg-indigo-500/20 text-indigo-300'
                              : preflightState.result.score >= 4
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'bg-red-500/20 text-red-300'
                          }`}
                        >
                          {preflightState.result.score.toFixed(1)}/10
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-neutral-500">
                          {preflightState.result.recommendation}
                        </span>
                        {preflightState.result.partial && (
                          <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                            partial signal
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-neutral-500">
                        {preflightState.result.metrics.durationMs}ms · {preflightState.result.metrics.totalTokens} tok
                      </span>
                    </div>
                    <p className="mb-2 text-neutral-400">{preflightState.result.reasoning}</p>
                    <ul className="mb-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
                      <li>Articles: <span className="text-neutral-300">{preflightState.result.signals.existing_articles_count}</span></li>
                      <li>Reddit: <span className="text-neutral-300">{preflightState.result.signals.has_reddit_discussion ? 'yes' : 'no'}</span></li>
                      <li>Authoritative: <span className="text-neutral-300">{preflightState.result.signals.has_authoritative_source ? 'yes' : 'no'}</span></li>
                      <li>Competition: <span className="text-neutral-300">{preflightState.result.signals.competition_level}</span></li>
                      <li>Freshness: <span className="text-neutral-300">{preflightState.result.signals.freshness}</span></li>
                    </ul>
                    {preflightState.result.topSources.length > 0 && (
                      <div>
                        <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">Top existing articles</div>
                        <ul className="space-y-0.5 text-[11px]">
                          {preflightState.result.topSources.map((s) => (
                            <li key={s.url} className="truncate">
                              <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-indigo-300 hover:underline">
                                {s.title || s.url}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </form>
```

- [ ] **Step 7.4: TypeScript lint check**

Run: `npm run lint`

Expected: PASS — no TS errors. If the new icon `Gauge` errors, ensure it's exported by `lucide-react` (it is — version 0.546.0 has it).

- [ ] **Step 7.5: Smoke test manually**

Run dev server:

```bash
npm run dev
```

In a browser:
1. Navigate to `http://localhost:3000/admin`
2. Log in with the admin password
3. Go to the Featured Comparisons section
4. Type `ChatGPT` and `Claude` into Item A / Item B
5. Click `Check Demand`
6. Wait ~5-10 seconds

Expected:
- Loading spinner appears on the Check Demand button
- Result panel renders with a score (likely 7-9), recommendation, signals, reasoning, and top 3-5 source links
- Click a source link — opens in new tab
- Click `Add` — featured row is created, preflight panel disappears

Try once more with an obscure pair (e.g., `FooBarTest1 vs QuuxBaz2`) and confirm the score is low (≤ 4) with red color.

If everything works, proceed to commit. If the UI renders broken or the endpoint 404s/500s, investigate via browser devtools network tab + server console.

- [ ] **Step 7.6: Commit**

```bash
git add src/admin/types.ts src/admin/adminApi.ts src/admin/AdminApp.tsx
git commit -m "$(cat <<'EOF'
feat(admin): Check Demand UI for featured candidate pairs

Add [Check Demand] button next to Add in the Featured form. Renders
score (colored by tier), recommendation, signals, reasoning, and top
existing articles. Advisory only — Add button is always enabled.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Checklist (run after writing the plan)

Spec coverage:
- [x] DemandSensingService with happy path → Task 1
- [x] Input validation (empty, identical, truncate) → Task 2
- [x] Partial degradation (one search fail, both fail, prompt notation) → Task 3
- [x] DeepSeek retry on invalid JSON + missing fields → Task 4
- [x] POST /api/admin/featured/preflight endpoint with auth + status codes → Task 5
- [x] Production wiring in index.ts + callMinimaxSearch export → Task 6
- [x] Real API tests (hot pair en/zh, obscure pair) → Task 6
- [x] Admin UI Check Demand button + result panel → Task 7
- [x] Advisory-only (Add button always enabled) → Task 7
- [x] Smoke test → Task 7

Items intentionally deferred (out of scope per spec):
- [ ] `aiUsage` table logging — endpoint logs to console; persistent logging not required for v1
- [ ] AbortController total-30s timeout — relies on per-call timeouts (fetch defaults + DeepSeek's own); explicit master timeout deferred
- [ ] Frontend test framework — human smoke test only (per spec)

## Out of scope reminders (from spec, repeated here)

- No batch mode
- No caching
- No hard gate (UI must not disable Add based on score)
- No auto-promotion
- No new signals (Wikipedia/Autocomplete/Reddit-direct) — stays at DeepSeek + MiniMax
- No multi-language search queries (always English)
- No changes to Phase 1-4 pipeline

## Execution

After plan approval, two execution paths:

**1. Subagent-Driven (recommended)** — fresh subagent per Task (Cycle), I review between tasks, fast iteration. Each cycle's red/green/commit happens in one subagent invocation.

**2. Inline Execution** — execute all 7 tasks in this session, batched with checkpoints. Slower because each red/green confirmation involves you in the loop, but you wanted "每個紅綠 cycle都需要測試" — this is closer to that.

Given the user requirement of confirming each red/green cycle, **Inline Execution with executing-plans** is the more faithful match.
