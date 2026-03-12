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
    key_attributes: { type: 'array', items: { type: 'string' } }
  },
  required: ["name", "normalized_name", "category", "subcategory", "likely_domain", "short_definition", "key_attributes"]
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
      model: 'grok-4-1-fast-non-reasoning',
      input: [
        {
          role: 'user',
          content: `Search the web for comprehensive information about "${itemName}":
- Key characteristics and defining attributes
- Historical background and timeline
- Expert analysis and comparisons
- Recent developments or changes
- Relevant facts and data points

Provide detailed, factual information with sources.`
        }
      ] as ResponsesAPIInput[],
      tools: [{ type: 'web_search' }] as ResponsesAPITool[]
    }),
    (openai as any).responses.create({
      model: 'grok-4-1-fast-non-reasoning',
      input: [
        {
          role: 'user',
          content: `Search X (Twitter) for recent discussions about "${itemName}":
- Public opinions and perspectives
- Common criticisms or praise
- Trending topics and discussions
- Real-world observations and insights

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
1. Normalized name and category classification
2. Key characteristics and defining attributes from authoritative sources
3. Domain and subcategory classification
4. Concise definition incorporating both factual information and public perception
5. Key attributes list combining objective facts and notable observations`
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
  const prompt = `You are an Architect Agent. Based on the following entity profiles, determine their relationship and generate 4 to 6 key dimensions to compare them on.

First entity: ${JSON.stringify(profileA)}
Second entity: ${JSON.stringify(profileB)}

These entities can be anything: products, countries, people, animals, concepts, events, or any other comparable subjects. Analyze their nature and generate dimensions that are specifically tailored to these particular entities. Do not use generic templates.

IMPORTANT: In all your outputs, always refer to entities by their actual names ("${profileA.name}" and "${profileB.name}"). Never use generic labels like "Entity A", "Entity B", "A", "B", "Item A", "Item B", or similar placeholders.`;

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
  const prompt = `You are an Analyst Agent. Compare the following two entities strictly on the dimension: "${dimension.label}".

${profileA.name}: ${profileA.short_definition}
${profileB.name}: ${profileB.short_definition}
Dimension Context: ${dimension.why_it_matters}
Comparison Angle: ${dimension.comparison_angle}

Analyze their differences, summarize each entity's characteristics on this dimension, and provide a score out of 10 for both.

IMPORTANT: Always refer to entities by their actual names ("${profileA.name}" and "${profileB.name}"). Never use "Entity A", "Entity B", "A", "B", or similar placeholders in your analysis text.`;

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
  const prompt = `You are a Judge Agent. Based on the entity profiles and the multidimensional analysis below, extract the key strengths and weaknesses for both entities.

${profileA.name}: ${profileA.short_definition}
${profileB.name}: ${profileB.short_definition}
Analysis: ${JSON.stringify(dimensions)}

IMPORTANT: Always refer to entities by their actual names ("${profileA.name}" and "${profileB.name}"). Never use "Entity A", "Entity B", "A", "B", or similar placeholders.`;

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
  const prompt = `You are a Judge Agent. Based on all the gathered data, provide a final verdict and recommendation on when to prefer each entity.

${profileA.name}: ${profileA.short_definition}
${profileB.name}: ${profileB.short_definition}
Analysis: ${JSON.stringify(dimensions)}
Strengths & Weaknesses: ${JSON.stringify(prosCons)}

IMPORTANT: Always refer to entities by their actual names ("${profileA.name}" and "${profileB.name}"). Never use "Entity A", "Entity B", "A", "B", or similar placeholders in your verdict and recommendations.`;

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
  // Limit concurrency to 6 for faster processing
  const analyzedDimensions = await mapConcurrent(framework.dimensions, 6, async (dim) => {
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
