import type OpenAI from 'openai';
import type { AIProvider, AiCallMetrics, ChatMessage, JsonSchema, ResearchRawParams, Source } from './types';
import { extractJson, validateRequiredFields } from './jsonExtractor';

const DEEPSEEK_MODEL_DEFAULT = 'deepseek-v4-flash';
const MAX_JSON_RETRIES = 2;
const SEARCH_TIMEOUT_MS = 30_000;
const LLM_TIMEOUT_MS = 60_000;

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

export async function callMinimaxSearch(
  apiKey: string,
  query: string,
  baseUrl = 'https://api.minimaxi.com',
): Promise<{ text: string; sources: Source[] }> {
  const response = await fetch(`${baseUrl}/v1/coding_plan/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    throw new Error(`MiniMax search failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const results = (data as any).organic || (data as any).results || [];
  const sources: Source[] = results.map((r: any) => ({
    url: r.link || r.url,
    title: r.title,
    snippet: r.snippet || '',
  }));
  const text = results
    .map(
      (r: any, i: number) =>
        `[${i + 1}] ${r.title}\n${r.link || r.url}\n${r.snippet || ''}`,
    )
    .join('\n\n');
  return { text, sources };
}

function deduplicateSourcesByUrl(sources: Source[]): Source[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    const normalized = (s.url || '').toLowerCase().replace(/\/$/, '');
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
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
    this.chatModel = options?.chatModel || DEEPSEEK_MODEL_DEFAULT;
  }

  async research(
    query: string,
    _rawParams?: ResearchRawParams,
  ): Promise<{ text: string; sources: Source[]; metrics: AiCallMetrics }> {
    const start = Date.now();
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;

    // Step 1: DeepSeek generates multi-angle search queries
    const planResponse = await this.chatClient.chat.completions.create({
      model: this.chatModel,
      messages: [
        {
          role: 'system',
          content: `You are a research query planner. Generate 5-8 diverse search queries to comprehensively research a topic. Cover multiple angles:
- Factual overview and key characteristics
- Technical details and specifications
- Recent developments and news
- Expert analysis and reviews
- Comparisons and competitive landscape
- Market data and statistics

Respond with ONLY a JSON object: {"queries": ["query1", "query2", ...]}`,
        },
        {
          role: 'user',
          content: `Generate search queries to research: "${query}"`,
        },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
    } as any, { timeout: LLM_TIMEOUT_MS });

    const planUsage = (planResponse as any).usage || {};
    totalPromptTokens += planUsage.prompt_tokens || 0;
    totalCompletionTokens += planUsage.completion_tokens || 0;
    totalTokens += planUsage.total_tokens || 0;

    const planContent = (planResponse as any).choices?.[0]?.message?.content || '';
    let queries: string[];
    try {
      const parsed = extractJson(planContent);
      queries = (parsed.queries as string[]) || [query];
      if (queries.length === 0) queries = [query];
    } catch {
      queries = [query, `${query} overview`, `${query} latest news`];
    }

    // Step 2: Execute all searches in parallel via MiniMax Search API
    const searchResults = await Promise.all(
      queries.map((q) =>
        callMinimaxSearch(this.searchApiKey, q, this.searchBaseUrl).catch(
          (err) => ({ text: `Search failed for "${q}": ${err.message}`, sources: [] as Source[] }),
        ),
      ),
    );
    const allSources = deduplicateSourcesByUrl(searchResults.flatMap((r) => r.sources));
    const combinedResults = queries
      .map((q, i) => `### Search: "${q}"\n${searchResults[i].text}`)
      .join('\n\n---\n\n');

    // Step 3: DeepSeek synthesizes all results
    const synthResponse = await this.chatClient.chat.completions.create({
      model: this.chatModel,
      messages: [
        {
          role: 'system',
          content: 'You are a research analyst. Synthesize search results into a comprehensive, factual research report in English. Include specific data points, statistics, and cite sources where available. Be thorough and detailed. If search results are in other languages, translate key findings into English.',
        },
        {
          role: 'user',
          content: `Synthesize the following search results into a comprehensive research report about "${query}":\n\n${combinedResults}`,
        },
      ],
      temperature: 0.2,
      thinking: { type: 'disabled' },
    } as any, { timeout: LLM_TIMEOUT_MS });

    const synthUsage = (synthResponse as any).usage || {};
    totalPromptTokens += synthUsage.prompt_tokens || 0;
    totalCompletionTokens += synthUsage.completion_tokens || 0;
    totalTokens += synthUsage.total_tokens || 0;

    return {
      text: (synthResponse as any).choices?.[0]?.message?.content || '',
      sources: allSources,
      metrics: {
        model: this.chatModel,
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
    enableThinking?: boolean;
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
      const thinkingMode = params.enableThinking ? 'enabled' : 'disabled';
      const response = await this.chatClient.chat.completions.create({
        model,
        messages,
        temperature: params.enableThinking ? undefined : (params.temperature ?? 0.2),
        response_format: { type: 'json_object' },
        thinking: { type: thinkingMode },
      } as any, { timeout: params.enableThinking ? LLM_TIMEOUT_MS * 2 : LLM_TIMEOUT_MS });

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
