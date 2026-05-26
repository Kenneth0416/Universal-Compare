export type AdminMetricSummary = {
  users: number;
  comparisons: number;
  aiCalls: number;
  failedCalls: number;
  successRate: number;
  averageDurationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  aiCostUsd: number;
  webSearchCount: number;
  xSearchCount: number;
};

export type TrendPoint = {
  date: string;
  users: number;
  comparisons: number;
  aiCalls: number;
};

export type RunListItem = {
  runId: string;
  visitorId: string;
  itemA: string;
  itemB: string;
  language: string;
  status: 'started' | 'completed' | 'failed';
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  callCount: number;
  totalDurationMs: number;
  totalTokens: number;
  totalCostUsd: number;
};

export type CallListItem = {
  id: number;
  runId: string | null;
  visitorId: string | null;
  callType: string;
  model: string;
  status: 'success' | 'error';
  statusCode: number;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  costUsd: number;
  costSource: 'provider' | 'estimated' | 'unavailable';
  webSearchCount: number;
  xSearchCount: number;
  toolUsageJson: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type UserListItem = {
  visitorId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  userAgent: string;
  comparisonCount: number;
  aiCallCount: number;
  userType: 'user' | 'bot';
};

export type RecentComparison = {
  itemA: string;
  itemB: string;
  finishedAt: string;
};

export type FeaturedComparison = {
  id: number;
  itemA: string;
  itemB: string;
  language: string;
  description: string;
  reportId: string | null;
  slug: string;
  viewCount: number;
  sortOrder: number;
  createdAt: string;
};

export type AdminSummary = {
  today: AdminMetricSummary;
  trend: TrendPoint[];
  recentRuns: RunListItem[];
  recentFailedCalls: CallListItem[];
};

export type ReportListItem = {
  reportId: string;
  itemA: string;
  itemB: string;
  language: string;
  visitorId: string;
  createdAt: string;
  viewCount: number;
};

export type ListResponse<T> = {
  items: T[];
  total: number;
};

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

export type Entity = {
  id: number;
  name: string;
  category: string;
  createdAt: string;
};

export type CandidatePairStatus = 'pending' | 'scored' | 'promoted' | 'rejected';

export type CandidatePair = {
  id: number;
  entityAId: number;
  entityBId: number;
  itemAName: string;
  itemBName: string;
  category: string;
  status: CandidatePairStatus;
  demandScore: number | null;
  recommendation: string | null;
  signalsJson: string | null;
  reasoning: string | null;
  topSourcesJson: string | null;
  partial: boolean;
  lastScoredAt: string | null;
  createdAt: string;
};

export type BulkPreflightItemResult =
  | { id: number; status: 'scored'; result: DemandSenseResult }
  | { id: number; status: 'error'; error: string };

export type BulkPromoteResult = {
  promoted: FeaturedComparison[];
  skipped: Array<{
    candidateId: number;
    reason: 'already_promoted' | 'not_found' | 'create_failed';
  }>;
};
