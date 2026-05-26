# Phase 0 Demand Sensing Design

**Date**: 2026-05-26
**Status**: Approved, ready for implementation plan

## Problem

Admin currently adds entries to `featured_comparisons` with no demand validation. Featured pages drive sitemap, llms.txt, homepage links, and related links — they are the SEO/GEO surface area of the site. Adding low-demand or low-quality pairs:

- Wastes the comparison pipeline cost (4-phase Grok pipeline runs even for hopeless pairs)
- Dilutes domain quality signal (Google "scaled content abuse" risk past ~5k thin pages)
- Misses GEO citation opportunities (high-demand pairs not prioritized)

**Goal**: Give admin a fast, in-product signal of search/GEO demand for a candidate `(itemA, itemB)` pair before committing it to featured.

## Approach: DeepSeek + MiniMax dual-search pipeline

Run two parallel MiniMax web searches (general SERP + Reddit), pass results to DeepSeek for structured scoring. Admin sees `score 0-10 + signals + topSources` and decides whether to add. No hard gate.

### Why this approach (vs alternatives)
- **A. Single search + DeepSeek**: cheaper but signal too narrow
- **B. Dual search + DeepSeek (CHOSEN)**: best cost/signal ratio (~$0.01-0.02/candidate, ~4-6s latency)
- **C. Reuse `MinimaxProvider.research()` full pipeline**: 5-10x cost for 1.5-2x signal — wasteful

### Decisions locked
- **Trigger**: admin-only, on demand (`[Check Demand]` button before `[Add to Featured]`)
- **Gate behavior**: advisory only — score + signals displayed, admin decides. No hard gate. Failed preflight does not block `[Add to Featured]`.
- **Search query**: always English, even for non-English `language` (Chinese SERP "vs" signal is weak)
- **Reasoning language**: matches `language` param
- **No DB writes, no cache**: each preflight is fresh
- **No frontend test framework added**: backend tests cover correctness; UI is human-verified

## Architecture

```
Admin UI                              Backend                          External
─────────────────────────────────────────────────────────────────────────────
[Check Demand]
   │ POST /api/admin/featured/preflight
   ├──────────────────────────────►
                                    DemandSensingService.scorePair()
                                       │
                                       ├─ Promise.allSettled([
                                       │    callMinimaxSearch("A vs B"),       ──► MiniMax /v1/coding_plan/search
                                       │    callMinimaxSearch("A vs B reddit") ──► MiniMax /v1/coding_plan/search
                                       │  ])
                                       │
                                       ├─ Build prompt with both search blocks
                                       │
                                       ├─ deepseekClient.chat.completions       ──► DeepSeek API
                                       │  (response_format: json_object,             (deepseek-v4-flash)
                                       │   1 retry on parse fail)
                                       │
                                       └─ Return DemandSenseResult
   ◄──────────────────────────────
Render score badge + signals + topSources

[Add to Featured]
   │ POST /api/admin/featured  ← unchanged
   ├──────────────────────────────►
                                    featuredStore.addFeatured()
   ◄──────────────────────────────
```

### Why two endpoints
- `preflight` = pure evaluation, no side effects, retryable
- `featured` = actual write (unchanged)
- Separation enables future batch mode without restructuring

## Components

### New: `server/demandSensing.ts`

```typescript
export type DemandSenseSignals = {
  existing_articles_count: number;
  has_reddit_discussion: boolean;
  has_authoritative_source: boolean;
  competition_level: 'low' | 'medium' | 'high';
  freshness: 'stale' | 'recent' | 'fresh';
};

export type DemandSenseResult = {
  score: number;                              // 0-10
  recommendation: 'skip' | 'consider' | 'good' | 'excellent';
  signals: DemandSenseSignals;
  reasoning: string;                          // 1-2 sentences in {language}
  topSources: Array<{ url: string; title: string }>;
  partial: boolean;                           // true if one search failed
  metrics: { durationMs: number; totalTokens: number };
};

export type DemandSensingDependencies = {
  minimaxSearchApiKey: string;
  minimaxSearchBaseUrl?: string;
  deepseekClient: OpenAI;
  deepseekModel?: string;
  searchFn?: MinimaxSearchFn;  // optional override for tests
};

export class DemandSensingError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
  }
}

export class DemandSensingService {
  constructor(private deps: DemandSensingDependencies) {}

  async scorePair(
    itemA: string,
    itemB: string,
    language?: string
  ): Promise<DemandSenseResult>;
}
```

### New: `server/demandSensing.test.ts`, `server/demandSensing.real.test.ts`

See Testing section.

### Changed: `server/app.ts`

Add `POST /api/admin/featured/preflight` (under existing `requireAdmin` middleware):

