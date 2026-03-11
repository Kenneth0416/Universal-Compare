import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: 'https://api.x.ai/v1',
  dangerouslyAllowBrowser: true
});

// Responses API 类型定义
type ResponsesAPIInput = {
  role: 'user' | 'assistant';
  content: string;
};

type ResponsesAPITool = { type: 'web_search' } | { type: 'x_search' };

export interface ComparisonResult {
  entityA: {
    name: string;
    normalized_name: string;
    category: string;
    subcategory: string;
    likely_domain: string;
    short_definition: string;
  };
  entityB: {
    name: string;
    normalized_name: string;
    category: string;
    subcategory: string;
    likely_domain: string;
    short_definition: string;
  };
  relationship: {
    relationship_type: string;
    comparison_goal: string;
    can_directly_compare: boolean;
    reasoning: string;
  };
  dimensions: Array<{
    key: string;
    label: string;
    why_it_matters: string;
    comparison_angle: string;
    analysis: {
      item_a_summary: string;
      item_b_summary: string;
      key_difference: string;
      better_for: string;
      optional_score_a: number;
      optional_score_b: number;
    };
  }>;
  prosCons: {
    item_a_pros: string[];
    item_a_cons: string[];
    item_b_pros: string[];
    item_b_cons: string[];
  };
  recommendation: {
    best_for_a: string[];
    best_for_b: string[];
    which_to_choose_first: string;
    when_not_to_compare_directly: string;
    short_verdict: string;
    long_verdict: string;
  };
}

// Phase 1 Schema
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
    key_specs: { type: 'array', items: { type: 'string' } }
  },
  required: ["name", "normalized_name", "category", "subcategory", "likely_domain", "short_definition", "key_specs"]
};

// Phase 2 Schema
const frameworkSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    relationship: {
      type: 'object',
      additionalProperties: false,
      properties: {
        relationship_type: { type: 'string', description: 'same_category, cross_category, etc.' },
        comparison_goal: { type: 'string' },
        can_directly_compare: { type: 'boolean' },
        reasoning: { type: 'string' },
      },
      required: ["relationship_type", "comparison_goal", "can_directly_compare", "reasoning"]
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
        required: ["key", "label", "why_it_matters", "comparison_angle"]
      }
    }
  },
  required: ["relationship", "dimensions"]
};

// Phase 3 Schema
const analysisSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    item_a_summary: { type: 'string' },
    item_b_summary: { type: 'string' },
    key_difference: { type: 'string' },
    better_for: { type: 'string', description: "'A', 'B', 'Both', or 'Neither'" },
    optional_score_a: { type: 'number' },
    optional_score_b: { type: 'number' },
  },
  required: ["item_a_summary", "item_b_summary", "key_difference", "better_for", "optional_score_a", "optional_score_b"]
};

// Phase 4a Schema
const prosConsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    item_a_pros: { type: 'array', items: { type: 'string' } },
    item_a_cons: { type: 'array', items: { type: 'string' } },
    item_b_pros: { type: 'array', items: { type: 'string' } },
    item_b_cons: { type: 'array', items: { type: 'string' } },
  },
  required: ["item_a_pros", "item_a_cons", "item_b_pros", "item_b_cons"]
};

// Phase 4b Schema
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
  required: ["best_for_a", "best_for_b", "which_to_choose_first", "when_not_to_compare_directly", "short_verdict", "long_verdict"]
};

// --- Agent Functions ---

async function runResearcherAgent(itemName: string) {
  const [webSearchResponse, xSearchResponse] = await Promise.all([
    (openai as any).responses.create({
      model: 'grok-4-1-fast',
      input: [
        {
          role: 'user',
          content: `Search the web for comprehensive information about "${itemName}":
- Official specifications and features
- Release date and pricing information
- Expert reviews and comparisons
- Latest updates or versions

Provide detailed, factual information with sources.`
        }
      ] as ResponsesAPIInput[],
      tools: [{ type: 'web_search' }] as ResponsesAPITool[]
    }),
    (openai as any).responses.create({
      model: 'grok-4-1-fast',
      input: [
        {
          role: 'user',
          content: `Search X (Twitter) for recent discussions about "${itemName}":
- User experiences and opinions
- Common complaints or praise
- Trending topics and discussions
- Real-world usage feedback

Focus on posts from the last 3 months.`
        }
      ] as ResponsesAPIInput[],
      tools: [{ type: 'x_search' }] as ResponsesAPITool[]
    })
  ]);

  const webResults = webSearchResponse.output_text || '';
  const xResults = xSearchResponse.output_text || '';

  const structuredResponse = await openai.chat.completions.create({
    model: 'grok-4-1-fast-reasoning',
    messages: [
      {
        role: 'user',
        content: `Based on the following information, create a structured profile for "${itemName}":

WEB SEARCH RESULTS:
${webResults}

X (TWITTER) DISCUSSIONS:
${xResults}

Extract and synthesize:
1. Normalized name and category
2. Key specifications from official sources
3. Domain and subcategory classification
4. Concise definition incorporating both official specs and user sentiment
5. Key specs list combining technical details and user-highlighted features`
      }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'entity_response',
        strict: true,
        schema: entitySchema
      }
    },
    temperature: 0.1
  });

  return JSON.parse(structuredResponse.choices[0].message.content || '{}');
}

