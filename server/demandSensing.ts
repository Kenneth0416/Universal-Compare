import type OpenAI from 'openai';
import type { Source } from './providers/types';

export type DemandSenseSignals = {
  existing_articles_count: number;
  has_reddit_discussion: boolean;
  has_authoritative_source: boolean;
  competition_level: 'low' | 'medium' | 'high';
  freshness: 'stale' | 'recent' | 'fresh';
};

export type DemandSenseResult = {
  score: number;
  recommendation: 'skip' | 'consider' | 'good' | 'excellent';
  signals: DemandSenseSignals;
  reasoning: string;
  topSources: Array<{ url: string; title: string }>;
  partial: boolean;
  metrics: { durationMs: number; totalTokens: number };
};

export type MinimaxSearchFn = (
  apiKey: string,
  query: string,
  baseUrl?: string,
) => Promise<{ text: string; sources: Source[] }>;

export type DemandSensingDependencies = {
  minimaxSearchApiKey: string;
  minimaxSearchBaseUrl?: string;
  deepseekClient: OpenAI;
  deepseekModel?: string;
  searchFn?: MinimaxSearchFn;
};

export class DemandSensingError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'DemandSensingError';
  }
}

function dedupeByUrl(sources: Source[]): Source[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    const normalized = (s.url || '').toLowerCase().replace(/\/+$/, '');
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function formatSearchBlock(
  label: string,
  query: string,
  result: { sources: Source[] } | null,
): string {
  if (!result) return `=== ${label}: "${query}" ===\n(search unavailable)`;
  const lines = result.sources
    .slice(0, 10)
    .map(
      (s, i) =>
        `[${i + 1}] ${s.title}\n    ${s.url}\n    ${s.snippet || ''}`,
    );
  return `=== ${label}: "${query}" ===\n${lines.join('\n\n')}`;
}

function buildPrompt(
  itemA: string,
  itemB: string,
  language: string,
  search1: { sources: Source[] } | null,
  search2: { sources: Source[] } | null,
): string {
  const generalQuery = `${itemA} vs ${itemB}`;
  const redditQuery = `${itemA} vs ${itemB} reddit`;
  const langName =
    language === 'zh-CN' || language === 'zh-Hans'
      ? 'Simplified Chinese'
      : language === 'zh-TW' || language === 'zh-Hant'
        ? 'Traditional Chinese'
        : 'English';

  return `You are a SEO/GEO demand analyst. Given search results for the pair "${itemA} vs ${itemB}", judge whether this comparison has real demand for a comparison website.

Scoring rubric (0-10):
- 0-3 (skip): No existing articles, no community discussion. Obscure or nonsensical.
- 4-5 (consider): Some articles exist but quality low or topic niche.
- 6-7 (good): Clear demand — multiple articles, some community discussion, not over-saturated.
- 8-10 (excellent): Strong demand — many articles, active Reddit, authoritative sources.

Signals to extract:
- existing_articles_count: distinct comparison articles in Search 1
- has_reddit_discussion: any Reddit thread with substantive discussion in Search 2
- has_authoritative_source: G2/Capterra/Wirecutter/Wikipedia/major-press in Search 1
- competition_level: low/medium/high (quality + diversity of coverage)
- freshness: stale (>2y), recent (last 2y), fresh (last 6mo)

Reasoning: 1-2 sentences in ${langName} explaining the score.

Output JSON only matching this schema (fields: score, recommendation, signals{existing_articles_count, has_reddit_discussion, has_authoritative_source, competition_level, freshness}, reasoning). No markdown.

Search results:
${formatSearchBlock('Search 1 (General SERP)', generalQuery, search1)}

${formatSearchBlock('Search 2 (Reddit)', redditQuery, search2)}`;
}

export class DemandSensingService {
  private searchFn: MinimaxSearchFn;
  private deepseekClient: OpenAI;
  private deepseekModel: string;
  private minimaxSearchApiKey: string;
  private minimaxSearchBaseUrl: string | undefined;

  constructor(deps: DemandSensingDependencies) {
    if (!deps.searchFn) {
      throw new Error(
        'searchFn must be provided (or wire callMinimaxSearch in production)',
      );
    }
    this.searchFn = deps.searchFn;
    this.deepseekClient = deps.deepseekClient;
    this.deepseekModel = deps.deepseekModel || 'deepseek-v4-flash';
    this.minimaxSearchApiKey = deps.minimaxSearchApiKey;
    this.minimaxSearchBaseUrl = deps.minimaxSearchBaseUrl;
  }

  async scorePair(
    itemA: string,
    itemB: string,
    language = 'en',
  ): Promise<DemandSenseResult> {
    const start = Date.now();
    const generalQuery = `${itemA} vs ${itemB}`;
    const redditQuery = `${itemA} vs ${itemB} reddit`;

    const [r1, r2] = await Promise.allSettled([
      this.searchFn(this.minimaxSearchApiKey, generalQuery, this.minimaxSearchBaseUrl),
      this.searchFn(this.minimaxSearchApiKey, redditQuery, this.minimaxSearchBaseUrl),
    ]);

    const search1 = r1.status === 'fulfilled' ? r1.value : null;
    const search2 = r2.status === 'fulfilled' ? r2.value : null;
    const partial = !search1 || !search2;

    if (!search1 && !search2) {
      throw new DemandSensingError('Both MiniMax searches failed', 502);
    }

    const prompt = buildPrompt(itemA, itemB, language, search1, search2);

    const response = await this.deepseekClient.chat.completions.create({
      model: this.deepseekModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    } as any);

    const content = (response as any).choices?.[0]?.message?.content || '';
    const usage = (response as any).usage || {};
    const totalTokens = usage.total_tokens || 0;

    const parsed = JSON.parse(content);

    const sourcePool = search1?.sources ?? search2?.sources ?? [];
    const topSources = dedupeByUrl(sourcePool)
      .slice(0, 5)
      .map((s) => ({ url: s.url, title: s.title }));

    return {
      score: parsed.score,
      recommendation: parsed.recommendation,
      signals: parsed.signals,
      reasoning: parsed.reasoning,
      topSources,
      partial,
      metrics: { durationMs: Date.now() - start, totalTokens },
    };
  }
}
