/**
 * A/B test: does an optimized "compare-researcher" skill reduce searches/turns/time
 * while preserving evidence quality? Same entity, baseline prompt vs skilled prompt.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Type } from '/Users/kennethkwok/.nvm/versions/node/v24.13.0/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/typebox/build/index.mjs';
import {
  AuthStorage, createAgentSession, DefaultResourceLoader, defineTool,
  ModelRegistry, SessionManager, SettingsManager,
} from '/Users/kennethkwok/.nvm/versions/node/v24.13.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js';

const entity = process.argv[2] || 'Fujifilm X-T50';

const sources: Array<{ url: string; title: string }> = [];
const searchTool = defineTool({
  name: 'web_search',
  label: 'Web Search',
  description: 'Search the web for factual info.',
  parameters: Type.Object({ query: Type.String() }),
  execute: async (_id, params) => {
    const r = await fetch('https://api.minimaxi.com/v1/coding_plan/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: params.query }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await r.json().catch(() => ({})) as any;
    const results = (data.organic || data.results || []).slice(0, 5);
    results.forEach((x: any) => sources.push({ url: x.link || x.url, title: x.title }));
    return { content: [{ type: 'text', text: results.map((x: any, i: number) => `[${i + 1}] ${x.title}\n${x.link || x.url}\n${(x.snippet || '').slice(0, 250)}`).join('\n\n') || 'none' }], details: {} };
  },
});

let submitted: any = null;
const submitTool = defineTool({
  name: 'submit_research',
  label: 'Submit Research',
  description: 'Submit final structured research. Call once when done.',
  parameters: Type.Object({
    profile: Type.Object({ name: Type.String(), category: Type.String(), short_definition: Type.String() }),
    evidence_notes: Type.String(),
  }),
  execute: async (_id, params) => {
    submitted = params;
    return { content: [{ type: 'text', text: 'ok' }], details: {} };
  },
});

const BASELINE = `Research "${entity}" thoroughly for a comparison article, then call submit_research with a profile and evidence notes.`;

const SKILL = `You are executing the "compare-researcher" skill.

## Research protocol (follow exactly, do not exceed)
1. Plan at most 4 queries covering: (a) overview + key specs, (b) price/value, (c) expert review conclusions, (d) weaknesses/user complaints.
2. Issue ALL independent queries in ONE response (parallel tool calls). Never search one query per turn.
3. Stop conditions — submit immediately when ANY is true:
   - You have >= 10 concrete data points (numbers, prices, specs, dates, review verdicts), or
   - 2 search rounds done. Never do a 3rd round.
4. Do NOT search for: history, trivia, unboxings, or anything not decision-relevant.
5. submit_research with:
   - profile: 1-2 sentence definition
   - evidence_notes: bullet-dense facts, each with a number or specific claim and its source URL. No filler text.

Research subject: "${entity}"`;

async function run(label: string, prompt: string, systemPrompt?: string) {
  const authStorage = AuthStorage.create();
  if (process.env.MINIMAX_API_KEY) authStorage.setRuntimeApiKey('minimax-cn', process.env.MINIMAX_API_KEY);
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = (await modelRegistry.getAvailable()).find((m) => m.provider === 'minimax-cn');

  submitted = null;
  sources.length = 0;
  let searches = 0;
  let turns = 0;

  const loader = systemPrompt
    ? new DefaultResourceLoader({ systemPromptOverride: () => systemPrompt })
    : undefined;
  if (loader) await loader.reload();

  const { session } = await createAgentSession({
    model,
    thinkingLevel: 'off',
    tools: ['web_search', 'submit_research'],
    customTools: [searchTool, submitTool],
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory(),
    ...(loader ? { resourceLoader: loader } : {}),
  });
  session.subscribe((e) => {
    if (e.type === 'tool_execution_start' && e.toolName === 'web_search') searches += 1;
    if (e.type === 'turn_end') turns += 1;
  });

  const start = Date.now();
  await session.prompt(prompt);
  const ms = Date.now() - start;
  session.dispose();

  const notes: string = submitted?.evidence_notes || '';
  const dataPoints = (notes.match(/\d+/g) || []).length;
  console.log(`${label}: ${ms}ms | searches=${searches} turns=${turns} sources=${sources.length} notesLen=${notes.length} dataPoints~${dataPoints} submitted=${!!submitted}`);
  return { label, ms, searches, turns, sources: sources.length, notesLen: notes.length, dataPoints };
}

await run('baseline', BASELINE);
await run('skilled ', SKILL);
