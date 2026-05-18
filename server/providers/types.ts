export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
};

export type JsonSchema = Record<string, unknown>;

export type AiCallMetrics = {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
};

/**
 * Raw params from the frontend's Responses API request.
 * When provided, GrokProvider passes these through directly (preserving researchConfig behavior).
 * MinimaxProvider ignores these and builds its own tool-calling flow from the query.
 */
export type ResearchRawParams = {
  input: Array<{ role: string; content: string }>;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: string;
};

export interface AIProvider {
  readonly name: string;
  /** Phase 1: research with web search. rawParams allows pass-through of frontend-built requests. */
  research(query: string, rawParams?: ResearchRawParams): Promise<{ text: string; metrics: AiCallMetrics }>;
  chatCompletion(params: {
    messages: ChatMessage[];
    schema: JsonSchema;
    schemaName: string;
    temperature?: number;
  }): Promise<{ json: string; metrics: AiCallMetrics }>;
}
