export type XSearchMode = 'auto' | 'always' | 'off';

export type ResponsesAPIInput = {
  role: 'user' | 'assistant';
  content: string;
};

export type ResponsesAPITool = { type: 'web_search' } | { type: 'x_search' };

export type ResearchRequest = {
  input: ResponsesAPIInput[];
  tools: ResponsesAPITool[];
  tool_choice: 'auto';
};

export function normalizeXSearchMode(value: unknown): XSearchMode {
  if (typeof value !== 'string') return 'auto';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'off' || normalized === 'always' || normalized === 'auto') return normalized;
  return 'auto';
}

export function buildResearchRequest(itemName: string, xSearchMode: XSearchMode): ResearchRequest {
  const basePrompt = `Research comprehensive information about "${itemName}".

Use Web Search for authoritative and factual sources:
- Key characteristics and defining attributes
- Historical background and timeline
- Expert analysis and comparisons
- Recent developments or changes
- Relevant facts and data points

Provide detailed, factual information with sources.`;

  if (xSearchMode === 'off') {
    return {
      input: [
        {
          role: 'user',
          content: `${basePrompt}

Do not use X Search. If social sentiment is relevant, rely only on reputable web sources that summarize it.`,
        },
      ],
      tools: [{ type: 'web_search' }],
      tool_choice: 'auto',
    };
  }

  if (xSearchMode === 'always') {
    return {
      input: [
        {
          role: 'user',
          content: `${basePrompt}

Use X Search to gather recent public discussion from the last 3 months:
- Public opinions and perspectives
- Common criticisms or praise
- Trending topics and discussions
- Real-world observations and insights`,
        },
      ],
      tools: [{ type: 'web_search' }, { type: 'x_search' }],
      tool_choice: 'auto',
    };
  }

  return {
    input: [
      {
        role: 'user',
        content: `${basePrompt}

Use X Search only if recent public sentiment, controversy, launch reactions, creator/community discussion, or fast-moving social context would materially improve the comparison. Skip X Search for stable reference facts, mature products with well-covered reviews, historical topics, or subjects where social posts are unlikely to add decision-relevant evidence.`,
      },
    ],
    tools: [{ type: 'web_search' }, { type: 'x_search' }],
    tool_choice: 'auto',
  };
}
