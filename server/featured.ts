type DatabaseConnection = {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    run: (...params: unknown[]) => { changes: number };
    get: (...params: unknown[]) => any;
    all: (...params: unknown[]) => any[];
  };
};

export type FeaturedComparison = {
  id: number;
  itemA: string;
  itemB: string;
  language: string;
  description: string;
  reportId: string | null;
  sortOrder: number;
  createdAt: string;
};

function isoNow() {
  return new Date().toISOString();
}

function truncate(value: string | undefined, maxLength = 500) {
  if (!value) return '';
  return value.trim().slice(0, maxLength);
}

function initializeSchema(db: DatabaseConnection) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS featured_comparisons (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      item_a      TEXT    NOT NULL,
      item_b      TEXT    NOT NULL,
      language    TEXT    NOT NULL DEFAULT 'en',
      description TEXT    NOT NULL DEFAULT '',
      report_id   TEXT,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_featured_sort ON featured_comparisons(sort_order);
  `);

  // Migrate: add columns if missing (for existing tables)
  const migrations: [string, string][] = [
    ['language', "ALTER TABLE featured_comparisons ADD COLUMN language TEXT NOT NULL DEFAULT 'en'"],
    ['description', "ALTER TABLE featured_comparisons ADD COLUMN description TEXT NOT NULL DEFAULT ''"],
    ['report_id', 'ALTER TABLE featured_comparisons ADD COLUMN report_id TEXT'],
  ];
  for (const [col, sql] of migrations) {
    try {
      db.prepare(`SELECT ${col} FROM featured_comparisons LIMIT 1`).get();
    } catch {
      db.exec(sql);
    }
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_featured_lang ON featured_comparisons(language)');
}

export function createFeaturedStore(db: DatabaseConnection) {
  initializeSchema(db);

  const selectCols = 'id, item_a AS itemA, item_b AS itemB, language, description, report_id AS reportId, sort_order AS sortOrder, created_at AS createdAt';

  const listFeatured = (language?: string): FeaturedComparison[] => {
    if (language) {
      return db.prepare(`
        SELECT ${selectCols}
        FROM featured_comparisons
        WHERE language = ?
        ORDER BY sort_order ASC, created_at DESC
      `).all(language) as FeaturedComparison[];
    }
    return db.prepare(`
      SELECT ${selectCols}
      FROM featured_comparisons
      ORDER BY sort_order ASC, created_at DESC
    `).all() as FeaturedComparison[];
  };

  const addFeatured = (
    itemA: string,
    itemB: string,
    options: { language?: string; description?: string; sortOrder?: number; reportId?: string } = {},
  ): FeaturedComparison => {
    const now = isoNow();
    const lang = options.language || 'en';
    const desc = truncate(options.description, 200);
    const order = options.sortOrder ?? 0;
    const rId = options.reportId || null;

    const result = db.prepare(`
      INSERT INTO featured_comparisons (item_a, item_b, language, description, report_id, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(truncate(itemA), truncate(itemB), lang, desc, rId, order, now);

    return {
      id: Number((result as any).lastInsertRowid),
      itemA: truncate(itemA),
      itemB: truncate(itemB),
      language: lang,
      description: desc,
      reportId: rId,
      sortOrder: order,
      createdAt: now,
    };
  };

  const updateReportId = (id: number, reportId: string): boolean => {
    const result = db.prepare('UPDATE featured_comparisons SET report_id = ? WHERE id = ?').run(reportId, id);
    return result.changes > 0;
  };

  const removeFeatured = (id: number): boolean => {
    const result = db.prepare('DELETE FROM featured_comparisons WHERE id = ?').run(id);
    return result.changes > 0;
  };

  return {
    listFeatured,
    addFeatured,
    updateReportId,
    removeFeatured,
  };
}
