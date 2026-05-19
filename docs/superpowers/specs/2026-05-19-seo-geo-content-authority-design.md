# SEO/GEO Content Authority — Design Spec

> **Goal**: Make comparison reports discoverable and citable by Google, Perplexity, ChatGPT Search, and other AI search engines by adding source citations, editorial signals, and unique user data.
>
> **Current Problem**: Google rank ~70, zero AI search citations. Technical SEO is solid (SSR, JSON-LD, robots.txt, llms.txt) but content lacks external references, author attribution, and unique value that AI cannot self-generate.

---

## Scope

| Priority | Feature | Impact |
|----------|---------|--------|
| P0 | Per-dimension source citations in reports | External links + verifiable claims |
| P0 | /methodology page | E-E-A-T Expertise signal |
| P1 | /about page + author attribution | E-E-A-T Trust signal |
| P1 | JSON-LD author + byline in SSR | Structured authority signal |
| P2 | "Was this helpful?" feedback system | Unique user data (AI can't generate) |
| P2 | Batch backfill sources for existing reports | Retroactive citation coverage |

---

## 1. Data Model — `ComparisonResult` Extension

### New types

```typescript
interface Source {
  url: string;
  title: string;
  snippet?: string;
}
```

### ComparisonResult changes

```typescript
export interface ComparisonResult {
  // ... all existing fields unchanged ...

  // NEW: report-level sources collected during research phase
  sources?: Source[];
}
```

### AnalysisResult changes (per-dimension)

```typescript
interface AnalysisResult {
  item_a_summary: string;
  item_b_summary: string;
  key_difference: string;
  better_for: string;
  optional_score_a: number;
  optional_score_b: number;
  // NEW: 1-2 sources that support this dimension's analysis
  citations?: Array<{ url: string; title: string }>;
}
```

Both `sources` and `citations` are optional for backward compatibility with existing reports.

---

## 2. Source Capture — MiniMax Provider

### 2a. `callMinimaxSearch()` returns structured sources

**File**: `server/providers/minimax.ts`

Current signature: `callMinimaxSearch(apiKey, query, baseUrl): Promise<string>`

New signature: `callMinimaxSearch(apiKey, query, baseUrl): Promise<{ text: string; sources: Source[] }>`

```typescript
async function callMinimaxSearch(apiKey, query, baseUrl): Promise<{ text: string; sources: Source[] }> {
  // ... existing fetch logic unchanged ...
  const results = data.organic || data.results || [];

  const sources = results.map(r => ({
    url: r.link || r.url,
    title: r.title,
    snippet: r.snippet || '',
  }));

  const text = results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.link || r.url}\n${r.snippet || ''}`)
    .join('\n\n');

  return { text, sources };
}
```

### 2b. `research()` collects and deduplicates sources

**File**: `server/providers/minimax.ts`

Current return: `{ text: string; metrics: AiCallMetrics }`

New return: `{ text: string; sources: Source[]; metrics: AiCallMetrics }`

- Collect sources from all parallel search calls
- Deduplicate by URL (keep first occurrence)
- Return alongside synthesized text

### 2c. `AIProvider` interface

**File**: `server/providers/types.ts`

```typescript
interface AIProvider {
  research(query: string, rawParams?: ResearchRawParams): Promise<{
    text: string;
    sources?: Source[];  // NEW — optional, Grok provider returns undefined
    metrics: AiCallMetrics;
  }>;
  chatCompletion(params: { ... }): Promise<{ json: string; metrics: AiCallMetrics }>;
}
```

### 2d. `/api/ai` endpoint pass-through

**File**: `server/app.ts`

For `callType: 'responses'`, include sources in response:

```typescript
// Current: res.json({ output_text: result.text, usage: ... })
// New:     res.json({ output_text: result.text, sources: result.sources, usage: ... })
```

Grok provider returns `sources: undefined` which serializes as absent — no breaking change.

---

## 3. Pipeline Threading — Sources Through Agent Pipeline

### 3a. `runResearcherAgent()` returns sources

**File**: `src/services/apiService.ts`

Current return: `EntityProfile`

New return: `{ profile: EntityProfile; sources: Source[] }`

```typescript
export async function runResearcherAgent(itemName, language?, runId?) {
  const researchResponse = await callAI<{
    output_text: string;
    sources?: Source[];
  }>('responses', { ... }, runId);

  const sources = researchResponse.sources || [];

  // ... existing structured profiling call unchanged ...

  return { profile: parsedProfile, sources };
}
```

### 3b. `runAnalystAgent()` receives sources, cites them

**File**: `src/services/apiService.ts`

New parameter: `sources: Source[]`

Prompt addition:
```
AVAILABLE SOURCES (cite 1-2 most relevant ones in your citations field):
[1] Source Title — https://url
[2] Source Title — https://url
...

