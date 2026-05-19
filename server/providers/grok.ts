import type OpenAI from 'openai';
import type { AIProvider, AiCallMetrics, ChatMessage, JsonSchema, ResearchRawParams, Source } from './types';

const LLM_TIMEOUT_MS = 120_000;

export class GrokProvider implements AIProvider {
  readonly name = 'grok';
  private client: OpenAI;

  constructor(client: OpenAI) {
    this.client = client;
  }

  async research(query: string, rawParams?: ResearchRawParams): Promise<{ text: string; sources: Source[]; metrics: AiCallMetrics }> {
    const model = 'grok-4-1-fast-non-reasoning';
    const start = Date.now();

    // When rawParams are provided (from server route), pass them through directly.
    // This preserves the frontend's researchConfig behavior (X Search mode, etc.).
    // When not provided (e.g. A/B test script), build a default prompt.
    const requestParams = rawParams
      ? { model, ...rawParams }
      : {
          model,
          input: [
            {
              role: 'user',
              content: `Research comprehensive information about "${query}".

Use Web Search for authoritative and factual sources:
- Key characteristics and defining attributes
- Historical background and timeline
- Expert analysis and comparisons
- Recent developments or changes
- Relevant facts and data points

Use X Search only if recent public sentiment, controversy, launch reactions, creator/community discussion, or fast-moving social context would materially improve the comparison. Skip X Search for stable reference facts, mature products with well-covered reviews, historical topics, or subjects where social posts are unlikely to add decision-relevant evidence.

Provide detailed, factual information with sources.`,
            },
          ],
          tools: [{ type: 'web_search' }, { type: 'x_search' }],
          tool_choice: 'auto',
        };

    const response = await this.client.responses.create(requestParams as any, { timeout: LLM_TIMEOUT_MS });

    const text = (response as any).output_text || '';
    const usage = (response as any).usage || {};

    // Extract source URLs from web_search_result items in the response output
    const sources: Source[] = [];
    const seen = new Set<string>();
    const output = (response as any).output || [];
    for (const item of output) {
      const results = item?.results || item?.search_results || [];
      for (const r of results) {
        const url = r?.url || r?.link || '';
        const title = r?.title || '';
        const normalized = url.replace(/\/+$/, '').toLowerCase();
        if (url && title && !seen.has(normalized)) {
          seen.add(normalized);
          sources.push({ url, title, snippet: r?.snippet || '' });
        }
      }
    }

    return {
      text,
      sources,
      metrics: {
        model,
        promptTokens: usage.prompt_tokens || usage.input_tokens || 0,
        completionTokens: usage.completion_tokens || usage.output_tokens || 0,
        totalTokens: usage.total_tokens || 0,
        durationMs: Date.now() - start,
      },
    };
  }

  async chatCompletion(params: {
    messages: ChatMessage[];
    schema: JsonSchema;
    schemaName: string;
    temperature?: number;
  }): Promise<{ json: string; metrics: AiCallMetrics }> {
    const model = 'grok-4-1-fast-reasoning';
    const start = Date.now();

    const response = await this.client.chat.completions.create({
      model,
      messages: params.messages as any,
      temperature: params.temperature ?? 0.2,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: params.schemaName,
          strict: true,
          schema: params.schema,
        },
      },
    } as any, { timeout: LLM_TIMEOUT_MS });

    const content = (response as any).choices?.[0]?.message?.content || '{}';
    const usage = (response as any).usage || {};

    return {
      json: content,
      metrics: {
        model,
        promptTokens: usage.prompt_tokens || usage.input_tokens || 0,
        completionTokens: usage.completion_tokens || usage.output_tokens || 0,
        totalTokens: usage.total_tokens || 0,
        durationMs: Date.now() - start,
      },
    };
  }
}
