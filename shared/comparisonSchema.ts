export const MAX_COMPARISON_RESULT_BYTES = 256 * 1024;

const TEXT_LIMIT = 4_000;
const SHORT_TEXT_LIMIT = 500;
const URL_LIMIT = 2_048;
const MAX_LIST_ITEMS = 32;
const MAX_SOURCES = 40;
const MAX_CITATIONS = 12;
const SAFE_URL_SCHEMES = new Set(['http:', 'https:']);
const URL_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

export type SafeSource = {
  url: string;
  title: string;
  snippet?: string;
};

export type NormalizedComparisonResult = {
  entityA: {
    name: string;
    normalized_name: string;
    category: string;
    subcategory: string;
    likely_domain: string;
    short_definition: string;
  };
  entityB: NormalizedComparisonResult['entityA'];
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
      better_for: 'A' | 'B' | 'Both' | 'Neither';
      optional_score_a?: number;
      optional_score_b?: number;
      citations?: SafeSource[];
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
  sources?: SafeSource[];
};

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as RecordValue;
}

function string(value: unknown, maxLength: number, allowEmpty = false): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > maxLength) return null;
  return normalized;
}

function requiredText(value: unknown, maxLength = TEXT_LIMIT) {
  return string(value, maxLength);
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) return null;
  const result: string[] = [];
  for (const item of value) {
    const normalized = requiredText(item, 2_000);
    if (normalized === null) return null;
    result.push(normalized);
  }
  return result;
}