```typescript
app.post('/api/admin/featured/preflight', async (req, res) => {
  const { itemA, itemB, language } = req.body || {};
  try {
    const result = await demandSensingService.scorePair(itemA, itemB, language);
    res.json(result);
  } catch (err) {
    if (err instanceof DemandSensingError) {
      res.status(err.statusCode).json({ error: err.message });
    } else {
      res.status(502).json({ error: 'Demand sensing failed' });
    }
  }
});
```

### Changed: `server/index.ts`

Instantiate `DemandSensingService` reusing existing `deepseekClient` + `minimaxSearchApiKey` + `minimaxBaseUrl` from `.env.local`. Pass to `createApp()`.

### Changed: `src/admin/adminApi.ts`

```typescript
export function preflightFeatured(
  itemA: string,
  itemB: string,
  language: string
): Promise<DemandSenseResult>;
```

### Changed: `src/admin/AdminApp.tsx`

In the existing "Add Featured" form, add:
- `[Check Demand]` button (non-required action)
- Result panel below form (score badge, signals list, topSources list, reasoning)
- Partial warning banner if `partial: true`
- Three UI states: idle / loading / success / rate_limited / error

`[Add to Featured]` button remains enabled in all states (advisory-only design).

### Changed: `src/admin/types.ts`

Export `DemandSenseResult` and `DemandSenseSignals` types (mirror backend).

### Unchanged
- `MinimaxProvider`
- `createProvider()`
- Phase 1-4 pipeline (`runResearcherAgent` etc.)
- `featuredStore` and `/api/admin/featured` POST endpoint

## Data flow

### MiniMax search blocks → DeepSeek prompt

Each search returns top-N organic results, formatted as:

```
=== Search 1: "ChatGPT vs Claude" ===
[1] OpenAI ChatGPT vs Anthropic Claude: Which AI is...
    https://example.com/...
    OpenAI's ChatGPT and Anthropic's Claude are two...

[2] ...

=== Search 2: "ChatGPT vs Claude reddit" ===
[1] r/ChatGPT - "Switched from ChatGPT to Claude, here's my take"
    https://reddit.com/r/ChatGPT/...
    ...
```

### DeepSeek scoring prompt

```
You are a SEO/GEO demand analyst. Given search results for the pair
"{itemA} vs {itemB}", judge whether this comparison has real demand
for a comparison website.

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

Reasoning: 1-2 sentences in {language} explaining the score.

Output JSON only matching this schema (fields: score, recommendation, signals{...}, reasoning). No markdown. Service computes topSources/partial/metrics separately and merges into final result.

Search results:
{combined_results}
```

### topSources extraction

Service computes topSources independently from DeepSeek (DeepSeek schema covers only `score / signals / recommendation / reasoning`; `topSources / partial / metrics` are assembled by the service).

Preference order:
1. If search1 succeeded → use search1 results
2. Else if search2 succeeded → use search2 results
3. Else → empty array (never reached: both-fail throws 502)

```typescript
const sourcePool = search1?.sources ?? search2?.sources ?? [];
const topSources = dedupeByUrl(sourcePool)
  .slice(0, 5)
  .map(s => ({ url: s.url, title: s.title }));
```

Display purpose: admin sees "here are the existing comparison articles" — qualitative signal of competition.

### No persistence
- Preflight results never written to DB
- AI usage tracked via existing `aiUsage` table with `agent: 'demand_sensing'`, `provider: 'deepseek'`

## Error handling

### Failure matrix

| Failure | Handling | HTTP |
|---|---|---|
| Input: empty/non-string itemA or itemB | reject | 400 |
| Input: both strings > 200 chars | truncate to 200, continue | 200 |
| Input: itemA === itemB (trim+lowercase) | reject | 400 |
| MiniMax: both searches fail | fail | 502 |
| MiniMax: one search fails | continue with the other, `partial: true` | 200 |
| MiniMax: 429 rate limit | pass through | 429 |
| MiniMax: timeout (>15s per search) | treat as failure, apply above rules | 502/200 |
| DeepSeek: 5xx or network error | 1 retry, then fail | 502 |
| DeepSeek: invalid JSON | 1 retry with stricter prompt, then fail | 502 |
| DeepSeek: schema validation fail | same as invalid JSON | 502 |
| Total request timeout (>30s) | service-level `AbortController` wraps the entire `scorePair()` | 504 |
| Unhandled error | catch + log + generic 502 | 502 |

### Partial degradation

When one search succeeds and the other fails:
- Response includes `partial: true`
- DeepSeek prompt notes the missing search block as `(search unavailable)`
- DeepSeek instructed to give a confident score from available signal, with reasoning noting the limitation
- Admin UI displays warning banner

### Frontend UX states

```typescript
type PreflightUiState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success', result: DemandSenseResult, partial: boolean }
  | { kind: 'rate_limited' }
  | { kind: 'error', message: string };
```

In all states, `[Add to Featured]` remains enabled — preflight is advisory.

