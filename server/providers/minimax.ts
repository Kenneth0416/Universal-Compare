import type OpenAI from 'openai';
import type { AIProvider, AiCallMetrics, ChatMessage, JsonSchema, ResearchRawParams } from './types';
import { extractJson, validateRequiredFields } from './jsonExtractor';

const MINIMAX_MODEL = 'MiniMax-M2.7';
const DEEPSEEK_MODEL_PRO = 'deepseek-v4-pro';
const DEEPSEEK_MODEL_FLASH = 'deepseek-v4-flash';
const MAX_JSON_RETRIES = 2;

const WEB_SEARCH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'web_search',
    description: 'Search the web for current information about a topic',
    parameters: {
      type: 'object',
      properties: {
        query_list: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of search queries to execute',
        },
      },
      required: ['query_list'],
    },
  },
};

export function parseMinimaxToolCall(
  text: string,
): { name: string; arguments: Record<string, unknown> } | null {
  const invokeMatch = text.match(
    /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/,
  );
  if (!invokeMatch) return null;

  const name = invokeMatch[1];
  const paramsBlock = invokeMatch[2];
  const args: Record<string, unknown> = {};

  const paramRegex = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g;
  let match;
  while ((match = paramRegex.exec(paramsBlock)) !== null) {
    const paramName = match[1];
    const paramValue = match[2].trim();
    try {
      args[paramName] = JSON.parse(paramValue);
    } catch {
      args[paramName] = paramValue;
    }
  }

  return { name, arguments: args };
}

