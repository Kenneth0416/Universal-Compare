import crypto from 'node:crypto';
import {
  normalizeComparisonResult,
  serializeComparisonResult,
  type NormalizedComparisonResult,
} from '../shared/comparisonSchema';

type DatabaseConnection = {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    run: (...params: unknown[]) => { changes: number };
    get: (...params: unknown[]) => any;
    all: (...params: unknown[]) => any[];
  };
};

export interface SaveReportInput {
  runId?: string;
  itemA: string;
  itemB: string;
  language: string;
  result: unknown;
  visitorId?: string;
}

export interface ReportData {
  reportId: string;
  runId: string | null;
  itemA: string;
  itemB: string;
  language: string;
  result: NormalizedComparisonResult;
  visitorId: string;
  createdAt: string;
  viewCount: number;
}

export type PublicReportData = Omit<ReportData, 'runId' | 'visitorId'>;

export interface ReportListItem {
  reportId: string;
  itemA: string;
  itemB: string;
  language: string;
  visitorId: string;
  createdAt: string;
  viewCount: number;
}

function isoNow() {
  return new Date().toISOString();
}

function truncate(value: string | undefined, maxLength = 500) {
  if (!value) return '';
  return value.trim().slice(0, maxLength);
}

function generateReportId(): string {
  const bytes = crypto.randomBytes(8);
  const id = bytes.readBigUInt64BE(0).toString(36).padStart(8, '0').slice(0, 8);
  return `Rpt-${id}`;
}

function normalizeLimit(limit = 50) {
  return Math.min(Math.max(Number(limit) || 50, 1), 100);
}

function normalizeOffset(offset = 0) {
  return Math.max(Number(offset) || 0, 0);
}

