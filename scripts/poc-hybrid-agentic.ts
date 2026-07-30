/**
 * Hybrid agentic pipeline PoC: parallel scoped agents.
 * 2 research agents ∥ → architect → N analyst agents ∥ → synthesis.
 * Each agent keeps tool autonomy; phases run concurrently.
 * Measures wall time, tokens, and quality metrics.
 *
 * Run: npx tsx scripts/poc-hybrid-agentic.ts "Notion" "Obsidian"
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import OpenAI from 'openai';
import { Type } from '/Users/kennethkwok/.nvm/versions/node/v24.13.0/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/typebox/build/index.mjs';
import {
  AuthStorage, createAgentSession, defineTool, ModelRegistry,
  SessionManager, SettingsManager,
} from '/Users/kennethkwok/.nvm/versions/node/v24.13.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js';
import { normalizeComparisonResult } from '../shared/comparisonSchema';

const itemA = process.argv[2] || 'Notion';
const itemB = process.argv[3] || 'Obsidian';
const ANALYST_CONCURRENCY = 3;

const deepseek = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' });
const CHAT_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

// ---------- shared infra ----------
const tokens = { prompt: 0, completion: 0, total: 0 };
const addUsage = (u: any) => {
  tokens.prompt += u?.prompt_tokens || u?.promptTokens || 0;
  tokens.completion += u?.completion_tokens || u?.completionTokens || 0;
  tokens.total += u?.total_tokens || u?.totalTokens || 0;
};

const allSources: Array<{ url: string; title: string }> = [];
const seenUrls = new Set<string>();
function trackSources(sources: Array<{ url: string; title: string }>) {
  for (const s of sources) {
    const norm = (s.url || '').replace(/\/+$/, '').toLowerCase();
    if (!norm || seenUrls.has(norm)) continue;
    seenUrls.add(norm);
    allSources.push(s);
  }
}

function makeSearchTool() {
  return defineTool({
    name: 'web_search',
    label: 'Web Search',
    description: 'Search the web for factual info. Returns titles, URLs, snippets.',
    parameters: Type.Object({ query: Type.String() }),
    execute: async (_id, params) => {
      const response = await fetch('https://api.minimaxi.com/v1/coding_plan/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: params.query }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await response.json().catch(() => ({})) as any;
      const results = (data.organic || data.results || []).slice(0, 5);
      trackSources(results.map((r: any) => ({ url: r.link || r.url, title: r.title })));
      const text = results.map((r: any, i: number) => `[${i + 1}] ${r.title}\n${r.link || r.url}\n${(r.snippet || '').slice(0, 300)}`).join('\n\n');
      return { content: [{ type: 'text', text: text || 'No results' }], details: {} };
    },
  });
}

async function agentSession(tools: any[], opts: { thinking?: 'off' | 'low' | 'medium' } = {}) {
  const authStorage = AuthStorage.create();
  if (process.env.MINIMAX_API_KEY) authStorage.setRuntimeApiKey('minimax-cn', process.env.MINIMAX_API_KEY);
  const modelRegistry = ModelRegistry.create(authStorage);
  const available = await modelRegistry.getAvailable();
  const model = available.find((m) => m.provider === 'minimax-cn') || available[0];
  return createAgentSession({
    model,
    thinkingLevel: opts.thinking || 'off',
    tools: tools.map((t) => t.name),
    customTools: tools,
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory({ retry: { enabled: true, maxRetries: 2 } }),
  });
}

function submitTool(name: string, schema: any, onSubmit: (v: any) => void) {
  return defineTool({
    name,
    label: name,
    description: 'Submit the final structured result. Call exactly once when done.',
    parameters: schema,
    execute: async (_id, params) => {
      onSubmit(params);
      return { content: [{ type: 'text', text: 'Accepted.' }], details: {} };
    },
  });
}

// ---------- Phase 1: research agents (agentic, parallel) ----------
const profileSchemaObj = Type.Object({
  profile: Type.Object({
    name: Type.String(), category: Type.String(), subcategory: Type.String(),
    short_definition: Type.String(), key_attributes: Type.Array(Type.String()),
  }),
  evidence_notes: Type.String({ description: 'Dense factual notes with specific data points, prices, specs, dates, review findings, citing source URLs inline.' }),
});

async function researchAgent(name: string) {
  let submitted: any = null;
  const tool = submitTool('submit_research', profileSchemaObj, (v) => { submitted = v; });
  const { session } = await agentSession([makeSearchTool(), tool]);
  await session.prompt(
    `Research "${name}" for a comparison article. Do AT MOST 4 targeted web_search calls (overview, pricing/specs, reviews, drawbacks), and put ALL independent queries in a SINGLE response (parallel tool calls, not one by one). Then call submit_research with: a short profile and dense evidence notes containing every concrete data point you found (numbers, prices, specs, dates, review conclusions) with source URLs inline.`,
  );
  session.dispose();
  if (!submitted) throw new Error(`research agent for ${name} did not submit`);
  return submitted as { profile: any; evidence_notes: string };
}

// ---------- Phase 2: architect (single direct call) ----------
const frameworkSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    relationship: { type: 'object', additionalProperties: false, properties: { relationship_type: { type: 'string' }, comparison_goal: { type: 'string' }, can_directly_compare: { type: 'boolean' }, reasoning: { type: 'string' } }, required: ['relationship_type', 'comparison_goal', 'can_directly_compare', 'reasoning'] },
    dimensions: { type: 'array', minItems: 4, maxItems: 6, items: { type: 'object', additionalProperties: false, properties: { key: { type: 'string' }, label: { type: 'string' }, why_it_matters: { type: 'string' }, comparison_angle: { type: 'string' } }, required: ['key', 'label', 'why_it_matters', 'comparison_angle'] } },
  },
  required: ['relationship', 'dimensions'],
};

async function architect(ra: any, rb: any) {
  const r = await deepseek.chat.completions.create({
    model: CHAT_MODEL, temperature: 0.2, response_format: { type: 'json_object' },
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: `Generate 4-6 tailored comparison dimensions for ${itemA} vs ${itemB}. JSON: {"relationship":{"relationship_type","comparison_goal","can_directly_compare","reasoning"},"dimensions":[{"key","label","why_it_matters","comparison_angle"}]}\n\nA: ${JSON.stringify(ra.profile)}\nB: ${JSON.stringify(rb.profile)}` }],
  } as any);
  addUsage((r as any).usage);
  return JSON.parse((r as any).choices[0].message.content);
}

// ---------- Phase 3: analyst agents (agentic, parallel, one per dimension) ----------
const analysisSchemaObj = Type.Object({
  item_a_summary: Type.String(), item_b_summary: Type.String(), key_difference: Type.String(),
  better_for: Type.Union([Type.Literal('A'), Type.Literal('B'), Type.Literal('Both'), Type.Literal('Neither')]),
  optional_score_a: Type.Number(), optional_score_b: Type.Number(),
  citations: Type.Array(Type.Object({ url: Type.String(), title: Type.String() }), { maxItems: 2 }),
});

async function analystAgent(dim: any, ra: any, rb: any, allowedSources: Array<{ url: string; title: string }>) {
  const sourceDigest = allowedSources.slice(0, 20).map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join('\n');
  const r = await deepseek.chat.completions.create({
    model: CHAT_MODEL, temperature: 0.2, response_format: { type: 'json_object' },
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: `Compare ${itemA} vs ${itemB} on ONE dimension: "${dim.label}" (${dim.why_it_matters}; angle: ${dim.comparison_angle}).

Entity A: ${ra.profile.short_definition}
Entity B: ${rb.profile.short_definition}

Evidence from research:
A: ${ra.evidence_notes.slice(0, 2500)}
B: ${rb.evidence_notes.slice(0, 2500)}

Score desirability 0-10 for both; ground every claim in the evidence with concrete data points. Citations only from allowlist:
${sourceDigest}

JSON: {"item_a_summary","item_b_summary","key_difference","better_for":"A|B|Both|Neither","optional_score_a","optional_score_b","citations":[{"url","title"}]}` }],
  } as any);
  addUsage((r as any).usage);
  return { ...dim, analysis: JSON.parse((r as any).choices[0].message.content) };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...await Promise.all(items.slice(i, i + limit).map(fn)));
  }
  return out;
}

// ---------- Phase 4: synthesis (2 parallel direct calls) ----------
async function synthesis(analyses: any[], ra: any, rb: any) {
  const digest = JSON.stringify(analyses.map((d) => ({ label: d.label, analysis: d.analysis }))).slice(0, 9000);
  const [pc, rec] = await Promise.all([
    deepseek.chat.completions.create({ model: CHAT_MODEL, temperature: 0.2, response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: `Extract pros/cons. JSON: {"item_a_pros":[],"item_a_cons":[],"item_b_pros":[],"item_b_cons":[]}\n${digest}` }] } as any),
    deepseek.chat.completions.create({ model: CHAT_MODEL, temperature: 0.2, response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: `Final verdict for ${itemA} vs ${itemB}. JSON: {"best_for_a":[],"best_for_b":[],"which_to_choose_first","when_not_to_compare_directly","short_verdict","long_verdict"}\n${digest}` }] } as any),
  ]);
  addUsage((pc as any).usage); addUsage((rec as any).usage);
  return { prosCons: JSON.parse((pc as any).choices[0].message.content), recommendation: JSON.parse((rec as any).choices[0].message.content) };
}

// ---------- run ----------
async function main() {
  const t0 = Date.now();

  const [ra, rb] = await Promise.all([researchAgent(itemA), researchAgent(itemB)]);
  const tResearch = Date.now() - t0;

  const t1 = Date.now();
  const framework = await architect(ra, rb);
  const tArch = Date.now() - t1;

  const t2 = Date.now();
  const analyses = await mapLimit(framework.dimensions, ANALYST_CONCURRENCY, (dim) => analystAgent(dim, ra, rb, allSources));
  const tAnalyst = Date.now() - t2;

  const t3 = Date.now();
  const { prosCons, recommendation } = await synthesis(analyses, ra, rb);
  const tSynth = Date.now() - t3;

  const total = Date.now() - t0;
  const result = {
    entityA: { ...ra.profile, normalized_name: ra.profile.name, likely_domain: '' },
    entityB: { ...rb.profile, normalized_name: rb.profile.name, likely_domain: '' },
    relationship: framework.relationship,
    dimensions: analyses, prosCons, recommendation, sources: allSources.slice(0, 20),
  };

  const valid = normalizeComparisonResult(result) !== null;
  const urls = new Set(allSources.map((s) => s.url));
  const citations = result.dimensions.flatMap((d) => d.analysis.citations || []);
  const validCites = citations.filter((c) => urls.has(c.url)).length;
  const summaryLens = result.dimensions.flatMap((d) => [d.analysis.item_a_summary, d.analysis.item_b_summary]).map((s) => s.length);
  const avgLen = Math.round(summaryLens.reduce((a, b) => a + b, 0) / summaryLens.length);

  console.log('\n=== HYBRID RESULT ===');
  console.log(`research ∥: ${tResearch}ms | architect: ${tArch}ms | analysts ∥(${result.dimensions.length}): ${tAnalyst}ms | synthesis: ${tSynth}ms`);
  console.log(`TOTAL wall: ${total}ms (~${(total / 1000).toFixed(1)}s)`);
  console.log(`tokens (chat only, agent tokens not metered by pi): ${tokens.total}`);
  console.log(`dims: ${result.dimensions.length} | schema valid: ${valid} | citations: ${validCites}/${citations.length} valid`);
  console.log(`avg summary length: ${avgLen} chars | verdict: ${recommendation.short_verdict?.slice(0, 120)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
