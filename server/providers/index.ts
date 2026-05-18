import type OpenAI from 'openai';
import type { AIProvider } from './types';
import { GrokProvider } from './grok';
import { MinimaxProvider } from './minimax';

export type { AIProvider, AiCallMetrics, ChatMessage, JsonSchema, ResearchRawParams } from './types';

type ProviderOptions = {
  grokClient?: OpenAI;
  minimaxClient?: OpenAI;
  minimaxSearchApiKey?: string;
  minimaxBaseUrl?: string;
};

export function createProvider(
  name: string,
  options: ProviderOptions,
): AIProvider {
  switch (name) {
    case 'grok': {
      if (!options.grokClient) throw new Error('grokClient is required for Grok provider');
      return new GrokProvider(options.grokClient);
    }
    case 'minimax': {
      if (!options.minimaxClient) throw new Error('minimaxClient is required for MiniMax provider');
      if (!options.minimaxSearchApiKey) throw new Error('minimaxSearchApiKey is required for MiniMax provider');
      return new MinimaxProvider(options.minimaxClient, options.minimaxSearchApiKey, options.minimaxBaseUrl);
    }
    default:
      throw new Error(`Unknown AI provider: ${name}`);
  }
}
