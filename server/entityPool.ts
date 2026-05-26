type DatabaseConnection = {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    run: (...params: unknown[]) => { changes: number };
    get: (...params: unknown[]) => any;
    all: (...params: unknown[]) => any[];
  };
};

export type Entity = {
  id: number;
  name: string;
  category: string;
  createdAt: string;
};

function nowIso() {
  return new Date().toISOString();
}

function initializeSchema(db: DatabaseConnection) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_pool (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      category   TEXT    NOT NULL,
      created_at TEXT    NOT NULL,
      UNIQUE(name, category)
    );
    CREATE INDEX IF NOT EXISTS idx_entity_category ON entity_pool(category);
  `);
}

export function parseEntityCsv(csv: string): {
  items: Array<{ name: string; category: string }>;
  rejectedRows: number;
} {
  const lines = csv.split(/\r?\n/);
  const items: Array<{ name: string; category: string }> = [];
  let rejectedRows = 0;
  let firstSeen = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(',').map((p) => p.trim());

    if (!firstSeen) {
      firstSeen = true;
      if (/^(name|item)$/i.test(parts[0] || '') || /category/i.test(parts[1] || '')) {
        continue;
      }
    }

    const [name, category] = parts;
    if (!name || !category) {
      rejectedRows++;
      continue;
    }
    if (name.length > 200 || category.length > 100) {
      rejectedRows++;
      continue;
    }
    items.push({ name, category });
  }
  return { items, rejectedRows };
}

export function createEntityPoolStore(db: DatabaseConnection) {
  initializeSchema(db);

  const cols = 'id, name, category, created_at AS createdAt';

  const listEntities = (category?: string): Entity[] => {
    if (category) {
      return db.prepare(
        `SELECT ${cols} FROM entity_pool WHERE category = ? ORDER BY id ASC`,
      ).all(category) as Entity[];
    }
    return db.prepare(
      `SELECT ${cols} FROM entity_pool ORDER BY category ASC, id ASC`,
    ).all() as Entity[];
  };

  const addEntity = (name: string, category: string): Entity => {
    if (!name || !name.trim() || !category || !category.trim()) {
      throw new Error('name and category must be non-empty');
    }
    const cleanName = name.trim().slice(0, 200);
    const cleanCat = category.trim().slice(0, 100);
    const createdAt = nowIso();
    try {
      const result = db.prepare(
        'INSERT INTO entity_pool (name, category, created_at) VALUES (?, ?, ?)',
      ).run(cleanName, cleanCat, createdAt);
      return {
        id: Number((result as any).lastInsertRowid),
        name: cleanName,
        category: cleanCat,
        createdAt,
      };
    } catch (err: any) {
      if (/UNIQUE/i.test(err.message)) {
        throw new Error(`duplicate entity: ${cleanName} / ${cleanCat}`);
      }
      throw err;
    }
  };

  const addEntitiesBulk = (
    items: Array<{ name: string; category: string }>,
  ): {
    added: Entity[];
    skipped: Array<{ name: string; category: string; reason: 'duplicate' | 'invalid' }>;
  } => {
    const added: Entity[] = [];
    const skipped: Array<{ name: string; category: string; reason: 'duplicate' | 'invalid' }> = [];
    for (const item of items) {
      if (!item.name || !item.name.trim() || !item.category || !item.category.trim()) {
        skipped.push({ name: item.name, category: item.category, reason: 'invalid' });
        continue;
      }
      try {
        added.push(addEntity(item.name, item.category));
      } catch (err: any) {
        if (/duplicate/i.test(err.message)) {
          skipped.push({ name: item.name, category: item.category, reason: 'duplicate' });
        } else {
          skipped.push({ name: item.name, category: item.category, reason: 'invalid' });
        }
      }
    }
    return { added, skipped };
  };

  const removeEntity = (id: number): boolean => {
    const result = db.prepare('DELETE FROM entity_pool WHERE id = ?').run(id);
    return result.changes > 0;
  };

  const listCategories = (): string[] => {
    const rows = db.prepare(
      'SELECT DISTINCT category FROM entity_pool ORDER BY category ASC',
    ).all() as Array<{ category: string }>;
    return rows.map((r) => r.category);
  };

  return {
    listEntities,
    addEntity,
    addEntitiesBulk,
    removeEntity,
    listCategories,
  };
}

export type EntityPoolStore = ReturnType<typeof createEntityPoolStore>;
