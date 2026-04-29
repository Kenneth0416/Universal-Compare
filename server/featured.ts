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
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_featured_sort ON featured_comparisons(sort_order);
    CREATE INDEX IF NOT EXISTS idx_featured_lang ON featured_comparisons(language);
  `);

  // Migrate: add language and description columns if missing
  try {
    db.prepare("SELECT language FROM featured_comparisons LIMIT 1").get();
  } catch {
    db.exec("ALTER TABLE featured_comparisons ADD COLUMN language TEXT NOT NULL DEFAULT 'en'");
  }
  try {
    db.prepare("SELECT description FROM featured_comparisons LIMIT 1").get();
  } catch {
    db.exec("ALTER TABLE featured_comparisons ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  }
}

export function createFeaturedStore(db: DatabaseConnection) {
  initializeSchema(db);

  const listFeatured = (language?: string): FeaturedComparison[] => {
    if (language) {
      return db.prepare(`
        SELECT id, item_a AS itemA, item_b AS itemB, language, description, sort_order AS sortOrder, created_at AS createdAt
        FROM featured_comparisons
        WHERE language = ?
        ORDER BY sort_order ASC, created_at DESC
      `).all(language) as FeaturedComparison[];
    }
    return db.prepare(`
      SELECT id, item_a AS itemA, item_b AS itemB, language, description, sort_order AS sortOrder, created_at AS createdAt
      FROM featured_comparisons
      ORDER BY sort_order ASC, created_at DESC
    `).all() as FeaturedComparison[];
  };

  const addFeatured = (
    itemA: string,
    itemB: string,
    options: { language?: string; description?: string; sortOrder?: number } = {},
  ): FeaturedComparison => {
    const now = isoNow();
    const lang = options.language || 'en';
    const desc = truncate(options.description, 200);
    const order = options.sortOrder ?? 0;

    const result = db.prepare(`
      INSERT INTO featured_comparisons (item_a, item_b, language, description, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(truncate(itemA), truncate(itemB), lang, desc, order, now);

    return {
      id: Number((result as any).lastInsertRowid),
      itemA: truncate(itemA),
      itemB: truncate(itemB),
      language: lang,
      description: desc,
      sortOrder: order,
      createdAt: now,
    };
  };

  const removeFeatured = (id: number): boolean => {
    const result = db.prepare('DELETE FROM featured_comparisons WHERE id = ?').run(id);
    return result.changes > 0;
  };

  return {
    listFeatured,
    addFeatured,
    removeFeatured,
  };
}
