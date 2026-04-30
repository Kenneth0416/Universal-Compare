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
  slug: string;
  viewCount: number;
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

function slugify(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function buildSlugBase(itemA: string, itemB: string) {
  const left = slugify(itemA);
  const right = slugify(itemB);
  const base = [left, right].filter(Boolean).join('-vs-');
  return base || 'comparison';
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
      slug        TEXT,
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
    ['slug', 'ALTER TABLE featured_comparisons ADD COLUMN slug TEXT'],
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

  const selectCols = 'id, item_a AS itemA, item_b AS itemB, language, description, report_id AS reportId, slug, sort_order AS sortOrder, created_at AS createdAt';

  const slugExists = (slug: string): boolean => {
    const existing = db.prepare('SELECT id FROM featured_comparisons WHERE slug = ? LIMIT 1').get(slug);
    return !!existing;
  };

  const createUniqueSlug = (itemA: string, itemB: string): string => {
    const base = buildSlugBase(itemA, itemB);
    let candidate = base;
    let suffix = 2;

    while (slugExists(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  };

  const ensureExistingSlugs = () => {
    const rows = db.prepare(`
      SELECT id, item_a AS itemA, item_b AS itemB
      FROM featured_comparisons
      WHERE slug IS NULL OR slug = ''
      ORDER BY id ASC
    `).all() as Array<{ id: number; itemA: string; itemB: string }>;

    for (const row of rows) {
      db.prepare('UPDATE featured_comparisons SET slug = ? WHERE id = ?').run(
        createUniqueSlug(row.itemA, row.itemB),
        row.id,
      );
    }
  };

  ensureExistingSlugs();
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_featured_slug ON featured_comparisons(slug)');

  const getReportViewCount = (reportId: string | null): number => {
    if (!reportId) return 0;

    try {
      const row = db.prepare('SELECT view_count AS viewCount FROM comparison_reports WHERE report_id = ?').get(reportId) as any;
      return Number(row?.viewCount || 0);
    } catch {
      return 0;
    }
  };

  const withViewCount = (items: FeaturedComparison[]): FeaturedComparison[] =>
    items.map((item) => ({
      ...item,
      viewCount: getReportViewCount(item.reportId),
    }));

  const listFeatured = (language?: string): FeaturedComparison[] => {
    if (language) {
      const items = db.prepare(`
        SELECT ${selectCols}
        FROM featured_comparisons
        WHERE language = ?
        ORDER BY sort_order ASC, created_at DESC
      `).all(language) as FeaturedComparison[];
      return withViewCount(items);
    }
    const items = db.prepare(`
      SELECT ${selectCols}
      FROM featured_comparisons
      ORDER BY sort_order ASC, created_at DESC
    `).all() as FeaturedComparison[];
    return withViewCount(items);
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
    const slug = createUniqueSlug(itemA, itemB);

    const result = db.prepare(`
      INSERT INTO featured_comparisons (item_a, item_b, language, description, report_id, slug, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(truncate(itemA), truncate(itemB), lang, desc, rId, slug, order, now);

    return {
      id: Number((result as any).lastInsertRowid),
      itemA: truncate(itemA),
      itemB: truncate(itemB),
      language: lang,
      description: desc,
      reportId: rId,
      slug,
      viewCount: getReportViewCount(rId),
      sortOrder: order,
      createdAt: now,
    };
  };

  const getFeaturedBySlug = (slug: string): FeaturedComparison | null => {
    const item = db.prepare(`
      SELECT ${selectCols}
      FROM featured_comparisons
      WHERE slug = ?
    `).get(slug) as FeaturedComparison | undefined;
    return item ? withViewCount([item])[0] : null;
  };

  const getFeaturedByReportId = (reportId: string): FeaturedComparison | null => {
    const item = db.prepare(`
      SELECT ${selectCols}
      FROM featured_comparisons
      WHERE report_id = ?
      ORDER BY sort_order ASC, created_at DESC
      LIMIT 1
    `).get(reportId) as FeaturedComparison | undefined;
    return item ? withViewCount([item])[0] : null;
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
    getFeaturedBySlug,
    getFeaturedByReportId,
    updateReportId,
    removeFeatured,
  };
}
