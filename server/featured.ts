type DatabaseConnection = {
  exec: (sql: string) => void;
  readonly inTransaction?: boolean;
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
  hasSources: boolean;
  hasCitations: boolean;
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

function tableExists(db: DatabaseConnection, name: string) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function inTransaction<T>(db: DatabaseConnection, action: () => T): T {
  // Candidate promotion already wraps featured creation and state transition in
  // one better-sqlite3 transaction. Reuse that transaction instead of issuing a
  // nested BEGIN, which SQLite rejects.
  if (db.inTransaction) return action();

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

  // Older databases did not enforce this relationship. Null broken links rather than
  // deleting the curated entry while migrating them to read-safe state.
  if (tableExists(db, 'comparison_reports')) {
    db.exec(`
      UPDATE featured_comparisons SET report_id = NULL
      WHERE report_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM comparison_reports r
          WHERE r.report_id = featured_comparisons.report_id
        )
    `);
  }
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

  type ReportMeta = { viewCount: number; hasSources: boolean; hasCitations: boolean };

  const getReportMeta = (reportId: string | null): ReportMeta => {
    if (!reportId) return { viewCount: 0, hasSources: false, hasCitations: false };

    try {
      const row = db.prepare('SELECT view_count AS viewCount, result_json AS resultJson FROM comparison_reports WHERE report_id = ?').get(reportId) as any;
      if (!row) return { viewCount: 0, hasSources: false, hasCitations: false };

      let hasSources = false;
      let hasCitations = false;
      try {
        const result = JSON.parse(row.resultJson) as any;
        hasSources = Array.isArray(result?.sources) && result.sources.length > 0;
        const dims = Array.isArray(result?.dimensions) ? result.dimensions : [];
        hasCitations = dims.some((d: any) => Array.isArray(d?.analysis?.citations) && d.analysis.citations.length > 0);
      } catch {
        // malformed result_json — treat as missing
      }

      return { viewCount: Number(row.viewCount || 0), hasSources, hasCitations };
    } catch {
      return { viewCount: 0, hasSources: false, hasCitations: false };
    }
  };

  const withReportMeta = (items: FeaturedComparison[]): FeaturedComparison[] =>
    items.map((item) => {
      const meta = getReportMeta(item.reportId);
      return { ...item, ...meta };
    });

  const listFeatured = (language?: string): FeaturedComparison[] => {
    if (language) {
      const items = db.prepare(`
        SELECT ${selectCols}
        FROM featured_comparisons
        WHERE language = ?
        ORDER BY sort_order ASC, created_at DESC
      `).all(language) as FeaturedComparison[];
      return withReportMeta(items);
    }
    const items = db.prepare(`
      SELECT ${selectCols}
      FROM featured_comparisons
      ORDER BY sort_order ASC, created_at DESC
    `).all() as FeaturedComparison[];
    return withReportMeta(items);
  };

  const reportExists = (reportId: string): boolean => {
    if (!tableExists(db, 'comparison_reports')) return false;
    return !!db.prepare('SELECT 1 FROM comparison_reports WHERE report_id = ?').get(reportId);
  };

  // Hotness = recent views with a 7-day half-life, plus a discounted lifetime
  // component (30-day half-life on report age) so the ranking works before the
  // daily buckets accumulate, plus a freshness boost so newly published
  // reports get initial exposure. Recent traffic dominates once data exists.
  const HOT_RECENT_WINDOW_DAYS = 30;
  const halfLifeDecay = (ageDays: number, halfLifeDays: number) =>
    Math.pow(0.5, Math.max(ageDays, 0) / halfLifeDays);

  const listHotFeatured = (language?: string, limit = 12): FeaturedComparison[] => {
    const boundedLimit = Math.min(Math.max(Math.floor(limit) || 12, 1), 100);
    if (!tableExists(db, 'comparison_reports')) return [];
    const rows = db.prepare(`
      SELECT f.id AS id, f.report_id AS reportId, r.view_count AS viewCount, r.created_at AS reportCreatedAt
      FROM featured_comparisons f
      JOIN comparison_reports r ON r.report_id = f.report_id
      WHERE f.slug IS NOT NULL ${language ? 'AND f.language = ?' : ''}
    `).all(...(language ? [language] : [])) as Array<{ id: number; reportId: string; viewCount: number; reportCreatedAt: string }>;
    if (rows.length === 0) return [];

    const recentByReport = new Map<string, number>();
    if (tableExists(db, 'report_view_daily')) {
      const viewRows = db.prepare(`
        SELECT report_id AS reportId, day, views FROM report_view_daily
        WHERE day >= date('now', ?)
      `).all(`-${HOT_RECENT_WINDOW_DAYS} day`) as Array<{ reportId: string; day: string; views: number }>;
      const now = Date.now();
      for (const view of viewRows) {
        const ageDays = (now - Date.parse(`${view.day}T00:00:00Z`)) / 86_400_000;
        const decayed = view.views * halfLifeDecay(ageDays, 7);
        recentByReport.set(view.reportId, (recentByReport.get(view.reportId) || 0) + decayed);
      }
    }

    const now = Date.now();
    const scored = rows.map((row) => {
      const reportAgeDays = (now - Date.parse(row.reportCreatedAt)) / 86_400_000;
      const recentScore = recentByReport.get(row.reportId) || 0;
      const lifetimeScore = 0.2 * (row.viewCount || 0) * halfLifeDecay(reportAgeDays, 30);
      const freshnessBoost = 3 * halfLifeDecay(reportAgeDays, 14);
      return { id: row.id, score: recentScore + lifetimeScore + freshnessBoost };
    });
    scored.sort((left, right) => right.score - left.score);

    const topIds = scored.slice(0, boundedLimit).map((item) => item.id);
    const placeholders = topIds.map(() => '?').join(',');
    const items = db.prepare(`
      SELECT ${selectCols}
      FROM featured_comparisons
      WHERE id IN (${placeholders})
    `).all(...topIds) as FeaturedComparison[];
    const order = new Map(topIds.map((id, index) => [id, index]));
    items.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
    return withReportMeta(items);
  };

  const addFeatured = (
    itemA: string,
    itemB: string,
    options: { language?: string; description?: string; sortOrder?: number; reportId?: string } = {},
  ): FeaturedComparison => inTransaction(db, () => {
    const now = isoNow();
    const lang = options.language || 'en';
    const desc = truncate(options.description, 200);
    const order = options.sortOrder ?? 0;
    const rId = options.reportId || null;
    if (rId && !reportExists(rId)) throw new Error('Cannot feature a missing report');
    const slug = createUniqueSlug(itemA, itemB);

    const result = db.prepare(`
      INSERT INTO featured_comparisons (item_a, item_b, language, description, report_id, slug, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(truncate(itemA), truncate(itemB), lang, desc, rId, slug, order, now);

    const meta = getReportMeta(rId);
    return {
      id: Number((result as any).lastInsertRowid),
      itemA: truncate(itemA),
      itemB: truncate(itemB),
      language: lang,
      description: desc,
      reportId: rId,
      slug,
      viewCount: meta.viewCount,
      sortOrder: order,
      createdAt: now,
      hasSources: meta.hasSources,
      hasCitations: meta.hasCitations,
    };
  });

  const getFeaturedBySlug = (slug: string): FeaturedComparison | null => {
    const item = db.prepare(`
      SELECT ${selectCols}
      FROM featured_comparisons
      WHERE slug = ?
    `).get(slug) as FeaturedComparison | undefined;
    return item ? withReportMeta([item])[0] : null;
  };

  const getFeaturedByReportId = (reportId: string): FeaturedComparison | null => {
    const item = db.prepare(`
      SELECT ${selectCols}
      FROM featured_comparisons
      WHERE report_id = ?
      ORDER BY sort_order ASC, created_at DESC
      LIMIT 1
    `).get(reportId) as FeaturedComparison | undefined;
    return item ? withReportMeta([item])[0] : null;
  };

  const updateReportId = (id: number, reportId: string): boolean => inTransaction(db, () => {
    if (!reportId || !reportExists(reportId)) return false;
    return db.prepare('UPDATE featured_comparisons SET report_id = ? WHERE id = ?').run(reportId, id).changes > 0;
  });

  const removeFeatured = (id: number): boolean => {
    const result = db.prepare('DELETE FROM featured_comparisons WHERE id = ?').run(id);
    return result.changes > 0;
  };

  return {
    listFeatured,
    listHotFeatured,
    addFeatured,
    getFeaturedBySlug,
    getFeaturedByReportId,
    updateReportId,
    removeFeatured,
  };
}
