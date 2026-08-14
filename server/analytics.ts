import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

type DatabaseConnection = {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    run: (...params: unknown[]) => { changes: number };
    get: (...params: unknown[]) => any;
    all: (...params: unknown[]) => any[];
  };
  transaction: <T>(fn: () => T) => () => T;
  pragma: (source: string) => void;
};

export type VisitorRecord = {
  visitorId: string;
  isNew: boolean;
};

export type StartComparisonRunInput = {
  runId?: string;
  visitorId: string;
  itemA: string;
  itemB: string;
  language?: string;
};

export type FinishComparisonRunInput = {
  runId: string;
  visitorId?: string;
  status: 'completed' | 'failed';
  errorMessage?: string;
};

export type LogAiCallInput = {
  runId?: string;
  visitorId?: string;
  callType: 'responses' | 'chat' | string;
  model?: string;
  status: 'success' | 'error';
  statusCode: number;
  durationMs: number;
  errorMessage?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  costSource?: 'provider' | 'estimated' | 'unavailable';
  webSearchCount?: number;
  xSearchCount?: number;
  toolUsageJson?: string | null;
};

export type AdminMetricSummary = {
  users: number;
  humanUsers: number;
  aiUsers: number;
  botUsers: number;
  returningUsers: number;
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

export type VisitorType = 'human' | 'ai' | 'bot';

export type UserListItem = {
  visitorId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  userAgent: string;
  visitCount: number;
  comparisonCount: number;
  aiCallCount: number;
  userType: VisitorType;
};

// AI assistants and their crawlers — checked before the generic bot patterns
// because most of their tokens ("GPTBot", "ClaudeBot") also match those.
const AI_UA_PATTERNS = [
  'gptbot', 'chatgpt-user', 'oai-searchbot', 'openai',
  'claudebot', 'claude-user', 'claude-web', 'anthropic',
  'perplexitybot', 'perplexity-user', 'bytespider', 'amazonbot', 'amzn-searchbot',
  'google-extended', 'meta-external', 'ccbot', 'cohere', 'youbot', 'mistral',
];

const BOT_UA_PATTERNS = [
  'googlebot', 'googleother', 'google-inspectiontool', 'bingbot', 'bingpreview',
  'yandex', 'baiduspider', 'duckduckbot', 'applebot', 'petalbot', 'facebookexternalhit',
  'semrush', 'ahrefs', 'mj12', 'dotbot', 'seznambot',
  'bot', 'crawl', 'spider', 'curl', 'wget', 'python', 'go-http', 'node-fetch', 'axios',
  'okhttp', 'libwww', 'httpclient', 'headless', 'monitor', 'uptime', 'healthcheck',
  'scan', 'zgrab', 'masscan', 'censys', 'expanse', 'palo alto',
];

// SQL expression classifying a user-agent column as 'human' | 'ai' | 'bot'.
// Patterns are compile-time constants, never user input.
function visitorTypeSql(column: string) {
  const match = (patterns: string[]) => patterns.map((p) => `instr(lower(${column}), '${p}') > 0`).join(' OR ');
  return `CASE
    WHEN ${column} IS NULL OR ${column} = '' THEN 'bot'
    WHEN ${match(AI_UA_PATTERNS)} THEN 'ai'
    WHEN ${match(BOT_UA_PATTERNS)} THEN 'bot'
    ELSE 'human'
  END`;
}

export type RecentComparison = {
  itemA: string;
  itemB: string;
  finishedAt: string;
};

export type AdminSummary = {
  today: AdminMetricSummary;
  trend: TrendPoint[];
  recentRuns: RunListItem[];
  recentFailedCalls: CallListItem[];
};

const MAX_TEXT_LENGTH = 500;

function isoNow() {
  return new Date().toISOString();
}

function truncate(value: string | undefined, maxLength = MAX_TEXT_LENGTH) {
  if (!value) return '';
  return value.trim().slice(0, maxLength);
}

function hashIp(ipAddress: string | undefined, secret: string) {
  return crypto
    .createHash('sha256')
    .update(`${secret}:${ipAddress || 'unknown'}`)
    .digest('hex');
}

function generateId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

const ALLOWED_SUMMARY_PERIODS = new Set([0, 1, 7, 14, 30]);

export function normalizeSummaryPeriod(periodDays?: number): 0 | 1 | 7 | 14 | 30 {
  const resolved = periodDays === undefined ? 0 : periodDays;
  if (!Number.isInteger(resolved) || !ALLOWED_SUMMARY_PERIODS.has(resolved)) {
    throw new RangeError('periodDays must be one of 0, 1, 7, 14, or 30');
  }
  return resolved as 0 | 1 | 7 | 14 | 30;
}

function percentage(part: number, total: number) {
  if (total === 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function normalizeLimit(limit = 50) {
  return Math.min(Math.max(Number(limit) || 50, 1), 100);
}

function normalizeOffset(offset = 0) {
  return Math.max(Number(offset) || 0, 0);
}

function ensureParentDirectory(dbPath: string) {
  if (dbPath === ':memory:') return;
  mkdirSync(path.dirname(dbPath), { recursive: true });
}

function initializeSchema(db: DatabaseConnection) {
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS visitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_id TEXT NOT NULL UNIQUE,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      user_agent TEXT NOT NULL DEFAULT '',
      ip_hash TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS comparison_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL UNIQUE,
      visitor_id TEXT NOT NULL,
      item_a TEXT NOT NULL,
      item_b TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en',
      status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
      error_message TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ai_call_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT,
      visitor_id TEXT,
      call_type TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('success', 'error')),
      status_code INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cached_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      cost_source TEXT NOT NULL DEFAULT 'unavailable',
      web_search_count INTEGER NOT NULL DEFAULT 0,
      x_search_count INTEGER NOT NULL DEFAULT 0,
      tool_usage_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_visitors_visitor_id ON visitors(visitor_id);
    CREATE INDEX IF NOT EXISTS idx_visitors_last_seen ON visitors(last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_runs_run_id ON comparison_runs(run_id);
    CREATE INDEX IF NOT EXISTS idx_runs_started ON comparison_runs(started_at);
    CREATE INDEX IF NOT EXISTS idx_calls_created ON ai_call_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_calls_run_id ON ai_call_logs(run_id);
  `);

  const migrations: [string, string][] = [
    ['prompt_tokens', 'ALTER TABLE ai_call_logs ADD COLUMN prompt_tokens INTEGER NOT NULL DEFAULT 0'],
    ['completion_tokens', 'ALTER TABLE ai_call_logs ADD COLUMN completion_tokens INTEGER NOT NULL DEFAULT 0'],
    ['total_tokens', 'ALTER TABLE ai_call_logs ADD COLUMN total_tokens INTEGER NOT NULL DEFAULT 0'],
    ['cached_tokens', 'ALTER TABLE ai_call_logs ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0'],
    ['reasoning_tokens', 'ALTER TABLE ai_call_logs ADD COLUMN reasoning_tokens INTEGER NOT NULL DEFAULT 0'],
    ['cost_usd', 'ALTER TABLE ai_call_logs ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0'],
    ['cost_source', "ALTER TABLE ai_call_logs ADD COLUMN cost_source TEXT NOT NULL DEFAULT 'unavailable'"],
    ['web_search_count', 'ALTER TABLE ai_call_logs ADD COLUMN web_search_count INTEGER NOT NULL DEFAULT 0'],
    ['x_search_count', 'ALTER TABLE ai_call_logs ADD COLUMN x_search_count INTEGER NOT NULL DEFAULT 0'],
    ['tool_usage_json', 'ALTER TABLE ai_call_logs ADD COLUMN tool_usage_json TEXT'],
  ];

  for (const [col, sql] of migrations) {
    try {
      db.prepare(`SELECT ${col} FROM ai_call_logs LIMIT 1`).get();
    } catch {
      db.exec(sql);
    }
  }

  const visitorMigrations: [string, string][] = [
    ['visit_count', 'ALTER TABLE visitors ADD COLUMN visit_count INTEGER NOT NULL DEFAULT 1'],
  ];

  for (const [col, sql] of visitorMigrations) {
    try {
      db.prepare(`SELECT ${col} FROM visitors LIMIT 1`).get();
    } catch {
      db.exec(sql);
    }
  }
}

export function createAnalyticsStore(dbPath: string, secret: string) {
  ensureParentDirectory(dbPath);
  const db = new Database(dbPath) as DatabaseConnection;
  initializeSchema(db);

  const ensureVisitor = ({
    visitorId,
    userAgent,
    ipAddress,
  }: {
    visitorId?: string;
    userAgent?: string;
    ipAddress?: string;
  }): VisitorRecord => {
    const now = isoNow();
    const resolvedVisitorId = visitorId && visitorId.startsWith('v_') ? visitorId : generateId('v');
    const existing = db.prepare('SELECT visitor_id, last_seen_at AS lastSeenAt FROM visitors WHERE visitor_id = ?').get(resolvedVisitorId) as { visitor_id: string; lastSeenAt: string } | undefined;

    // A gap of 30+ minutes since the last touch counts as a new visit.
    const isNewVisit = existing && Date.parse(now) - Date.parse(existing.lastSeenAt) > 30 * 60 * 1_000 ? 1 : 0;

    db.prepare(`
      INSERT INTO visitors (visitor_id, first_seen_at, last_seen_at, user_agent, ip_hash)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(visitor_id) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        user_agent = excluded.user_agent,
        ip_hash = excluded.ip_hash,
        visit_count = visit_count + ?
    `).run(resolvedVisitorId, now, now, truncate(userAgent), hashIp(ipAddress, secret), isNewVisit);

    return {
      visitorId: resolvedVisitorId,
      isNew: !existing,
    };
  };

  const startComparisonRun = (input: StartComparisonRunInput) => {
    const now = isoNow();
    const requestedRunId = input.runId?.trim().slice(0, 200);
    const insert = db.prepare(`
      INSERT OR IGNORE INTO comparison_runs (
        run_id, visitor_id, item_a, item_b, language, status, error_message, started_at, finished_at
      )
      VALUES (?, ?, ?, ?, ?, 'started', NULL, ?, NULL)
    `);

    let runId = requestedRunId || generateId('run');
    let result = insert.run(
      runId,
      input.visitorId,
      truncate(input.itemA),
      truncate(input.itemB),
      truncate(input.language, 20) || 'en',
      now,
    );

    // Generated IDs are owned by the server and should never alias an existing run.
    while (!requestedRunId && result.changes === 0) {
      runId = generateId('run');
      result = insert.run(
        runId,
        input.visitorId,
        truncate(input.itemA),
        truncate(input.itemB),
        truncate(input.language, 20) || 'en',
        now,
      );
    }

    const created = result.changes > 0;
    const existing = created
      ? null
      : db.prepare('SELECT visitor_id AS visitorId FROM comparison_runs WHERE run_id = ?').get(runId);

    return {
      runId,
      visitorId: input.visitorId,
      created,
      owned: created || existing?.visitorId === input.visitorId,
    };
  };

  const finishComparisonRun = (input: FinishComparisonRunInput) => {
    // Without a verified visitor identity the unguessable run id itself is the
    // capability (cookie-less clients); ownership is enforced whenever a
    // visitor id is present.
    const result = input.visitorId
      ? db.prepare(`
          UPDATE comparison_runs
          SET status = ?, error_message = ?, finished_at = ?
          WHERE run_id = ? AND visitor_id = ?
        `).run(
          input.status,
          input.errorMessage ? truncate(input.errorMessage, 1000) : null,
          isoNow(),
          input.runId,
          input.visitorId,
        )
      : db.prepare(`
          UPDATE comparison_runs
          SET status = ?, error_message = ?, finished_at = ?
          WHERE run_id = ?
        `).run(
          input.status,
          input.errorMessage ? truncate(input.errorMessage, 1000) : null,
          isoNow(),
          input.runId,
        );

    return { updated: result.changes > 0 };
  };

  const logAiCall = (input: LogAiCallInput) => {
    db.prepare(`
      INSERT INTO ai_call_logs (
        run_id, visitor_id, call_type, model, status, status_code, duration_ms,
        prompt_tokens, completion_tokens, total_tokens, cached_tokens, reasoning_tokens,
        cost_usd, cost_source, web_search_count, x_search_count, tool_usage_json, error_message, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.runId || null,
      input.visitorId || null,
      truncate(input.callType, 40),
      truncate(input.model, 120),
      input.status,
      input.statusCode,
      Math.max(Math.round(input.durationMs), 0),
      Math.max(Math.round(input.promptTokens || 0), 0),
      Math.max(Math.round(input.completionTokens || 0), 0),
      Math.max(Math.round(input.totalTokens || 0), 0),
      Math.max(Math.round(input.cachedTokens || 0), 0),
      Math.max(Math.round(input.reasoningTokens || 0), 0),
      Math.max(input.costUsd || 0, 0),
      input.costSource || 'unavailable',
      Math.max(Math.round(input.webSearchCount || 0), 0),
      Math.max(Math.round(input.xSearchCount || 0), 0),
      input.toolUsageJson || null,
      input.errorMessage ? truncate(input.errorMessage, 1000) : null,
      isoNow(),
    );
  };

  const listRuns = ({ limit, offset }: { limit?: number; offset?: number } = {}) => {
    const safeLimit = normalizeLimit(limit);
    const safeOffset = normalizeOffset(offset);
    const items = db.prepare(`
      SELECT
        r.run_id AS runId,
        r.visitor_id AS visitorId,
        r.item_a AS itemA,
        r.item_b AS itemB,
        r.language AS language,
        r.status AS status,
        r.error_message AS errorMessage,
        r.started_at AS startedAt,
        r.finished_at AS finishedAt,
        COUNT(c.id) AS callCount,
        CASE
          WHEN r.finished_at IS NOT NULL
          THEN CAST((julianday(r.finished_at) - julianday(r.started_at)) * 86400000 AS INTEGER)
          ELSE 0
        END AS totalDurationMs,
        COALESCE(SUM(c.total_tokens), 0) AS totalTokens,
        COALESCE(SUM(c.cost_usd), 0) AS totalCostUsd
      FROM comparison_runs r
      LEFT JOIN ai_call_logs c ON c.run_id = r.run_id
      GROUP BY r.id
      ORDER BY r.started_at DESC
      LIMIT ? OFFSET ?
    `).all(safeLimit, safeOffset) as RunListItem[];

    const total = Number(db.prepare('SELECT COUNT(*) AS count FROM comparison_runs').get().count || 0);
    return { items, total };
  };

  const listCalls = ({
    limit,
    offset,
    status,
  }: {
    limit?: number;
    offset?: number;
    status?: 'success' | 'error';
  } = {}) => {
    const safeLimit = normalizeLimit(limit);
    const safeOffset = normalizeOffset(offset);
    const where = status ? 'WHERE status = ?' : '';
    const params: unknown[] = status ? [status, safeLimit, safeOffset] : [safeLimit, safeOffset];
    const items = db.prepare(`
      SELECT
        id,
        run_id AS runId,
        visitor_id AS visitorId,
        call_type AS callType,
        model,
        status,
        status_code AS statusCode,
        duration_ms AS durationMs,
        prompt_tokens AS promptTokens,
        completion_tokens AS completionTokens,
        total_tokens AS totalTokens,
        cached_tokens AS cachedTokens,
        reasoning_tokens AS reasoningTokens,
        cost_usd AS costUsd,
        cost_source AS costSource,
        web_search_count AS webSearchCount,
        x_search_count AS xSearchCount,
        tool_usage_json AS toolUsageJson,
        error_message AS errorMessage,
        created_at AS createdAt
      FROM ai_call_logs
      ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...params) as CallListItem[];

    const totalParams: unknown[] = status ? [status] : [];
    const total = Number(
      db.prepare(`SELECT COUNT(*) AS count FROM ai_call_logs ${where}`).get(...totalParams).count || 0,
    );
    return { items, total };
  };

  const listUsers = ({
    limit,
    offset,
    type,
    minComparisons,
    sort,
  }: {
    limit?: number;
    offset?: number;
    type?: VisitorType;
    minComparisons?: number;
    sort?: 'recent' | 'comparisons' | 'visits';
  } = {}) => {
    const safeLimit = normalizeLimit(limit);
    const safeOffset = normalizeOffset(offset);
    const typeExpr = visitorTypeSql('v.user_agent');
    const where = type ? `WHERE ${typeExpr} = ?` : '';
    const safeMinComparisons = Math.max(Number(minComparisons) || 0, 0);
    const having = safeMinComparisons > 0 ? 'HAVING COUNT(DISTINCT r.id) >= ?' : '';
    const orderBy = sort === 'comparisons'
      ? 'comparisonCount DESC, v.last_seen_at DESC'
      : sort === 'visits'
        ? 'v.visit_count DESC, v.last_seen_at DESC'
        : 'v.last_seen_at DESC';

    const filterParams: unknown[] = [];
    if (type) filterParams.push(type);
    if (safeMinComparisons > 0) filterParams.push(safeMinComparisons);

    const items = db.prepare(`
      SELECT
        v.visitor_id AS visitorId,
        v.first_seen_at AS firstSeenAt,
        v.last_seen_at AS lastSeenAt,
        v.user_agent AS userAgent,
        v.visit_count AS visitCount,
        COUNT(DISTINCT r.id) AS comparisonCount,
        COUNT(DISTINCT c.id) AS aiCallCount,
        ${typeExpr} AS userType
      FROM visitors v
      LEFT JOIN comparison_runs r ON r.visitor_id = v.visitor_id
      LEFT JOIN ai_call_logs c ON c.visitor_id = v.visitor_id
      ${where}
      GROUP BY v.id
      ${having}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).all(...filterParams, safeLimit, safeOffset) as UserListItem[];

    const total = Number(db.prepare(`
      SELECT COUNT(*) AS count FROM (
        SELECT v.id
        FROM visitors v
        LEFT JOIN comparison_runs r ON r.visitor_id = v.visitor_id
        ${where}
        GROUP BY v.id
        ${having}
      )
    `).get(...filterParams).count || 0);
    return { items, total };
  };

  const getSummary = (periodDays?: number): AdminSummary => {
    const period = normalizeSummaryPeriod(periodDays);
    const now = new Date();
    let periodStart = '';

    if (period === 1) {
      const start = new Date(now);
      start.setUTCMinutes(0, 0, 0);
      start.setUTCHours(start.getUTCHours() - 23);
      periodStart = start.toISOString();
    } else if (period > 1) {
      const start = new Date(now);
      start.setUTCHours(0, 0, 0, 0);
      start.setUTCDate(start.getUTCDate() - period + 1);
      periodStart = start.toISOString();
    }

    const typeExpr = visitorTypeSql('user_agent');
    const todayRow = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM visitors WHERE last_seen_at >= ?) AS users,
        (SELECT COUNT(*) FROM visitors WHERE last_seen_at >= ? AND ${typeExpr} = 'human') AS humanUsers,
        (SELECT COUNT(*) FROM visitors WHERE last_seen_at >= ? AND ${typeExpr} = 'ai') AS aiUsers,
        (SELECT COUNT(*) FROM visitors WHERE last_seen_at >= ? AND ${typeExpr} = 'bot') AS botUsers,
        (SELECT COUNT(*) FROM visitors WHERE last_seen_at >= ? AND ${typeExpr} = 'human' AND (visit_count > 1 OR (? != '' AND first_seen_at < ?))) AS returningUsers,
        (SELECT COUNT(*) FROM comparison_runs WHERE started_at >= ?) AS comparisons,
        (SELECT COUNT(*) FROM ai_call_logs WHERE created_at >= ?) AS aiCalls,
        (SELECT COUNT(*) FROM ai_call_logs WHERE created_at >= ? AND status = 'error') AS failedCalls,
        (SELECT COALESCE(AVG(duration_ms), 0) FROM ai_call_logs WHERE created_at >= ?) AS averageDurationMs,
        (SELECT COALESCE(SUM(prompt_tokens), 0) FROM ai_call_logs WHERE created_at >= ?) AS promptTokens,
        (SELECT COALESCE(SUM(completion_tokens), 0) FROM ai_call_logs WHERE created_at >= ?) AS completionTokens,
        (SELECT COALESCE(SUM(total_tokens), 0) FROM ai_call_logs WHERE created_at >= ?) AS totalTokens,
        (SELECT COALESCE(SUM(cached_tokens), 0) FROM ai_call_logs WHERE created_at >= ?) AS cachedTokens,
        (SELECT COALESCE(SUM(reasoning_tokens), 0) FROM ai_call_logs WHERE created_at >= ?) AS reasoningTokens,
        (SELECT COALESCE(SUM(cost_usd), 0) FROM ai_call_logs WHERE created_at >= ?) AS aiCostUsd,
        (SELECT COALESCE(SUM(web_search_count), 0) FROM ai_call_logs WHERE created_at >= ?) AS webSearchCount,
        (SELECT COALESCE(SUM(x_search_count), 0) FROM ai_call_logs WHERE created_at >= ?) AS xSearchCount
    `).get(
      periodStart,
      periodStart,
      periodStart,
      periodStart,
      periodStart,
      periodStart,
      periodStart,
      periodStart,
      periodStart,
      periodStart,
      periodStart,
      periodStart,
      periodStart,
      periodStart,
      periodStart,
      periodStart,
      periodStart,
      periodStart,
      periodStart,
    );

    const aiCalls = Number(todayRow.aiCalls || 0);
    const failedCalls = Number(todayRow.failedCalls || 0);
    const today: AdminMetricSummary = {
      users: Number(todayRow.users || 0),
      humanUsers: Number(todayRow.humanUsers || 0),
      aiUsers: Number(todayRow.aiUsers || 0),
      botUsers: Number(todayRow.botUsers || 0),
      returningUsers: Number(todayRow.returningUsers || 0),
      comparisons: Number(todayRow.comparisons || 0),
      aiCalls,
      failedCalls,
      successRate: percentage(aiCalls - failedCalls, aiCalls),
      averageDurationMs: Math.round(Number(todayRow.averageDurationMs || 0)),
      promptTokens: Number(todayRow.promptTokens || 0),
      completionTokens: Number(todayRow.completionTokens || 0),
      totalTokens: Number(todayRow.totalTokens || 0),
      cachedTokens: Number(todayRow.cachedTokens || 0),
      reasoningTokens: Number(todayRow.reasoningTokens || 0),
      aiCostUsd: Number(todayRow.aiCostUsd || 0),
      webSearchCount: Number(todayRow.webSearchCount || 0),
      xSearchCount: Number(todayRow.xSearchCount || 0),
    };

    // Build trend window: hourly for 24h, daily for 7d+
    const isHourly = period === 1;
    const trend: TrendPoint[] = [];

    if (isHourly) {
      const hourStart = new Date(periodStart);
      for (let index = 0; index < 24; index += 1) {
        const hour = new Date(hourStart);
        hour.setUTCHours(hourStart.getUTCHours() + index);
        trend.push({
          date: `${hour.toISOString().slice(0, 13)}:00`,
          users: 0,
          comparisons: 0,
          aiCalls: 0,
        });
      }
    } else {
      // Keep an all-time request bounded to a useful seven-day trend window.
      const trendDays = period || 7;
      const trendStart = new Date(now);
      trendStart.setUTCHours(0, 0, 0, 0);
      trendStart.setUTCDate(trendStart.getUTCDate() - trendDays + 1);
      for (let index = 0; index < trendDays; index += 1) {
        const date = new Date(trendStart);
        date.setUTCDate(trendStart.getUTCDate() + index);
        trend.push({
          date: dateKey(date),
          users: 0,
          comparisons: 0,
          aiCalls: 0,
        });
      }
    }

    const trendByDate = new Map(trend.map((item) => [item.date, item]));
    const firstTrendPoint = trend[0];
    const trendStartDate = isHourly
      ? periodStart
      : firstTrendPoint
        ? `${firstTrendPoint.date}T00:00:00.000Z`
        : now.toISOString();
    const groupLen = isHourly ? 13 : 10;

    for (const row of db.prepare(`
      SELECT substr(first_seen_at, 1, ${groupLen}) AS date, COUNT(*) AS count
      FROM visitors
      WHERE first_seen_at >= ?
      GROUP BY substr(first_seen_at, 1, ${groupLen})
    `).all(trendStartDate)) {
      const key = isHourly ? `${row.date}:00` : row.date;
      const point = trendByDate.get(key);
      if (point) point.users = Number(row.count || 0);
    }

    for (const row of db.prepare(`
      SELECT substr(started_at, 1, ${groupLen}) AS date, COUNT(*) AS count
      FROM comparison_runs
      WHERE started_at >= ?
      GROUP BY substr(started_at, 1, ${groupLen})
    `).all(trendStartDate)) {
      const key = isHourly ? `${row.date}:00` : row.date;
      const point = trendByDate.get(key);
      if (point) point.comparisons = Number(row.count || 0);
    }

    for (const row of db.prepare(`
      SELECT substr(created_at, 1, ${groupLen}) AS date, COUNT(*) AS count
      FROM ai_call_logs
      WHERE created_at >= ?
      GROUP BY substr(created_at, 1, ${groupLen})
    `).all(trendStartDate)) {
      const key = isHourly ? `${row.date}:00` : row.date;
      const point = trendByDate.get(key);
      if (point) point.aiCalls = Number(row.count || 0);
    }

    return {
      today,
      trend,
      recentRuns: listRuns({ limit: 8 }).items,
      recentFailedCalls: listCalls({ limit: 8, status: 'error' }).items,
    };
  };

  const getRecentComparisons = (limit = 8): RecentComparison[] => {
    return db.prepare(`
      SELECT item_a AS itemA, item_b AS itemB, MAX(finished_at) AS finishedAt
      FROM comparison_runs
      WHERE status = 'completed' AND item_a != '' AND item_b != ''
      GROUP BY lower(item_a), lower(item_b)
      ORDER BY MAX(finished_at) DESC
      LIMIT ?
    `).all(limit) as RecentComparison[];
  };

  return {
    getDb: () => db,
    ensureVisitor,
    startComparisonRun,
    finishComparisonRun,
    logAiCall,
    getSummary,
    getRecentComparisons,
    listRuns,
    listCalls,
    listUsers,
  };
}
