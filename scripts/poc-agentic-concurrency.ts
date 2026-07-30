/**
 * Experiment: does pi execute parallel tool calls in one turn concurrently?
 * Forces the agent to issue exactly 4 searches in a single turn and times each.
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

const timings: Array<{ query: string; start: number; end: number }> = [];
const t0 = Date.now();

const slowSearch = defineTool({
  name: 'web_search',
  label: 'Web Search',
  description: 'Search the web (simulated latency 3s).',
  parameters: Type.Object({ query: Type.String() }),
  execute: async (_id, params) => {
    const start = Date.now();
    await new Promise((r) => setTimeout(r, 3000));
    const end = Date.now();
    timings.push({ query: params.query, start: start - t0, end: end - t0 });
    return { content: [{ type: 'text', text: `Results for ${params.query}: ...` }], details: {} };
  },
});

async function main() {
  const authStorage = AuthStorage.create();
  if (process.env.MINIMAX_API_KEY) authStorage.setRuntimeApiKey('minimax-cn', process.env.MINIMAX_API_KEY);
  const modelRegistry = ModelRegistry.create(authStorage);
  const available = await modelRegistry.getAvailable();
  const model = available.find((m) => m.provider === 'minimax-cn') || available[0];
  if (!model) throw new Error('no model');

  const { session } = await createAgentSession({
    model,
    thinkingLevel: 'off',
    tools: ['web_search'],
    customTools: [slowSearch],
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory(),
  });

  await session.prompt(
    'Call web_search exactly 4 times, ALL in your very next single response (parallel tool calls in ONE turn, not one at a time), with queries: alpha, beta, gamma, delta. Then reply "done".',
  );

  session.dispose();
  console.log('\n--- timings (ms since start) ---');
  for (const t of timings) console.log(`${t.query}: ${t.start} -> ${t.end} (${t.end - t.start}ms)`);
  if (timings.length >= 2) {
    const span = Math.max(...timings.map((t) => t.end)) - Math.min(...timings.map((t) => t.start));
    const sum = timings.reduce((a, t) => a + (t.end - t.start), 0);
    console.log(`span=${span}ms sum=${sum}ms -> ${span < sum * 0.7 ? 'CONCURRENT' : 'SEQUENTIAL'}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
