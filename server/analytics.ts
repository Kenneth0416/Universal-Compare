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
};

export type AdminMetricSummary = {
  users: number;
  comparisons: number;
  aiCalls: number;
  failedCalls: number;
  successRate: number;
  averageDurationMs: number;
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
};

export type PopularComparison = {
  itemA: string;
  itemB: string;
  count: number;
};

export type AdminSummary = {
  today: AdminMetricSummary;
  trend: TrendPoint[];
  recentRuns: RunListItem[];
  recentFailedCalls: CallListItem[];
  popularComparisons: PopularComparison[];
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

function startOfTodayIso() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildLastSevenDays() {
  const days: TrendPoint[] = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);

  for (let index = 0; index < 7; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    days.push({
      date: dateKey(date),
      users: 0,
      comparisons: 0,
      aiCalls: 0,
    });
  }

  return days;
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
    const existing = db.prepare('SELECT visitor_id FROM visitors WHERE visitor_id = ?').get(resolvedVisitorId);

    db.prepare(`
      INSERT INTO visitors (visitor_id, first_seen_at, last_seen_at, user_agent, ip_hash)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(visitor_id) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        user_agent = excluded.user_agent,
        ip_hash = excluded.ip_hash
    `).run(resolvedVisitorId, now, now, truncate(userAgent), hashIp(ipAddress, secret));

    return {
      visitorId: resolvedVisitorId,
      isNew: !existing,
    };
  };

  const startComparisonRun = (input: StartComparisonRunInput) => {
    const now = isoNow();
    const runId = input.runId || generateId('run');

    db.prepare(`
      INSERT INTO comparison_runs (
        run_id, visitor_id, item_a, item_b, language, status, error_message, started_at, finished_at
      )
      VALUES (?, ?, ?, ?, ?, 'started', NULL, ?, NULL)
      ON CONFLICT(run_id) DO UPDATE SET
        visitor_id = excluded.visitor_id,
        item_a = excluded.item_a,
        item_b = excluded.item_b,
        language = excluded.language,
        status = 'started',
        error_message = NULL,
        started_at = excluded.started_at,
        finished_at = NULL
    `).run(
      runId,
      input.visitorId,
      truncate(input.itemA),
      truncate(input.itemB),
      truncate(input.language, 20) || 'en',
      now,
    );

    return {
      runId,
      visitorId: input.visitorId,
    };
  };

  const finishComparisonRun = (input: FinishComparisonRunInput) => {
    const now = isoNow();
    const result = db.prepare(`
      UPDATE comparison_runs
      SET status = ?, error_message = ?, finished_at = ?
      WHERE run_id = ?
    `).run(input.status, input.errorMessage ? truncate(input.errorMessage, 1000) : null, now, input.runId);

    if (result.changes === 0) {
      db.prepare(`
        INSERT INTO comparison_runs (
          run_id, visitor_id, item_a, item_b, language, status, error_message, started_at, finished_at
        )
        VALUES (?, ?, '', '', 'en', ?, ?, ?, ?)
      `).run(input.runId, input.visitorId || '', input.status, input.errorMessage || null, now, now);
    }
  };

  const logAiCall = (input: LogAiCallInput) => {
    db.prepare(`
      INSERT INTO ai_call_logs (
        run_id, visitor_id, call_type, model, status, status_code, duration_ms, error_message, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.runId || null,
      input.visitorId || null,
      truncate(input.callType, 40),
      truncate(input.model, 120),
      input.status,
      input.statusCode,
      Math.max(Math.round(input.durationMs), 0),
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
        COALESCE(SUM(c.duration_ms), 0) AS totalDurationMs
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

  const listUsers = ({ limit, offset }: { limit?: number; offset?: number } = {}) => {
    const safeLimit = normalizeLimit(limit);
    const safeOffset = normalizeOffset(offset);
    const items = db.prepare(`
      SELECT
        v.visitor_id AS visitorId,
        v.first_seen_at AS firstSeenAt,
        v.last_seen_at AS lastSeenAt,
        v.user_agent AS userAgent,
        COUNT(DISTINCT r.id) AS comparisonCount,
        COUNT(DISTINCT c.id) AS aiCallCount
      FROM visitors v
      LEFT JOIN comparison_runs r ON r.visitor_id = v.visitor_id
      LEFT JOIN ai_call_logs c ON c.visitor_id = v.visitor_id
      GROUP BY v.id
      ORDER BY v.last_seen_at DESC
      LIMIT ? OFFSET ?
    `).all(safeLimit, safeOffset) as UserListItem[];

    const total = Number(db.prepare('SELECT COUNT(*) AS count FROM visitors').get().count || 0);
    return { items, total };
  };

  const getSummary = (): AdminSummary => {
    const todayStart = startOfTodayIso();
    const todayRow = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM visitors WHERE last_seen_at >= ?) AS users,
        (SELECT COUNT(*) FROM comparison_runs WHERE started_at >= ?) AS comparisons,
        (SELECT COUNT(*) FROM ai_call_logs WHERE created_at >= ?) AS aiCalls,
        (SELECT COUNT(*) FROM ai_call_logs WHERE created_at >= ? AND status = 'error') AS failedCalls,
        (SELECT COALESCE(AVG(duration_ms), 0) FROM ai_call_logs WHERE created_at >= ?) AS averageDurationMs
    `).get(todayStart, todayStart, todayStart, todayStart, todayStart);

    const aiCalls = Number(todayRow.aiCalls || 0);
    const failedCalls = Number(todayRow.failedCalls || 0);
    const today: AdminMetricSummary = {
      users: Number(todayRow.users || 0),
      comparisons: Number(todayRow.comparisons || 0),
      aiCalls,
      failedCalls,
      successRate: percentage(aiCalls - failedCalls, aiCalls),
      averageDurationMs: Math.round(Number(todayRow.averageDurationMs || 0)),
    };

    const trend = buildLastSevenDays();
    const trendByDate = new Map(trend.map((item) => [item.date, item]));
    const firstTrendDate = `${trend[0].date}T00:00:00.000Z`;

    for (const row of db.prepare(`
      SELECT substr(first_seen_at, 1, 10) AS date, COUNT(*) AS count
      FROM visitors
      WHERE first_seen_at >= ?
      GROUP BY substr(first_seen_at, 1, 10)
    `).all(firstTrendDate)) {
      const point = trendByDate.get(row.date);
      if (point) point.users = Number(row.count || 0);
    }

    for (const row of db.prepare(`
      SELECT substr(started_at, 1, 10) AS date, COUNT(*) AS count
      FROM comparison_runs
      WHERE started_at >= ?
      GROUP BY substr(started_at, 1, 10)
    `).all(firstTrendDate)) {
      const point = trendByDate.get(row.date);
      if (point) point.comparisons = Number(row.count || 0);
    }

    for (const row of db.prepare(`
      SELECT substr(created_at, 1, 10) AS date, COUNT(*) AS count
      FROM ai_call_logs
      WHERE created_at >= ?
      GROUP BY substr(created_at, 1, 10)
    `).all(firstTrendDate)) {
      const point = trendByDate.get(row.date);
      if (point) point.aiCalls = Number(row.count || 0);
    }

    const popularComparisons = db.prepare(`
      SELECT item_a AS itemA, item_b AS itemB, COUNT(*) AS count
      FROM comparison_runs
      WHERE item_a != '' AND item_b != ''
      GROUP BY lower(item_a), lower(item_b)
      ORDER BY count DESC, MAX(started_at) DESC
      LIMIT 10
    `).all() as PopularComparison[];

    return {
      today,
      trend,
      recentRuns: listRuns({ limit: 8 }).items,
      recentFailedCalls: listCalls({ limit: 8, status: 'error' }).items,
      popularComparisons,
    };
  };

  return {
    getDb: () => db,
    ensureVisitor,
    startComparisonRun,
    finishComparisonRun,
    logAiCall,
    getSummary,
    listRuns,
    listCalls,
    listUsers,
  };
}