### Logging

- Success: log `{ pair, score, durationMs, totalTokens, partial }` to `aiUsage` table
- Failure: log to console + `aiUsage` with `error_message`
- Not logged: full search results, full DeepSeek prompt (size, possible PII)

## Testing

Four layers. Real API tests are required (user-mandated).

### Layer 1: Unit tests (mocked) — `tests/server/demandSensing.test.ts`

| Test | Asserts |
|---|---|
| Happy path | score / signals / topSources correct, `partial: false` |
| Partial: search1 fails | `partial: true`, prompt contains "(search unavailable)", score still computed |
| Partial: search2 fails | symmetric |
| Both searches fail | throws `DemandSensingError(502)` |
| DeepSeek invalid JSON, retry succeeds | retry triggers, returns valid result |
| DeepSeek invalid JSON, retry fails | throws `DemandSensingError(502)` |
| DeepSeek missing required field | same handling as invalid JSON |
| DeepSeek 429 | throws with status 429 |
| Input: empty itemA | throws (400) |
| Input: itemA === itemB | throws (400) |
| Input: > 200 chars | truncated, succeeds |
| topSources deduplication | duplicate URLs merged, top 5 kept |

Mock: inject `searchFn` and mock `OpenAI` client via `DemandSensingDependencies`.

### Layer 2: Endpoint integration tests (mocked) — extend `tests/server/app.test.ts`

| Test | Asserts |
|---|---|
| POST /preflight without admin cookie | 401 |
| POST /preflight with valid input | 200, returns `DemandSenseResult` shape |
| POST /preflight missing itemA | 400 |
| POST /preflight when service throws 502 | 502 pass-through |

Uses existing `providers.test.ts` mock pattern.

### Layer 3: Real API tests — `tests/server/demandSensing.real.test.ts`

Reads `.env.local`. Gated by separate npm script:

```json
"scripts": {
  "test": "tsx --test tests/server/*.test.ts",
  "test:real": "tsx --test tests/server/*.real.test.ts"
}
```

| Test | Asserts |
|---|---|
| Hot pair: `"ChatGPT" vs "Claude"` (en) | score ≥ 6, articles > 0, reddit=true, duration < 30s |
| Hot pair (Chinese): `"ChatGPT" vs "Claude"` (zh-Hans) | score ≥ 6, reasoning is Chinese |
| Obscure pair: `"FooBarXYZ_AI_v1" vs "QuuxQux_v2_test_only"` | score ≤ 4, articles low, recommendation in ['skip', 'consider'] |
| Real JSON parse | DeepSeek response parses without retry |
| Real sources | topSources returns ≥ 3 valid URLs |

Why real tests are required: mock tests can't verify the real DeepSeek model produces parseable JSON matching the schema, or that real MiniMax SERP signals support the rubric.

### Layer 4: Human smoke test
After all TDD cycles, run dev server, admin login, click `[Check Demand]` on a real pair, verify UI renders correctly.

## TDD execution plan

Every red-green cycle has 4 checkpoints awaiting user `ok`:

```
Cycle 1: Happy path (unit, mocked)
  Step 1.1: Write failing test → user ok
  Step 1.2: Run test, show failure output → user ok
  Step 1.3: Write minimum implementation → user ok
  Step 1.4: Run test, show success output → user ok

Cycle 2: Input validation
Cycle 3: Partial degradation
Cycle 4: DeepSeek retry
Cycle 5: Endpoint integration
Cycle 6: Real API tests (uses .env.local)
Cycle 7: Admin UI
```

Total: ~7 cycles × 4 checkpoints ≈ 28 confirmation points.

## Out of scope (explicitly)

- Frontend test framework (vitest/RTL)
- Caching preflight results
- Batch mode (preflight 100 pairs at once)
- Auto-promotion (score ≥ 8 auto-add to featured)
- Google Autocomplete / Wikipedia pageviews signals (kept to DeepSeek + MiniMax only)
- Multi-language search queries (search stays English)
- Hard gating (admin can always proceed regardless of score)
- Modifying existing Phase 1-4 pipeline

## Files touched

| File | Change |
|---|---|
| `server/demandSensing.ts` | NEW — service class |
| `server/demandSensing.test.ts` | NEW — unit tests |
| `server/demandSensing.real.test.ts` | NEW — real API tests |
| `server/app.ts` | ADD `POST /api/admin/featured/preflight` |
| `server/index.ts` | ADD service instantiation |
| `src/admin/adminApi.ts` | ADD `preflightFeatured()` |
| `src/admin/AdminApp.tsx` | ADD Check Demand UI in featured form |
| `src/admin/types.ts` | ADD `DemandSenseResult` / `DemandSenseSignals` |
| `tests/server/app.test.ts` | ADD endpoint test cases |
| `package.json` | ADD `test:real` script |
