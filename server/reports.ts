import crypto from 'node:crypto';

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
  result: unknown;
  visitorId: string;
  createdAt: string;
  viewCount: number;
}

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

function validateResult(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const r = result as Record<string, unknown>;
  return !!(r.entityA && r.entityB && r.dimensions && r.recommendation);
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
    CREATE INDEX IF NOT EXISTS idx_reports_run_id ON comparison_reports(run_id);
    CREATE INDEX IF NOT EXISTS idx_reports_created ON comparison_reports(created_at);
    CREATE INDEX IF NOT EXISTS idx_reports_visitor ON comparison_reports(visitor_id);
  `);
}

export function createReportStore(db: DatabaseConnection) {
  initializeSchema(db);

  const saveReport = (input: SaveReportInput): { reportId: string; url: string } | null => {
    if (!validateResult(input.result)) {
      return null;
    }

    const reportId = generateReportId();
    const now = isoNow();

    try {
      db.prepare(`
        INSERT INTO comparison_reports (report_id, run_id, item_a, item_b, language, result_json, visitor_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        reportId,
        input.runId || null,
        truncate(input.itemA),
        truncate(input.itemB),
        truncate(input.language, 20),
        JSON.stringify(input.result),
        input.visitorId || '',
        now,
      );

      return { reportId, url: `/r/${reportId}` };
    } catch (err: any) {
      // UNIQUE constraint violation (run_id duplicate) — ignore
      if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        // Try to find existing report for this runId
        if (input.runId) {
          const existing = db.prepare('SELECT report_id FROM comparison_reports WHERE run_id = ?').get(input.runId) as any;
          if (existing) {
            return { reportId: existing.report_id, url: `/r/${existing.report_id}` };
          }
        }
      }
      throw err;
    }
  };

  const getReport = (reportId: string): ReportData | null => {
    const row = db.prepare(`
      SELECT report_id, run_id, item_a, item_b, language, result_json, visitor_id, created_at, view_count
      FROM comparison_reports
      WHERE report_id = ?
    `).get(reportId) as any;

    if (!row) return null;

    return {
      reportId: row.report_id,
      runId: row.run_id,
      itemA: row.item_a,
      itemB: row.item_b,
      language: row.language,
      result: JSON.parse(row.result_json),
      visitorId: row.visitor_id,
      createdAt: row.created_at,
      viewCount: row.view_count,
    };
  };

  const incrementViewCount = (reportId: string): void => {
    try {
      db.prepare('UPDATE comparison_reports SET view_count = view_count + 1 WHERE report_id = ?').run(reportId);
    } catch {
      // ignore
    }
  };

  const listReports = ({ limit, offset }: { limit?: number; offset?: number } = {}): { items: ReportListItem[]; total: number } => {
    const safeLimit = normalizeLimit(limit);
    const safeOffset = normalizeOffset(offset);

    const totalRow = db.prepare('SELECT COUNT(*) as total FROM comparison_reports').get() as any;
    const total = totalRow?.total || 0;

    const rows = db.prepare(`
      SELECT report_id, item_a, item_b, language, visitor_id, created_at, view_count
      FROM comparison_reports
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(safeLimit, safeOffset) as any[];

    const items: ReportListItem[] = rows.map((row: any) => ({
      reportId: row.report_id,
      itemA: row.item_a,
      itemB: row.item_b,
      language: row.language,
      visitorId: row.visitor_id,
      createdAt: row.created_at,
      viewCount: row.view_count,
    }));

    return { items, total };
  };

  const deleteReport = (reportId: string): boolean => {
    const result = db.prepare('DELETE FROM comparison_reports WHERE report_id = ?').run(reportId);
    return result.changes > 0;
  };

  return {
    saveReport,
    getReport,
    incrementViewCount,
    listReports,
    deleteReport,
  };
}
