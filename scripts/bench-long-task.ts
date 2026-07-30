/**
 * Long-task benchmark: current per-phase pipeline vs single-call long task,
 * using REAL research (MiniMax search) and the PRODUCTION validator as the gate.
 *
 * Run: npx tsx scripts/bench-long-task.ts "Notion" "Obsidian" [zh-CN]
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import OpenAI from 'openai';
import { MinimaxProvider } from '../server/providers/minimax';
import { normalizeComparisonResult } from '../shared/comparisonSchema';

const itemA = process.argv[2] || 'Notion';
const itemB = process.argv[3] || 'Obsidian';
const language = process.argv[4] || 'en';
const langName = language === 'zh-CN' ? 'Simplified Chinese (简体中文)' : language === 'zh-TW' ? 'Traditional Chinese (繁體中文)' : 'English';

const deepseek = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' });
const provider = new MinimaxProvider(deepseek as any, process.env.MINIMAX_API_KEY!, {
  chatClient: deepseek as any,
  chatModel: process.env.DEEPSEEK_MODEL,
});

const analysisSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    item_a_summary: { type: 'string' }, item_b_summary: { type: 'string' },
    key_difference: { type: 'string' }, better_for: { type: 'string', enum: ['A', 'B', 'Both', 'Neither'] },
    optional_score_a: { type: 'number' }, optional_score_b: { type: 'number' },
    citations: { type: 'array', maxItems: 2, items: { type: 'object', additionalProperties: false, properties: { url: { type: 'string' }, title: { type: 'string' } }, required: ['url', 'title'] } },
  },
  required: ['item_a_summary', 'item_b_summary', 'key_difference', 'better_for', 'optional_score_a', 'optional_score_b', 'citations'],
};
const dimensionSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    key: { type: 'string' }, label: { type: 'string' },
    why_it_matters: { type: 'string' }, comparison_angle: { type: 'string' },
    analysis: analysisSchema,
  },
  required: ['key', 'label', 'why_it_matters', 'comparison_angle', 'analysis'],
};
const frameworkSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    relationship: {
      type: 'object', additionalProperties: false,
      properties: { relationship_type: { type: 'string' }, comparison_goal: { type: 'string' }, can_directly_compare: { type: 'boolean' }, reasoning: { type: 'string' } },
      required: ['relationship_type', 'comparison_goal', 'can_directly_compare', 'reasoning'],
    },
    dimensions: { type: 'array', minItems: 4, maxItems: 6, items: { type: 'object', additionalProperties: false, properties: { key: { type: 'string' }, label: { type: 'string' }, why_it_matters: { type: 'string' }, comparison_angle: { type: 'string' } }, required: ['key', 'label', 'why_it_matters', 'comparison_angle'] } },
  },
  required: ['relationship', 'dimensions'],
};
const prosConsSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    item_a_pros: { type: 'array', items: { type: 'string' } }, item_a_cons: { type: 'array', items: { type: 'string' } },
    item_b_pros: { type: 'array', items: { type: 'string' } }, item_b_cons: { type: 'array', items: { type: 'string' } },
  },
  required: ['item_a_pros', 'item_a_cons', 'item_b_pros', 'item_b_cons'],
};
const recommendationSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    best_for_a: { type: 'array', items: { type: 'string' } }, best_for_b: { type: 'array', items: { type: 'string' } },
    which_to_choose_first: { type: 'string' }, when_not_to_compare_directly: { type: 'string' },
    short_verdict: { type: 'string' }, long_verdict: { type: 'string' },
  },
  required: ['best_for_a', 'best_for_b', 'which_to_choose_first', 'when_not_to_compare_directly', 'short_verdict', 'long_verdict'],
};
const longTaskSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    dimensions: { type: 'array', minItems: 4, maxItems: 6, items: dimensionSchema },
    prosCons: prosConsSchema,
    recommendation: recommendationSchema,
  },
  required: ['dimensions', 'prosCons', 'recommendation'],
};

const profileSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    name: { type: 'string' }, normalized_name: { type: 'string' }, category: { type: 'string' },
    subcategory: { type: 'string' }, likely_domain: { type: 'string' }, short_definition: { type: 'string' },
    key_attributes: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'normalized_name', 'category', 'subcategory', 'likely_domain', 'short_definition', 'key_attributes'],
};

type Usage = { prompt: number; completion: number; total: number; ms: number };
const usageOf = (m: any): Usage => ({ prompt: m?.promptTokens || 0, completion: m?.completionTokens || 0, total: m?.totalTokens || 0, ms: m?.durationMs || 0 });

async function main() {
  // --- Shared research (same evidence for both variants) ---
  const t0 = Date.now();
  const [resA, resB] = await Promise.all([provider.research(itemA), provider.research(itemB)]);
  const researchMs = Date.now() - t0;
  const sources = [...resA.sources, ...resB.sources].slice(0, 20);
  const sourceList = sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join('\n');

  const profileOf = async (name: string, text: string) => {
    const r = await provider.chatCompletion({
      messages: [{ role: 'user', content: `Create a structured profile for "${name}" from this research. Return all text in ${langName}.\n\n${text.slice(0, 12000)}` }],
      schema: profileSchema, schemaName: 'profile', temperature: 0.1,
    });
    return { profile: JSON.parse(r.json), metrics: r.metrics };
  };
  const [pA, pB] = await Promise.all([profileOf(itemA, resA.text), profileOf(itemB, resB.text)]);

  const archPrompt = `Determine relationship and generate 4-6 tailored dimensions for ${itemA} vs ${itemB}. Refer to actual names. All text in ${langName}.\nA: ${JSON.stringify(pA.profile)}\nB: ${JSON.stringify(pB.profile)}`;
  const arch = await provider.chatCompletion({
    messages: [{ role: 'user', content: archPrompt }],
    schema: frameworkSchema, schemaName: 'framework', temperature: 0.2, enableThinking: true,
  });
  const framework = JSON.parse(arch.json);

  const shared = { researchMs, framework, sources, pA: pA.profile, pB: pB.profile };

  // ============ Variant 1: current per-phase ============
  const v1Start = Date.now();
  const v1Usage: Usage[] = [usageOf(pA.metrics), usageOf(pB.metrics), usageOf(arch.metrics)];
  const analyses = await Promise.all(framework.dimensions.map(async (dim: any) => {
    const r = await provider.chatCompletion({
      messages: [{ role: 'user', content: `Compare ${pA.profile.name} and ${pB.profile.name} only on "${dim.label}". Context: ${dim.why_it_matters}. Angle: ${dim.comparison_angle}. Score desirability 0-10. Cite ≤2 URLs only from: \n${sourceList}\nAll text in ${langName}.` }],
      schema: analysisSchema, schemaName: 'analysis', temperature: 0.2,
    });
    v1Usage.push(usageOf(r.metrics));
    return { ...dim, analysis: JSON.parse(r.json) };
  }));
  const digest = JSON.stringify(analyses).slice(0, 8000);
  const [pc, rec] = await Promise.all([
    provider.chatCompletion({ messages: [{ role: 'user', content: `Extract pros/cons for ${pA.profile.name} and ${pB.profile.name}. All text in ${langName}.\n${digest}` }], schema: prosConsSchema, schemaName: 'proscons', temperature: 0.2, enableThinking: true }),
    provider.chatCompletion({ messages: [{ role: 'user', content: `Final verdict for ${pA.profile.name} vs ${pB.profile.name}. All text in ${langName}.\n${digest}` }], schema: recommendationSchema, schemaName: 'recommendation', temperature: 0.2, enableThinking: true }),
  ]);
  v1Usage.push(usageOf(pc.metrics), usageOf(rec.metrics));
  const v1Ms = Date.now() - v1Start;
  const v1Result = {
    entityA: pA.profile, entityB: pB.profile, relationship: framework.relationship,
    dimensions: analyses, prosCons: JSON.parse(pc.json), recommendation: JSON.parse(rec.json), sources,
  };

  // ============ Variant 2: long task (single analysis+synthesis call) ============
  const v2Start = Date.now();
  const v2Usage: Usage[] = [usageOf(pA.metrics), usageOf(pB.metrics), usageOf(arch.metrics)];
  const longPrompt = `You have 4-6 dimensions for ${pA.profile.name} vs ${pB.profile.name}. In ONE response: (1) analyze BOTH entities on EVERY dimension with scores 0-10 desirability and ≤2 citations from SOURCES, (2) pros/cons, (3) final recommendation. Refer to actual names, never A/B. All text in ${langName}.

DIMENSIONS:
${framework.dimensions.map((d: any, i: number) => `${i + 1}. ${d.label} — ${d.why_it_matters} (${d.comparison_angle})`).join('\n')}

PROFILES:
${pA.profile.name}: ${pA.profile.short_definition}
${pB.profile.name}: ${pB.profile.short_definition}

SOURCES:
${sourceList}`;
  const [long, longFast] = await Promise.all([
    provider.chatCompletion({
      messages: [{ role: 'user', content: longPrompt }],
      schema: longTaskSchema, schemaName: 'long_task', temperature: 0.2, enableThinking: true,
    }),
    provider.chatCompletion({
      messages: [{ role: 'user', content: longPrompt }],
      schema: longTaskSchema, schemaName: 'long_task', temperature: 0.2, enableThinking: false,
    }),
  ]);
  v2Usage.push(usageOf(long.metrics));
  const v2Ms = Date.now() - v2Start;
  const longParsed = JSON.parse(long.json);
  const v3Usage: Usage[] = [usageOf(pA.metrics), usageOf(pB.metrics), usageOf(arch.metrics), usageOf(longFast.metrics)];
  const v3Ms = v2Ms;
  let v3Parsed: any = null;
  try { v3Parsed = JSON.parse(longFast.json); } catch {}
  const v2Result = {
    entityA: pA.profile, entityB: pB.profile, relationship: framework.relationship,
    dimensions: longParsed.dimensions, prosCons: longParsed.prosCons, recommendation: longParsed.recommendation, sources,
  };

  // ============ Evaluate ============
  const sum = (u: Usage[]) => u.reduce((a, x) => ({ prompt: a.prompt + x.prompt, completion: a.completion + x.completion, total: a.total + x.total, ms: a.ms }), { prompt: 0, completion: 0, total: 0, ms: 0 });
  const v1Tok = sum(v1Usage), v2Tok = sum(v2Usage);
  const v1Valid = normalizeComparisonResult(v1Result) !== null;
  const v2Valid = normalizeComparisonResult(v2Result) !== null;
  const v1CitationOk = v1Result.dimensions.every((d: any) => (d.analysis.citations || []).every((c: any) => sources.some((s) => s.url === c.url)));
  const v2CitationOk = v2Result.dimensions.every((d: any) => (d.analysis.citations || []).every((c: any) => sources.some((s) => s.url === c.url)));

  const v3Tok = sum(v3Usage);
  const v3Result = v3Parsed ? {
    entityA: pA.profile, entityB: pB.profile, relationship: framework.relationship,
    dimensions: v3Parsed.dimensions, prosCons: v3Parsed.prosCons, recommendation: v3Parsed.recommendation, sources,
  } : null;
  const v3Valid = v3Result ? normalizeComparisonResult(v3Result) !== null : false;

  console.log('\nvariant             | total tok | schema valid');
  console.log(`current-phase       | ${String(v1Tok.total).padEnd(9)} | ${v1Valid}`);
  console.log(`long-task(thinking) | ${String(v2Tok.total).padEnd(9)} | ${v2Valid}`);
  console.log(`long-task(no-think) | ${String(v3Tok.total).padEnd(9)} | ${v3Valid}`);
  console.log(`wall: current=${v1Ms}ms, long-thinking~${long.metrics.durationMs}ms call, long-no-think~${longFast.metrics.durationMs}ms call`);
  console.log(`\nresearch shared: ${researchMs}ms`);
  console.log(`token saved (thinking): ${(((v1Tok.total - v2Tok.total) / v1Tok.total) * 100).toFixed(1)}%`);
  console.log(`token saved (no-think): ${(((v1Tok.total - v3Tok.total) / v1Tok.total) * 100).toFixed(1)}%`);
  console.log(`\nv1 verdict: ${v1Result.recommendation.short_verdict?.slice(0, 120)}`);
  console.log(`v2 verdict: ${v2Result.recommendation.short_verdict?.slice(0, 120)}`);
  console.log(`v3 verdict: ${v3Result?.recommendation.short_verdict?.slice(0, 120) || 'PARSE FAILED'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
