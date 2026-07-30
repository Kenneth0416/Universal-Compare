type DatabaseConnection = {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    run: (...params: unknown[]) => { changes: number };
    get: (...params: unknown[]) => any;
    all: (...params: unknown[]) => any[];
  };
  transaction: <T>(fn: () => T) => () => T;
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

function identityKey(value: string) {
  return value.normalize('NFKC').toLowerCase();
}

function initializeSchema(db: DatabaseConnection) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_pool (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      category     TEXT    NOT NULL,
      name_key     TEXT,
      category_key TEXT,
      created_at   TEXT    NOT NULL,
      UNIQUE(name, category)
    );
    CREATE INDEX IF NOT EXISTS idx_entity_category ON entity_pool(category);
  `);

  for (const [column, sql] of [
    ['name_key', 'ALTER TABLE entity_pool ADD COLUMN name_key TEXT'],
    ['category_key', 'ALTER TABLE entity_pool ADD COLUMN category_key TEXT'],
  ] as const) {
    try { db.prepare(`SELECT ${column} FROM entity_pool LIMIT 1`).get(); }
    catch { db.exec(sql); }
  }

  db.transaction(() => {
    const entities = db.prepare(
      'SELECT id, name, category FROM entity_pool ORDER BY id ASC',
    ).all() as Array<{ id: number; name: string; category: string }>;
    const canonicalByKey = new Map<string, typeof entities[number]>();
    const canonicalId = new Map<number, number>();

    for (const entity of entities) {
      const key = `${identityKey(entity.name)}\u0000${identityKey(entity.category)}`;
      const canonical = canonicalByKey.get(key) || entity;
      canonicalByKey.set(key, canonical);
      canonicalId.set(entity.id, canonical.id);
    }

    const hasDuplicates = [...canonicalId].some(([id, canonical]) => id !== canonical);
    const hasCandidateTable = !!db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'candidate_pairs'`,
    ).get();

    if (hasDuplicates && hasCandidateTable) {
      const candidates = db.prepare(`
        SELECT id, entity_a_id AS entityAId, entity_b_id AS entityBId, status
        FROM candidate_pairs ORDER BY id ASC
      `).all() as Array<{ id: number; entityAId: number; entityBId: number; status: string }>;
      const priority: Record<string, number> = { promoted: 4, scored: 3, rejected: 2, pending: 1 };
      const winnerByPair = new Map<string, typeof candidates[number]>();
      const mappedById = new Map<number, { entityAId: number; entityBId: number }>();

      for (const candidate of candidates) {
        const left = canonicalId.get(candidate.entityAId) ?? candidate.entityAId;
        const right = canonicalId.get(candidate.entityBId) ?? candidate.entityBId;
        if (left === right) continue;
        const entityAId = Math.min(left, right);
        const entityBId = Math.max(left, right);
        const key = `${entityAId}:${entityBId}`;
        mappedById.set(candidate.id, { entityAId, entityBId });
        const current = winnerByPair.get(key);
        if (!current || (priority[candidate.status] || 0) > (priority[current.status] || 0)) {
          winnerByPair.set(key, candidate);
        }
      }

      const winnerIds = new Set([...winnerByPair.values()].map((candidate) => candidate.id));
      for (const candidate of candidates) {
        if (!winnerIds.has(candidate.id)) {
          db.prepare('DELETE FROM candidate_pairs WHERE id = ?').run(candidate.id);
        }
      }
      for (const candidate of winnerByPair.values()) {
        const mapped = mappedById.get(candidate.id)!;
        const entityA = entities.find((entity) => entity.id === mapped.entityAId);
        const entityB = entities.find((entity) => entity.id === mapped.entityBId);
        db.prepare(`
          UPDATE candidate_pairs
          SET entity_a_id = ?, entity_b_id = ?, item_a_name = ?, item_b_name = ?
          WHERE id = ?
        `).run(mapped.entityAId, mapped.entityBId, entityA?.name || '', entityB?.name || '', candidate.id);
      }
    }

    if (hasDuplicates) {
      for (const [id, canonical] of canonicalId) {
        if (id !== canonical) db.prepare('DELETE FROM entity_pool WHERE id = ?').run(id);
      }
    }

    const survivors = db.prepare('SELECT id, name, category FROM entity_pool').all() as Array<{ id: number; name: string; category: string }>;
    const updateKeys = db.prepare('UPDATE entity_pool SET name_key = ?, category_key = ? WHERE id = ?');
    for (const entity of survivors) {
      updateKeys.run(identityKey(entity.name), identityKey(entity.category), entity.id);
    }

    // SQLite NOCASE/LOWER are ASCII-only. Persist Unicode-normalized keys that
    // are computed by JavaScript, then let SQLite enforce them atomically.
    db.exec(`
      DROP INDEX IF EXISTS idx_entity_name_category_nocase;
      CREATE UNIQUE INDEX idx_entity_name_category_nocase
      ON entity_pool(name_key, category_key)
    `);
  })();
}

function readCsvRows(csv: string): Array<{ fields: string[]; malformed: boolean }> {
  const rows: Array<{ fields: string[]; malformed: boolean }> = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let closedQuote = false;
  let malformed = false;

  const finishRow = () => {
    fields.push(field.trim());
    if (fields.length > 1 || fields.some((value) => value !== '') || malformed) {
      rows.push({ fields, malformed });
    }
    fields = [];
    field = '';
    closedQuote = false;
    malformed = false;
  };

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (inQuotes) {
      if (char === '"') {
        if (csv[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          closedQuote = true;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (field.trim() === '' && !closedQuote) {
        field = '';
        inQuotes = true;
      } else {
        malformed = true;
        field += char;
      }
    } else if (char === ',') {
      fields.push(field.trim());
      field = '';
      closedQuote = false;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && csv[index + 1] === '\n') index += 1;
      finishRow();
    } else if (closedQuote && !/\s/.test(char)) {
      malformed = true;
      field += char;
    } else {
      field += char;
    }
  }

  if (inQuotes) malformed = true;
  if (field !== '' || fields.length > 0 || malformed) finishRow();
  return rows;
}

export function parseEntityCsv(csv: string): {
  items: Array<{ name: string; category: string }>;
  rejectedRows: number;
} {
  const rows = readCsvRows(csv);
  const items: Array<{ name: string; category: string }> = [];
  let rejectedRows = 0;
  let firstSeen = false;

  for (const row of rows) {
    const [rawName, rawCategory] = row.fields;
    if (!firstSeen) {
      firstSeen = true;
      const headerName = rawName?.replace(/^\uFEFF/, '').toLocaleLowerCase();
      const headerCategory = rawCategory?.toLocaleLowerCase();
      if (!row.malformed && row.fields.length === 2 && (headerName === 'name' || headerName === 'item') && headerCategory === 'category') {
        continue;
      }
    }

    const name = rawName?.replace(/^\uFEFF/, '').trim();
    const category = rawCategory?.trim();
    if (row.malformed || row.fields.length !== 2 || !name || !category) {
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
    const nameKey = identityKey(cleanName);
    const categoryKey = identityKey(cleanCat);
    const duplicate = db.prepare(`
      SELECT 1 FROM entity_pool
      WHERE name_key = ? AND category_key = ?
      LIMIT 1
    `).get(nameKey, categoryKey);
    if (duplicate) {
      throw new Error(`duplicate entity: ${cleanName} / ${cleanCat}`);
    }

    const createdAt = nowIso();
    try {
      const result = db.prepare(
        'INSERT INTO entity_pool (name, category, name_key, category_key, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(cleanName, cleanCat, nameKey, categoryKey, createdAt);
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
