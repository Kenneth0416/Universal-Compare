# SEO/GEO Content Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add source citations, editorial pages, feedback system, and author attribution to make comparison reports discoverable and citable by Google and AI search engines.

**Architecture:** Extend the MiniMax provider to capture source URLs during web search, thread them through the 4-phase AI pipeline so each dimension analysis cites 1-2 sources, render citations in both SSR HTML and client UI, add /methodology and /about pages for E-E-A-T signals, and add a user feedback system for unique data.

**Tech Stack:** TypeScript, Express.js (server SSR), React + Vite (client), SQLite (feedback storage), Tailwind CSS (styling)

**Spec:** `docs/superpowers/specs/2026-05-19-seo-geo-content-authority-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `server/providers/types.ts` | Modify | Add `Source` type, update `AIProvider.research()` return type |
| `server/providers/minimax.ts` | Modify | Capture sources from search results, return in `research()` |
| `server/providers/grok.ts` | Modify | Return `sources: undefined` to match updated interface |
| `server/app.ts` | Modify | Pass sources in `/api/ai`, add /methodology + /about + feedback routes |
| `server/seo.ts` | Modify | Render citations in SSR, author byline, new page renderers |
| `server/reports.ts` | Modify | Add `report_feedback` table, feedback CRUD |
| `src/services/apiService.ts` | Modify | Update types, researcher returns sources, analyst accepts sources + citations schema |
| `src/services/geminiService.ts` | Modify | Thread sources through pipeline orchestration |
| `src/main.tsx` | Modify | Add /methodology and /about route handling |
| `src/components/MethodologyPage.tsx` | Create | Methodology page component |
| `src/components/AboutPage.tsx` | Create | About page component |
| `src/components/ReportFeedback.tsx` | Create | Feedback widget component |
| `src/components/ComparisonResultView.tsx` | Modify | Render per-dimension citations + sources section |
| `src/components/ReportViewer.tsx` | Modify | Include ReportFeedback component |
| `src/admin/AdminApp.tsx` | Modify | Add backfill button per featured comparison |
| `src/admin/adminApi.ts` | Modify | Add backfill API call |
| `tests/seo/stageOneSeo.test.ts` | Modify | Add tests for new pages in sitemap |

---

### Task 1: Source Type and AIProvider Interface

**Files:**
- Modify: `server/providers/types.ts`

- [ ] **Step 1: Add Source type and update AIProvider interface**

In `server/providers/types.ts`, add the `Source` type after the existing `ResearchRawParams` type, and update the `research()` return type:

```typescript
export type Source = {
  url: string;
  title: string;
  snippet?: string;
};
```

Update the `research` method signature in `AIProvider`:

```typescript
research(query: string, rawParams?: ResearchRawParams): Promise<{
  text: string;
  sources?: Source[];
  metrics: AiCallMetrics;
}>;
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`

Expected: Type errors in `minimax.ts` and `grok.ts` because their `research()` return types need updating. This is expected — we fix them in the next tasks.

- [ ] **Step 3: Commit**

```bash
git add server/providers/types.ts
git commit -m "feat(types): add Source type and update AIProvider.research() return"
```

---

### Task 2: MiniMax Provider Source Capture

**Files:**
- Modify: `server/providers/minimax.ts`

- [ ] **Step 1: Update `callMinimaxSearch()` to return structured sources**

Change the function signature and body. Replace the current return statement:

```typescript
// At the top of the file, import Source type:
import type { AIProvider, AiCallMetrics, ChatMessage, JsonSchema, ResearchRawParams, Source } from './types';