CITATION RULE: In the "citations" array, include 1-2 sources that directly
support your analysis for this dimension. Only cite sources that are genuinely
relevant. If no source is relevant, return an empty array.
```

Schema extension — add `citations` to `analysisSchema`:
```typescript
citations: {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      title: { type: 'string' },
    },
    required: ['url', 'title'],
    additionalProperties: false,
  },
}
```

Add `'citations'` to the `required` array.

### 3c. `generateComparison()` orchestration

**File**: `src/services/geminiService.ts`

```typescript
// Phase 1: collect sources alongside profiles
const [resA, resB] = await Promise.all([
  runResearcherAgent(itemA, lang, runId),
  runResearcherAgent(itemB, lang, runId),
]);
const profileA = resA.profile;
const profileB = resB.profile;
const allSources = deduplicateByUrl([...resA.sources, ...resB.sources]);

// Phase 3: pass sources to analyst
const dimensions = await mapConcurrent(framework.dimensions, 6, (dim) =>
  runAnalystAgent(profileA, profileB, dim, allSources, lang, runId)
);

// Final result includes sources
return {
  entityA: profileA,
  entityB: profileB,
  relationship: framework.relationship,
  dimensions,
  prosCons,
  recommendation,
  sources: allSources,
};
```

### 3d. Source deduplication and limiting

```typescript
function deduplicateByUrl(sources: Source[]): Source[] {
  const seen = new Set<string>();
  return sources.filter(s => {
    const normalized = s.url.replace(/\/+$/, '').toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).slice(0, 20); // cap at 20 to avoid prompt bloat
}
```

---

## 4. SSR Rendering — Citations in HTML and JSON-LD

**File**: `server/seo.ts`

### 4a. Per-dimension citation links

After the existing scores line in each dimension `<li>`:

```html
<p><em>Scores — ItemA: 8/10, ItemB: 7/10</em></p>
<p class="seo-citations">Sources:
  <a href="https://swe-bench.com" rel="noopener" target="_blank">SWE-bench</a>,
  <a href="https://arxiv.org/..." rel="noopener" target="_blank">Terminal-Bench 2.0</a>
</p>
```

Only rendered when `dimension.analysis.citations` is non-empty.

### 4b. Report-level sources section

After pros-cons, before the CTA:

```html
<section id="sources">
  <h2>Sources</h2>
  <ol>
    <li><a href="https://..." rel="noopener" target="_blank">Source Title</a></li>
    ...
  </ol>
</section>
```

Only rendered when `report.result.sources` is non-empty.

### 4c. JSON-LD enhancements

**Article schema** — add `citation` array:
```json
{
  "@type": "Article",
  "citation": [
    { "@type": "WebPage", "url": "https://...", "name": "Source Title" }
  ]
}
```

**Review schemas** (per-dimension) — add `citation`:
```json
{
  "@type": "Review",
  "reviewAspect": "Coding Benchmarks",
  "citation": [
    { "@type": "WebPage", "url": "https://...", "name": "SWE-bench" }
  ]
}
```

### 4d. Author attribution in SSR

**Byline** below `<h1>`:
```html
<p class="seo-byline">
  By <a href="/about">CompareAI Editorial Team</a> · Published Apr 29, 2026 ·
  <a href="/methodology">How we compare</a>
</p>
```

**Article schema** `author` update:
```json
{
  "author": {
    "@type": "Organization",
    "name": "CompareAI Editorial Team",
    "url": "https://compare-anythings.com/about"
  },
  "publisher": {
    "@type": "Organization",
    "name": "CompareAI",
    "url": "https://compare-anythings.com",
    "logo": { "@type": "ImageObject", "url": "https://compare-anythings.com/og-image.png" }
  }
}
```

### 4e. Backward compatibility

Reports without `sources`/`citations` fields → SSR skips all source-related sections. No visual or structural change for old reports.

---

## 5. Client UI — Citation Display

**Files**: `src/components/ComparisonResultView.tsx` (or relevant dimension card component)

### 5a. Per-dimension citations

Below scores in each dimension card:

```
Sources: SWE-bench↗  arXiv↗
```

- Style: `text-xs text-gray-400`
- Each link: `<a href="..." target="_blank" rel="noopener">`
- Hidden when `citations` is empty or absent

### 5b. Report-level sources section

After recommendations/pros-cons, a full sources list:

```
Sources (12)
1. SWE-bench Official Results — swe-bench.com
2. Terminal-Bench 2.0 Paper — arxiv.org
3. OpenAI GPT-5.5 Release — openai.com
...
```

- Ordered list `<ol>` matching citation references
- Displayed expanded (better for SEO crawlers)
- Hidden when `sources` is empty or absent

### 5c. Backward compatibility

```typescript
const sources = result.sources ?? [];
const citations = dimension.analysis.citations ?? [];
// Empty array → nothing rendered
```

---

## 6. /methodology Page

### Route

- **URL**: `/methodology`
- **Server**: `app.get('/methodology', ...)` → SSR with `renderMethodologyHtml()`
- **Client**: `src/components/MethodologyPage.tsx`
- **main.tsx**: Add pathname check before report/popular routes

### Content structure

```
H1: How Our Comparisons Are Generated

H2: Our 4-Phase AI Research Pipeline
  Phase 1: Dual-Track Research — web search across 5-8 angles per entity
  Phase 2: Framework Architecture — relationship analysis, 4-6 tailored dimensions
  Phase 3: Multi-Dimensional Analysis — scored 0-10 with cited sources
  Phase 4: Synthesis — pros/cons extraction + final verdict

H2: Data Sources & Verification
  - Web search via MiniMax Search API covering multiple query angles
  - Each claim linked to original source URLs
  - Scores based on publicly available benchmarks and reviews

H2: Scoring Methodology
  - 0-10 scale where 10 = most favorable
  - Inverted scoring for negative dimensions (lower risk = higher score)
  - Per-dimension citations for transparency

H2: Editorial Standards
  - AI-generated, reviewed by CompareAI Editorial Team
  - Featured comparisons undergo quality review before publication
  - Methodology updated as AI capabilities improve

H2: Limitations
  - AI analysis may contain inaccuracies
  - Scores are relative, not absolute
  - Data freshness depends on available web sources
```

### Dynamic statistics

Top of page, queried from analytics DB:

```
"X comparisons generated | Y featured reports | 30+ web sources per report"
```

Server queries `SELECT COUNT(*) FROM comparison_reports` and `SELECT COUNT(*) FROM featured_comparisons` at render time.

### JSON-LD

`TechArticle` schema with author = CompareAI Editorial Team.

### Cache

`Cache-Control: public, max-age=3600` (1 hour).

---

## 7. /about Page

### Route

- **URL**: `/about`
- **Server**: `app.get('/about', ...)` → SSR with `renderAboutHtml()`
- **Client**: `src/components/AboutPage.tsx`
- **main.tsx**: Add pathname check

### Content structure

```
H1: About CompareAI

H2: What We Do
  Free AI-powered comparison engine for products, concepts, and decisions.
  Uses multi-agent AI pipeline with web research for factual grounding.

H2: Why We Built This
  Comparison searches are among the most common decision-making queries.
  Existing tools lack depth, structure, and source transparency.
  We wanted AI comparisons backed by real sources, not just LLM opinions.

H2: The Team
  Built and maintained by CompareAI Editorial Team.

H2: Editorial Policy
  Every featured comparison is reviewed for accuracy and completeness.
  Sources are automatically collected from web research and linked in reports.
  We prioritize factual claims over subjective opinions.
  Reports are updated when significant new information becomes available.

H2: Contact
  [Placeholder — user to fill in]
```

### JSON-LD

`AboutPage` schema.

### Footer links

Add "About" and "Methodology" links to global footer across all pages. This improves internal linking for SEO.

### Cache

`Cache-Control: public, max-age=3600` (1 hour).

---

## 8. Feedback System — "Was this helpful?"

### Database

New table in existing SQLite DB:

```sql
CREATE TABLE IF NOT EXISTS report_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  helpful INTEGER NOT NULL,  -- 1 = yes, 0 = no
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(report_id, visitor_id)
);
```

### API endpoints

```
POST /api/reports/:reportId/feedback
  Body: { helpful: boolean }
  Auth: visitorId from cookie (existing)
  Behavior: UPSERT — insert or update if visitor already voted
  Response: { helpful: number, total: number }

