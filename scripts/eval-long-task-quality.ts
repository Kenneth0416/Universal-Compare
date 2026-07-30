/**
 * Objective quality evaluation: current per-phase vs long-task(no-think).
 * Metrics: citation validity/coverage, score-winner consistency, specificity,
 * plus a blind LLM judge (faithfulness/accuracy/completeness/balance).
 *
 * Run: npx tsx scripts/eval-long-task-quality.ts "Notion" "Obsidian"
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import OpenAI from 'openai';
import { MinimaxProvider } from '../server/providers/minimax';
import { normalizeComparisonResult } from '../shared/comparisonSchema';

const itemA = process.argv[2] || 'Notion';
const itemB = process.argv[3] || 'Obsidian';

const deepseek = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' });
const provider = new MinimaxProvider(deepseek as any, process.env.MINIMAX_API_KEY!, {
  chatClient: deepseek as any, chatModel: process.env.DEEPSEEK_MODEL,
});

const analysisSchema = { type: 'object', additionalProperties: false, properties: { item_a_summary: { type: 'string' }, item_b_summary: { type: 'string' }, key_difference: { type: 'string' }, better_for: { type: 'string', enum: ['A', 'B', 'Both', 'Neither'] }, optional_score_a: { type: 'number' }, optional_score_b: { type: 'number' }, citations: { type: 'array', maxItems: 2, items: { type: 'object', additionalProperties: false, properties: { url: { type: 'string' }, title: { type: 'string' } }, required: ['url', 'title'] } } }, required: ['item_a_summary', 'item_b_summary', 'key_difference', 'better_for', 'optional_score_a', 'optional_score_b', 'citations'] };
const dimAnalysisSchema = { ...analysisSchema };
const frameworkSchema = { type: 'object', additionalProperties: false, properties: { relationship: { type: 'object', additionalProperties: false, properties: { relationship_type: { type: 'string' }, comparison_goal: { type: 'string' }, can_directly_compare: { type: 'boolean' }, reasoning: { type: 'string' } }, required: ['relationship_type', 'comparison_goal', 'can_directly_compare', 'reasoning'] }, dimensions: { type: 'array', minItems: 4, maxItems: 6, items: { type: 'object', additionalProperties: false, properties: { key: { type: 'string' }, label: { type: 'string' }, why_it_matters: { type: 'string' }, comparison_angle: { type: 'string' } }, required: ['key', 'label', 'why_it_matters', 'comparison_angle'] } } }, required: ['relationship', 'dimensions'] };
const profileSchema = { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, normalized_name: { type: 'string' }, category: { type: 'string' }, subcategory: { type: 'string' }, likely_domain: { type: 'string' }, short_definition: { type: 'string' }, key_attributes: { type: 'array', items: { type: 'string' } } }, required: ['name', 'normalized_name', 'category', 'subcategory', 'likely_domain', 'short_definition', 'key_attributes'] };
const prosConsSchema = { type: 'object', additionalProperties: false, properties: { item_a_pros: { type: 'array', items: { type: 'string' } }, item_a_cons: { type: 'array', items: { type: 'string' } }, item_b_pros: { type: 'array', items: { type: 'string' } }, item_b_cons: { type: 'array', items: { type: 'string' } } }, required: ['item_a_pros', 'item_a_cons', 'item_b_pros', 'item_b_cons'] };
const recommendationSchema = { type: 'object', additionalProperties: false, properties: { best_for_a: { type: 'array', items: { type: 'string' } }, best_for_b: { type: 'array', items: { type: 'string' } }, which_to_choose_first: { type: 'string' }, when_not_to_compare_directly: { type: 'string' }, short_verdict: { type: 'string' }, long_verdict: { type: 'string' } }, required: ['best_for_a', 'best_for_b', 'which_to_choose_first', 'when_not_to_compare_directly', 'short_verdict', 'long_verdict'] };
const dimensionSchema = { type: 'object', additionalProperties: false, properties: { key: { type: 'string' }, label: { type: 'string' }, why_it_matters: { type: 'string' }, comparison_angle: { type: 'string' }, analysis: dimAnalysisSchema }, required: ['key', 'label', 'why_it_matters', 'comparison_angle', 'analysis'] };
const longTaskSchema = { type: 'object', additionalProperties: false, properties: { dimensions: { type: 'array', minItems: 4, maxItems: 6, items: dimensionSchema }, prosCons: prosConsSchema, recommendation: recommendationSchema }, required: ['dimensions', 'prosCons', 'recommendation'] };

const NUMBER_RE = /\d+(\.\d+)?\s*(%|GB|TB|MB|mAh|MP|Hz|W|hours?|years?|\$|USD|EUR|devices?|users?|plugins?|x\b)/i;

function metrics(result: any, sources: any[]) {
  const dims = result.dimensions || [];
  const urls = new Set(sources.map((s) => s.url));
  const citations = dims.flatMap((d: any) => d.analysis?.citations || []);
  const validCitations = citations.filter((c: any) => urls.has(c.url));
  const consistent = dims.filter((d: any) => {
    const a = d.analysis?.optional_score_a, b = d.analysis?.optional_score_b, bf = d.analysis?.better_for;
    if (typeof a !== 'number' || typeof b !== 'number') return true;
    if (bf === 'A') return a > b;
    if (bf === 'B') return b > a;
    return true;
  });
  const summaries = dims.flatMap((d: any) => [d.analysis?.item_a_summary || '', d.analysis?.item_b_summary || '', d.analysis?.key_difference || '']);
  const specific = summaries.filter((s: string) => NUMBER_RE.test(s)).length;
  const avgSummaryLen = summaries.reduce((a: number, s: string) => a + s.length, 0) / Math.max(1, summaries.length);
  return {
    dims: dims.length,
    citationsTotal: citations.length,
    citationsValidPct: citations.length ? Math.round((validCitations.length / citations.length) * 100) : 100,
    dimsWithCitationPct: Math.round((dims.filter((d: any) => (d.analysis?.citations || []).length > 0).length / Math.max(1, dims.length)) * 100),
    scoreWinnerConsistencyPct: Math.round((consistent.length / Math.max(1, dims.length)) * 100),
    specificityRatio: `${specific}/${summaries.length}`,
    avgSummaryChars: Math.round(avgSummaryLen),
    verdictChars: (result.recommendation?.long_verdict || '').length,
    prosConsCount: ['item_a_pros', 'item_a_cons', 'item_b_pros', 'item_b_cons'].reduce((n, k) => n + (result.prosCons?.[k]?.length || 0), 0),
  };
}

async function main() {
  const [resA, resB] = await Promise.all([provider.research(itemA), provider.research(itemB)]);
  const sources = [...resA.sources, ...resB.sources].slice(0, 20);
  const sourceList = sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join('\n');
  const sourceText = `RESEARCH A:\n${resA.text.slice(0, 6000)}\n\nRESEARCH B:\n${resB.text.slice(0, 6000)}`;

  const profileOf = async (name: string, text: string) => JSON.parse((await provider.chatCompletion({
    messages: [{ role: 'user', content: `Create a structured profile for "${name}" from this research.\n\n${text.slice(0, 12000)}` }],
    schema: profileSchema, schemaName: 'profile', temperature: 0.1,
  })).json);
  const [pA, pB] = await Promise.all([profileOf(itemA, resA.text), profileOf(itemB, resB.text)]);
  const framework = JSON.parse((await provider.chatCompletion({
    messages: [{ role: 'user', content: `Generate 4-6 tailored dimensions for ${itemA} vs ${itemB}.\nA: ${JSON.stringify(pA)}\nB: ${JSON.stringify(pB)}` }],
    schema: frameworkSchema, schemaName: 'framework', temperature: 0.2, enableThinking: true,
  })).json);

  // current per-phase
  const analyses = await Promise.all(framework.dimensions.map(async (dim: any) => ({
    ...dim,
    analysis: JSON.parse((await provider.chatCompletion({
      messages: [{ role: 'user', content: `Compare ${pA.name} and ${pB.name} only on "${dim.label}". Context: ${dim.why_it_matters}. Angle: ${dim.comparison_angle}. Score 0-10. Cite ≤2 URLs from:\n${sourceList}` }],
      schema: analysisSchema, schemaName: 'analysis', temperature: 0.2,
    })).json),
  })));
  const digest = JSON.stringify(analyses).slice(0, 8000);
  const [pc, rec] = await Promise.all([
    provider.chatCompletion({ messages: [{ role: 'user', content: `Extract pros/cons for ${pA.name} and ${pB.name}.\n${digest}` }], schema: prosConsSchema, schemaName: 'proscons', temperature: 0.2, enableThinking: true }),
    provider.chatCompletion({ messages: [{ role: 'user', content: `Final verdict for ${pA.name} vs ${pB.name}.\n${digest}` }], schema: recommendationSchema, schemaName: 'recommendation', temperature: 0.2, enableThinking: true }),
  ]);
  const current = { entityA: pA, entityB: pB, relationship: framework.relationship, dimensions: analyses, prosCons: JSON.parse(pc.json), recommendation: JSON.parse(rec.json), sources };

  // long task
  const long = await provider.chatCompletion({
    messages: [{ role: 'user', content: `Analyze ${pA.name} vs ${pB.name} on EVERY dimension below in ONE response with scores 0-10 and ≤2 citations from SOURCES, then pros/cons and recommendation. Refer to actual names.\n\nDIMENSIONS:\n${framework.dimensions.map((d: any, i: number) => `${i + 1}. ${d.label} — ${d.why_it_matters} (${d.comparison_angle})`).join('\n')}\n\nPROFILES:\n${pA.name}: ${pA.short_definition}\n${pB.name}: ${pB.short_definition}\n\nSOURCES:\n${sourceList}` }],
    schema: longTaskSchema, schemaName: 'long_task', temperature: 0.2, enableThinking: false,
  });
  const longParsed = JSON.parse(long.json);
  const longTask = { entityA: pA, entityB: pB, relationship: framework.relationship, dimensions: longParsed.dimensions, prosCons: longParsed.prosCons, recommendation: longParsed.recommendation, sources };

  const mCurrent = metrics(current, sources);
  const mLong = metrics(longTask, sources);
  console.log('metric                      | current | long-task');
  for (const k of Object.keys(mCurrent) as (keyof typeof mCurrent)[]) {
    console.log(`${k.padEnd(28)}| ${String(mCurrent[k]).padEnd(7)} | ${mLong[k]}`);
  }
  console.log(`schema valid                | ${normalizeComparisonResult(current) !== null}      | ${normalizeComparisonResult(longTask) !== null}`);

  // blind judge
  const strip = (r: any) => ({
    relationship: r.relationship,
    dimensions: r.dimensions.map((d: any) => ({ label: d.label, analysis: d.analysis })),
    prosCons: r.prosCons,
    recommendation: r.recommendation,
  });
  const flip = Math.random() > 0.5;
  const first = flip ? strip(current) : strip(longTask);
  const second = flip ? strip(longTask) : strip(current);
  const judge = await provider.chatCompletion({
    messages: [{ role: 'user', content: `You are a strict evaluator. Two AI-generated comparison reports for "${itemA} vs ${itemB}" follow the same framework. Score each 0-10 on: faithfulness (claims supported by the provided research, no invented facts), specificity (concrete data vs vague), completeness (covers the dimensions with depth), balance (fair to both). Also name the better overall report.

RESEARCH (ground truth):
${sourceText}

REPORT 1:
${JSON.stringify(first).slice(0, 9000)}

REPORT 2:
${JSON.stringify(second).slice(0, 9000)}

Output JSON: {"r1":{"faithfulness","specificity","completeness","balance","total"},"r2":{...same},"winner":"1|2|tie","notes":"one sentence"}` }],
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        r1: { type: 'object', additionalProperties: false, properties: { faithfulness: { type: 'number' }, specificity: { type: 'number' }, completeness: { type: 'number' }, balance: { type: 'number' }, total: { type: 'number' } }, required: ['faithfulness', 'specificity', 'completeness', 'balance', 'total'] },
        r2: { type: 'object', additionalProperties: false, properties: { faithfulness: { type: 'number' }, specificity: { type: 'number' }, completeness: { type: 'number' }, balance: { type: 'number' }, total: { type: 'number' } }, required: ['faithfulness', 'specificity', 'completeness', 'balance', 'total'] },
        winner: { type: 'string' }, notes: { type: 'string' },
      },
      required: ['r1', 'r2', 'winner', 'notes'],
    },
    schemaName: 'judgement', temperature: 0.1, enableThinking: true,
  });
  const j = JSON.parse(judge.json);
  const r1IsCurrent = flip;
  console.log('\n--- blind judge (thinking) ---');
  console.log(`Report 1 was: ${r1IsCurrent ? 'CURRENT' : 'LONG-TASK'}`);
  console.log(`current:   total=${(r1IsCurrent ? j.r1 : j.r2).total} detail=${JSON.stringify(r1IsCurrent ? j.r1 : j.r2)}`);
  console.log(`long-task: total=${(r1IsCurrent ? j.r2 : j.r1).total} detail=${JSON.stringify(r1IsCurrent ? j.r2 : j.r1)}`);
  const winnerLabel = j.winner === 'tie' ? 'tie' : (j.winner === '1') === r1IsCurrent ? 'current' : 'long-task';
  console.log(`winner: ${winnerLabel} — ${j.notes}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