// Change callMinimaxSearch signature and implementation:
async function callMinimaxSearch(
  apiKey: string,
  query: string,
  baseUrl = 'https://api.minimaxi.com',
): Promise<{ text: string; sources: Source[] }> {
  const response = await fetch(`${baseUrl}/v1/coding_plan/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    throw new Error(`MiniMax search failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const results = (data as any).organic || (data as any).results || [];

  const sources: Source[] = results.map((r: any) => ({
    url: r.link || r.url || '',
    title: r.title || '',
    snippet: r.snippet || '',
  }));

  const text = results
    .map(
      (r: any, i: number) =>
        `[${i + 1}] ${r.title}\n${r.link || r.url}\n${r.snippet || ''}`,
    )
    .join('\n\n');

  return { text, sources };
}
```

- [ ] **Step 2: Add `deduplicateSourcesByUrl` helper**

Add after `callMinimaxSearch`:

```typescript
function deduplicateSourcesByUrl(sources: Source[]): Source[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    const normalized = s.url.replace(/\/+$/, '').toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}
```

- [ ] **Step 3: Update `research()` to collect and return sources**

In the `research()` method, update Step 2 to collect sources from search results, and update the return type and statement:

```typescript
async research(
  query: string,
  _rawParams?: ResearchRawParams,
): Promise<{ text: string; sources: Source[]; metrics: AiCallMetrics }> {
  // ... (Step 1: query planning unchanged) ...

  // Step 2: Execute all searches in parallel via MiniMax Search API
  const searchResults = await Promise.all(
    queries.map((q) =>
      callMinimaxSearch(this.searchApiKey, q, this.searchBaseUrl).catch(
        (err) => ({ text: `Search failed for "${q}": ${err.message}`, sources: [] as Source[] }),
      ),
    ),
  );

  const allSources = deduplicateSourcesByUrl(
    searchResults.flatMap((r) => r.sources),
  );

  const combinedResults = queries
    .map((q, i) => `### Search: "${q}"\n${searchResults[i].text}`)
    .join('\n\n---\n\n');

  // Step 3: DeepSeek synthesizes all results (unchanged)
  // ...

  return {
    text: (synthResponse as any).choices?.[0]?.message?.content || '',
    sources: allSources,
    metrics: { ... },
  };
}
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`

Expected: `minimax.ts` compiles cleanly. May still have error in `grok.ts`.

- [ ] **Step 5: Commit**

```bash
git add server/providers/minimax.ts
git commit -m "feat(minimax): capture and return source URLs from search results"
```

---

### Task 3: Grok Provider Compatibility + API Proxy Pass-Through

**Files:**
- Modify: `server/providers/grok.ts` (if it exists — update return type)
- Modify: `server/app.ts`

- [ ] **Step 1: Update Grok provider return type**

Check `server/providers/grok.ts`. If the `research()` method exists, ensure it returns `sources: undefined` or omit it (TypeScript allows this since `sources` is optional in the interface). The key change is making sure the return type matches `{ text: string; sources?: Source[]; metrics: AiCallMetrics }`.

If `grok.ts` doesn't need code changes (because the return type was already `{ text, metrics }` and `sources` is optional), skip this step.

- [ ] **Step 2: Update `/api/ai` endpoint to pass sources through**

In `server/app.ts`, in the `case 'responses'` block (around line 282-292), change:

```typescript
case 'responses': {
  const input = params.input || [];
  const tools = params.tools || [];
  const result = await provider.research('', {
    input,
    tools,
    tool_choice: params.tool_choice,
  });
  model = result.metrics.model;
  response = { output_text: result.text, sources: result.sources };
  break;
}
```

The only change is adding `sources: result.sources` to the response object.

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`

Expected: All provider files and app.ts compile cleanly.

- [ ] **Step 4: Commit**

```bash
git add server/providers/grok.ts server/app.ts
git commit -m "feat(api): pass source URLs through /api/ai responses endpoint"
```

---

### Task 4: Client Pipeline — Researcher Returns Sources

**Files:**
- Modify: `src/services/apiService.ts`

- [ ] **Step 1: Add Source type to apiService.ts**

At the top of the file, after the existing interfaces, add:

```typescript
export interface Source {
  url: string;
  title: string;
  snippet?: string;
}
```

- [ ] **Step 2: Add `sources` to `ComparisonResult`**

In the `ComparisonResult` interface, add after the `recommendation` field:

```typescript
sources?: Source[];
```

- [ ] **Step 3: Update `runResearcherAgent()` return type**

Change `runResearcherAgent` to return `{ profile: EntityProfile; sources: Source[] }` instead of `EntityProfile`:

```typescript
export async function runResearcherAgent(
  itemName: string,
  language?: string,
  runId?: string,
): Promise<{ profile: EntityProfile; sources: Source[] }> {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const xSearchMode = normalizeXSearchMode(env?.VITE_X_SEARCH_MODE);
  const researchRequest = buildResearchRequest(itemName, xSearchMode);
  const researchResponse = await callAI<{
    output_text: string;
    sources?: Source[];
  }>('responses', {
    model: 'grok-4-1-fast-non-reasoning',
    ...researchRequest,
  }, runId);

  const researchResults = researchResponse.output_text || '';
  const sources = researchResponse.sources || [];

  // Structured profiling via chat (unchanged)
  const structuredResponse = await callAI<{ choices: Array<{ message: { content: string } }> }>('chat', {
    // ... existing params unchanged ...
  }, runId);

  return {
    profile: JSON.parse(structuredResponse.choices[0].message.content || '{}'),
    sources,
  };
}
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`

Expected: Errors in `geminiService.ts` because it calls `runResearcherAgent` and expects `EntityProfile` directly. This is expected — fixed in Task 6.

- [ ] **Step 5: Commit**

```bash
git add src/services/apiService.ts
git commit -m "feat(pipeline): researcher agent returns sources alongside profile"
```

---

### Task 5: Client Pipeline — Analyst Agent Citations

**Files:**
- Modify: `src/services/apiService.ts`

- [ ] **Step 1: Add `citations` to `analysisSchema`**

Update the `analysisSchema` object to include the `citations` field:

```typescript
const analysisSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    item_a_summary: { type: 'string' },
    item_b_summary: { type: 'string' },
    key_difference: { type: 'string' },
    better_for: { type: 'string', description: "'A', 'B', 'Both', or 'Neither'" },
    optional_score_a: { type: 'number' },
    optional_score_b: { type: 'number' },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string' },
          title: { type: 'string' },
        },
        required: ['url', 'title'],
      },
    },
  },
  required: [
    'item_a_summary', 'item_b_summary', 'key_difference',
    'better_for', 'optional_score_a', 'optional_score_b', 'citations',
  ],
};
```

- [ ] **Step 2: Update `runAnalystAgent()` to accept and use sources**

Add `sources` parameter and update the prompt:

```typescript
export async function runAnalystAgent(
  profileA: any,
  profileB: any,
  dimension: any,
  sources: Source[] = [],
  language?: string,
  runId?: string,
): Promise<any> {
  const sourcesContext = sources.length > 0
    ? `\n\nAVAILABLE SOURCES (cite 1-2 most relevant in your "citations" array):
${sources.slice(0, 20).map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join('\n')}

CITATION RULE: Include 1-2 sources from the list above that directly support your analysis for this dimension. Only cite genuinely relevant sources. If none are relevant, return an empty array.`
    : '';

  const prompt = `You are an Analyst Agent. Compare the following two entities strictly on the dimension: "${dimension.label}".

${profileA.name}: ${profileA.short_definition}
${profileB.name}: ${profileB.short_definition}
Dimension Context: ${dimension.why_it_matters}
Comparison Angle: ${dimension.comparison_angle}

Analyze their differences, summarize each entity's characteristics on this dimension, and provide a score out of 10 for both.

SCORING RULE: Scores must always represent desirability or advantage (10 = best possible outcome for that entity on this dimension). For negative dimensions such as risk, cost, complexity, or danger, a lower value is better — so an entity with lower risk/cost/complexity should receive a HIGHER score. Never score "how much" of a negative trait exists; always score "how favorable" the entity's position is.

IMPORTANT: Always refer to entities by their actual names ("${profileA.name}" and "${profileB.name}"). Never use "Entity A", "Entity B", "A", "B", or similar placeholders in your analysis text.${sourcesContext}`;

  const languagePrompt = `\n\nIMPORTANT: All text fields in your response must be in ${language === 'zh-CN' ? 'Simplified Chinese (简体中文)' : language === 'zh-TW' ? 'Traditional Chinese (繁體中文)' : 'English'}.`;
  const fullPrompt = `${prompt}${languagePrompt}`;

  const response = await callAI<{ choices: Array<{ message: { content: string } }> }>('chat', {
    model: 'grok-4-1-fast-non-reasoning',
    messages: [{ role: 'user', content: fullPrompt }],
    temperature: 0.2,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'analysis_response',
        strict: true,
        schema: analysisSchema,
      },
    },
  }, runId);
  return { ...dimension, analysis: JSON.parse(response.choices[0].message.content || '{}') };
}
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`

Expected: Still errors in `geminiService.ts` (fixed next task). The `apiService.ts` itself should be clean.

- [ ] **Step 4: Commit**

```bash
git add src/services/apiService.ts
git commit -m "feat(pipeline): analyst agent accepts sources and returns citations"
```

---

### Task 6: Pipeline Orchestration — Thread Sources

**Files:**
- Modify: `src/services/geminiService.ts`

- [ ] **Step 1: Add deduplication helper and update `generateComparison()`**

```typescript
import * as apiService from './apiService';
import type { ComparisonResult } from './apiService';
import type { Source } from './apiService';

export type { ComparisonResult, Source } from './apiService';

// Re-export all agent functions and helpers from apiService
export {
  runResearcherAgent,
  runArchitectAgent,
  runAnalystAgent,
  runProsConsAgent,
  runRecommendationAgent,
  mapConcurrent,
} from './apiService';

function deduplicateSourcesByUrl(sources: Source[]): Source[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    const normalized = s.url.replace(/\/+$/, '').toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export async function generateComparison(
  itemA: string,
  itemB: string,
  onProgress?: (step: string) => void,
  onPhaseComplete?: (phase: string, data: any) => void,
  language?: string,
  runId?: string,
): Promise<ComparisonResult> {

  // Phase 1: Dual-Track Research (now returns sources)
  onProgress?.("Phase 1: Researching entities concurrently...");
  const [resA, resB] = await Promise.all([
    apiService.runResearcherAgent(itemA, language, runId),
    apiService.runResearcherAgent(itemB, language, runId),
  ]);
  const profileA = resA.profile;
  const profileB = resB.profile;
  const allSources = deduplicateSourcesByUrl([...resA.sources, ...resB.sources]).slice(0, 20);
  onPhaseComplete?.('entities', { entityA: profileA, entityB: profileB });

  // Phase 2: Framework Architecture (unchanged)
  onProgress?.("Phase 2: Architecting comparison framework...");
  const framework = await apiService.runArchitectAgent(profileA, profileB, language, runId);
  onPhaseComplete?.('framework', { relationship: framework.relationship, dimensionCount: framework.dimensions.length });

  // Phase 3: Multi-Dimensional Analysis — now passes sources
  onProgress?.(`Phase 3: Analyzing ${framework.dimensions.length} dimensions concurrently...`);
  const analyzedDimensions = await apiService.mapConcurrent(framework.dimensions, 6, async (dim) => {
    const result = await apiService.runAnalystAgent(profileA, profileB, dim, allSources, language, runId);
    onPhaseComplete?.('dimension', result);
    return result;
  });

  // Phase 4: Synthesis & Verdict (unchanged)
  onProgress?.("Phase 4: Synthesizing final verdict and pros/cons...");
  const [prosCons, recommendation] = await Promise.all([
    apiService.runProsConsAgent(profileA, profileB, analyzedDimensions, language, runId),
    apiService.runRecommendationAgent(profileA, profileB, analyzedDimensions, null, language, runId),
  ]);
  onPhaseComplete?.('verdict', { prosCons, recommendation });

  // Assemble Final Result — now includes sources
  onProgress?.("Finalizing report...");
  return {
    entityA: profileA,
    entityB: profileB,
    relationship: framework.relationship,
    dimensions: analyzedDimensions,
    prosCons,
    recommendation,
    sources: allSources,
  };
}
```

- [ ] **Step 2: Verify full project compiles**

Run: `npx tsc --noEmit`

Expected: PASS — all type errors resolved.

- [ ] **Step 3: Run existing tests**

Run: `npm test`

Expected: Existing SEO tests still pass (they don't test pipeline behavior).

- [ ] **Step 4: Commit**

```bash
git add src/services/geminiService.ts
git commit -m "feat(pipeline): thread sources through comparison pipeline"
```

---

### Task 7: SSR Rendering — Citations, Sources, Byline, Author

**Files:**
- Modify: `server/seo.ts`

- [ ] **Step 1: Add citation type to SeoReportResult**

Update the `SeoReportResult` type's `dimensions` array item's `analysis` to include:

```typescript
citations?: Array<{ url?: string; title?: string }>;
```

Also add at the top level of `SeoReportResult`:

```typescript
sources?: Array<{ url?: string; title?: string; snippet?: string }>;
```

- [ ] **Step 2: Update `renderDimensionSummary()` to include per-dimension citations**

In the `renderDimensionSummary` function, after the scores line (`parts.push(\`<em>Scores — ...`), add citation rendering:

```typescript
// After the scores block and before the why_it_matters block:
const citations = (dimension.analysis as any)?.citations || [];
if (citations.length > 0) {
  const citationLinks = citations
    .filter((c: any) => c?.url && c?.title)
    .map((c: any) => `<a href="${escapeHtml(c.url)}" rel="noopener" target="_blank">${escapeHtml(c.title)}</a>`)
    .join(', ');
  if (citationLinks) {
    parts.push(`<p class="seo-citations">Sources: ${citationLinks}</p>`);
  }
}
```

- [ ] **Step 3: Add report-level sources section in `renderReportSummary()`**

After `renderProsCons(report)` and before the CTA section, add a sources section:

```typescript
function renderSources(report: ReportData) {
  const result = getReportResult(report);
  const sources = result.sources || [];
  if (!sources.length) return '';

  const items = sources
    .filter((s) => s.url && s.title)
    .map((s) => `<li><a href="${escapeHtml(s.url!)}" rel="noopener" target="_blank">${escapeHtml(s.title!)}</a></li>`)
    .join('');

  if (!items) return '';
  return `<section class="seo-section" id="sources"><h2>Sources</h2><ol>${items}</ol></section>`;
}
```

Update `renderReportSummary` to include it:

```typescript
${renderProsCons(report)}
${renderSources(report)}
<section class="seo-section"><p><a href="/">Create your own comparison</a></p></section>
```

- [ ] **Step 4: Add byline below `<h1>` in `renderReportSummary()`**

After the `<h1>` line and before `<p class="seo-description">`, add:

```typescript
const publishDate = getIsoDate(report.createdAt);
// In the template:
<p class="seo-byline">By <a href="/about">CompareAI Editorial Team</a> · Published ${publishDate} · <a href="/methodology">How we compare</a></p>
```

- [ ] **Step 5: Update `buildStructuredData()` — author + citations**

Update the `article` object's `author` field:

```typescript
author: {
  '@type': 'Organization',
  name: 'CompareAI Editorial Team',
  url: `${siteUrl}/about`,
},
publisher: {
  '@type': 'Organization',
  name: 'CompareAI',
  url: siteUrl,
  logo: { '@type': 'ImageObject', url: `${siteUrl}${OG_IMAGE_PATH}` },
},
```

Add `citation` array to the article schema from report-level sources:

```typescript
const reportSources = result.sources || [];
if (reportSources.length > 0) {
  (article as any).citation = reportSources
    .filter((s) => s.url && s.title)
    .map((s) => ({ '@type': 'WebPage', url: s.url, name: s.title }));
}
```

Add `citation` to per-dimension Review schemas:

```typescript
const dimCitations = (d.analysis as any)?.citations || [];
if (dimCitations.length > 0) {
  review.citation = dimCitations
    .filter((c: any) => c?.url && c?.title)
    .map((c: any) => ({ '@type': 'WebPage', url: c.url, name: c.title }));
}
```

Also update the `author` in Review schemas from `'CompareAI'` to `'CompareAI Editorial Team'`.

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit`

Expected: PASS

- [ ] **Step 7: Run existing tests**

Run: `npm test`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add server/seo.ts
git commit -m "feat(ssr): add citations, sources section, byline, and author attribution"
```

---

### Task 8: Client UI — Citations in Dimension Cards + Sources Section

**Files:**
- Modify: `src/components/ComparisonResultView.tsx`

- [ ] **Step 1: Add per-dimension citation links**

In the dimension card rendering (inside the `.map((dim, idx) => {` block), after the `better_for` badge div (around line 169), add citation links:

```tsx
{/* Citations */}
{(dim.analysis as any)?.citations?.length > 0 && (
  <div className="text-[10px] text-neutral-500 mt-2 pt-2 border-t border-white/5">
    Sources:{' '}
    {((dim.analysis as any).citations as Array<{ url: string; title: string }>)
      .map((c, ci) => (
        <span key={ci}>
          {ci > 0 && ', '}
          <a
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-400/60 hover:text-indigo-300 transition-colors"
          >
            {c.title}
          </a>
        </span>
      ))}
  </div>
)}
```

- [ ] **Step 2: Add report-level Sources section**

After the Share section (section 5), before the closing `</div>`, add:

```tsx
{/* 6. Sources */}
{(result.sources?.length ?? 0) > 0 && (
  <section className="bg-white/5 backdrop-blur-xl rounded-3xl p-6 sm:p-8 shadow-2xl border border-white/10">
    <h3 className="text-lg font-bold text-white mb-4">
      Sources ({result.sources!.length})
    </h3>
    <ol className="space-y-1.5 list-decimal list-inside">
      {result.sources!.map((source, i) => (
        <li key={i} className="text-sm text-neutral-400">
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-400/80 hover:text-indigo-300 transition-colors"
          >
            {source.title}
          </a>
          {source.snippet && (
            <span className="text-neutral-500 ml-1">— {source.snippet.slice(0, 80)}</span>
          )}
        </li>
      ))}
    </ol>
  </section>
)}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/ComparisonResultView.tsx
git commit -m "feat(ui): display per-dimension citations and report sources"
```

---

### Task 9: /methodology Page

**Files:**
- Create: `src/components/MethodologyPage.tsx`
- Modify: `src/main.tsx`
- Modify: `server/seo.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Create MethodologyPage.tsx client component**

```tsx
export default function MethodologyPage() {
  return (
    <div className="min-h-screen bg-[#0a0f1f] text-white">
      <main className="max-w-3xl mx-auto px-4 py-16 sm:py-24">
        <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-4 font-mono">Methodology</p>
        <h1 className="text-3xl sm:text-4xl font-bold mb-8">How Our Comparisons Are Generated</h1>

        <div className="prose prose-invert prose-sm max-w-none space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-white">Our 4-Phase AI Research Pipeline</h2>
            <p className="text-neutral-300 leading-relaxed">Every comparison goes through a rigorous 4-phase process designed to produce balanced, evidence-based analysis.</p>
            <ol className="text-neutral-300 space-y-3 list-decimal list-inside">
              <li><strong className="text-white">Dual-Track Research</strong> — We search the web across 5-8 different angles per entity, gathering information from official sources, reviews, benchmarks, and expert analysis.</li>
              <li><strong className="text-white">Framework Architecture</strong> — An AI architect analyzes the relationship between the two entities and generates 4-6 comparison dimensions specifically tailored to them. No generic templates.</li>
              <li><strong className="text-white">Multi-Dimensional Analysis</strong> — Each dimension is analyzed independently with scores on a 0-10 scale. Each analysis cites 1-2 web sources that directly support the findings.</li>
              <li><strong className="text-white">Synthesis</strong> — A final phase extracts pros and cons for each entity and produces an actionable recommendation with a clear verdict.</li>
            </ol>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">Data Sources & Verification</h2>
            <ul className="text-neutral-300 space-y-2 list-disc list-inside">
              <li>Web search via multiple query angles covering factual overviews, technical specifications, expert reviews, and recent news</li>
              <li>Each claim in the analysis is linked to its original source URL for transparency</li>
              <li>Scores are based on publicly available benchmarks, reviews, and specifications</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">Scoring Methodology</h2>
            <ul className="text-neutral-300 space-y-2 list-disc list-inside">
              <li>All scores use a 0-10 scale where 10 represents the most favorable outcome</li>
              <li>For negative dimensions (e.g., risk, cost), lower real-world values receive higher scores — a product with lower cost scores higher</li>
              <li>Scores are relative within the comparison, not absolute ratings</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">Editorial Standards</h2>
            <ul className="text-neutral-300 space-y-2 list-disc list-inside">
              <li>Comparisons are AI-generated and reviewed by the CompareAI Editorial Team</li>
              <li>Featured comparisons undergo quality review before publication</li>
              <li>Our methodology is continuously updated as AI capabilities improve</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">Limitations</h2>
            <ul className="text-neutral-300 space-y-2 list-disc list-inside">
              <li>AI analysis may contain inaccuracies — always verify critical decisions with primary sources</li>
              <li>Scores are relative within each comparison and should not be compared across reports</li>
              <li>Data freshness depends on available web sources at the time of generation</li>
            </ul>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10 flex gap-4 text-sm">
          <a href="/" className="text-indigo-400 hover:text-indigo-300 transition-colors">Home</a>
          <a href="/about" className="text-indigo-400 hover:text-indigo-300 transition-colors">About</a>
          <a href="/popular-ai-comparisons" className="text-indigo-400 hover:text-indigo-300 transition-colors">Popular Comparisons</a>
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Add /methodology route in main.tsx**

Update `src/main.tsx` — add the check before the report/popular routes:

```tsx
import MethodologyPage from './components/MethodologyPage.tsx';

const pathname = window.location.pathname;
let RootApp;
if (pathname.startsWith('/admin')) {
  RootApp = AdminApp;
} else if (pathname === '/methodology') {
  RootApp = MethodologyPage;
} else if (pathname.startsWith('/r/') || pathname.startsWith('/compare/')) {
  RootApp = ReportViewer;
} else if (pathname === '/popular-ai-comparisons') {
  RootApp = PopularComparisonsPage;
} else {
  RootApp = App;
}
```

- [ ] **Step 3: Add SSR renderer in seo.ts**

Add the `renderMethodologyHtml` function to `server/seo.ts`:

```typescript
export function renderMethodologyHtml({
  indexHtml,
  siteUrl: rawSiteUrl,
  stats,
}: {
  indexHtml: string;
  siteUrl?: string;
  stats?: { totalReports: number; totalFeatured: number };
}) {
  const siteUrl = normalizeSiteUrl(rawSiteUrl);
  const url = `${siteUrl}/methodology`;
  const title = 'How Our Comparisons Are Generated | CompareAI';
  const description = 'Learn about CompareAI\'s 4-phase AI research pipeline, scoring methodology, data sources, and editorial standards.';

  const statsLine = stats
    ? `<p class="seo-stats">${stats.totalReports.toLocaleString()}+ comparisons generated · ${stats.totalFeatured} featured reports · 30+ web sources per report</p>`
    : '';

  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: title,
      description,
      url,
      author: { '@type': 'Organization', name: 'CompareAI Editorial Team', url: `${siteUrl}/about` },
      publisher: { '@type': 'Organization', name: 'CompareAI', url: siteUrl },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, item: { '@id': `${siteUrl}/`, name: 'Home' } },
        { '@type': 'ListItem', position: 2, item: { '@id': url, name: 'Methodology' } },
      ],
    },
  ];

  const head = `
    <title>${escapeHtml(title)}</title>
    <meta name="title" content="${escapeHtml(title)}" />
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="CompareAI" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:image" content="${escapeHtml(`${siteUrl}${OG_IMAGE_PATH}`)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    ${renderJsonLdBlocks(structuredData)}
  `;

  const body = `
    <main class="seo-report-summary">
      <p class="seo-kicker">Methodology</p>
      <h1>How Our Comparisons Are Generated</h1>
      ${statsLine}
      <section class="seo-section"><h2>Our 4-Phase AI Research Pipeline</h2>
        <ol>
          <li><strong>Dual-Track Research</strong> — Web search across 5-8 angles per entity</li>
          <li><strong>Framework Architecture</strong> — Relationship analysis with 4-6 tailored dimensions</li>
          <li><strong>Multi-Dimensional Analysis</strong> — Scored 0-10 with cited sources</li>
          <li><strong>Synthesis</strong> — Pros/cons extraction and final verdict</li>
        </ol>
      </section>
      <section class="seo-section"><h2>Data Sources &amp; Verification</h2>
        <p>Each comparison uses web search across multiple query angles. Claims are linked to original source URLs for transparency.</p>
      </section>
      <section class="seo-section"><h2>Scoring Methodology</h2>
        <p>All scores use a 0-10 scale where 10 = most favorable. For negative dimensions, lower real-world values receive higher scores.</p>
      </section>
      <section class="seo-section"><h2>Editorial Standards</h2>
        <p>AI-generated, reviewed by <a href="/about">CompareAI Editorial Team</a>. Featured comparisons undergo quality review.</p>
      </section>
      <section class="seo-section"><h2>Limitations</h2>
        <p>AI analysis may contain inaccuracies. Scores are relative, not absolute. Data freshness depends on available web sources.</p>
      </section>
      <section class="seo-section"><p><a href="/">Create your own comparison</a> · <a href="/about">About</a></p></section>
    </main>
  `;

  return injectSeoIntoHtml(indexHtml, head, body);
}
```

- [ ] **Step 4: Add server route in app.ts**

Add before the `/popular-ai-comparisons` route:

```typescript
app.get('/methodology', (_req, res) => {
  const indexHtml = readClientIndexHtml();
  const { total: totalReports } = reportStore.listReports({ limit: 1 });
  const totalFeatured = featuredStore.listFeatured().length;
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('text/html').send(
    renderMethodologyHtml({
      indexHtml,
      siteUrl,
      stats: { totalReports, totalFeatured },
    }),
  );
});
```

Add `renderMethodologyHtml` to the import from `'./seo'`.

- [ ] **Step 5: Update sitemap to include /methodology**

In the `renderSitemapXml` function in `seo.ts`, add after the popular-comparisons URL:

```typescript
{
  loc: `${normalizedSiteUrl}/methodology`,
  lastmod: today,
  changefreq: 'monthly',
  priority: '0.6',
},
```

- [ ] **Step 6: Verify build**

Run: `npm run build`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/MethodologyPage.tsx src/main.tsx server/seo.ts server/app.ts
git commit -m "feat: add /methodology page with SSR and client component"
```

---

### Task 10: /about Page

**Files:**
- Create: `src/components/AboutPage.tsx`
- Modify: `src/main.tsx`
- Modify: `server/seo.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Create AboutPage.tsx client component**

```tsx
export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[#0a0f1f] text-white">
      <main className="max-w-3xl mx-auto px-4 py-16 sm:py-24">
        <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-4 font-mono">About</p>
        <h1 className="text-3xl sm:text-4xl font-bold mb-8">About CompareAI</h1>

        <div className="prose prose-invert prose-sm max-w-none space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-white">What We Do</h2>
            <p className="text-neutral-300 leading-relaxed">CompareAI is a free AI-powered comparison engine that analyzes any two entities — products, concepts, technologies, services, or ideas. Our multi-agent AI pipeline uses web research to produce factual, source-backed comparisons with dimension-by-dimension scoring, pros and cons, and actionable recommendations.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">Why We Built This</h2>
            <p className="text-neutral-300 leading-relaxed">Comparison searches are among the most common decision-making queries on the web. Existing comparison tools often lack depth, structured analysis, and source transparency. We built CompareAI to provide AI-powered comparisons that are backed by real web sources — not just LLM opinions.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">The Team</h2>
            <p className="text-neutral-300 leading-relaxed">CompareAI is built and maintained by the CompareAI Editorial Team. We combine AI engineering expertise with editorial rigor to deliver reliable comparison reports.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">Editorial Policy</h2>
            <ul className="text-neutral-300 space-y-2 list-disc list-inside">
              <li>Every featured comparison is reviewed for accuracy and completeness</li>
              <li>Sources are automatically collected from web research and linked directly in reports</li>
              <li>We prioritize factual, verifiable claims over subjective opinions</li>
              <li>Reports are updated when significant new information becomes available</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">Contact</h2>
            <p className="text-neutral-300 leading-relaxed">For questions, feedback, or partnership inquiries, please reach out via our website.</p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10 flex gap-4 text-sm">
          <a href="/" className="text-indigo-400 hover:text-indigo-300 transition-colors">Home</a>
          <a href="/methodology" className="text-indigo-400 hover:text-indigo-300 transition-colors">Methodology</a>
          <a href="/popular-ai-comparisons" className="text-indigo-400 hover:text-indigo-300 transition-colors">Popular Comparisons</a>
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Add /about route in main.tsx**

Add after the `/methodology` check:

```tsx
import AboutPage from './components/AboutPage.tsx';

// In route detection, after methodology:
} else if (pathname === '/about') {
  RootApp = AboutPage;
}
```

- [ ] **Step 3: Add SSR renderer in seo.ts**

```typescript
export function renderAboutHtml({
  indexHtml,
  siteUrl: rawSiteUrl,
}: {
  indexHtml: string;
  siteUrl?: string;
}) {
  const siteUrl = normalizeSiteUrl(rawSiteUrl);
  const url = `${siteUrl}/about`;
  const title = 'About CompareAI';
  const description = 'Learn about CompareAI — a free AI-powered comparison engine with web-sourced analysis, editorial standards, and transparent methodology.';

  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'AboutPage',
      name: title,
      url,
      description,
      mainEntity: {
        '@type': 'Organization',
        name: 'CompareAI',
        url: siteUrl,
        logo: `${siteUrl}${OG_IMAGE_PATH}`,
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, item: { '@id': `${siteUrl}/`, name: 'Home' } },
        { '@type': 'ListItem', position: 2, item: { '@id': url, name: 'About' } },
      ],
    },
  ];

  const head = `
    <title>${escapeHtml(title)}</title>
    <meta name="title" content="${escapeHtml(title)}" />
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="CompareAI" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:image" content="${escapeHtml(`${siteUrl}${OG_IMAGE_PATH}`)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    ${renderJsonLdBlocks(structuredData)}
  `;

  const body = `
    <main class="seo-report-summary">
      <p class="seo-kicker">About</p>
      <h1>About CompareAI</h1>
      <section class="seo-section"><h2>What We Do</h2>
        <p>CompareAI is a free AI-powered comparison engine that analyzes any two entities using a multi-agent AI pipeline with web research. Reports include dimension-by-dimension scoring, pros and cons, and actionable recommendations.</p>
      </section>
      <section class="seo-section"><h2>Why We Built This</h2>
        <p>Comparison searches are among the most common decision-making queries. We built CompareAI to provide AI comparisons backed by real web sources, not just LLM opinions.</p>
      </section>
      <section class="seo-section"><h2>The Team</h2>
        <p>Built and maintained by the CompareAI Editorial Team.</p>
      </section>
      <section class="seo-section"><h2>Editorial Policy</h2>
        <ul>
          <li>Every featured comparison is reviewed for accuracy and completeness</li>
          <li>Sources are automatically collected from web research and linked in reports</li>
          <li>We prioritize factual claims over subjective opinions</li>
          <li>Reports are updated when significant new information becomes available</li>
        </ul>
      </section>
      <section class="seo-section"><p><a href="/">Create your own comparison</a> · <a href="/methodology">Methodology</a></p></section>
    </main>
  `;

  return injectSeoIntoHtml(indexHtml, head, body);
}
```

- [ ] **Step 4: Add server route in app.ts**

Add after the `/methodology` route:

```typescript
app.get('/about', (_req, res) => {
  const indexHtml = readClientIndexHtml();
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('text/html').send(renderAboutHtml({ indexHtml, siteUrl }));
});
```

Add `renderAboutHtml` to the import from `'./seo'`.

- [ ] **Step 5: Update sitemap to include /about**

In `renderSitemapXml` in `seo.ts`, add after the methodology URL:

```typescript
{
  loc: `${normalizedSiteUrl}/about`,
  lastmod: today,
  changefreq: 'monthly',
  priority: '0.5',
},
```

- [ ] **Step 6: Verify build**

Run: `npm run build`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/AboutPage.tsx src/main.tsx server/seo.ts server/app.ts
git commit -m "feat: add /about page with SSR and client component"
```

---

### Task 11: Feedback System

**Files:**
- Modify: `server/reports.ts`
- Modify: `server/app.ts`
- Create: `src/components/ReportFeedback.tsx`
- Modify: `src/components/ReportViewer.tsx`
- Modify: `server/seo.ts`

- [ ] **Step 1: Add feedback table + CRUD to reports.ts**

In `server/reports.ts`, update `initializeSchema` to add the feedback table:

```typescript
db.exec(`
  -- ... existing table creation ...

  CREATE TABLE IF NOT EXISTS report_feedback (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id   TEXT    NOT NULL,
    visitor_id  TEXT    NOT NULL,
    helpful     INTEGER NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(report_id, visitor_id)
  );

  CREATE INDEX IF NOT EXISTS idx_feedback_report ON report_feedback(report_id);
`);
```

Add feedback methods to the returned object from `createReportStore`:

```typescript
const submitFeedback = (reportId: string, visitorId: string, helpful: boolean): { helpful: number; total: number } => {
  db.prepare(`
    INSERT INTO report_feedback (report_id, visitor_id, helpful)
    VALUES (?, ?, ?)
    ON CONFLICT(report_id, visitor_id) DO UPDATE SET helpful = excluded.helpful
  `).run(reportId, visitorId, helpful ? 1 : 0);

  return getFeedbackStats(reportId);
};

const getFeedbackStats = (reportId: string): { helpful: number; total: number } => {
  const row = db.prepare(`
    SELECT COUNT(*) as total, SUM(helpful) as helpful
    FROM report_feedback
    WHERE report_id = ?
  `).get(reportId) as any;

  return {
    helpful: row?.helpful || 0,
    total: row?.total || 0,
  };
};

return {
  saveReport,
  getReport,
  incrementViewCount,
  listReports,
  deleteReport,
  submitFeedback,
  getFeedbackStats,
};
```

- [ ] **Step 2: Add feedback API routes in app.ts**

Add before the admin routes (after the `GET /api/reports/:reportId` route):

```typescript
app.get('/api/reports/:reportId/feedback', (req, res) => {
  res.json(reportStore.getFeedbackStats(req.params.reportId));
});

app.post('/api/reports/:reportId/feedback', (req: RequestWithVisitor, res) => {
  const { helpful } = req.body || {};
  if (typeof helpful !== 'boolean') {
    res.status(400).json({ error: 'Missing helpful (boolean)' });
    return;
  }

  const visitorId = req.visitorId || '';
  if (!visitorId) {
    res.status(400).json({ error: 'Missing visitor identity' });
    return;
  }

  res.json(reportStore.submitFeedback(req.params.reportId, visitorId, helpful));
});
```

- [ ] **Step 3: Create ReportFeedback.tsx client component**

```tsx
import { useState, useEffect } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';

interface FeedbackStats {
  helpful: number;
  total: number;
}

export default function ReportFeedback({ reportId }: { reportId: string }) {
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [voted, setVoted] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const storageKey = `feedback:${reportId}`;

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored !== null) setVoted(stored === 'true');

    fetch(`/api/reports/${reportId}/feedback`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, [reportId, storageKey]);

  const submit = async (helpful: boolean) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/reports/${reportId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ helpful }),
      });
      if (res.ok) {
        const updated = await res.json();
        setStats(updated);
        setVoted(helpful);
        localStorage.setItem(storageKey, String(helpful));
      }
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  };

  const pct = stats && stats.total >= 5
    ? Math.round((stats.helpful / stats.total) * 100)
    : null;

  return (
    <div className="bg-white/5 backdrop-blur-xl rounded-2xl p-6 border border-white/10 text-center">
      <p className="text-sm text-neutral-300 mb-3">Was this comparison helpful?</p>
      <div className="flex justify-center gap-3 mb-3">
        <button
          onClick={() => submit(true)}
          disabled={voted !== null || submitting}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            voted === true
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : voted !== null
                ? 'bg-white/5 text-neutral-500 cursor-not-allowed'
                : 'bg-white/10 text-white hover:bg-emerald-500/20 hover:text-emerald-400 border border-white/10'
          }`}
        >
          <ThumbsUp size={14} /> Yes
        </button>
        <button
          onClick={() => submit(false)}
          disabled={voted !== null || submitting}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            voted === false
              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
              : voted !== null
                ? 'bg-white/5 text-neutral-500 cursor-not-allowed'
                : 'bg-white/10 text-white hover:bg-rose-500/20 hover:text-rose-400 border border-white/10'
          }`}
        >
          <ThumbsDown size={14} /> No
        </button>
      </div>
      {voted !== null && (
        <p className="text-xs text-neutral-500">Thanks for your feedback!</p>
      )}
      {pct !== null && (
        <p className="text-xs text-neutral-500 mt-1">
          {pct}% of readers found this helpful ({stats!.total} votes)
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add ReportFeedback to ReportViewer**

In `src/components/ReportViewer.tsx`, import and render `ReportFeedback` after the `ComparisonResultView` component. Find where the result is rendered and add:

```tsx
import ReportFeedback from './ReportFeedback';