GET /api/reports/:reportId/feedback
  Public, no auth required
  Response: { helpful: number, total: number }
```

### Client UI

**File**: New component, e.g. `src/components/ReportFeedback.tsx`

Rendered at bottom of ReportViewer, after sources section:

```
Was this comparison helpful?
[👍 Yes]  [👎 No]

87% of readers found this helpful (31 votes)
```

- Fetch GET on mount to show aggregate
- POST on click, disable buttons after vote
- Store voted state in localStorage as backup (key: `feedback:${reportId}`)
- Show percentage only when total >= 5

### SSR integration

In `renderReportSeoHtml()`, query feedback stats and render:

```html
<p class="seo-feedback">87% of readers found this comparison helpful (31 votes)</p>
```

- Only rendered when total >= 5
- Not included in JSON-LD (avoid appearing as manipulated review data)

---

## 9. Batch Backfill — Existing Reports

### Admin UI

**File**: `src/admin/AdminApp.tsx`

Add "Backfill Sources" button per featured comparison in the featured management section:

```
GPT 5.5 vs Claude Opus 4.7    [View] [Backfill Sources]
```

- Button disabled if report already has `sources` (show "Sources ✓" instead)
- Shows progress spinner during backfill

### Admin API

```
POST /api/admin/reports/:reportId/backfill-sources
  Auth: admin cookie
  Response: { success: boolean, sourcesCount: number, dimensionsUpdated: number }
