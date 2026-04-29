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
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_featured_sort ON featured_comparisons(sort_order);
  `);
}

export function createFeaturedStore(db: DatabaseConnection) {
  initializeSchema(db);

  const listFeatured = (): FeaturedComparison[] => {
    return db.prepare(`
      SELECT id, item_a AS itemA, item_b AS itemB, sort_order AS sortOrder, created_at AS createdAt
      FROM featured_comparisons
      ORDER BY sort_order ASC, created_at DESC
    `).all() as FeaturedComparison[];
  };

  const addFeatured = (itemA: string, itemB: string, sortOrder = 0): FeaturedComparison => {
    const now = isoNow();
    const result = db.prepare(`
      INSERT INTO featured_comparisons (item_a, item_b, sort_order, created_at)
      VALUES (?, ?, ?, ?)
    `).run(truncate(itemA), truncate(itemB), sortOrder, now);

    return {
      id: Number((result as any).lastInsertRowid),
      itemA: truncate(itemA),
      itemB: truncate(itemB),
      sortOrder,
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
