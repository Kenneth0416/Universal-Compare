/**
 * Real-pipeline efficiency test: current per-phase JSON calls vs
 * per-phase Markdown (parsed) vs monolithic Markdown long-task output.
 * Uses production-style prompts from comparisonAgentApi and DeepSeek.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' });
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

const A = 'Notion';
const B = 'Obsidian';
const PROFILE_A = 'Notion is a cloud-based all-in-one workspace combining notes, databases, tasks, and real-time collaboration.';
const PROFILE_B = 'Obsidian is a local-first Markdown knowledge base with a large plugin ecosystem, focused on privacy and customization.';
const DIMENSIONS = ['Collaboration', 'Privacy & data ownership', 'Customization', 'Learning curve'];

type Usage = { prompt: number; completion: number; total: number };
const zero: Usage = { prompt: 0, completion: 0, total: 0 };

async function call(user: string, opts: { json?: boolean; maxTokens?: number } = {}) {
  const start = Date.now();
  const r = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: user }],
    temperature: 0.2,
    max_tokens: opts.maxTokens || 4000,
    thinking: { type: 'disabled' },
    ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
  } as any);
  const u = (r as any).usage || {};
  return {
    ms: Date.now() - start,
    text: (r as any).choices?.[0]?.message?.content || '',
    usage: { prompt: u.prompt_tokens || 0, completion: u.completion_tokens || 0, total: u.total_tokens || 0 } as Usage,
  };
}

const DASH = '[—–-]';
function parseMdDimensions(md: string) {
  const dims: any[] = [];
  const blocks = md.split(/^### D\d+:/m).slice(1);
  for (const block of blocks) {
    const label = block.split('\n')[0]?.trim();
    const a = block.match(new RegExp(`^- A:\\s*([\\d.]+)\\s*/10\\s*${DASH}\\s*(.+)$`, 'm'));
    const b = block.match(new RegExp(`^- B:\\s*([\\d.]+)\\s*/10\\s*${DASH}\\s*(.+)$`, 'm'));
    const better = block.match(/- Better:\s*(A|B|Both|Neither)/)?.[1];
    if (label && a && b && better) {
      dims.push({ label, analysis: { item_a_summary: a[2].trim(), item_b_summary: b[2].trim(), optional_score_a: Number(a[1]), optional_score_b: Number(b[1]), better_for: better } });
    }
  }
  return dims;
}
function parseList(md: string, header: string) {
  const sec = md.split(new RegExp(`^## ${header}`, 'm'))[1]?.split(/^## /m)[0] || '';
  return [...sec.matchAll(/^- (.+)$/gm)].map((m) => m[1].trim());
}

// ---------- Variant A: current JSON multi-call ----------
async function variantJson() {
  const usage = { ...zero };
  let ms = 0;
  const add = (r: any) => { usage.prompt += r.usage.prompt; usage.completion += r.usage.completion; usage.total += r.usage.total; ms += r.ms; };

  // architect
  add(await call(`Generate exactly 4 comparison dimensions for ${A} vs ${B}. JSON: {"dimensions":[{"key","label","why_it_matters","comparison_angle"}]}`, { json: true }));

  // analysts ×4 (parallel like production)
  const analystPrompt = (d: string) => `Compare ${A} and ${B} on "${d}". ${A}: ${PROFILE_A} ${B}: ${PROFILE_B}
Score desirability 0-10. JSON: {"item_a_summary","item_b_summary","key_difference","better_for": "A|B|Both|Neither","optional_score_a": 0-10,"optional_score_b": 0-10,"citations": []}`;
  const analystResults = await Promise.all(DIMENSIONS.map((d) => call(analystPrompt(d), { json: true })));
  analystResults.forEach(add);
  const parsedDims = analystResults.map((r, i) => {
    try { return { label: DIMENSIONS[i], analysis: JSON.parse(r.text) }; } catch { return null; }
  });

  // pros/cons + recommendation (parallel like production)
  const analysisDigest = parsedDims.map((d) => d ? `${d.label}: A=${d.analysis.optional_score_a} B=${d.analysis.optional_score_b}` : '').join('\n');
  const [pc, rec] = await Promise.all([
    call(`Extract pros/cons for ${A} and ${B} from analysis:\n${analysisDigest}\nJSON: {"item_a_pros":[],"item_a_cons":[],"item_b_pros":[],"item_b_cons":[]}`, { json: true }),
    call(`Give final verdict for ${A} vs ${B}:\n${analysisDigest}\nJSON: {"best_for_a":[],"best_for_b":[],"which_to_choose_first","when_not_to_compare_directly","short_verdict","long_verdict"}`, { json: true }),
  ]);
  add(pc); add(rec);

  let ok = true;
  try { JSON.parse(pc.text); JSON.parse(rec.text); } catch { ok = false; }
  ok = ok && parsedDims.every(Boolean);
  return { variant: 'JSON-multi-call', calls: 7, ms, usage, parsedDims: parsedDims.filter(Boolean).length, parseOk: ok };
}