async function runArchitectAgent(profileA: any, profileB: any) {
  const prompt = `You are an Architect Agent. Based on the following profiles, determine their relationship and generate 4 to 6 key dimensions to compare them on.
Profile A: ${JSON.stringify(profileA)}
Profile B: ${JSON.stringify(profileB)}

Do not use generic templates. Tailor the dimensions to these specific items.`;

  const response = await openai.chat.completions.create({
    model: 'grok-4-1-fast-reasoning',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'framework_response',
        strict: true,
        schema: frameworkSchema
      }
    }
  });
  return JSON.parse(response.choices[0].message.content || '{}');
}

async function runAnalystAgent(profileA: any, profileB: any, dimension: any) {
  const prompt = `You are an Analyst Agent. Compare the following two items strictly on the dimension: "${dimension.label}".
Item A: ${profileA.name} (${profileA.short_definition})
Item B: ${profileB.name} (${profileB.short_definition})
Dimension Context: ${dimension.why_it_matters}
Comparison Angle: ${dimension.comparison_angle}

Analyze their differences, summarize each, and provide a score out of 10 for both.`;

  const response = await openai.chat.completions.create({
    model: 'grok-4-1-fast-reasoning',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'analysis_response',
        strict: true,
        schema: analysisSchema
      }
    }
  });
  return { ...dimension, analysis: JSON.parse(response.choices[0].message.content || '{}') };
}

async function runProsConsAgent(profileA: any, profileB: any, dimensions: any[]) {
  const prompt = `You are a Judge Agent. Based on the profiles and the multidimensional analysis below, extract the key pros and cons for both items.
Item A: ${profileA.name}
Item B: ${profileB.name}
Analysis: ${JSON.stringify(dimensions)}`;

  const response = await openai.chat.completions.create({
    model: 'grok-4-1-fast-reasoning',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'proscons_response',
        strict: true,
        schema: prosConsSchema
      }
    }
  });
  return JSON.parse(response.choices[0].message.content || '{}');
}

async function runRecommendationAgent(profileA: any, profileB: any, dimensions: any[], prosCons: any) {
  const prompt = `You are a Judge Agent. Based on all the gathered data, provide a final verdict and recommendation on who should choose which item.
Item A: ${profileA.name}
Item B: ${profileB.name}
Analysis: ${JSON.stringify(dimensions)}
Pros & Cons: ${JSON.stringify(prosCons)}`;

  const response = await openai.chat.completions.create({
    model: 'grok-4-1-fast-reasoning',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'recommendation_response',
        strict: true,
        schema: recommendationSchema
      }
    }
  });
  return JSON.parse(response.choices[0].message.content || '{}');
}

// Helper for concurrency limit
async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    const chunkResults = await Promise.all(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
}

export async function generateComparison(
  itemA: string, 
  itemB: string, 
  onProgress?: (step: string) => void,
  onPhaseComplete?: (phase: string, data: any) => void
): Promise<ComparisonResult> {
  
  // Phase 1: Dual-Track Research
  onProgress?.("Phase 1: Researching entities concurrently...");
  const [profileA, profileB] = await Promise.all([
    runResearcherAgent(itemA),
    runResearcherAgent(itemB)
  ]);
  onPhaseComplete?.('entities', { entityA: profileA, entityB: profileB });

  // Phase 2: Framework Architecture
  onProgress?.("Phase 2: Architecting comparison framework...");
  const framework = await runArchitectAgent(profileA, profileB);
  onPhaseComplete?.('framework', { relationship: framework.relationship, dimensionCount: framework.dimensions.length });

  // Phase 3: Multi-Dimensional Analysis (Concurrent)
  onProgress?.(`Phase 3: Analyzing ${framework.dimensions.length} dimensions concurrently...`);
  // Limit concurrency to 3 to avoid rate limits on standard tiers
  const analyzedDimensions = await mapConcurrent(framework.dimensions, 3, async (dim) => {
    const result = await runAnalystAgent(profileA, profileB, dim);
    onPhaseComplete?.('dimension', result);
    return result;
  });

  // Phase 4: Synthesis & Verdict (Concurrent)
  onProgress?.("Phase 4: Synthesizing final verdict and pros/cons...");
  const [prosCons, recommendation] = await Promise.all([
    runProsConsAgent(profileA, profileB, analyzedDimensions),
    runRecommendationAgent(profileA, profileB, analyzedDimensions, null)
  ]);
  onPhaseComplete?.('verdict', { prosCons, recommendation });

  // Assemble Final Result
  onProgress?.("Finalizing report...");
  return {
    entityA: profileA,
    entityB: profileB,
    relationship: framework.relationship,
    dimensions: analyzedDimensions,
    prosCons,
    recommendation
  };
}