function initializeSchema(db: DatabaseConnection) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS comparison_reports (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id     TEXT    NOT NULL UNIQUE,
      run_id        TEXT,
      item_a        TEXT    NOT NULL,
      item_b        TEXT    NOT NULL,
      language      TEXT    NOT NULL DEFAULT 'en',
      result_json   TEXT    NOT NULL,
      visitor_id    TEXT    NOT NULL DEFAULT '',
      created_at    TEXT    NOT NULL,
      view_count    INTEGER NOT NULL DEFAULT 0
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_report_id ON comparison_reports(report_id);
    CREATE INDEX IF NOT EXISTS idx_reports_created ON comparison_reports(created_at);
    CREATE INDEX IF NOT EXISTS idx_reports_visitor ON comparison_reports(visitor_id);

    CREATE TABLE IF NOT EXISTS report_feedback (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id   TEXT    NOT NULL,
      visitor_id  TEXT    NOT NULL,
      helpful     INTEGER NOT NULL CHECK (helpful IN (0, 1)),
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(report_id, visitor_id)
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_report ON report_feedback(report_id);

    CREATE TABLE IF NOT EXISTS report_view_daily (
      report_id  TEXT    NOT NULL,
      day        TEXT    NOT NULL,
      views      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (report_id, day)
    );
  `);

  // Keep the oldest report as the idempotency target. Other reports remain addressable,
  // but no longer claim the duplicated run id.
  db.exec(`
    UPDATE comparison_reports SET run_id = NULL WHERE run_id = '';
    UPDATE comparison_reports
      SET run_id = NULL
      WHERE run_id IS NOT NULL
        AND id NOT IN (
          SELECT MIN(id) FROM comparison_reports WHERE run_id IS NOT NULL GROUP BY run_id
        );
    DROP INDEX IF EXISTS idx_reports_run_id;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_run_id_unique
      ON comparison_reports(run_id) WHERE run_id IS NOT NULL;
    DELETE FROM report_feedback
      WHERE NOT EXISTS (
        SELECT 1 FROM comparison_reports r WHERE r.report_id = report_feedback.report_id
      );
  `);
}

function tableExists(db: DatabaseConnection, name: string) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function inTransaction<T>(db: DatabaseConnection, action: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* preserve the original error */ }
    throw error;
  }
}

/** Public API projection. Internal callers can continue using getReport(). */
export function toPublicReportDto(report: ReportData): PublicReportData {
  const { runId: _runId, visitorId: _visitorId, ...publicReport } = report;
  return publicReport;
}

export function createReportStore(db: DatabaseConnection) {
  initializeSchema(db);

  const findByRunId = (runId: string) => db.prepare(
    'SELECT report_id AS reportId FROM comparison_reports WHERE run_id = ? LIMIT 1',
  ).get(runId) as { reportId: string } | undefined;

  const saveReport = (input: SaveReportInput): { reportId: string; url: string } | null => {
    const itemA = truncate(input.itemA);
    const itemB = truncate(input.itemB);
    const language = truncate(input.language, 20);
    const runId = truncate(input.runId, 200) || null;
    const serialized = serializeComparisonResult(input.result);
    if (!itemA || !itemB || !language || !serialized) return null;

    if (runId) {
      const existing = findByRunId(runId);
      if (existing) return { reportId: existing.reportId, url: `/r/${existing.reportId}` };
    }

    const reportId = generateReportId();
    try {
      db.prepare(`
        INSERT INTO comparison_reports (report_id, run_id, item_a, item_b, language, result_json, visitor_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(reportId, runId, itemA, itemB, language, serialized, truncate(input.visitorId), isoNow());
      return { reportId, url: `/r/${reportId}` };
    } catch (error: any) {
      if (runId && (error?.code === 'SQLITE_CONSTRAINT_UNIQUE' || error?.code === 'SQLITE_CONSTRAINT')) {
        const existing = findByRunId(runId);
        if (existing) return { reportId: existing.reportId, url: `/r/${existing.reportId}` };
      }
      throw error;
    }
  };

  const getReport = (reportId: string): ReportData | null => {
    const row = db.prepare(`
      SELECT report_id, run_id, item_a, item_b, language, result_json, visitor_id, created_at, view_count
      FROM comparison_reports
      WHERE report_id = ?
    `).get(reportId) as any;
    if (!row || typeof row.result_json !== 'string') return null;

    try {
      const result = normalizeComparisonResult(JSON.parse(row.result_json), { allowLegacyDimensionCount: true });
      if (!result) return null;
      return {
        reportId: row.report_id,
        runId: row.run_id,
        itemA: row.item_a,
        itemB: row.item_b,
        language: row.language,
        result,
        visitorId: row.visitor_id,
        createdAt: row.created_at,
        viewCount: row.view_count,
      };
    } catch {
      return null;
    }
  };

  const incrementViewCount = (reportId: string): void => {
    try {
      db.prepare('UPDATE comparison_reports SET view_count = view_count + 1 WHERE report_id = ?').run(reportId);
      db.prepare(`
        INSERT INTO report_view_daily (report_id, day, views)
        VALUES (?, date('now'), 1)
        ON CONFLICT(report_id, day) DO UPDATE SET views = views + 1
      `).run(reportId);
    } catch {
      // View tracking must not make report reads fail.
    }
  };

  const listReports = ({ limit, offset }: { limit?: number; offset?: number } = {}): { items: ReportListItem[]; total: number } => {
    const safeLimit = normalizeLimit(limit);
    const safeOffset = normalizeOffset(offset);
    const totalRow = db.prepare('SELECT COUNT(*) as total FROM comparison_reports').get() as any;
    const rows = db.prepare(`
      SELECT report_id, item_a, item_b, language, visitor_id, created_at, view_count
      FROM comparison_reports
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(safeLimit, safeOffset) as any[];

    return {
      items: rows.map((row) => ({
        reportId: row.report_id,
        itemA: row.item_a,
        itemB: row.item_b,
        language: row.language,
        visitorId: row.visitor_id,
        createdAt: row.created_at,
        viewCount: row.view_count,
      })),
      total: totalRow?.total || 0,
    };
  };

  const listReportsByVisitor = (visitorId: string, limit = 50): ReportListItem[] => {
    if (!visitorId) return [];
    const rows = db.prepare(`
      SELECT report_id, item_a, item_b, language, visitor_id, created_at, view_count
      FROM comparison_reports
      WHERE visitor_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(visitorId, normalizeLimit(limit)) as any[];
    return rows.map((row) => ({
      reportId: row.report_id,
      itemA: row.item_a,
      itemB: row.item_b,
      language: row.language,
      visitorId: row.visitor_id,
      createdAt: row.created_at,
      viewCount: row.view_count,
    }));
  };

  const getReportIdByRunId = (runId: string): string | null => {
    const row = findByRunId(runId);
    return row?.reportId || null;
  };

  const deleteReport = (reportId: string): boolean => inTransaction(db, () => {
    if (tableExists(db, 'featured_comparisons')) {
      db.prepare('DELETE FROM featured_comparisons WHERE report_id = ?').run(reportId);
    }
    db.prepare('DELETE FROM report_feedback WHERE report_id = ?').run(reportId);
    return db.prepare('DELETE FROM comparison_reports WHERE report_id = ?').run(reportId).changes > 0;
  });

  const getFeedbackStats = (reportId: string): { helpful: number; total: number } => {
    const row = db.prepare(`
      SELECT COUNT(*) as total, SUM(helpful) as helpful
      FROM report_feedback WHERE report_id = ?
    `).get(reportId) as any;
    return { helpful: row?.helpful || 0, total: row?.total || 0 };
  };

  const submitFeedback = (reportId: string, visitorId: string, helpful: boolean): { helpful: number; total: number } => {
    const normalizedVisitorId = truncate(visitorId);
    if (!normalizedVisitorId) throw new Error('Feedback requires a visitor id');
    return inTransaction(db, () => {
      const report = db.prepare('SELECT 1 FROM comparison_reports WHERE report_id = ?').get(reportId);
      if (!report) throw new Error('Cannot add feedback to a missing report');
      db.prepare(`
        INSERT INTO report_feedback (report_id, visitor_id, helpful)
        VALUES (?, ?, ?)
        ON CONFLICT(report_id, visitor_id) DO UPDATE SET helpful = excluded.helpful
      `).run(reportId, normalizedVisitorId, helpful ? 1 : 0);
      return getFeedbackStats(reportId);
    });
  };

  const updateReportResult = (reportId: string, result: unknown): boolean => {
    const serialized = serializeComparisonResult(result);
    if (!serialized) return false;
    return db.prepare('UPDATE comparison_reports SET result_json = ? WHERE report_id = ?')
      .run(serialized, reportId).changes > 0;
  };

  return {
    saveReport,
    getReport,
    incrementViewCount,
    listReports,
    listReportsByVisitor,
    getReportIdByRunId,
    deleteReport,
    submitFeedback,
    getFeedbackStats,
    updateReportResult,
  };
}