```

### Backfill flow

1. Read report from DB (itemA, itemB, existing result_json)
2. `provider.research(itemA)` → sourcesA
3. `provider.research(itemB)` → sourcesB
4. `allSources = deduplicateByUrl([...sourcesA, ...sourcesB])`
5. For each dimension in existing result:
   - Call `provider.chatCompletion()` with prompt:
     "Given these sources and this dimension analysis, pick 1-2 most relevant sources"
   - Returns `citations: [{ url, title }]`
   - Merge into dimension's analysis
6. Update `result_json` in DB with new `sources` + dimension `citations`
7. Return success + counts

### Cost estimate

- 2 research calls per report (5-8 searches each + synthesis) ≈ $0.01-0.02
- ~5 citation matching calls per report ≈ $0.01
- Total per report: ~$0.02-0.05
- 12 featured reports: < $0.60

---

## Files Changed (Summary)

| File | Change Type | Description |
|------|-------------|-------------|
| `server/providers/types.ts` | Modify | Add `Source` type, update `AIProvider.research()` return |
| `server/providers/minimax.ts` | Modify | Capture sources from search, return in research() |
| `server/app.ts` | Modify | Pass sources in /api/ai response, add /methodology + /about + feedback routes |
| `server/seo.ts` | Modify | Render citations in SSR, author byline, new page renderers |
| `server/reports.ts` | Modify | Add report_feedback table, feedback CRUD |
| `src/services/apiService.ts` | Modify | Update types, runResearcherAgent returns sources, runAnalystAgent accepts sources + citations schema |
| `src/services/geminiService.ts` | Modify | Thread sources through pipeline |
| `src/main.tsx` | Modify | Add /methodology and /about routes |
| `src/components/MethodologyPage.tsx` | **New** | Methodology page component |
| `src/components/AboutPage.tsx` | **New** | About page component |
| `src/components/ReportFeedback.tsx` | **New** | Feedback widget component |
| `src/components/ComparisonResultView.tsx` | Modify | Render per-dimension citations + sources section |
| `src/components/ReportViewer.tsx` | Modify | Include ReportFeedback component |
| `src/admin/AdminApp.tsx` | Modify | Add backfill button |
| `src/admin/adminApi.ts` | Modify | Add backfill API call |

---

## Out of Scope

- Dynamic OG images per report
- User accounts / authentication
- Comment system
- Price history data
- Custom benchmark testing
- Blog / editorial content
- hreflang for multilingual
