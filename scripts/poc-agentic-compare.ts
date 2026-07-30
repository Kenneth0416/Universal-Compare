/**
 * PoC: Agentic comparison via pi SDK — one autonomous agent session produces
 * the exact ComparisonResult shape through a terminal submit tool.
 *
 * Run: npx tsx scripts/poc-agentic-compare.ts "Coffee" "Tea"
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { Type } from '/Users/kennethkwok/.nvm/versions/node/v24.13.0/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/typebox/build/index.mjs';
import {
  AuthStorage,
  createAgentSession,
  defineTool,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from '/Users/kennethkwok/.nvm/versions/node/v24.13.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js';
import { normalizeComparisonResult } from '../shared/comparisonSchema';

const itemA = process.argv[2] || 'Coffee';
const itemB = process.argv[3] || 'Tea';

const webSearch = defineTool({
  name: 'web_search',
  label: 'Web Search',
  description: 'Search the web for factual, up-to-date information. Returns titles, URLs and snippets.',
  parameters: Type.Object({
    query: Type.String({ description: 'Search query' }),
  }),
  execute: async (_id, params) => {
    const response = await fetch('https://api.minimaxi.com/v1/coding_plan/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: params.query }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return { content: [{ type: 'text', text: `Search failed: ${response.status}` }], details: {} };
    const data = await response.json() as any;
    const results = (data.organic || data.results || []).slice(0, 6);
    const text = results.map((r: any, i: number) =>
      `[${i + 1}] ${r.title}\n${r.link || r.url}\n${r.snippet || ''}`).join('\n\n');
    return { content: [{ type: 'text', text: text || 'No results' }], details: { sources: results.map((r: any) => ({ url: r.link || r.url, title: r.title })) } };
  },
});

const dimensionSchema = Type.Object({
  key: Type.String(),
  label: Type.String(),
  why_it_matters: Type.String(),
  comparison_angle: Type.String(),
  analysis: Type.Object({
    item_a_summary: Type.String(),
    item_b_summary: Type.String(),
    key_difference: Type.String(),
    better_for: Type.Union([Type.Literal('A'), Type.Literal('B'), Type.Literal('Both'), Type.Literal('Neither')]),
    optional_score_a: Type.Number({ minimum: 0, maximum: 10 }),
    optional_score_b: Type.Number({ minimum: 0, maximum: 10 }),
    citations: Type.Array(Type.Object({ url: Type.String(), title: Type.String() }), { maxItems: 2 }),
  }),
});

let submittedReport: unknown = null;
const submitReport = defineTool({
  name: 'submit_comparison_report',
  label: 'Submit Comparison Report',
  description: 'Submit the final structured comparison report. Call exactly once when research and analysis are complete.',
  parameters: Type.Object({
    entityA: Type.Object({
      name: Type.String(), normalized_name: Type.String(), category: Type.String(),
      subcategory: Type.String(), likely_domain: Type.String(), short_definition: Type.String(),
    }),
    entityB: Type.Object({
      name: Type.String(), normalized_name: Type.String(), category: Type.String(),
      subcategory: Type.String(), likely_domain: Type.String(), short_definition: Type.String(),
    }),
    relationship: Type.Object({
      relationship_type: Type.String(), comparison_goal: Type.String(),
      can_directly_compare: Type.Boolean(), reasoning: Type.String(),
    }),
    dimensions: Type.Array(dimensionSchema, { minItems: 4, maxItems: 6 }),
    prosCons: Type.Object({
      item_a_pros: Type.Array(Type.String()), item_a_cons: Type.Array(Type.String()),
      item_b_pros: Type.Array(Type.String()), item_b_cons: Type.Array(Type.String()),
    }),
    recommendation: Type.Object({
      best_for_a: Type.Array(Type.String()), best_for_b: Type.Array(Type.String()),
      which_to_choose_first: Type.String(), when_not_to_compare_directly: Type.String(),
      short_verdict: Type.String(), long_verdict: Type.String(),
    }),
    sources: Type.Array(Type.Object({ url: Type.String(), title: Type.String() })),
  }),
  execute: async (_id, params) => {
    submittedReport = params;
    return { content: [{ type: 'text', text: 'Report accepted.' }], details: {} };
  },
});

async function main() {
  const authStorage = AuthStorage.create();
  if (process.env.XAI_API_KEY) authStorage.setRuntimeApiKey('xai', process.env.XAI_API_KEY);
  if (process.env.MINIMAX_API_KEY) authStorage.setRuntimeApiKey('minimax-cn', process.env.MINIMAX_API_KEY);
  const modelRegistry = ModelRegistry.create(authStorage);
  const available = await modelRegistry.getAvailable();
  console.log('available models:', available.map((m) => `${m.provider}/${m.id}`).join(', '));
  const model = available.find((m) => m.provider === 'minimax-cn' && m.id === 'MiniMax-M3')
    || available.find((m) => m.provider === 'minimax-cn')
    || available.find((m) => m.provider === 'xai' && m.id.includes('4'))
    || available[0];
  if (!model) throw new Error('No model available');
  console.log(`Model: ${model.provider}/${model.id}`);

  const { session } = await createAgentSession({
    model,
    thinkingLevel: 'medium',
    tools: ['web_search', 'submit_comparison_report'],
    customTools: [webSearch, submitReport],
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: true, maxRetries: 2 } }),
  });

  let searches = 0;
  session.subscribe((event) => {
    if (event.type === 'tool_execution_start') {
      searches += event.toolName === 'web_search' ? 1 : 0;
      console.log(`[tool] ${event.toolName} ${JSON.stringify(event.args ?? {}).slice(0, 120)}`);
    }
    if (event.type === 'agent_end') console.log('[agent] done');
    if (event.type === 'message_end') {
      const m = event.message as any;
      if (m.role === 'assistant') {
        const text = (m.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
        console.log(`[assistant] stop=${m.stopReason} text=${text.slice(0, 200)}${m.errorMessage ? ` ERROR=${m.errorMessage}` : ''}`);
      }
    }
  });

  await session.prompt(
    `You are a comparison research agent. Compare "${itemA}" vs "${itemB}" for a consumer decision website.

Workflow:
1. Use web_search to research BOTH items (facts, specs, pricing, reviews, sentiment). Do several targeted searches per item.
2. Decide their relationship and design 4-6 comparison dimensions tailored to these specific items (no generic templates).
3. Analyze both items on each dimension. Scores are desirability 0-10 (for negative traits like cost/risk, lower is better = higher score).
4. Call submit_comparison_report exactly once with the complete structured report in English. Citations and sources must be real URLs from your searches, never invented.`,
  );

  if (!submittedReport) throw new Error('Agent finished without submitting a report');
  const validated = normalizeComparisonResult(submittedReport);
  console.log(`\n=== RESULT ===`);
  console.log(`searches: ${searches}`);
  console.log(`schema valid: ${validated !== null}`);
  console.log(`dimensions: ${(submittedReport as any).dimensions.length}`);
  console.log(`sources: ${(submittedReport as any).sources.length}`);
  console.log(`verdict: ${(submittedReport as any).recommendation.short_verdict}`);
  session.dispose();
}

main().catch((error) => {
  console.error('PoC failed:', error);
  process.exit(1);
});