/** Returns a canonical HTTP(S) URL, or null for credentials, controls, or another scheme. */
export function normalizeSafeHttpUrl(value: unknown): string | null {
  const raw = string(value, URL_LIMIT);
  if (raw === null || URL_CONTROL_CHARACTERS.test(raw)) return null;
  try {
    const parsed = new URL(raw);
    if (!SAFE_URL_SCHEMES.has(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function source(value: unknown): SafeSource | null {
  const input = record(value);
  if (!input) return null;
  const url = normalizeSafeHttpUrl(input.url);
  const title = requiredText(input.title, 1_000);
  if (!url || title === null) return null;
  const result: SafeSource = { url, title };
  if (input.snippet !== undefined) {
    const snippet = string(input.snippet, 4_000, true);
    if (snippet === null) return null;
    result.snippet = snippet;
  }
  return result;
}

function sourceList(value: unknown, maxItems: number): SafeSource[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const result: SafeSource[] = [];
  for (const item of value) {
    const normalized = source(item);
    if (!normalized) return null;
    result.push(normalized);
  }
  return result;
}

function entity(value: unknown): NormalizedComparisonResult['entityA'] | null {
  const input = record(value);
  if (!input) return null;
  const name = requiredText(input.name, SHORT_TEXT_LIMIT);
  const normalizedName = requiredText(input.normalized_name, SHORT_TEXT_LIMIT);
  const category = requiredText(input.category, SHORT_TEXT_LIMIT);
  const subcategory = requiredText(input.subcategory, SHORT_TEXT_LIMIT);
  const likelyDomain = string(input.likely_domain, URL_LIMIT, true);
  const shortDefinition = requiredText(input.short_definition, 4_000);
  if (name === null || normalizedName === null || category === null || subcategory === null || likelyDomain === null || shortDefinition === null) return null;
  return { name, normalized_name: normalizedName, category, subcategory, likely_domain: likelyDomain, short_definition: shortDefinition };
}

function score(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10 ? value : null;
}

function dimension(
  value: unknown,
  options: { allowLegacyAnalysisFields?: boolean } = {},
): NormalizedComparisonResult['dimensions'][number] | null {
  const input = record(value);
  const analysisInput = record(input?.analysis);
  if (!input || !analysisInput) return null;
  const key = requiredText(input.key, SHORT_TEXT_LIMIT);
  const label = requiredText(input.label, SHORT_TEXT_LIMIT);
  const why = requiredText(input.why_it_matters);
  const angle = requiredText(input.comparison_angle);
  const summaryA = requiredText(analysisInput.item_a_summary);
  const summaryB = requiredText(analysisInput.item_b_summary);
  const difference = requiredText(analysisInput.key_difference);
  const betterFor = analysisInput.better_for;
  if (key === null || label === null || why === null || angle === null || summaryA === null || summaryB === null || difference === null || !['A', 'B', 'Both', 'Neither'].includes(String(betterFor))) return null;

  const analysis: NormalizedComparisonResult['dimensions'][number]['analysis'] = {
    item_a_summary: summaryA,
    item_b_summary: summaryB,
    key_difference: difference,
    better_for: betterFor as 'A' | 'B' | 'Both' | 'Neither',
  };
  for (const field of ['optional_score_a', 'optional_score_b'] as const) {
    if (analysisInput[field] === undefined || analysisInput[field] === null) {
      if (!options.allowLegacyAnalysisFields) return null;
      continue;
    }
    const normalized = score(analysisInput[field]);
    if (normalized === null) return null;
    analysis[field] = normalized;
  }
  if (analysisInput.citations === undefined) {
    if (!options.allowLegacyAnalysisFields) return null;
  } else {
    const citations = sourceList(analysisInput.citations, MAX_CITATIONS);
    if (!citations) return null;
    analysis.citations = citations;
  }
  return { key, label, why_it_matters: why, comparison_angle: angle, analysis };
}

export function normalizeComparisonResult(
  value: unknown,
  options: { allowLegacyDimensionCount?: boolean; allowLegacyAnalysisFields?: boolean } = {},
): NormalizedComparisonResult | null {
  const input = record(value);
  if (!input) return null;
  const entityA = entity(input.entityA);
  const entityB = entity(input.entityB);
  const relationshipInput = record(input.relationship);
  const prosConsInput = record(input.prosCons);
  const recommendationInput = record(input.recommendation);
  if (!entityA || !entityB || !relationshipInput || !prosConsInput || !recommendationInput || !Array.isArray(input.dimensions)) return null;

  const minDimensions = options.allowLegacyDimensionCount ? 1 : 4;
  if (input.dimensions.length < minDimensions || input.dimensions.length > 6) return null;
  const dimensions: NormalizedComparisonResult['dimensions'] = [];
  for (const item of input.dimensions) {
    const normalized = dimension(item, {
      allowLegacyAnalysisFields: options.allowLegacyAnalysisFields ?? options.allowLegacyDimensionCount,
    });
    if (!normalized) return null;
    dimensions.push(normalized);
  }

  const relationshipType = requiredText(relationshipInput.relationship_type, SHORT_TEXT_LIMIT);
  const comparisonGoal = requiredText(relationshipInput.comparison_goal);
  const reasoning = requiredText(relationshipInput.reasoning);
  if (relationshipType === null || comparisonGoal === null || reasoning === null || typeof relationshipInput.can_directly_compare !== 'boolean') return null;

  const itemAPros = stringList(prosConsInput.item_a_pros);
  const itemACons = stringList(prosConsInput.item_a_cons);
  const itemBPros = stringList(prosConsInput.item_b_pros);
  const itemBCons = stringList(prosConsInput.item_b_cons);
  const bestForA = stringList(recommendationInput.best_for_a);
  const bestForB = stringList(recommendationInput.best_for_b);
  const chooseFirst = requiredText(recommendationInput.which_to_choose_first);
  const notDirect = string(recommendationInput.when_not_to_compare_directly, TEXT_LIMIT, true);
  const shortVerdict = requiredText(recommendationInput.short_verdict);
  const longVerdict = requiredText(recommendationInput.long_verdict);
  if (!itemAPros || !itemACons || !itemBPros || !itemBCons || !bestForA || !bestForB || chooseFirst === null || notDirect === null || shortVerdict === null || longVerdict === null) return null;

  const result: NormalizedComparisonResult = {
    entityA,
    entityB,
    relationship: {
      relationship_type: relationshipType,
      comparison_goal: comparisonGoal,
      can_directly_compare: relationshipInput.can_directly_compare,
      reasoning,
    },
    dimensions,
    prosCons: { item_a_pros: itemAPros, item_a_cons: itemACons, item_b_pros: itemBPros, item_b_cons: itemBCons },
    recommendation: {
      best_for_a: bestForA,
      best_for_b: bestForB,
      which_to_choose_first: chooseFirst,
      when_not_to_compare_directly: notDirect,
      short_verdict: shortVerdict,
      long_verdict: longVerdict,
    },
  };
  if (input.sources !== undefined) {
    const sources = sourceList(input.sources, MAX_SOURCES);
    if (!sources) return null;
    result.sources = sources;
  }
  return result;
}

export function validateComparisonResult(value: unknown): value is NormalizedComparisonResult {
  try {
    return normalizeComparisonResult(value) !== null;
  } catch {
    return false;
  }
}

export function serializeComparisonResult(value: unknown): string | null {
  try {
    const normalized = normalizeComparisonResult(value);
    if (!normalized) return null;
    const serialized = JSON.stringify(normalized);
    return Buffer.byteLength(serialized, 'utf8') <= MAX_COMPARISON_RESULT_BYTES ? serialized : null;
  } catch {
    return null;
  }
}
