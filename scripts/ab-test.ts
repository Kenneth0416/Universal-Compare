import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { createProvider } from '../server/providers/index';
import type { AIProvider, AiCallMetrics } from '../server/providers/types';

const entitySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    normalized_name: { type: 'string' },
    category: { type: 'string' },
    subcategory: { type: 'string' },
    likely_domain: { type: 'string' },
    short_definition: { type: 'string' },
    key_attributes: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'normalized_name', 'category', 'subcategory', 'likely_domain', 'short_definition', 'key_attributes'],
};

const frameworkSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    relationship: {
      type: 'object',
      additionalProperties: false,
      properties: {
        relationship_type: { type: 'string' },
        comparison_goal: { type: 'string' },
        can_directly_compare: { type: 'boolean' },
        reasoning: { type: 'string' },
      },
      required: ['relationship_type', 'comparison_goal', 'can_directly_compare', 'reasoning'],
    },
    dimensions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string' },
          label: { type: 'string' },
          why_it_matters: { type: 'string' },
          comparison_angle: { type: 'string' },
        },
        required: ['key', 'label', 'why_it_matters', 'comparison_angle'],
      },
    },
  },
  required: ['relationship', 'dimensions'],
};

const analysisSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    item_a_summary: { type: 'string' },
    item_b_summary: { type: 'string' },
    key_difference: { type: 'string' },
    better_for: { type: 'string' },
    optional_score_a: { type: 'number' },
    optional_score_b: { type: 'number' },
  },
  required: ['item_a_summary', 'item_b_summary', 'key_difference', 'better_for', 'optional_score_a', 'optional_score_b'],
};

const prosConsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    item_a_pros: { type: 'array', items: { type: 'string' } },
    item_a_cons: { type: 'array', items: { type: 'string' } },
    item_b_pros: { type: 'array', items: { type: 'string' } },
    item_b_cons: { type: 'array', items: { type: 'string' } },
  },
  required: ['item_a_pros', 'item_a_cons', 'item_b_pros', 'item_b_cons'],
};

const recommendationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    best_for_a: { type: 'array', items: { type: 'string' } },
    best_for_b: { type: 'array', items: { type: 'string' } },
    which_to_choose_first: { type: 'string' },
    when_not_to_compare_directly: { type: 'string' },
    short_verdict: { type: 'string' },
    long_verdict: { type: 'string' },
  },
  required: ['best_for_a', 'best_for_b', 'which_to_choose_first', 'when_not_to_compare_directly', 'short_verdict', 'long_verdict'],
};

type PhaseResult = {
  phase: string;
  durationMs: number;
  metrics: AiCallMetrics;
  success: boolean;
  error?: string;
  data: unknown;
};

