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

export interface AIProvider {
  readonly name: string;
  research(query: string): Promise<{ text: string; metrics: AiCallMetrics }>;
  chatCompletion(params: {
    messages: ChatMessage[];
    schema: JsonSchema;
    schemaName: string;
    temperature?: number;
  }): Promise<{ json: string; metrics: AiCallMetrics }>;
}
