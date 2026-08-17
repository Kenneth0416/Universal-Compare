import type OpenAI from 'openai';
import type { Source } from './providers/types';
import { callMinimaxSearch } from './providers/minimax';

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
  signal?: AbortSignal,
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

  return `You are a SEO/GEO opportunity analyst for a small, new comparison website. Given search results for the pair "${itemA} vs ${itemB}", judge the RANKING OPPORTUNITY, not the popularity of the topic.

Score = (evidence that real people search this) × (our chance of ranking for it).
We win on long-tail, newly launched products with genuine search demand and thin coverage. We CANNOT win pages already owned by big publishers.

Scoring rubric (0-10):
- 8-10 (excellent): Blue ocean. The pair is specific and plausible, there is real evidence people search or discuss it (autocomplete-style queries, forum/Reddit threads, shopping intent, a recent launch shoppers are cross-shopping), AND coverage is thin, shallow, or low quality — spec-dump pages, aggregator stubs, no real head-to-head.
- 6-7 (good): Demand is evident and coverage is moderate — a few decent articles, but gaps remain (missing angles, outdated, no authoritative head-to-head).
- 5 (consider): Demand plausible but weakly evidenced, or coverage is solid enough that ranking is uncertain.
- 0-4 (skip): The pair is nonsense or mismatched (different categories, incomparable things), there is NO evidence anyone searches it, OR the space is saturated — multiple strong authoritative head-to-heads from major publishers already own the SERP, so we cannot rank.

IMPORTANT INVERSION vs. naive SEO scoring:
- Many existing comparison articles LOWERS the score (crowded, already answered), it does not raise it.
- Freshness RAISES the score: a product launched recently has demand arriving faster than coverage — that gap is exactly our opportunity.
- Zero comparison articles is NOT automatically bad. If the pair is plausible and specific and any demand signal exists (people asking on forums, obvious cross-shopping between rivals or successive generations), thin coverage is the best possible outcome — score it high.
- Only punish "no articles" when the pair also looks like something nobody would ever search.

Signals to extract:
- existing_articles_count: distinct comparison articles in Search 1 (higher = more crowded = worse for us)
- has_reddit_discussion: any Reddit/forum thread with substantive discussion in Search 2 (demand evidence, good)
- has_authoritative_source: G2/Capterra/Wirecutter/Wikipedia/major-press head-to-head in Search 1 (a strong incumbent we must outrank; usually bad for us)
- competition_level: low = few or weak comparison pages, we can realistically rank (OPPORTUNITY, good); medium = some credible coverage; high = saturated with strong authoritative comparisons (avoid)
- freshness: stale (>2y — likely a settled topic), recent (last 2y), fresh (last 6mo — new launch, best opportunity)

Reasoning: 1-2 sentences in ${langName} explaining the score in terms of demand evidence and how crowded the space is.

Output JSON only matching this schema (fields: score, recommendation, signals{existing_articles_count, has_reddit_discussion, has_authoritative_source, competition_level, freshness}, reasoning). recommendation MUST be exactly one of: "skip", "consider", "good", "excellent". No markdown.

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
    this.searchFn = deps.searchFn ?? callMinimaxSearch;
    this.deepseekClient = deps.deepseekClient;
    this.deepseekModel = deps.deepseekModel || 'deepseek-v4-flash';
    this.minimaxSearchApiKey = deps.minimaxSearchApiKey;
    this.minimaxSearchBaseUrl = deps.minimaxSearchBaseUrl;
  }

  async scorePair(
    itemA: string,
    itemB: string,
    language = 'en',
    signal?: AbortSignal,
  ): Promise<DemandSenseResult> {
    if (
      typeof itemA !== 'string' ||
      typeof itemB !== 'string' ||
      !itemA.trim() ||
      !itemB.trim()
    ) {
      throw new DemandSensingError(
        'itemA and itemB must be non-empty strings',
        400,
      );
    }

    const trimmedA = itemA.trim().slice(0, 200);
    const trimmedB = itemB.trim().slice(0, 200);

    if (trimmedA.toLowerCase() === trimmedB.toLowerCase()) {
      throw new DemandSensingError(
        'itemA and itemB must be different',
        400,
      );
    }

    const start = Date.now();
    const generalQuery = `${trimmedA} vs ${trimmedB}`;
    const redditQuery = `${trimmedA} vs ${trimmedB} reddit`;

    const [r1, r2] = await Promise.allSettled([
      this.searchFn(this.minimaxSearchApiKey, generalQuery, this.minimaxSearchBaseUrl, signal),
      this.searchFn(this.minimaxSearchApiKey, redditQuery, this.minimaxSearchBaseUrl, signal),
    ]);

    const search1 = r1.status === 'fulfilled' ? r1.value : null;
    const search2 = r2.status === 'fulfilled' ? r2.value : null;
    const partial = !search1 || !search2;

    if (!search1 && !search2) {
      throw new DemandSensingError('Both MiniMax searches failed', 502);
    }

    const prompt = buildPrompt(trimmedA, trimmedB, language, search1, search2);

    signal?.throwIfAborted();
    const { scoring, totalTokens } = await this.callDeepseekWithRetry(prompt, signal);

    const sourcePool = [
      ...(search1?.sources ?? []),
      ...(search2?.sources ?? []),
    ];
    const topSources = dedupeByUrl(sourcePool)
      .slice(0, 5)
      .map((s) => ({ url: s.url, title: s.title }));

    return {
      score: scoring.score,
      recommendation: scoring.recommendation,
      signals: scoring.signals,
      reasoning: scoring.reasoning,
      topSources,
      partial,
      metrics: { durationMs: Date.now() - start, totalTokens },
    };
  }

  private async callDeepseekWithRetry(
    prompt: string,
    signal?: AbortSignal,
  ): Promise<{ scoring: any; totalTokens: number }> {
    const messages: any[] = [{ role: 'user', content: prompt }];
    let totalTokens = 0;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.deepseekClient.chat.completions.create({
          model: this.deepseekModel,
          messages,
          temperature: 0.2,
          response_format: { type: 'json_object' },
        } as any, { signal });

        const content = (response as any).choices?.[0]?.message?.content || '';
        const usage = (response as any).usage || {};
        totalTokens += usage.total_tokens || 0;

        const scoring = JSON.parse(content);
        this.validateScoringResponse(scoring);
        return { scoring, totalTokens };
      } catch (err) {
        signal?.throwIfAborted();
        lastError = err as Error;
        if (attempt === 0) {
          messages.push(
            { role: 'assistant', content: '' },
            {
              role: 'user',
              content:
                'Your previous response was invalid (parse error or missing required fields). Respond with ONLY a raw JSON object containing: score, recommendation, signals{existing_articles_count, has_reddit_discussion, has_authoritative_source, competition_level, freshness}, reasoning. No markdown, no commentary.',
            },
          );
        }
      }
    }

    throw new DemandSensingError(
      `DeepSeek failed after retry: ${lastError?.message || 'unknown'}`,
      502,
    );
  }

  private validateScoringResponse(parsed: any): void {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('response must be an object');
    }

    const required = ['score', 'recommendation', 'signals', 'reasoning'];
    const missing = required.filter(
      (k) => parsed[k] === undefined || parsed[k] === null,
    );
    if (missing.length) {
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }
    if (typeof parsed.score !== 'number' || !Number.isFinite(parsed.score) || parsed.score < 0 || parsed.score > 10) {
      throw new Error('score must be a finite number between 0 and 10');
    }
    if (!['skip', 'consider', 'good', 'excellent'].includes(parsed.recommendation)) {
      // Models occasionally invent synonyms ("publish", "proceed"); the score
      // is the authoritative signal, so derive the tier from it instead of
      // failing the whole (search-expensive) scoring call.
      parsed.recommendation = parsed.score >= 8 ? 'excellent'
        : parsed.score >= 6 ? 'good'
        : parsed.score >= 4 ? 'consider'
        : 'skip';
    }
    if (typeof parsed.reasoning !== 'string' || !parsed.reasoning.trim() || parsed.reasoning.length > 1000) {
      throw new Error('reasoning must be a non-empty string of at most 1000 characters');
    }

    const signals = parsed.signals;
    if (!signals || typeof signals !== 'object' || Array.isArray(signals)) {
      throw new Error('signals must be an object');
    }
    const sigRequired = [
      'existing_articles_count',
      'has_reddit_discussion',
      'has_authoritative_source',
      'competition_level',
      'freshness',
    ];
    const sigMissing = sigRequired.filter((k) => signals[k] === undefined);
    if (sigMissing.length) {
      throw new Error(`Missing required signals: ${sigMissing.join(', ')}`);
    }
    if (!Number.isInteger(signals.existing_articles_count) || signals.existing_articles_count < 0) {
      throw new Error('existing_articles_count must be a non-negative integer');
    }
    if (typeof signals.has_reddit_discussion !== 'boolean' || typeof signals.has_authoritative_source !== 'boolean') {
      throw new Error('discussion and authoritative source signals must be booleans');
    }
    if (!['low', 'medium', 'high'].includes(signals.competition_level)) {
      throw new Error('competition_level must be a supported value');
    }
    if (!['stale', 'recent', 'fresh'].includes(signals.freshness)) {
      throw new Error('freshness must be a supported value');
    }
  }
}
