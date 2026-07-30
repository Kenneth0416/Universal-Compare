import type { DemandSenseResult } from './demandSensing';

type DatabaseConnection = {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    run: (...params: unknown[]) => { changes: number };
    get: (...params: unknown[]) => any;
    all: (...params: unknown[]) => any[];
  };
  transaction: <T>(fn: () => T) => () => T;
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

function nowIso() {
  return new Date().toISOString();
}

export const CANDIDATE_SYNC_BATCH_SIZE = 5000;

function normalizeLimit(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return 200;
  return Math.min(Math.max(Math.floor(value), 1), 500);
}

function normalizeOffset(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.floor(value), 0), 2_147_483_647);
}

function initializeSchema(db: DatabaseConnection) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS candidate_pairs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_a_id     INTEGER NOT NULL,
      entity_b_id     INTEGER NOT NULL,
      item_a_name     TEXT    NOT NULL,
      item_b_name     TEXT    NOT NULL,
      category        TEXT    NOT NULL,
      status          TEXT    NOT NULL DEFAULT 'pending',
      demand_score    REAL,
      recommendation  TEXT,
      signals_json    TEXT,
      reasoning       TEXT,
      top_sources_json TEXT,
      partial         INTEGER NOT NULL DEFAULT 0,
      last_scored_at  TEXT,
      created_at      TEXT    NOT NULL,
      UNIQUE(entity_a_id, entity_b_id),
      CHECK(entity_a_id < entity_b_id)
    );
    CREATE INDEX IF NOT EXISTS idx_candidate_status_cat ON candidate_pairs(status, category);
    CREATE INDEX IF NOT EXISTS idx_candidate_score ON candidate_pairs(demand_score);
  `);
}

const SELECT_COLS = `
  id, entity_a_id AS entityAId, entity_b_id AS entityBId,
  item_a_name AS itemAName, item_b_name AS itemBName,
  category, status,
  demand_score AS demandScore, recommendation,
  signals_json AS signalsJson, reasoning,
  top_sources_json AS topSourcesJson,
  partial, last_scored_at AS lastScoredAt, created_at AS createdAt