async function callMinimaxSearch(
  apiKey: string,
  query: string,
  baseUrl = 'https://api.minimaxi.com',
): Promise<string> {
  const response = await fetch(`${baseUrl}/v1/coding_plan/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    throw new Error(`MiniMax search failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const results = (data as any).results || [];
  return results
    .map(
      (r: any, i: number) =>
        `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet || ''}`,
    )
    .join('\n\n');
}

export class MinimaxProvider implements AIProvider {
  readonly name = 'minimax';
  private client: OpenAI;
  private chatClient: OpenAI;
  private chatModel: string;
  private searchApiKey: string;
  private searchBaseUrl: string;

  constructor(
    client: OpenAI,
    searchApiKey: string,
    options?: {
      searchBaseUrl?: string;
      chatClient?: OpenAI;
      chatModel?: string;
    },
  ) {
    this.client = client;
    this.searchApiKey = searchApiKey;
    this.searchBaseUrl = options?.searchBaseUrl || 'https://api.minimaxi.com';
    this.chatClient = options?.chatClient || client;
    this.chatModel = options?.chatModel || DEEPSEEK_MODEL_PRO;
  }

  async research(
    query: string,
    _rawParams?: ResearchRawParams,
  ): Promise<{ text: string; metrics: AiCallMetrics }> {
    const start = Date.now();
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;

    const messages: any[] = [
      {
        role: 'user',
        content: `Research comprehensive information about "${query}".

Use the web_search tool to find:
- Key characteristics and defining attributes
- Historical background and timeline
- Expert analysis and comparisons
- Recent developments or changes
- Relevant facts and data points

Provide detailed, factual information with sources.`,
      },
    ];

    const firstResponse = await this.client.chat.completions.create({
      model: MINIMAX_MODEL,
      messages,
      tools: [WEB_SEARCH_TOOL],
      tool_choice: 'auto',
    } as any);

    const firstUsage = (firstResponse as any).usage || {};
    totalPromptTokens += firstUsage.prompt_tokens || 0;
    totalCompletionTokens += firstUsage.completion_tokens || 0;
    totalTokens += firstUsage.total_tokens || 0;

    const firstContent =
      (firstResponse as any).choices?.[0]?.message?.content || '';
    const toolCall = parseMinimaxToolCall(firstContent);

    if (!toolCall) {
      let searchResults: string;
      try {
        searchResults = await callMinimaxSearch(this.searchApiKey, query, this.searchBaseUrl);
      } catch {
        return {
          text: firstContent,
          metrics: {
            model: MINIMAX_MODEL,
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            totalTokens,
            durationMs: Date.now() - start,
          },
        };
      }

      const synthesizeResponse = await this.client.chat.completions.create({
        model: MINIMAX_MODEL,
        messages: [
          {
            role: 'user',
            content: `Based on the following search results, provide a comprehensive research summary about "${query}":\n\n${searchResults}`,
          },
        ],
      } as any);

      const synthUsage = (synthesizeResponse as any).usage || {};
      totalPromptTokens += synthUsage.prompt_tokens || 0;
      totalCompletionTokens += synthUsage.completion_tokens || 0;
      totalTokens += synthUsage.total_tokens || 0;

      return {
        text:
          (synthesizeResponse as any).choices?.[0]?.message?.content || '',
        metrics: {
          model: MINIMAX_MODEL,
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          totalTokens,
          durationMs: Date.now() - start,
        },
      };
    }

    const queryList = (toolCall.arguments.query_list as string[]) || [query];
    const searchResultTexts = await Promise.all(
      queryList.map((q) =>
        callMinimaxSearch(this.searchApiKey, q, this.searchBaseUrl).catch(
          (err) => `Search failed for "${q}": ${err.message}`,
        ),
      ),
    );
    const combinedResults = searchResultTexts.join('\n\n---\n\n');

    messages.push(
      { role: 'assistant', content: firstContent },
      { role: 'tool', content: combinedResults, tool_call_id: 'web_search_0' },
    );

    const finalResponse = await this.client.chat.completions.create({
      model: MINIMAX_MODEL,
      messages,
    } as any);

    const finalUsage = (finalResponse as any).usage || {};
    totalPromptTokens += finalUsage.prompt_tokens || 0;
    totalCompletionTokens += finalUsage.completion_tokens || 0;
    totalTokens += finalUsage.total_tokens || 0;

    return {
      text: (finalResponse as any).choices?.[0]?.message?.content || '',
      metrics: {
        model: MINIMAX_MODEL,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens,
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
    const model = this.chatModel;
    const start = Date.now();
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;

    const schemaInstruction = `You MUST respond with valid JSON matching this exact schema. No markdown code fences, no explanation, no extra text — ONLY the raw JSON object.

Schema:
${JSON.stringify(params.schema, null, 2)}`;

    const messages: any[] = [
      { role: 'system', content: schemaInstruction },
      ...params.messages,
    ];

    for (let attempt = 0; attempt <= MAX_JSON_RETRIES; attempt++) {
      const response = await this.chatClient.chat.completions.create({
        model,
        messages,
        temperature: params.temperature ?? 0.2,
        response_format: { type: 'json_object' },
      } as any);

      const usage = (response as any).usage || {};
      totalPromptTokens += usage.prompt_tokens || usage.input_tokens || 0;
      totalCompletionTokens += usage.completion_tokens || usage.output_tokens || 0;
      totalTokens += usage.total_tokens || 0;

      const content = (response as any).choices?.[0]?.message?.content || '';

      try {
        const parsed = extractJson(content);
        validateRequiredFields(parsed, params.schema);
        return {
          json: JSON.stringify(parsed),
          metrics: {
            model,
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            totalTokens,
            durationMs: Date.now() - start,
          },
        };
      } catch (err) {
        if (attempt === MAX_JSON_RETRIES) {
          throw new Error(
            `DeepSeek JSON extraction failed after ${MAX_JSON_RETRIES + 1} attempts: ${(err as Error).message}`,
          );
        }
        messages.push(
          { role: 'assistant', content },
          {
            role: 'user',
            content: `Your previous response was not valid JSON or was missing required fields. Error: ${(err as Error).message}\n\nPlease try again. Respond with ONLY the raw JSON object.`,
          },
        );
      }
    }

    throw new Error('DeepSeek JSON extraction failed');
  }
}