async function runPipeline(
  provider: AIProvider,
  itemA: string,
  itemB: string,
): Promise<{ result: Record<string, unknown> | null; phases: PhaseResult[] }> {
  const phases: PhaseResult[] = [];

  console.log(`  [${provider.name}] Phase 1: Researching ${itemA} and ${itemB}...`);
  let profileA: Record<string, unknown> = {};
  let profileB: Record<string, unknown> = {};

  try {
    const start = Date.now();
    const [researchA, researchB] = await Promise.all([
      provider.research(itemA),
      provider.research(itemB),
    ]);

    const profA = await provider.chatCompletion({
      messages: [{
        role: 'user',
        content: `Based on the following research information, create a structured profile for "${itemA}":\n\nRESEARCH RESULTS:\n${researchA.text}\n\nExtract: normalized name, category, subcategory, domain, definition, key attributes.`,
      }],
      schema: entitySchema,
      schemaName: 'entity_response',
      temperature: 0.1,
    });

    const profB = await provider.chatCompletion({
      messages: [{
        role: 'user',
        content: `Based on the following research information, create a structured profile for "${itemB}":\n\nRESEARCH RESULTS:\n${researchB.text}\n\nExtract: normalized name, category, subcategory, domain, definition, key attributes.`,
      }],
      schema: entitySchema,
      schemaName: 'entity_response',
      temperature: 0.1,
    });

    profileA = JSON.parse(profA.json);
    profileB = JSON.parse(profB.json);

    phases.push({
      phase: 'research',
      durationMs: Date.now() - start,
      metrics: {
        model: researchA.metrics.model,
        promptTokens: researchA.metrics.promptTokens + researchB.metrics.promptTokens + profA.metrics.promptTokens + profB.metrics.promptTokens,
        completionTokens: researchA.metrics.completionTokens + researchB.metrics.completionTokens + profA.metrics.completionTokens + profB.metrics.completionTokens,
        totalTokens: researchA.metrics.totalTokens + researchB.metrics.totalTokens + profA.metrics.totalTokens + profB.metrics.totalTokens,
        durationMs: Date.now() - start,
      },
      success: true,
      data: { profileA, profileB },
    });
  } catch (err) {
    phases.push({ phase: 'research', durationMs: 0, metrics: { model: provider.name, promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 0 }, success: false, error: (err as Error).message, data: null });
    return { result: null, phases };
  }

  console.log(`  [${provider.name}] Phase 2: Architecting framework...`);
  let framework: Record<string, unknown> = {};
  try {
    const start = Date.now();
    const fw = await provider.chatCompletion({
      messages: [{
        role: 'user',
        content: `You are an Architect Agent. Based on the following entity profiles, determine their relationship and generate 4 to 6 key dimensions to compare them on.\n\nFirst entity: ${JSON.stringify(profileA)}\nSecond entity: ${JSON.stringify(profileB)}\n\nAnalyze their nature and generate dimensions specifically tailored to these entities. Always refer to them by name ("${profileA.name}" and "${profileB.name}").`,
      }],
      schema: frameworkSchema,
      schemaName: 'framework_response',
      temperature: 0.2,
    });
    framework = JSON.parse(fw.json);
    phases.push({ phase: 'framework', durationMs: Date.now() - start, metrics: fw.metrics, success: true, data: framework });
  } catch (err) {
    phases.push({ phase: 'framework', durationMs: 0, metrics: { model: provider.name, promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 0 }, success: false, error: (err as Error).message, data: null });
    return { result: null, phases };
  }

  console.log(`  [${provider.name}] Phase 3: Analyzing dimensions...`);
  const dimensions = (framework.dimensions as any[]) || [];
  const analyzedDimensions: unknown[] = [];
  try {
    const start = Date.now();
    const totalMetrics = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    for (const dim of dimensions) {
      const an = await provider.chatCompletion({
        messages: [{
          role: 'user',
          content: `You are an Analyst Agent. Compare "${profileA.name}" and "${profileB.name}" on dimension: "${dim.label}".\n\n${profileA.name}: ${profileA.short_definition}\n${profileB.name}: ${profileB.short_definition}\nDimension Context: ${dim.why_it_matters}\nComparison Angle: ${dim.comparison_angle}\n\nProvide scores out of 10 where higher = more favorable.`,
        }],
        schema: analysisSchema,
        schemaName: 'analysis_response',
        temperature: 0.2,
      });
      analyzedDimensions.push({ ...dim, analysis: JSON.parse(an.json) });
      totalMetrics.promptTokens += an.metrics.promptTokens;
      totalMetrics.completionTokens += an.metrics.completionTokens;
      totalMetrics.totalTokens += an.metrics.totalTokens;
    }
    phases.push({ phase: 'analysis', durationMs: Date.now() - start, metrics: { model: provider.name, ...totalMetrics, durationMs: Date.now() - start }, success: true, data: analyzedDimensions });
  } catch (err) {
    phases.push({ phase: 'analysis', durationMs: 0, metrics: { model: provider.name, promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 0 }, success: false, error: (err as Error).message, data: null });
    return { result: null, phases };
  }

  console.log(`  [${provider.name}] Phase 4: Synthesizing verdict...`);
  try {
    const start = Date.now();
    const [pc, rec] = await Promise.all([
      provider.chatCompletion({
        messages: [{
          role: 'user',
          content: `You are a Judge Agent. Extract key strengths and weaknesses for both entities.\n\n${profileA.name}: ${profileA.short_definition}\n${profileB.name}: ${profileB.short_definition}\nAnalysis: ${JSON.stringify(analyzedDimensions)}\n\nAlways refer to entities by name.`,
        }],
        schema: prosConsSchema,
        schemaName: 'proscons_response',
        temperature: 0.2,
      }),
      provider.chatCompletion({
        messages: [{
          role: 'user',
          content: `You are a Judge Agent. Provide a final verdict and recommendation.\n\n${profileA.name}: ${profileA.short_definition}\n${profileB.name}: ${profileB.short_definition}\nAnalysis: ${JSON.stringify(analyzedDimensions)}\n\nAlways refer to entities by name.`,
        }],
        schema: recommendationSchema,
        schemaName: 'recommendation_response',
        temperature: 0.2,
      }),
    ]);

    const prosCons = JSON.parse(pc.json);
    const recommendation = JSON.parse(rec.json);

    phases.push({
      phase: 'synthesis',
      durationMs: Date.now() - start,
      metrics: {
        model: provider.name,
        promptTokens: pc.metrics.promptTokens + rec.metrics.promptTokens,
        completionTokens: pc.metrics.completionTokens + rec.metrics.completionTokens,
        totalTokens: pc.metrics.totalTokens + rec.metrics.totalTokens,
        durationMs: Date.now() - start,
      },
      success: true,
      data: { prosCons, recommendation },
    });

    return {
      result: {
        entityA: profileA,
        entityB: profileB,
        relationship: framework.relationship,
        dimensions: analyzedDimensions,
        prosCons,
        recommendation,
      },
      phases,
    };
  } catch (err) {
    phases.push({ phase: 'synthesis', durationMs: 0, metrics: { model: provider.name, promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 0 }, success: false, error: (err as Error).message, data: null });
    return { result: null, phases };
  }
}