// ---------- Variant B: per-phase MD ----------
async function variantMdPhased() {
  const usage = { ...zero };
  let ms = 0;
  const add = (r: any) => { usage.prompt += r.usage.prompt; usage.completion += r.usage.completion; usage.total += r.usage.total; ms += r.ms; };

  add(await call(`List exactly 4 comparison dimensions for ${A} vs ${B} as a markdown bullet list: "- <label>: <why it matters>"`));

  const analystPrompt = (d: string) => `Compare ${A} and ${B} on "${d}". ${A}: ${PROFILE_A} ${B}: ${PROFILE_B}
Score desirability 0-10. Respond ONLY:
### D1: ${d}
- A: <score>/10 — <summary>
- B: <score>/10 — <summary>
- Difference: <text>
- Better: A|B|Both|Neither`;
  const analystResults = await Promise.all(DIMENSIONS.map((d) => call(analystPrompt(d))));
  analystResults.forEach(add);
  const parsedDims = analystResults.flatMap((r) => parseMdDimensions(r.text));

  const digest = parsedDims.map((d) => `${d.label}: A=${d.analysis.optional_score_a} B=${d.analysis.optional_score_b}`).join('\n');
  const [pc, rec] = await Promise.all([
    call(`Extract pros/cons for ${A} and ${B}:\n${digest}\nRespond ONLY:\n## ProsA\n- ...\n## ConsA\n- ...\n## ProsB\n- ...\n## ConsB\n- ...`),
    call(`Give final verdict for ${A} vs ${B}:\n${digest}\nRespond ONLY:\n## Verdict\n<text>`),
  ]);
  add(pc); add(rec);

  const pcOk = parseList(pc.text, 'ProsA').length > 0 && parseList(pc.text, 'ConsB').length > 0;
  const recOk = Boolean(pc.text && rec.text.trim().length > 20);
  return { variant: 'MD-phased', calls: 7, ms, usage, parsedDims: parsedDims.length, parseOk: pcOk && recOk && parsedDims.length === 4 };
}

// ---------- Variant C: monolithic MD (analysis+synthesis in 2 calls) ----------
async function variantMdMonolith() {
  const usage = { ...zero };
  let ms = 0;
  const add = (r: any) => { usage.prompt += r.usage.prompt; usage.completion += r.usage.completion; usage.total += r.usage.total; ms += r.ms; };

  add(await call(`List exactly 4 comparison dimensions for ${A} vs ${B} as a markdown bullet list.`));

  const big = await call(`Compare ${A} vs ${B} on ALL of these dimensions: ${DIMENSIONS.join(', ')}.
${A}: ${PROFILE_A}
${B}: ${PROFILE_B}
Score desirability 0-10 for each. Then pros/cons and verdict. Respond ONLY in this template:
### D1: Collaboration
- A: <score>/10 — <summary>
- B: <score>/10 — <summary>
- Difference: <text>
- Better: A|B|Both|Neither
### D2: Privacy & data ownership
(same fields)
### D3: Customization
(same fields)
### D4: Learning curve
(same fields)
## ProsA
- ...
## ConsA
- ...
## ProsB
- ...
## ConsB
- ...
## Verdict
<text>`, { maxTokens: 4000 });
  add(big);

  const parsedDims = parseMdDimensions(big.text);
  const pcOk = parseList(big.text, 'ProsA').length > 0 && parseList(big.text, 'ConsB').length > 0;
  const verdictOk = /## Verdict\n[\s\S]{20,}/.test(big.text);
  return { variant: 'MD-monolith', calls: 2, ms, usage, parsedDims: parsedDims.length, parseOk: pcOk && verdictOk && parsedDims.length === 4 };
}

const results = [];
results.push(await variantJson());
results.push(await variantMdPhased());
results.push(await variantMdMonolith());

console.log('\nvariant          | calls | wall ms | prompt tok | completion tok | total tok | dims parsed | parse OK');
for (const r of results) {
  console.log(
    `${r.variant.padEnd(16)} | ${String(r.calls).padEnd(5)} | ${String(r.ms).padEnd(7)} | ${String(r.usage.prompt).padEnd(10)} | ${String(r.usage.completion).padEnd(14)} | ${String(r.usage.total).padEnd(9)} | ${String(r.parsedDims).padEnd(11)} | ${r.parseOk}`,
  );
}
