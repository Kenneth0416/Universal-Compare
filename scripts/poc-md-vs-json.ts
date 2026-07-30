/**
 * Experiment v2: MD wire format vs JSON wire format — controlled comparison.
 * thinking disabled; outputs saved for inspection; robust-ish MD parser;
 * truncation resilience tested at ~700 tokens.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import OpenAI from 'openai';
import fs from 'node:fs';

const client = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' });
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

const TASK = `Compare "Notion" vs "Obsidian" with exactly 2 dimensions (collaboration, privacy).
Fields needed: relationship (type, goal), dimensions (label; A score/10 + summary; B score/10 + summary; better A|B|Both|Neither; 1 citation), short verdict, 2 sources.`;

const MD_SPEC = `Respond ONLY in this exact markdown template:
## Relationship
- Type: <same_category|cross_category|alternatives|complements|analogy|not_comparable>
- Goal: <text>
## Dimensions
### D1: <label>
- A: <score>/10 — <summary>
- B: <score>/10 — <summary>
- Better: A|B|Both|Neither
- Citation: [title](url)
### D2: <label>
(same fields)
## Verdict
<text>
## Sources
1. [title](url)
2. [title](url)`;

const DASH = /[—–-]\s*/;

function parseMd(md: string) {
  const result: any = { dimensions: [], sources: [], errors: [] as string[] };
  const relType = md.match(/- Type:\s*([a-z_]+)/i)?.[1];
  const relGoal = md.match(/- Goal:\s*(.+)/)?.[1]?.trim();
  if (relType) result.relationship = { relationship_type: relType, comparison_goal: relGoal || '' };
  else result.errors.push('relationship');

  const dimBlocks = md.split(/^### D\d+:/m).slice(1);
  for (const block of dimBlocks) {
    const label = block.split('\n')[0]?.trim();
    const a = block.match(new RegExp(`^- A:\\s*([\\d.]+)\\s*/10\\s*${DASH.source}(.+)$`, 'm'));
    const b = block.match(new RegExp(`^- B:\\s*([\\d.]+)\\s*/10\\s*${DASH.source}(.+)$`, 'm'));
    const better = block.match(/- Better:\s*(A|B|Both|Neither)/)?.[1];
    const citation = block.match(/- Citation:\s*\[([^\]]+)\]\(([^)\s]+)\)/);
    if (label && a && b && better) {
      result.dimensions.push({
        label,
        analysis: {
          item_a_summary: a[2].trim(), item_b_summary: b[2].trim(),
          optional_score_a: Number(a[1]), optional_score_b: Number(b[1]),
          better_for: better,
          citations: citation ? [{ title: citation[1], url: citation[2] }] : [],
        },
      });
    } else result.errors.push(`dimension:${label || '?'}`);
  }

  const verdict = md.match(/## Verdict\n([\s\S]*?)(?=\n## |$)/)?.[1]?.trim();
  if (verdict) result.recommendation = { short_verdict: verdict.replace(/\n+/g, ' ') };
  else result.errors.push('verdict');

  for (const m of md.matchAll(/^\d+\.\s*\[([^\]]+)\]\(([^)\s]+)\)/gm)) {
    result.sources.push({ title: m[1], url: m[2] });
  }
  if (!result.sources.length) result.errors.push('sources');
  return result;
}

async function run(mode: 'json' | 'md', maxTokens: number, tag: string) {
  const start = Date.now();
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{
      role: 'user',
      content: mode === 'json'
        ? `${TASK}\n\nRespond ONLY with raw JSON: {"relationship":{"relationship_type","comparison_goal"},"dimensions":[{"label","analysis":{"item_a_summary","item_b_summary","optional_score_a","optional_score_b","better_for","citations":[{"title","url"}]}}],"recommendation":{"short_verdict"},"sources":[{"title","url"}]}`
        : `${TASK}\n\n${MD_SPEC}`,
    }],
    temperature: 0.2,
    max_tokens: maxTokens,
    thinking: { type: 'disabled' },
  } as any);
  const ms = Date.now() - start;
  const text = (response as any).choices?.[0]?.message?.content || '';
  const usage = (response as any).usage || {};
  fs.writeFileSync(`/tmp/exp-${mode}-${tag}.txt`, text);

  let parsed: any = null;
  let errors: string[] = [];
  if (mode === 'json') {
    try { parsed = JSON.parse(text); } catch { parsed = null; errors = ['json-parse']; }
  } else {
    parsed = parseMd(text);
    errors = parsed.errors;
  }
  const dims = parsed?.dimensions?.length || 0;
  const sources = parsed?.sources?.length || 0;
  console.log(`${mode}-${tag}: ${ms}ms | prompt=${usage.prompt_tokens} completion=${usage.completion_tokens} total=${usage.total_tokens} | chars=${text.length} | dims=${dims}/2 sources=${sources}/2 verdict=${parsed?.recommendation?.short_verdict ? 1 : 0} errors=[${errors}]`);
  return { mode, tag, ms, usage, text, parsed };
}

console.log('--- full runs ---');
await run('json', 3000, 'full');
await run('md', 3000, 'full');
console.log('--- truncation (~700 max tokens) ---');
await run('json', 700, 'trunc');
await run('md', 700, 'trunc');