// After ComparisonResultView, inside the report display section:
{reportId && <ReportFeedback reportId={reportId} />}
```

The exact insertion point depends on the current ReportViewer structure — place it after the main comparison result and before any footer.

- [ ] **Step 5: Add feedback stats to SSR**

In `server/seo.ts`, update `renderReportSeoHtml` to accept and render feedback stats. Update the function signature to accept `feedbackStats`:

```typescript
export function renderReportSeoHtml({
  report,
  featured,
  indexHtml,
  siteUrl: rawSiteUrl,
  relatedComparisons,
  feedbackStats,
}: {
  report: ReportData;
  featured: FeaturedComparison | null;
  indexHtml: string;
  siteUrl?: string;
  relatedComparisons?: SeoComparisonLink[];
  feedbackStats?: { helpful: number; total: number };
}) {
```

In `renderReportSummary`, add feedback line before the CTA:

```typescript
// Add as parameter to renderReportSummary:
function renderReportSummary(report: ReportData, featured: FeaturedComparison | null, feedbackStats?: { helpful: number; total: number }) {
  // ... existing code ...
  const feedbackHtml = feedbackStats && feedbackStats.total >= 5
    ? `<p class="seo-feedback">${Math.round((feedbackStats.helpful / feedbackStats.total) * 100)}% of readers found this comparison helpful (${feedbackStats.total} votes)</p>`
    : '';

  // Add ${feedbackHtml} before the CTA section
}
```

Update the callers of `renderReportSummary` in `renderReportSeoHtml` to pass `feedbackStats`.

Update the `/compare/:slug` and `/r/:reportId` routes in `app.ts` to pass feedback stats:

```typescript
// In both routes, before res.type('text/html').send(...):
const feedbackStats = reportStore.getFeedbackStats(report.reportId);

// Pass to renderReportSeoHtml:
renderReportSeoHtml({
  report,
  featured,
  indexHtml,
  siteUrl,
  relatedComparisons: ...,
  feedbackStats,
})
```

- [ ] **Step 6: Verify build**

Run: `npm run build`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/reports.ts server/app.ts server/seo.ts src/components/ReportFeedback.tsx src/components/ReportViewer.tsx
git commit -m "feat: add feedback system with DB, API, client widget, and SSR integration"
```

---

### Task 12: Backfill System — Admin API + UI

**Files:**
- Modify: `server/app.ts`
- Modify: `src/admin/adminApi.ts`
- Modify: `src/admin/AdminApp.tsx`

- [ ] **Step 1: Add backfill API endpoint in app.ts**

Add after the existing admin featured routes (after `app.patch('/api/admin/featured/:id', ...)`):

```typescript
app.post('/api/admin/reports/:reportId/backfill-sources', async (req, res) => {
  const report = reportStore.getReport(req.params.reportId);
  if (!report) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }

  try {
    const result = report.result as any;

    // Research both items to get sources
    const [resA, resB] = await Promise.all([
      provider.research(report.itemA),
      provider.research(report.itemB),
    ]);

    const allSourcesRaw = [...(resA.sources || []), ...(resB.sources || [])];
    const seen = new Set<string>();
    const allSources = allSourcesRaw.filter((s) => {
      const norm = (s.url || '').replace(/\/+$/, '').toLowerCase();
      if (!norm || seen.has(norm)) return false;
      seen.add(norm);
      return true;
    }).slice(0, 20);

    // For each dimension, match citations
    const dimensions = result.dimensions || [];
    let dimensionsUpdated = 0;

    for (const dim of dimensions) {
      if (!dim.analysis) continue;

      const citationResult = await provider.chatCompletion({
        messages: [
          {
            role: 'user',
            content: `Given this analysis and available sources, pick 1-2 most relevant sources that directly support the analysis.

Analysis dimension: ${dim.label || dim.key}
Key difference: ${dim.analysis.key_difference || ''}
Item A summary: ${dim.analysis.item_a_summary || ''}
Item B summary: ${dim.analysis.item_b_summary || ''}

Available sources:
${allSources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join('\n')}

Return ONLY the citations array.`,
          },
        ],
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            citations: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  url: { type: 'string' },
                  title: { type: 'string' },
                },
                required: ['url', 'title'],
              },
            },
          },
          required: ['citations'],
        },
        schemaName: 'citation_match',
        temperature: 0.1,
      });

      try {
        const parsed = JSON.parse(citationResult.json);
        dim.analysis.citations = parsed.citations || [];
        dimensionsUpdated++;
      } catch {
        dim.analysis.citations = [];
      }
    }

    // Update report with sources and citations
    result.sources = allSources;

    // Save updated result back to DB
    const db = (reportStore as any).db || null;
    if (db) {
      db.prepare('UPDATE comparison_reports SET result_json = ? WHERE report_id = ?')
        .run(JSON.stringify(result), report.reportId);
    }

    res.json({
      success: true,
      sourcesCount: allSources.length,
      dimensionsUpdated,
    });
  } catch (error) {
    console.error('Backfill failed:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Backfill failed',
    });
  }
});
```

Note: The direct DB access via `(reportStore as any).db` is a shortcut. A cleaner approach is to add an `updateReportResult(reportId, result)` method to `reportStore`. Add this method in `reports.ts`:

```typescript
const updateReportResult = (reportId: string, result: unknown): boolean => {
  const changes = db.prepare('UPDATE comparison_reports SET result_json = ? WHERE report_id = ?')
    .run(JSON.stringify(result), reportId);
  return changes.changes > 0;
};

// Add to return object:
return { ..., updateReportResult };
```

Then use `reportStore.updateReportResult(report.reportId, result)` in the backfill route instead of direct DB access.

- [ ] **Step 2: Add backfill API call in adminApi.ts**

In `src/admin/adminApi.ts`, add:

```typescript
export async function backfillSources(reportId: string): Promise<{
  success: boolean;
  sourcesCount: number;
  dimensionsUpdated: number;
}> {
  const res = await fetch(`/api/admin/reports/${reportId}/backfill-sources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Backfill failed' }));
    throw new Error(err.error);
  }
  return res.json();
}
```

- [ ] **Step 3: Add Backfill button in AdminApp.tsx**

Find the featured comparison list in `AdminApp.tsx`. For each featured item that has a `reportId`, add a "Backfill Sources" button next to the existing action buttons. The button should:

- Call `backfillSources(item.reportId)` on click
- Show a spinner while loading
- Show "Sources ✓" if the linked report already has sources (check via a flag or just always allow re-backfill)
- Show success/error message after completion

The exact code depends on the current AdminApp structure, but the pattern is:

```tsx
import { backfillSources } from './adminApi';