`;

function rowToCandidate(row: any): CandidatePair {
  return { ...row, partial: !!row.partial };
}

export function createCandidatePairStore(db: DatabaseConnection) {
  initializeSchema(db);

  const syncFromEntityPool = (category?: string): { created: number; total: number } => {
    const countSql = category
      ? `SELECT COALESCE(SUM(cnt * (cnt - 1) / 2), 0) AS total
         FROM (SELECT COUNT(*) AS cnt FROM entity_pool WHERE category = ? GROUP BY category)`
      : `SELECT COALESCE(SUM(cnt * (cnt - 1) / 2), 0) AS total
         FROM (SELECT COUNT(*) AS cnt FROM entity_pool GROUP BY category)`;
    const total = Number(db.prepare(countSql).get(...(category ? [category] : [])).total || 0);

    const categoryClause = category ? 'AND e1.category = ?' : '';
    const insertSql = `
      INSERT OR IGNORE INTO candidate_pairs (
        entity_a_id, entity_b_id, item_a_name, item_b_name, category, status, created_at
      )
      SELECT e1.id, e2.id, e1.name, e2.name, e1.category, 'pending', ?
      FROM entity_pool e1
      JOIN entity_pool e2 ON e1.category = e2.category AND e1.id < e2.id
      WHERE 1 = 1
        ${categoryClause}
        AND NOT EXISTS (
          SELECT 1 FROM candidate_pairs c
          WHERE c.entity_a_id = e1.id AND c.entity_b_id = e2.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM featured_comparisons f
          WHERE (LOWER(f.item_a) = LOWER(e1.name) AND LOWER(f.item_b) = LOWER(e2.name))
             OR (LOWER(f.item_a) = LOWER(e2.name) AND LOWER(f.item_b) = LOWER(e1.name))
        )
      ORDER BY e1.id, e2.id
      LIMIT ?
    `;

    const created = db.transaction(() => {
      const params: unknown[] = [nowIso()];
      if (category) params.push(category);
      params.push(CANDIDATE_SYNC_BATCH_SIZE);
      return db.prepare(insertSql).run(...params).changes;
    })();

    return { created, total };
  };

  const listCandidates = (opts: {
    category?: string;
    status?: CandidatePairStatus;
    minScore?: number;
    limit?: number;
    offset?: number;
  }): { items: CandidatePair[]; total: number } => {
    const wheres: string[] = [];
    const params: any[] = [];
    if (opts.category) {
      wheres.push('category = ?');
      params.push(opts.category);
    }
    if (opts.status) {
      wheres.push('status = ?');
      params.push(opts.status);
    }
    if (typeof opts.minScore === 'number') {
      wheres.push('demand_score >= ?');
      params.push(opts.minScore);
    }
    const whereClause = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

    const countRow = db.prepare(
      `SELECT COUNT(*) AS cnt FROM candidate_pairs ${whereClause}`,
    ).get(...params) as { cnt: number };

    const limit = normalizeLimit(opts.limit);
    const offset = normalizeOffset(opts.offset);

    const items = db.prepare(
      `SELECT ${SELECT_COLS} FROM candidate_pairs
       ${whereClause}
       ORDER BY demand_score DESC NULLS LAST, id ASC
       LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset) as any[];

    return { items: items.map(rowToCandidate), total: countRow.cnt };
  };

  const getCandidate = (id: number): CandidatePair | null => {
    const row = db.prepare(
      `SELECT ${SELECT_COLS} FROM candidate_pairs WHERE id = ?`,
    ).get(id);
    return row ? rowToCandidate(row) : null;
  };

  const updateScore = (id: number, result: DemandSenseResult): void => {
    db.prepare(
      `UPDATE candidate_pairs SET
         status = CASE WHEN status = 'promoted' THEN 'promoted' ELSE 'scored' END,
         demand_score = ?,
         recommendation = ?,
         signals_json = ?,
         reasoning = ?,
         top_sources_json = ?,
         partial = ?,
         last_scored_at = ?
       WHERE id = ?`,
    ).run(
      result.score,
      result.recommendation,
      JSON.stringify(result.signals),
      result.reasoning,
      JSON.stringify(result.topSources),
      result.partial ? 1 : 0,
      nowIso(),
      id,
    );
  };

  const markPromoted = (id: number): boolean => {
    const result = db.prepare(
      `UPDATE candidate_pairs SET status = 'promoted' WHERE id = ? AND status != 'promoted'`,
    ).run(id);
    return result.changes > 0;
  };

  const promoteCandidate = <T>(
    id: number,
    createFeatured: (candidate: CandidatePair) => T,
    allowedStatuses: CandidatePairStatus[] = ['scored'],
  ):
    | { promoted: true; candidate: CandidatePair; value: T }
    | { promoted: false; reason: 'not_found' | 'invalid_status'; candidate?: CandidatePair } =>
    db.transaction(() => {
      const candidate = getCandidate(id);
      if (!candidate) return { promoted: false as const, reason: 'not_found' as const };
      if (!allowedStatuses.includes(candidate.status)) {
        return { promoted: false as const, reason: 'invalid_status' as const, candidate };
      }

      const value = createFeatured(candidate);
      const changed = db.prepare(
        `UPDATE candidate_pairs SET status = 'promoted' WHERE id = ? AND status = ?`,
      ).run(id, candidate.status).changes;
      if (changed !== 1) throw new Error('candidate status changed during promotion');
      return { promoted: true as const, candidate: { ...candidate, status: 'promoted' as const }, value };
    })();

  const markRejected = (id: number): boolean => {
    const result = db.prepare(
      `UPDATE candidate_pairs SET status = 'rejected' WHERE id = ? AND status != 'rejected'`,
    ).run(id);
    return result.changes > 0;
  };

  return {
    syncFromEntityPool,
    listCandidates,
    getCandidate,
    updateScore,
    markPromoted,
    promoteCandidate,
    markRejected,
  };
}

export type CandidatePairStore = ReturnType<typeof createCandidatePairStore>;