function generateComparisonMd(
  itemA: string,
  itemB: string,
  grokPhases: PhaseResult[],
  minimaxPhases: PhaseResult[],
): string {
  const lines: string[] = [
    `# A/B Test: ${itemA} vs ${itemB}`,
    `**Date:** ${new Date().toISOString()}`,
    '',
    '## Phase Comparison',
    '',
    '| Phase | Grok Duration | MiniMax Duration | Grok Tokens | MiniMax Tokens | Grok Success | MiniMax Success |',
    '|-------|--------------|-----------------|-------------|---------------|-------------|----------------|',
  ];

  const phaseNames = ['research', 'framework', 'analysis', 'synthesis'];
  for (const name of phaseNames) {
    const gp = grokPhases.find((p) => p.phase === name);
    const mp = minimaxPhases.find((p) => p.phase === name);
    lines.push(
      `| ${name} | ${gp?.durationMs ?? '-'}ms | ${mp?.durationMs ?? '-'}ms | ${gp?.metrics.totalTokens ?? '-'} | ${mp?.metrics.totalTokens ?? '-'} | ${gp?.success ? 'YES' : gp?.error || 'NO'} | ${mp?.success ? 'YES' : mp?.error || 'NO'} |`,
    );
  }

  const grokTotal = grokPhases.reduce((sum, p) => sum + p.durationMs, 0);
  const minimaxTotal = minimaxPhases.reduce((sum, p) => sum + p.durationMs, 0);
  const grokTokens = grokPhases.reduce((sum, p) => sum + p.metrics.totalTokens, 0);
  const minimaxTokens = minimaxPhases.reduce((sum, p) => sum + p.metrics.totalTokens, 0);

  lines.push('', `**Total:** Grok ${grokTotal}ms / MiniMax ${minimaxTotal}ms`);
  lines.push(`**Total Tokens:** Grok ${grokTokens} / MiniMax ${minimaxTokens}`);

  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const itemsIndex = args.indexOf('--items');
  if (itemsIndex === -1 || itemsIndex + 1 >= args.length) {
    console.error('Usage: npx tsx scripts/ab-test.ts --items "ItemA,ItemB" "ItemC,ItemD"');
    process.exit(1);
  }

  const pairs = args.slice(itemsIndex + 1).map((pair) => {
    const [a, b] = pair.split(',').map((s) => s.trim());
    if (!a || !b) {
      console.error(`Invalid pair format: "${pair}". Use "ItemA,ItemB"`);
      process.exit(1);
    }
    return { itemA: a, itemB: b };
  });

  if (!process.env.XAI_API_KEY) {
    console.error('Missing XAI_API_KEY in .env.local');
    process.exit(1);
  }
  if (!process.env.MINIMAX_API_KEY) {
    console.error('Missing MINIMAX_API_KEY in .env.local');
    process.exit(1);
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error('Missing DEEPSEEK_API_KEY in .env.local');
    process.exit(1);
  }

  const minimaxBaseUrl = process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1';
  const deepseekModel = process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro';

  const grokClient = new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: 'https://api.x.ai/v1' });
  const minimaxClient = new OpenAI({ apiKey: process.env.MINIMAX_API_KEY, baseURL: minimaxBaseUrl });
  const deepseekClient = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' });

  const grokProvider = createProvider('grok', { grokClient });
  const minimaxProvider = createProvider('minimax', {
    minimaxClient,
    minimaxSearchApiKey: process.env.MINIMAX_API_KEY,
    minimaxBaseUrl: minimaxBaseUrl.replace('/v1', ''),
    deepseekClient,
    deepseekModel,
  });

  // Validate API keys
  console.log('Validating MiniMax API key...');
  try {
    await minimaxClient.chat.completions.create({
      model: 'MiniMax-M2.7',
      messages: [{ role: 'user', content: 'Say "hello" in one word.' }],
      max_tokens: 10,
    } as any);
    console.log('MiniMax API key valid.');
  } catch (err) {
    console.error(`MiniMax API key validation failed: ${(err as Error).message}`);
    process.exit(1);
  }

  console.log(`Validating DeepSeek API key (model: ${deepseekModel})...`);
  try {
    await deepseekClient.chat.completions.create({
      model: deepseekModel,
      messages: [{ role: 'user', content: 'Say "hello" in one word.' }],
      max_tokens: 10,
    });
    console.log('DeepSeek API key valid.');
  } catch (err) {
    console.error(`DeepSeek API key validation failed: ${(err as Error).message}`);
    process.exit(1);
  }

  const resultsBase = path.resolve(process.cwd(), 'scripts', 'ab-results');
  mkdirSync(resultsBase, { recursive: true });

  for (const { itemA, itemB } of pairs) {
    const slug = `${new Date().toISOString().slice(0, 10)}-${itemA.toLowerCase().replace(/\s+/g, '-')}-vs-${itemB.toLowerCase().replace(/\s+/g, '-')}`;
    const outDir = path.join(resultsBase, slug);
    mkdirSync(outDir, { recursive: true });

    console.log(`\n=== Testing: ${itemA} vs ${itemB} ===`);

    console.log('\n--- Grok ---');
    const grok = await runPipeline(grokProvider, itemA, itemB);

    console.log(`\n--- MiniMax+DeepSeek (${deepseekModel}) ---`);
    const minimax = await runPipeline(minimaxProvider, itemA, itemB);

    writeFileSync(path.join(outDir, 'grok-result.json'), JSON.stringify(grok, null, 2));
    writeFileSync(path.join(outDir, 'minimax-result.json'), JSON.stringify(minimax, null, 2));
    writeFileSync(path.join(outDir, 'comparison.md'), generateComparisonMd(itemA, itemB, grok.phases, minimax.phases));

    console.log(`\nResults written to ${outDir}/`);
  }

  console.log('\nA/B test complete.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
