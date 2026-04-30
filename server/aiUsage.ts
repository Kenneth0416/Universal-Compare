export type AiCostSource = 'provider' | 'estimated' | 'unavailable';

export type AiUsageMetrics = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  costUsd: number;
  costSource: AiCostSource;
  webSearchCount: number;
  xSearchCount: number;
  toolUsageJson: string | null;
};

type ModelPricing = {
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

const COST_TICK_DENOMINATOR = 10_000_000_000;

const XAI_FAST_PRICING: ModelPricing = {
  inputUsdPerMillion: 0.2,
  cachedInputUsdPerMillion: 0.05,
  outputUsdPerMillion: 0.5,
};

function emptyMetrics(): AiUsageMetrics {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    costSource: 'unavailable',
    webSearchCount: 0,
    xSearchCount: 0,
    toolUsageJson: null,
  };
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(Math.round(value), 0);
}

function nonNegativeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(value, 0);
}

function getKnownPricing(model: string): ModelPricing | null {
  const normalized = model.toLowerCase();
  if (normalized.startsWith('grok-4-1-fast') || normalized.startsWith('grok-4-fast')) {
    return XAI_FAST_PRICING;
  }
  return null;
}

function estimateCostUsd(
  metrics: Pick<AiUsageMetrics, 'promptTokens' | 'completionTokens' | 'totalTokens' | 'cachedTokens' | 'reasoningTokens'>,
  model: string,
): number | null {
  const pricing = getKnownPricing(model);
  if (!pricing || metrics.totalTokens === 0) return null;

  const cachedInputTokens = Math.min(metrics.cachedTokens, metrics.promptTokens);
  const uncachedInputTokens = Math.max(metrics.promptTokens - cachedInputTokens, 0);
  const outputTokens = metrics.completionTokens + metrics.reasoningTokens;

  const cost =
    (uncachedInputTokens * pricing.inputUsdPerMillion +
      cachedInputTokens * pricing.cachedInputUsdPerMillion +
      outputTokens * pricing.outputUsdPerMillion) /
    1_000_000;

  return Number(cost.toFixed(12));
}

function compactToolUsageJson(toolUsage: Record<string, number>): string | null {
  const entries = Object.entries(toolUsage)
    .filter(([, value]) => value > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return null;
  return JSON.stringify(Object.fromEntries(entries));
}

function readToolUsage(response: unknown) {
  const responseObject = response as {
    server_side_tool_usage?: Record<string, unknown>;
    usage?: {
      server_side_tool_usage_details?: Record<string, unknown>;
    };
  } | null;
  const raw = responseObject?.usage?.server_side_tool_usage_details || responseObject?.server_side_tool_usage;
  if (!raw || typeof raw !== 'object') {
    return {
      webSearchCount: 0,
      xSearchCount: 0,
      toolUsageJson: null,
    };
  }

  const toolUsage: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const normalizedValue = nonNegativeInteger(value);
    if (normalizedValue > 0) toolUsage[key] = normalizedValue;
  }

  return {
    webSearchCount: toolUsage.web_search_calls || toolUsage.web_search || 0,
    xSearchCount: toolUsage.x_search_calls || toolUsage.x_search || 0,
    toolUsageJson: compactToolUsageJson(toolUsage),
  };
}

export function extractAiUsageMetrics(response: unknown, model: string): AiUsageMetrics {
  const toolUsage = readToolUsage(response);
  const usage = (response as { usage?: Record<string, any> } | null)?.usage;
  if (!usage || typeof usage !== 'object') {
    return {
      ...emptyMetrics(),
      ...toolUsage,
    };
  }

  const promptTokens = nonNegativeInteger(usage.prompt_tokens ?? usage.input_tokens);
  const completionTokens = nonNegativeInteger(usage.completion_tokens ?? usage.output_tokens);
  const cachedTokens = nonNegativeInteger(
    usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens,
  );
  const reasoningTokens = nonNegativeInteger(
    usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens,
  );
  const explicitTotalTokens = nonNegativeInteger(usage.total_tokens);
  const totalTokens = explicitTotalTokens || promptTokens + completionTokens + reasoningTokens;

  const baseMetrics = {
    promptTokens,
    completionTokens,
    totalTokens,
    cachedTokens,
    reasoningTokens,
  };

  const costTicks = nonNegativeNumber(usage.cost_in_usd_ticks);
  if (costTicks !== null) {
    return {
      ...baseMetrics,
      costUsd: costTicks / COST_TICK_DENOMINATOR,
      costSource: 'provider',
      ...toolUsage,
    };
  }

  const estimatedCostUsd = estimateCostUsd(baseMetrics, model);
  if (estimatedCostUsd !== null) {
    return {
      ...baseMetrics,
      costUsd: estimatedCostUsd,
      costSource: 'estimated',
      ...toolUsage,
    };
  }

  return {
    ...baseMetrics,
    costUsd: 0,
    costSource: 'unavailable',
    ...toolUsage,
  };
}
