/**
 * Experiment: wall-clock speedup of running scoped research agents concurrently
 * vs sequentially. Two tiny agent sessions, each doing a few batched searches.
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

const webSearch = defineTool({
  name: 'web_search',
  label: 'Web Search',
  description: 'Search the web.',
  parameters: Type.Object({ query: Type.String() }),
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
    const data = await response.json().catch(() => ({})) as any;
    const results = (data.organic || data.results || []).slice(0, 3);
    return {
      content: [{ type: 'text', text: results.map((r: any, i: number) => `[${i + 1}] ${r.title} — ${r.link || r.url}`).join('\n') || 'none' }],
      details: {},
    };
  },
});

async function researchEntity(name: string) {
  const authStorage = AuthStorage.create();
  if (process.env.MINIMAX_API_KEY) authStorage.setRuntimeApiKey('minimax-cn', process.env.MINIMAX_API_KEY);
  const modelRegistry = ModelRegistry.create(authStorage);
  const available = await modelRegistry.getAvailable();
  const model = available.find((m) => m.provider === 'minimax-cn') || available[0];

  const { session } = await createAgentSession({
    model,
    thinkingLevel: 'off',
    tools: ['web_search'],
    customTools: [webSearch],
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory(),
  });
  const start = Date.now();
  await session.prompt(
    `Research "${name}" for a comparison article. Issue exactly 3 web_search calls, ALL in ONE single response (parallel tool calls, not sequential). Then reply with a 3-sentence factual profile.`,
  );
  const elapsed = Date.now() - start;
  const profile = session.messages
    .filter((m: any) => m.role === 'assistant')
    .flatMap((m: any) => m.content)
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join(' ')
    .slice(0, 150);
  session.dispose();
  return { name, elapsed, profile };
}

async function main() {
  // Sequential baseline
  const seqStart = Date.now();
  const a = await researchEntity('Notion');
  const b = await researchEntity('Obsidian');
  const seqTotal = Date.now() - seqStart;

  // Parallel
  const parStart = Date.now();
  const [c, d] = await Promise.all([researchEntity('Notion'), researchEntity('Obsidian')]);
  const parTotal = Date.now() - parStart;

  console.log('\n=== timing ===');
  console.log(`sequential: A=${a.elapsed}ms B=${b.elapsed}ms total=${seqTotal}ms`);
  console.log(`parallel:   A=${c.elapsed}ms B=${d.elapsed}ms total=${parTotal}ms`);
  console.log(`speedup: ${(seqTotal / parTotal).toFixed(2)}x`);
}

main().catch((e) => { console.error(e); process.exit(1); });
