import type OpenAI from 'openai';
import type { AIProvider, AiCallMetrics, ChatMessage, JsonSchema } from './types';

export class GrokProvider implements AIProvider {
  readonly name = 'grok';
  private client: OpenAI;

  constructor(client: OpenAI) {
    this.client = client;
  }

  async research(query: string): Promise<{ text: string; metrics: AiCallMetrics }> {
    const model = 'grok-4-1-fast-non-reasoning';
    const start = Date.now();

    const response = await this.client.responses.create({
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
    } as any);

    const text = (response as any).output_text || '';
    const usage = (response as any).usage || {};

    return {
      text,
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
    } as any);

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