// In the featured item row:
<button
  onClick={async () => {
    setBackfilling(item.id);
    try {
      const result = await backfillSources(item.reportId!);
      alert(`Backfilled: ${result.sourcesCount} sources, ${result.dimensionsUpdated} dimensions updated`);
    } catch (err: any) {
      alert(`Failed: ${err.message}`);
    } finally {
      setBackfilling(null);
    }
  }}
  disabled={backfilling === item.id || !item.reportId}
  className="text-xs text-blue-400 hover:text-blue-300"
>
  {backfilling === item.id ? 'Backfilling...' : 'Backfill Sources'}
</button>
```

- [ ] **Step 4: Verify build**

Run: `npm run build`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/reports.ts server/app.ts src/admin/adminApi.ts src/admin/AdminApp.tsx
git commit -m "feat: add admin backfill sources for existing reports"
```

---

### Task 13: Final Verification and Tests

**Files:**
- Modify: `tests/seo/stageOneSeo.test.ts`

- [ ] **Step 1: Update SEO tests for new pages**

Add tests for the new sitemap entries and routes:

```typescript
test('sitemap includes methodology and about pages', () => {
  // This test needs to run against the server-generated sitemap
  // For static file test, check that seo.ts renderSitemapXml includes the new URLs
  const seoSource = readProjectFile('server/seo.ts');
  assert.match(seoSource, /methodology/);
  assert.match(seoSource, /about/);
});

test('main.tsx routes methodology and about pages', () => {
  const mainSource = readProjectFile('src/main.tsx');
  assert.match(mainSource, /\/methodology/);
  assert.match(mainSource, /\/about/);
  assert.match(mainSource, /MethodologyPage/);
  assert.match(mainSource, /AboutPage/);
});
```

- [ ] **Step 2: Run all tests**

Run: `npm test`

Expected: All tests PASS.

- [ ] **Step 3: Run full build**

Run: `npm run build`

Expected: PASS

- [ ] **Step 4: Run type checking**

Run: `npm run lint`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/seo/stageOneSeo.test.ts
git commit -m "test: add SEO tests for methodology and about pages"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Source type + AIProvider interface | `server/providers/types.ts` |
| 2 | MiniMax provider source capture | `server/providers/minimax.ts` |
| 3 | Grok compat + API proxy | `server/providers/grok.ts`, `server/app.ts` |
| 4 | Researcher returns sources | `src/services/apiService.ts` |
| 5 | Analyst citations schema | `src/services/apiService.ts` |
| 6 | Pipeline orchestration | `src/services/geminiService.ts` |
| 7 | SSR citations + sources + byline + author | `server/seo.ts` |
| 8 | Client UI citations + sources | `src/components/ComparisonResultView.tsx` |
| 9 | /methodology page | New component + SSR + route |
| 10 | /about page | New component + SSR + route |
| 11 | Feedback system | DB + API + component + SSR |
| 12 | Backfill system | Admin API + UI |
| 13 | Final verification + tests | Tests + build |
