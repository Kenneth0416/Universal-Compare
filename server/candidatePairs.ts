import type { DemandSenseResult } from './demandSensing';

type DatabaseConnection = {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    run: (...params: unknown[]) => { changes: number; lastInsertRowid: number | bigint };
    get: (...params: unknown[]) => any;
    all: (...params: unknown[]) => any[];
  };
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
    const entityRows = (category
      ? db.prepare('SELECT id, name, category FROM entity_pool WHERE category = ? ORDER BY id ASC').all(category)
      : db.prepare('SELECT id, name, category FROM entity_pool ORDER BY id ASC').all()) as Array<{ id: number; name: string; category: string }>;

    let created = 0;
    let total = 0;

    for (let i = 0; i < entityRows.length; i++) {
      for (let j = i + 1; j < entityRows.length; j++) {
        const ei = entityRows[i];
        const ej = entityRows[j];
        if (ei.category !== ej.category) continue;
        total++;

        const aIsFirst = ei.id < ej.id;
        const aId = aIsFirst ? ei.id : ej.id;
        const bId = aIsFirst ? ej.id : ei.id;
        const aName = aIsFirst ? ei.name : ej.name;
        const bName = aIsFirst ? ej.name : ei.name;

        const existing = db.prepare(
          'SELECT 1 FROM candidate_pairs WHERE entity_a_id = ? AND entity_b_id = ?',
        ).get(aId, bId);
        if (existing) continue;

        const inFeatured = db.prepare(
          `SELECT 1 FROM featured_comparisons
           WHERE (LOWER(item_a) = LOWER(?) AND LOWER(item_b) = LOWER(?))
              OR (LOWER(item_a) = LOWER(?) AND LOWER(item_b) = LOWER(?))`,
        ).get(aName, bName, bName, aName);
        if (inFeatured) continue;

        db.prepare(
          `INSERT INTO candidate_pairs
           (entity_a_id, entity_b_id, item_a_name, item_b_name, category, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
        ).run(aId, bId, aName, bName, ei.category, nowIso());
        created++;
      }
    }

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

    const limit = opts.limit ?? 200;
    const offset = opts.offset ?? 0;

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
         status = 'scored',
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
    markRejected,
  };
}

export type CandidatePairStore = ReturnType<typeof createCandidatePairStore>;
