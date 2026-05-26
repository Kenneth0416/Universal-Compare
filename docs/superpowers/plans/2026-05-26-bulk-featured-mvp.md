# Bulk Featured MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an entity-pool + candidate-pairs matrix workflow so admin can bulk-source, bulk-preflight, and bulk-promote featured comparisons (replacing single-add-at-a-time workflow with 10x throughput).

**Architecture:** Two new SQLite-backed stores (`entityPool`, `candidatePairs`) and 8 new admin endpoints. Bulk preflight reuses Phase 0 `DemandSensingService` via a new `mapConcurrent` helper (server-side). Bulk promote writes to existing `featured_comparisons` with `reportId=null` — Phase 1-4 generation stays per-row (existing UX). New `Pool` admin tab with three stacked sections.

**Tech Stack:** Node `node:test` + `node:assert/strict`, `tsx`, Express, `better-sqlite3` (existing), React 19 + TypeScript admin UI.

**Spec:** `docs/superpowers/specs/2026-05-26-bulk-featured-mvp-design.md`

---

## File Map

**New backend files:**
- `server/concurrency.ts` — Server-side `mapConcurrent` helper (~15 LOC)
- `server/entityPool.ts` — Entity store + CSV parser
- `server/candidatePairs.ts` — Candidate pair store with sync logic
- `tests/server/concurrency.test.ts` — Unit tests for the helper
- `tests/server/entityPool.test.ts` — Unit tests
- `tests/server/candidatePairs.test.ts` — Unit tests
- `tests/server/candidatePairs.real.test.ts` — Real API concurrent batch test (gated)

**Modified backend:**
- `server/app.ts` — 8 new endpoints, extend `CreateAppOptions` with `entityStore` + `candidateStore`
- `server/index.ts` — Instantiate stores, pass into `createApp`
- `tests/server/app.test.ts` — Endpoint integration tests + extend `createTestApp` helper

**Modified frontend:**
- `src/admin/types.ts` — Add `Entity`, `CandidatePair`, `BulkPreflightItemResult`, `BulkPromoteResult`
- `src/admin/adminApi.ts` — Add 8 client functions
- `src/admin/AdminApp.tsx` — Add `Pool` tab with three sections

---

## Conventions

- Every test uses `import assert from 'node:assert/strict'; import test from 'node:test';`
- Stores follow the existing `featured.ts` pattern: `createXStore(db)` initializes schema, returns API object
- Run unit tests: `npm test` (< 5 seconds total)
- Run real API tests: `npm run test:real`
- Commit after every Task's green phase

---

## Task 1: EntityPoolStore + CSV parser

**Files:**
- Create: `server/entityPool.ts`
- Create: `tests/server/entityPool.test.ts`

- [ ] **Step 1.1: Write failing unit tests**

Create `tests/server/entityPool.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAnalyticsStore } from '../../server/analytics';
import { createEntityPoolStore, parseEntityCsv } from '../../server/entityPool';

function makeStore() {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'entity-pool-')), 'analytics.db');
  const analyticsStore = createAnalyticsStore(dbPath, 'test-secret');
  return createEntityPoolStore(analyticsStore.getDb());
}

test('entityPool: addEntity creates row with timestamp', () => {
  const store = makeStore();
  const entity = store.addEntity('ChatGPT', 'AI Assistant');
  assert.equal(entity.name, 'ChatGPT');
  assert.equal(entity.category, 'AI Assistant');
  assert.ok(entity.id > 0);
  assert.match(entity.createdAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('entityPool: addEntity rejects duplicate (name, category)', () => {
  const store = makeStore();
  store.addEntity('ChatGPT', 'AI Assistant');
  assert.throws(
    () => store.addEntity('ChatGPT', 'AI Assistant'),
    /duplicate/i,
  );
});

test('entityPool: addEntity allows same name in different category', () => {
  const store = makeStore();
  const a = store.addEntity('Notion', 'Productivity');
  const b = store.addEntity('Notion', 'Database');
  assert.notEqual(a.id, b.id);
});

test('entityPool: addEntitiesBulk handles mix of valid + duplicate + invalid', () => {
  const store = makeStore();
  store.addEntity('Claude', 'AI Assistant');
  const result = store.addEntitiesBulk([
    { name: 'ChatGPT', category: 'AI Assistant' },     // new
    { name: 'Claude', category: 'AI Assistant' },      // dupe
    { name: '', category: 'AI Assistant' },            // invalid (empty name)
    { name: 'Gemini', category: '' },                  // invalid (empty cat)
    { name: 'Grok', category: 'AI Assistant' },        // new
  ]);
  assert.equal(result.added.length, 2);
  assert.equal(result.added[0].name, 'ChatGPT');
  assert.equal(result.added[1].name, 'Grok');
  assert.equal(result.skipped.length, 3);
  assert.equal(result.skipped[0].reason, 'duplicate');
  assert.equal(result.skipped[1].reason, 'invalid');
  assert.equal(result.skipped[2].reason, 'invalid');
});

test('entityPool: listEntities filters by category', () => {
  const store = makeStore();
  store.addEntity('ChatGPT', 'AI Assistant');
  store.addEntity('Claude', 'AI Assistant');
  store.addEntity('Notion', 'Productivity');
  const ai = store.listEntities('AI Assistant');
  assert.equal(ai.length, 2);
  const all = store.listEntities();
  assert.equal(all.length, 3);
});

test('entityPool: removeEntity returns true/false', () => {
  const store = makeStore();
  const e = store.addEntity('ChatGPT', 'AI Assistant');
  assert.equal(store.removeEntity(e.id), true);
  assert.equal(store.removeEntity(e.id), false);  // already gone
  assert.equal(store.removeEntity(99999), false); // never existed
});

test('entityPool: listCategories returns distinct sorted', () => {
  const store = makeStore();
  store.addEntity('ChatGPT', 'AI Assistant');
  store.addEntity('Notion', 'Productivity');
  store.addEntity('Claude', 'AI Assistant');
  assert.deepEqual(store.listCategories(), ['AI Assistant', 'Productivity']);
});

test('parseEntityCsv: header row auto-detected and skipped', () => {
  const csv = 'name,category\nChatGPT,AI\nClaude,AI';
  const result = parseEntityCsv(csv);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].name, 'ChatGPT');
  assert.equal(result.rejectedRows, 0);
});

test('parseEntityCsv: skips empty lines, trims, drops invalid', () => {
  const csv = '\n  ChatGPT , AI  \n\n,AI\nNotion,\nValid,Cat\n';
  const result = parseEntityCsv(csv);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].name, 'ChatGPT');
  assert.equal(result.items[0].category, 'AI');
  assert.equal(result.items[1].name, 'Valid');
  assert.equal(result.rejectedRows, 2);  // ,AI and Notion,
});

test('parseEntityCsv: caps name to 200 chars, category to 100, rejects over', () => {
  const longName = 'A'.repeat(201);
  const longCat = 'C'.repeat(101);
  const csv = `${longName},Cat\nName,${longCat}\nValid,Cat`;
  const result = parseEntityCsv(csv);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, 'Valid');
  assert.equal(result.rejectedRows, 2);
});
```

- [ ] **Step 1.2: Run tests, verify failure**

Run: `npm test -- --test-name-pattern="entityPool|parseEntityCsv"`

Expected: FAIL with `Cannot find module '../../server/entityPool'`.

- [ ] **Step 1.3: Implement `server/entityPool.ts`**

Create `server/entityPool.ts`:

```typescript
type DatabaseConnection = {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    run: (...params: unknown[]) => { changes: number; lastInsertRowid: number | bigint };
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
        id: Number(result.lastInsertRowid),
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
```

- [ ] **Step 1.4: Run tests, verify pass**

Run: `npm test`

Expected: all existing 72 tests + ~10 new entityPool tests PASS.

- [ ] **Step 1.5: Commit**

```bash
git add server/entityPool.ts tests/server/entityPool.test.ts
git commit -m "$(cat <<'EOF'
feat(bulk-mvp): EntityPoolStore with CSV parser

Schema for entity_pool table with UNIQUE(name, category). CRUD methods,
bulk add with explicit skip reasons, list categories. CSV parser auto-
detects header row, trims whitespace, rejects oversized values.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: CandidatePairStore with sync logic

**Files:**
- Create: `server/candidatePairs.ts`
- Create: `tests/server/candidatePairs.test.ts`

- [ ] **Step 2.1: Write failing unit tests**

Create `tests/server/candidatePairs.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAnalyticsStore } from '../../server/analytics';
import { createFeaturedStore } from '../../server/featured';
import { createEntityPoolStore } from '../../server/entityPool';
import { createCandidatePairStore } from '../../server/candidatePairs';

function makeStores() {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'candidate-')), 'analytics.db');
  const analyticsStore = createAnalyticsStore(dbPath, 'test-secret');
  const db = analyticsStore.getDb();
  const featuredStore = createFeaturedStore(db);
  const entityStore = createEntityPoolStore(db);
  const candidateStore = createCandidatePairStore(db);
  return { db, featuredStore, entityStore, candidateStore };
}

test('candidatePairs: syncFromEntityPool with empty pool returns 0/0', () => {
  const { candidateStore } = makeStores();
  const result = candidateStore.syncFromEntityPool();
  assert.deepEqual(result, { created: 0, total: 0 });
});

test('candidatePairs: sync with 3 entities same category → 3 pairs', () => {
  const { entityStore, candidateStore } = makeStores();
  entityStore.addEntity('A', 'X');
  entityStore.addEntity('B', 'X');
  entityStore.addEntity('C', 'X');
  const result = candidateStore.syncFromEntityPool();
  assert.equal(result.created, 3);
  assert.equal(result.total, 3);
  const items = candidateStore.listCandidates({}).items;
  assert.equal(items.length, 3);
});

test('candidatePairs: cross-category entities do not pair', () => {
  const { entityStore, candidateStore } = makeStores();
  entityStore.addEntity('A', 'X');
  entityStore.addEntity('B', 'Y');
  const result = candidateStore.syncFromEntityPool();
  assert.equal(result.created, 0);
  assert.equal(result.total, 0);
});

test('candidatePairs: sync is idempotent (running twice creates same pairs)', () => {
  const { entityStore, candidateStore } = makeStores();
  entityStore.addEntity('A', 'X');
  entityStore.addEntity('B', 'X');
  candidateStore.syncFromEntityPool();
  const second = candidateStore.syncFromEntityPool();
  assert.equal(second.created, 0);
  assert.equal(second.total, 1);
});

test('candidatePairs: sync skips pairs already in featured_comparisons (case-insensitive)', () => {
  const { entityStore, featuredStore, candidateStore } = makeStores();
  entityStore.addEntity('ChatGPT', 'AI');
  entityStore.addEntity('Claude', 'AI');
  featuredStore.addFeatured('chatgpt', 'CLAUDE');  // existing featured, different case
  const result = candidateStore.syncFromEntityPool();
  assert.equal(result.created, 0);
});

test('candidatePairs: canonical ordering (entity_a_id < entity_b_id)', () => {
  const { entityStore, candidateStore } = makeStores();
  const a = entityStore.addEntity('First', 'X');
  const b = entityStore.addEntity('Second', 'X');
  candidateStore.syncFromEntityPool();
  const items = candidateStore.listCandidates({}).items;
  assert.equal(items.length, 1);
  assert.ok(items[0].entityAId < items[0].entityBId);
  assert.equal(items[0].entityAId, a.id);
  assert.equal(items[0].entityBId, b.id);
});

test('candidatePairs: sync caches item_a_name and item_b_name', () => {
  const { entityStore, candidateStore } = makeStores();
  entityStore.addEntity('Alpha', 'X');
  entityStore.addEntity('Beta', 'X');
  candidateStore.syncFromEntityPool();
  const items = candidateStore.listCandidates({}).items;
  assert.equal(items[0].itemAName, 'Alpha');
  assert.equal(items[0].itemBName, 'Beta');
});

test('candidatePairs: updateScore writes full state and sets status=scored', () => {
  const { entityStore, candidateStore } = makeStores();
  entityStore.addEntity('Alpha', 'X');
  entityStore.addEntity('Beta', 'X');
  candidateStore.syncFromEntityPool();
  const id = candidateStore.listCandidates({}).items[0].id;
  candidateStore.updateScore(id, {
    score: 7.5,
    recommendation: 'good',
    signals: {
      existing_articles_count: 8,
      has_reddit_discussion: true,
      has_authoritative_source: false,
      competition_level: 'medium',
      freshness: 'fresh',
    },
    reasoning: 'Plenty of articles.',
    topSources: [{ url: 'https://example.com', title: 'Test' }],
    partial: false,
    metrics: { durationMs: 1200, totalTokens: 300 },
  });
  const updated = candidateStore.getCandidate(id)!;
  assert.equal(updated.status, 'scored');
  assert.equal(updated.demandScore, 7.5);
  assert.equal(updated.recommendation, 'good');
  assert.equal(updated.partial, false);
  assert.match(updated.lastScoredAt || '', /^\d{4}/);
  const signals = JSON.parse(updated.signalsJson!);
  assert.equal(signals.has_reddit_discussion, true);
});

test('candidatePairs: markPromoted is idempotent and returns boolean', () => {
  const { entityStore, candidateStore } = makeStores();
  entityStore.addEntity('Alpha', 'X');
  entityStore.addEntity('Beta', 'X');
  candidateStore.syncFromEntityPool();
  const id = candidateStore.listCandidates({}).items[0].id;
  assert.equal(candidateStore.markPromoted(id), true);
  assert.equal(candidateStore.markPromoted(id), false);
  assert.equal(candidateStore.getCandidate(id)!.status, 'promoted');
});

test('candidatePairs: listCandidates filters by status and minScore', () => {
  const { entityStore, candidateStore } = makeStores();
  entityStore.addEntity('A', 'X');
  entityStore.addEntity('B', 'X');
  entityStore.addEntity('C', 'X');
  candidateStore.syncFromEntityPool();
  const items = candidateStore.listCandidates({}).items;
  const baseResult = {
    score: 0,
    recommendation: 'consider' as const,
    signals: {
      existing_articles_count: 0,
      has_reddit_discussion: false,
      has_authoritative_source: false,
      competition_level: 'low' as const,
      freshness: 'recent' as const,
    },
    reasoning: 'x',
    topSources: [],
    partial: false,
    metrics: { durationMs: 1, totalTokens: 1 },
  };
  candidateStore.updateScore(items[0].id, { ...baseResult, score: 8 });
  candidateStore.updateScore(items[1].id, { ...baseResult, score: 4 });
  // items[2] remains pending

  const high = candidateStore.listCandidates({ status: 'scored', minScore: 6 });
  assert.equal(high.items.length, 1);
  assert.equal(high.items[0].demandScore, 8);

  const pending = candidateStore.listCandidates({ status: 'pending' });
  assert.equal(pending.items.length, 1);
  assert.equal(pending.items[0].id, items[2].id);
});
```

- [ ] **Step 2.2: Run tests, verify failure**

Run: `npm test -- --test-name-pattern="candidatePairs"`

Expected: FAIL with `Cannot find module '../../server/candidatePairs'`.

- [ ] **Step 2.3: Implement `server/candidatePairs.ts`**

Create `server/candidatePairs.ts`:

```typescript
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
    const entitiesSql = category
      ? 'SELECT id, name, category FROM entity_pool WHERE category = ? ORDER BY id ASC'
      : 'SELECT id, name, category FROM entity_pool ORDER BY id ASC';
    const entityRows = (category
      ? db.prepare(entitiesSql).all(category)
      : db.prepare(entitiesSql).all()) as Array<{ id: number; name: string; category: string }>;

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
```

- [ ] **Step 2.4: Run tests, verify pass**

Run: `npm test`

Expected: all previous tests + ~10 new candidatePairs tests PASS.

- [ ] **Step 2.5: Commit**

```bash
git add server/candidatePairs.ts tests/server/candidatePairs.test.ts
git commit -m "$(cat <<'EOF'
feat(bulk-mvp): CandidatePairStore with sync logic

Schema with canonical ordering (entity_a_id < entity_b_id) and unique
constraint. syncFromEntityPool enumerates intra-category pairs, skips
already-existing candidates and pairs already in featured_comparisons
(case-insensitive). updateScore persists DemandSenseResult fields.
markPromoted is idempotent via WHERE status != 'promoted'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Entity endpoints

**Files:**
- Modify: `server/app.ts` — Inject `entityStore`, add 4 entity endpoints
- Modify: `tests/server/app.test.ts` — Extend `createTestApp` + 6 new tests

- [ ] **Step 3.1: Write failing endpoint tests**

In `tests/server/app.test.ts`, first extend the imports near the top:

```typescript
import { createEntityPoolStore } from '../../server/entityPool';
import { createCandidatePairStore } from '../../server/candidatePairs';
```

Replace the existing `createTestApp` function with this expanded version (preserves current behavior + adds the two new stores):

```typescript
function createTestApp(overrides?: {
  demandSensingService?: { scorePair: (a: string, b: string, lang?: string) => Promise<any> };
}) {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'compareai-app-')), 'analytics.db');
  const analyticsStore = createAnalyticsStore(dbPath, 'test-secret');
  const reportStore = createReportStore(analyticsStore.getDb());
  const featuredStore = createFeaturedStore(analyticsStore.getDb());
  const entityStore = createEntityPoolStore(analyticsStore.getDb());
  const candidateStore = createCandidatePairStore(analyticsStore.getDb());
  const app = createApp({
    analyticsStore,
    reportStore,
    featuredStore,
    entityStore,
    candidateStore,
    adminPassword: 'admin-password',
    adminSessionSecret: 'session-secret',
    provider: {
      name: 'test',
      research: async () => ({
        text: 'ok',
        metrics: { model: 'test-model', promptTokens: 100, completionTokens: 25, totalTokens: 130, durationMs: 50 },
      }),
      chatCompletion: async () => ({
        json: '{}',
        metrics: { model: 'test-model', promptTokens: 100, completionTokens: 25, totalTokens: 130, durationMs: 50 },
      }),
    },
    demandSensingService: overrides?.demandSensingService,
  });

  return { app, analyticsStore, reportStore, featuredStore, entityStore, candidateStore };
}
```

Append entity endpoint tests at the end of `tests/server/app.test.ts`:

```typescript
test('POST /api/admin/entities requires admin auth', async () => {
  const { app } = createTestApp();
  await withServer(app, async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/api/admin/entities`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'X', category: 'Y' }),
    });
    assert.equal(resp.status, 401);
  });
});

test('POST /api/admin/entities creates entity (201)', async () => {
  const { app } = createTestApp();
  await withServer(app, async (baseUrl) => {
    const cookie = await loginAsAdmin(baseUrl);
    const resp = await fetch(`${baseUrl}/api/admin/entities`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'ChatGPT', category: 'AI Assistant' }),
    });
    assert.equal(resp.status, 201);
    const body = (await resp.json()) as any;
    assert.equal(body.name, 'ChatGPT');
    assert.equal(body.category, 'AI Assistant');
  });
});

test('POST /api/admin/entities returns 409 on duplicate', async () => {
  const { app } = createTestApp();
  await withServer(app, async (baseUrl) => {
    const cookie = await loginAsAdmin(baseUrl);
    await fetch(`${baseUrl}/api/admin/entities`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'ChatGPT', category: 'AI Assistant' }),
    });
    const resp = await fetch(`${baseUrl}/api/admin/entities`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'ChatGPT', category: 'AI Assistant' }),
    });
    assert.equal(resp.status, 409);
  });
});

test('POST /api/admin/entities/bulk with CSV returns added + skipped', async () => {
  const { app } = createTestApp();
  await withServer(app, async (baseUrl) => {
    const cookie = await loginAsAdmin(baseUrl);
    const csv = 'name,category\nChatGPT,AI\nClaude,AI\n,AI\nChatGPT,AI';
    const resp = await fetch(`${baseUrl}/api/admin/entities/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ csv }),
    });
    assert.equal(resp.status, 200);
    const body = (await resp.json()) as any;
    assert.equal(body.added.length, 2);
    assert.equal(body.skipped.length, 2);
    assert.ok(body.skipped.some((s: any) => s.reason === 'duplicate'));
    assert.ok(body.skipped.some((s: any) => s.reason === 'invalid'));
  });
});

test('GET /api/admin/entities filters by category', async () => {
  const { app, entityStore } = createTestApp();
  entityStore.addEntity('ChatGPT', 'AI');
  entityStore.addEntity('Notion', 'Productivity');
  await withServer(app, async (baseUrl) => {
    const cookie = await loginAsAdmin(baseUrl);
    const resp = await fetch(`${baseUrl}/api/admin/entities?category=AI`, { headers: { cookie } });
    assert.equal(resp.status, 200);
    const body = (await resp.json()) as any;
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].name, 'ChatGPT');
  });
});

test('DELETE /api/admin/entities/:id 200 on success, 404 missing', async () => {
  const { app, entityStore } = createTestApp();
  const e = entityStore.addEntity('Temp', 'X');
  await withServer(app, async (baseUrl) => {
    const cookie = await loginAsAdmin(baseUrl);
    const ok = await fetch(`${baseUrl}/api/admin/entities/${e.id}`, { method: 'DELETE', headers: { cookie } });
    assert.equal(ok.status, 200);
    const missing = await fetch(`${baseUrl}/api/admin/entities/99999`, { method: 'DELETE', headers: { cookie } });
    assert.equal(missing.status, 404);
  });
});
```

- [ ] **Step 3.2: Run tests, verify failure**

Run: `npm test -- --test-name-pattern="entities"`

Expected: FAIL — endpoints don't exist (404) and `createTestApp` doesn't accept `entityStore` in `createApp` yet.

- [ ] **Step 3.3: Extend `CreateAppOptions` and `createApp` signature**

In `server/app.ts`, add imports near the top:

```typescript
import { parseEntityCsv, type EntityPoolStore } from './entityPool';
import type { CandidatePairStore } from './candidatePairs';
```

Modify `CreateAppOptions` (currently lines 43-52):

```typescript
type CreateAppOptions = {
  analyticsStore: AnalyticsStore;
  reportStore: ReportStore;
  featuredStore: FeaturedStore;
  provider: AIProvider;
  demandSensingService?: Pick<DemandSensingService, 'scorePair'>;
  entityStore: EntityPoolStore;
  candidateStore: CandidatePairStore;
  adminPassword?: string;
  adminSessionSecret: string;
  siteUrl?: string;
};
```

Modify `createApp` destructuring:

```typescript
export function createApp({
  analyticsStore,
  reportStore,
  featuredStore,
  provider,
  demandSensingService,
  entityStore,
  candidateStore,
  adminPassword,
  adminSessionSecret,
  siteUrl = process.env.SITE_URL || process.env.APP_URL,
}: CreateAppOptions) {
```

- [ ] **Step 3.4: Add entity endpoints**

In `server/app.ts`, add these endpoints after the existing `POST /api/admin/featured/preflight` handler:

```typescript
  app.get('/api/admin/entities', (req, res) => {
    const { category } = req.query;
    const items = entityStore.listEntities(
      typeof category === 'string' && category.trim() ? category.trim() : undefined,
    );
    const categories = entityStore.listCategories();
    res.json({ items, categories });
  });

  app.post('/api/admin/entities', (req, res) => {
    const { name, category } = req.body || {};
    if (typeof name !== 'string' || typeof category !== 'string' || !name.trim() || !category.trim()) {
      res.status(400).json({ error: 'name and category must be non-empty strings' });
      return;
    }
    try {
      const entity = entityStore.addEntity(name, category);
      res.status(201).json(entity);
    } catch (err: any) {
      if (/duplicate/i.test(err.message)) {
        res.status(409).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/admin/entities/bulk', (req, res) => {
    const { csv, items } = req.body || {};
    let parsed: Array<{ name: string; category: string }>;

    if (typeof csv === 'string') {
      const { items: csvItems } = parseEntityCsv(csv);
      parsed = csvItems;
    } else if (Array.isArray(items)) {
      parsed = items.filter((i: any) => i && typeof i.name === 'string' && typeof i.category === 'string');
    } else {
      res.status(400).json({ error: 'must provide csv string or items array' });
      return;
    }

    if (parsed.length === 0) {
      res.status(400).json({ error: 'no valid entities to add' });
      return;
    }

    const result = entityStore.addEntitiesBulk(parsed);
    res.json(result);
  });

  app.delete('/api/admin/entities/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const ok = entityStore.removeEntity(id);
    if (!ok) {
      res.status(404).json({ error: 'entity not found' });
      return;
    }
    res.json({ ok: true });
  });
```

- [ ] **Step 3.5: Run tests, verify pass**

Run: `npm test`

Expected: previous tests + 6 entity endpoint tests PASS.

- [ ] **Step 3.6: Commit**

```bash
git add server/app.ts tests/server/app.test.ts
git commit -m "$(cat <<'EOF'
feat(bulk-mvp): entity CRUD endpoints

POST/GET/DELETE /api/admin/entities + POST /api/admin/entities/bulk
for CSV import. createApp now requires entityStore + candidateStore
in options; test helper extended.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Candidate sync + list endpoints

**Files:**
- Modify: `server/app.ts` — Add 2 endpoints
- Modify: `tests/server/app.test.ts` — Add 3 tests

- [ ] **Step 4.1: Write failing tests**

Append at the end of `tests/server/app.test.ts`:

```typescript
test('POST /api/admin/candidates/sync requires auth + creates pairs', async () => {
  const { app, entityStore } = createTestApp();
  entityStore.addEntity('A', 'X');
  entityStore.addEntity('B', 'X');
  await withServer(app, async (baseUrl) => {
    const unauth = await fetch(`${baseUrl}/api/admin/candidates/sync`, { method: 'POST' });
    assert.equal(unauth.status, 401);

    const cookie = await loginAsAdmin(baseUrl);
    const resp = await fetch(`${baseUrl}/api/admin/candidates/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({}),
    });
    assert.equal(resp.status, 200);
    const body = (await resp.json()) as any;
    assert.equal(body.created, 1);
    assert.equal(body.total, 1);
  });
});

test('GET /api/admin/candidates returns pairs with status/minScore filter', async () => {
  const { app, entityStore, candidateStore } = createTestApp();
  entityStore.addEntity('A', 'X');
  entityStore.addEntity('B', 'X');
  entityStore.addEntity('C', 'X');
  candidateStore.syncFromEntityPool();
  const items = candidateStore.listCandidates({}).items;
  candidateStore.updateScore(items[0].id, {
    score: 8, recommendation: 'good',
    signals: { existing_articles_count: 5, has_reddit_discussion: true, has_authoritative_source: false, competition_level: 'medium', freshness: 'fresh' },
    reasoning: 'x', topSources: [], partial: false,
    metrics: { durationMs: 1, totalTokens: 1 },
  });

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAsAdmin(baseUrl);
    const resp = await fetch(`${baseUrl}/api/admin/candidates?status=scored&minScore=6`, { headers: { cookie } });
    assert.equal(resp.status, 200);
    const body = (await resp.json()) as any;
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].demandScore, 8);
    assert.equal(body.total, 1);
  });
});

test('GET /api/admin/candidates pagination via limit + offset', async () => {
  const { app, entityStore, candidateStore } = createTestApp();
  for (const n of ['A', 'B', 'C', 'D', 'E']) entityStore.addEntity(n, 'X');
  candidateStore.syncFromEntityPool();
  await withServer(app, async (baseUrl) => {
    const cookie = await loginAsAdmin(baseUrl);
    const resp = await fetch(`${baseUrl}/api/admin/candidates?limit=3&offset=0`, { headers: { cookie } });
    const body = (await resp.json()) as any;
    assert.equal(body.items.length, 3);
    assert.equal(body.total, 10);
  });
});
```

- [ ] **Step 4.2: Run tests, verify failure**

Run: `npm test -- --test-name-pattern="candidates/sync|candidates returns|candidates pagination"`

Expected: FAIL — endpoints not yet defined (404).

- [ ] **Step 4.3: Add endpoints**

In `server/app.ts`, add after the entity endpoints:

```typescript
  app.post('/api/admin/candidates/sync', (req, res) => {
    const { category } = req.body || {};
    const result = candidateStore.syncFromEntityPool(
      typeof category === 'string' && category.trim() ? category.trim() : undefined,
    );
    res.json(result);
  });

  app.get('/api/admin/candidates', (req, res) => {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const minScore = req.query.minScore != null ? Number(req.query.minScore) : undefined;
    const limit = req.query.limit != null ? Math.min(Number(req.query.limit), 500) : 200;
    const offset = req.query.offset != null ? Number(req.query.offset) : 0;

    const allowedStatuses = ['pending', 'scored', 'promoted', 'rejected'];
    const safeStatus = status && allowedStatuses.includes(status) ? (status as any) : undefined;

    const result = candidateStore.listCandidates({
      category,
      status: safeStatus,
      minScore: Number.isFinite(minScore) ? minScore : undefined,
      limit: Number.isFinite(limit) ? limit : 200,
      offset: Number.isFinite(offset) ? offset : 0,
    });
    res.json(result);
  });
```

- [ ] **Step 4.4: Run tests, verify pass**

Run: `npm test`

Expected: previous tests + 3 new candidate tests PASS.

- [ ] **Step 4.5: Commit**

```bash
git add server/app.ts tests/server/app.test.ts
git commit -m "$(cat <<'EOF'
feat(bulk-mvp): candidate sync + list endpoints

POST /api/admin/candidates/sync triggers syncFromEntityPool. GET
/api/admin/candidates supports category, status, minScore, limit,
offset query params with safe parsing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: mapConcurrent helper + bulk preflight endpoint

**Files:**
- Create: `server/concurrency.ts`
- Create: `tests/server/concurrency.test.ts`
- Modify: `server/app.ts` — Add bulk-preflight endpoint
- Modify: `tests/server/app.test.ts` — Add 3 bulk-preflight tests

- [ ] **Step 5.1: Write failing concurrency test**

Create `tests/server/concurrency.test.ts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { mapConcurrent } from '../../server/concurrency';

test('mapConcurrent: preserves order of input array', async () => {
  const items = [1, 2, 3, 4, 5];
  const result = await mapConcurrent(items, 2, async (n) => n * 10);
  assert.deepEqual(result, [10, 20, 30, 40, 50]);
});

test('mapConcurrent: caps concurrency to N in flight', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  await mapConcurrent(items, 3, async (n) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 10));
    inFlight--;
    return n;
  });
  assert.ok(maxInFlight <= 3, `Expected max 3 concurrent, saw ${maxInFlight}`);
});

test('mapConcurrent: handles empty array', async () => {
  const result = await mapConcurrent([], 5, async (n) => n);
  assert.deepEqual(result, []);
});

test('mapConcurrent: surfaces thrown error', async () => {
  await assert.rejects(
    () => mapConcurrent([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    }),
    /boom/,
  );
});
```

- [ ] **Step 5.2: Run, verify failure**

Run: `npm test -- --test-name-pattern="mapConcurrent"`

Expected: FAIL with `Cannot find module '../../server/concurrency'`.

- [ ] **Step 5.3: Implement `server/concurrency.ts`**

Create `server/concurrency.ts`:

```typescript
export async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
```

- [ ] **Step 5.4: Run concurrency tests, verify pass**

Run: `npm test -- --test-name-pattern="mapConcurrent"`

Expected: 4 mapConcurrent tests PASS.

- [ ] **Step 5.5: Write failing bulk-preflight endpoint tests**

Append at the end of `tests/server/app.test.ts`:

```typescript
test('POST /api/admin/candidates/bulk-preflight requires auth', async () => {
  const { app } = createTestApp();
  await withServer(app, async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/api/admin/candidates/bulk-preflight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pairIds: [1], language: 'en' }),
    });
    assert.equal(resp.status, 401);
  });
});

test('POST /api/admin/candidates/bulk-preflight: 503 when service missing', async () => {
  const { app, entityStore, candidateStore } = createTestApp();
  entityStore.addEntity('A', 'X');
  entityStore.addEntity('B', 'X');
  candidateStore.syncFromEntityPool();
  const id = candidateStore.listCandidates({}).items[0].id;
  await withServer(app, async (baseUrl) => {
    const cookie = await loginAsAdmin(baseUrl);
    const resp = await fetch(`${baseUrl}/api/admin/candidates/bulk-preflight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ pairIds: [id], language: 'en' }),
    });
    assert.equal(resp.status, 503);
  });
});

test('POST /api/admin/candidates/bulk-preflight: happy path + partial failure', async () => {
  const validResult = {
    score: 7, recommendation: 'good',
    signals: {
      existing_articles_count: 5, has_reddit_discussion: true,
      has_authoritative_source: false, competition_level: 'medium', freshness: 'fresh',
    },
    reasoning: 'x', topSources: [], partial: false,
    metrics: { durationMs: 1, totalTokens: 1 },
  };
  const { app, entityStore, candidateStore } = createTestApp({
    demandSensingService: {
      scorePair: async (a: string) => {
        if (a === 'C') throw new Error('intentional fail');
        return validResult;
      },
    },
  });
  entityStore.addEntity('A', 'X');
  entityStore.addEntity('B', 'X');
  entityStore.addEntity('C', 'X');
  candidateStore.syncFromEntityPool();
  const pairIds = candidateStore.listCandidates({}).items.map((p) => p.id);

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAsAdmin(baseUrl);
    const resp = await fetch(`${baseUrl}/api/admin/candidates/bulk-preflight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ pairIds, language: 'en' }),
    });
    assert.equal(resp.status, 200);
    const body = (await resp.json()) as any;
    assert.equal(body.results.length, 3);
    const errors = body.results.filter((r: any) => r.status === 'error');
    const scored = body.results.filter((r: any) => r.status === 'scored');
    assert.equal(errors.length, 2);  // pairs involving 'C'
    assert.equal(scored.length, 1);  // A vs B
  });
});

test('POST /api/admin/candidates/bulk-preflight: rejects oversized batch (>50)', async () => {
  const { app } = createTestApp({
    demandSensingService: { scorePair: async () => ({}) as any },
  });
  const pairIds = Array.from({ length: 51 }, (_, i) => i + 1);
  await withServer(app, async (baseUrl) => {
    const cookie = await loginAsAdmin(baseUrl);
    const resp = await fetch(`${baseUrl}/api/admin/candidates/bulk-preflight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ pairIds, language: 'en' }),
    });
    assert.equal(resp.status, 400);
  });
});
```

- [ ] **Step 5.6: Run, verify failure**

Run: `npm test -- --test-name-pattern="bulk-preflight"`

Expected: FAIL — endpoint not yet defined.

- [ ] **Step 5.7: Add bulk-preflight endpoint**

In `server/app.ts`:

Add import:

```typescript
import { mapConcurrent } from './concurrency';
```

Add the endpoint after the candidate list endpoint:

```typescript
  app.post('/api/admin/candidates/bulk-preflight', async (req, res) => {
    if (!demandSensingService) {
      res.status(503).json({ error: 'Demand sensing service is not configured' });
      return;
    }

    const { pairIds, language } = req.body || {};
    if (!Array.isArray(pairIds) || pairIds.length === 0) {
      res.status(400).json({ error: 'pairIds must be a non-empty array' });
      return;
    }
    if (pairIds.length > 50) {
      res.status(400).json({ error: 'pairIds max 50 per batch' });
      return;
    }

    const pairs = pairIds
      .map((id: any) => candidateStore.getCandidate(Number(id)))
      .filter((p): p is NonNullable<typeof p> => p !== null && p.status !== 'promoted');

    const lang = typeof language === 'string' ? language : 'en';

    const results = await mapConcurrent(pairs, 5, async (pair) => {
      try {
        const result = await demandSensingService.scorePair(pair.itemAName, pair.itemBName, lang);
        candidateStore.updateScore(pair.id, result);
        return { id: pair.id, status: 'scored' as const, result };
      } catch (err) {
        return { id: pair.id, status: 'error' as const, error: (err as Error).message };
      }
    });

    res.json({ results });
  });
```

- [ ] **Step 5.8: Run all tests, verify pass**

Run: `npm test`

Expected: all previous tests + 4 mapConcurrent + 4 bulk-preflight tests PASS.

- [ ] **Step 5.9: Commit**

```bash
git add server/concurrency.ts tests/server/concurrency.test.ts server/app.ts tests/server/app.test.ts
git commit -m "$(cat <<'EOF'
feat(bulk-mvp): mapConcurrent helper + bulk preflight endpoint

Server-side mapConcurrent preserves input order, caps in-flight count,
surfaces errors. POST /api/admin/candidates/bulk-preflight runs Phase
0 against up to 50 candidates concurrently (max 5 in flight). Partial
failures returned per-item as { id, status: 'error', error }.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Bulk promote endpoint

**Files:**
- Modify: `server/app.ts` — Add bulk-promote endpoint
- Modify: `tests/server/app.test.ts` — Add 3 tests

- [ ] **Step 6.1: Write failing tests**

Append at the end of `tests/server/app.test.ts`:

```typescript
test('POST /api/admin/candidates/bulk-promote requires auth', async () => {
  const { app } = createTestApp();
  await withServer(app, async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/api/admin/candidates/bulk-promote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pairIds: [1], language: 'en' }),
    });
    assert.equal(resp.status, 401);
  });
});

test('POST /api/admin/candidates/bulk-promote creates featured + marks candidates', async () => {
  const { app, entityStore, candidateStore, featuredStore } = createTestApp();
  entityStore.addEntity('Alpha', 'X');
  entityStore.addEntity('Beta', 'X');
  entityStore.addEntity('Gamma', 'X');
  candidateStore.syncFromEntityPool();
  const items = candidateStore.listCandidates({}).items;
  const ids = [items[0].id, items[1].id];

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAsAdmin(baseUrl);
    const resp = await fetch(`${baseUrl}/api/admin/candidates/bulk-promote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ pairIds: ids, language: 'en' }),
    });
    assert.equal(resp.status, 200);
    const body = (await resp.json()) as any;
    assert.equal(body.promoted.length, 2);
    assert.equal(body.skipped.length, 0);

    // candidates marked
    assert.equal(candidateStore.getCandidate(ids[0])!.status, 'promoted');
    assert.equal(candidateStore.getCandidate(ids[1])!.status, 'promoted');

    // featured created with reportId=null
    const featured = featuredStore.listFeatured();
    assert.equal(featured.length, 2);
    assert.equal(featured[0].reportId, null);
  });
});

test('POST /api/admin/candidates/bulk-promote idempotent for already-promoted', async () => {
  const { app, entityStore, candidateStore } = createTestApp();
  entityStore.addEntity('A', 'X');
  entityStore.addEntity('B', 'X');
  candidateStore.syncFromEntityPool();
  const id = candidateStore.listCandidates({}).items[0].id;
  candidateStore.markPromoted(id);

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAsAdmin(baseUrl);
    const resp = await fetch(`${baseUrl}/api/admin/candidates/bulk-promote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ pairIds: [id, 99999], language: 'en' }),
    });
    assert.equal(resp.status, 200);
    const body = (await resp.json()) as any;
    assert.equal(body.promoted.length, 0);
    assert.equal(body.skipped.length, 2);
    assert.ok(body.skipped.some((s: any) => s.reason === 'already_promoted'));
    assert.ok(body.skipped.some((s: any) => s.reason === 'not_found'));
  });
});
```

- [ ] **Step 6.2: Run, verify failure**

Run: `npm test -- --test-name-pattern="bulk-promote"`

Expected: FAIL — endpoint not yet defined.

- [ ] **Step 6.3: Add bulk-promote endpoint**

In `server/app.ts`, add after bulk-preflight:

```typescript
  app.post('/api/admin/candidates/bulk-promote', (req, res) => {
    const { pairIds, language, description } = req.body || {};
    if (!Array.isArray(pairIds) || pairIds.length === 0) {
      res.status(400).json({ error: 'pairIds must be a non-empty array' });
      return;
    }
    if (pairIds.length > 50) {
      res.status(400).json({ error: 'pairIds max 50 per batch' });
      return;
    }

    const lang = typeof language === 'string' ? language : 'en';
    const desc = typeof description === 'string' ? description : '';

    const promoted: ReturnType<typeof featuredStore.addFeatured>[] = [];
    const skipped: Array<{ candidateId: number; reason: 'already_promoted' | 'not_found' | 'create_failed' }> = [];

    for (const rawId of pairIds) {
      const id = Number(rawId);
      if (!Number.isFinite(id)) continue;

      const pair = candidateStore.getCandidate(id);
      if (!pair) {
        skipped.push({ candidateId: id, reason: 'not_found' });
        continue;
      }
      if (pair.status === 'promoted') {
        skipped.push({ candidateId: id, reason: 'already_promoted' });
        continue;
      }

      try {
        const featured = featuredStore.addFeatured(pair.itemAName, pair.itemBName, {
          language: lang,
          description: desc,
        });
        candidateStore.markPromoted(id);
        promoted.push(featured);
      } catch (err) {
        console.error(`bulk-promote create_failed for candidate ${id}:`, err);
        skipped.push({ candidateId: id, reason: 'create_failed' });
      }
    }

    res.json({ promoted, skipped });
  });
```

- [ ] **Step 6.4: Run all tests, verify pass**

Run: `npm test`

Expected: previous tests + 3 bulk-promote tests PASS.

- [ ] **Step 6.5: Commit**

```bash
git add server/app.ts tests/server/app.test.ts
git commit -m "$(cat <<'EOF'
feat(bulk-mvp): bulk promote endpoint

POST /api/admin/candidates/bulk-promote creates featured_comparisons
rows (reportId=null) and marks candidates as 'promoted'. Idempotent
via skipped[] with explicit reasons (already_promoted / not_found /
create_failed). Phase 1-4 generation stays per-row.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire production deps + real API concurrent test

**Files:**
- Modify: `server/index.ts` — Instantiate entity + candidate stores, pass to createApp
- Create: `tests/server/candidatePairs.real.test.ts` — Real-API concurrent batch test

- [ ] **Step 7.1: Wire stores into `server/index.ts`**

Add imports:

```typescript
import { createEntityPoolStore } from './entityPool';
import { createCandidatePairStore } from './candidatePairs';
```

After `featuredStore` is created and before `createApp` is called, add:

```typescript
const entityStore = createEntityPoolStore(analyticsStore.getDb());
const candidateStore = createCandidatePairStore(analyticsStore.getDb());
```

Update the `createApp({...})` call to include both:

```typescript
const app = createApp({
  analyticsStore,
  reportStore,
  featuredStore,
  entityStore,
  candidateStore,
  provider,
  demandSensingService,
  adminPassword: process.env.ADMIN_PASSWORD,
  adminSessionSecret,
  siteUrl: process.env.SITE_URL || process.env.APP_URL,
});
```

- [ ] **Step 7.2: Verify lint passes**

Run: `npm run lint 2>&1 | grep -v "App.tsx" | tail -10`

Expected: no new TS errors (App.tsx errors are pre-existing).

- [ ] **Step 7.3: Verify all unit tests still pass with the wired createApp**

Run: `npm test`

Expected: all tests still pass.

- [ ] **Step 7.4: Create real API concurrent batch test**

Create `tests/server/candidatePairs.real.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { createAnalyticsStore } from '../../server/analytics';
import { createEntityPoolStore } from '../../server/entityPool';
import { createCandidatePairStore } from '../../server/candidatePairs';
import { DemandSensingService } from '../../server/demandSensing';
import { mapConcurrent } from '../../server/concurrency';

dotenv.config({ path: '.env.local' });

const RUN_REAL = process.env.RUN_REAL_API_TESTS === '1';
const HAS_KEYS = !!(process.env.MINIMAX_API_KEY && process.env.DEEPSEEK_API_KEY);
const SKIP_REASON = !RUN_REAL
  ? 'set RUN_REAL_API_TESTS=1 to enable'
  : !HAS_KEYS
    ? 'MINIMAX_API_KEY and DEEPSEEK_API_KEY required in .env.local'
    : undefined;

test('real API: bulk preflight 5 pairs concurrently writes scores without race', { skip: SKIP_REASON }, async () => {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'candidate-real-')), 'analytics.db');
  const analyticsStore = createAnalyticsStore(dbPath, 'test-secret');
  const entityStore = createEntityPoolStore(analyticsStore.getDb());
  const candidateStore = createCandidatePairStore(analyticsStore.getDb());

  // 4 entities → 6 pairs; pick 5 for batch
  for (const name of ['ChatGPT', 'Claude', 'Gemini', 'Grok']) {
    entityStore.addEntity(name, 'AI Assistant');
  }
  candidateStore.syncFromEntityPool();
  const all = candidateStore.listCandidates({}).items;
  const pairs = all.slice(0, 5);

  const minimaxBaseUrl = process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1';
  const deepseekClient = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY!,
    baseURL: 'https://api.deepseek.com',
  });
  const service = new DemandSensingService({
    minimaxSearchApiKey: process.env.MINIMAX_API_KEY!,
    minimaxSearchBaseUrl: minimaxBaseUrl.replace('/v1', ''),
    deepseekClient,
    deepseekModel: process.env.DEEPSEEK_MODEL,
  });

  const start = Date.now();
  const results = await mapConcurrent(pairs, 5, async (p) => {
    try {
      const r = await service.scorePair(p.itemAName, p.itemBName, 'en');
      candidateStore.updateScore(p.id, r);
      return { id: p.id, status: 'scored' as const, score: r.score };
    } catch (e) {
      return { id: p.id, status: 'error' as const, error: (e as Error).message };
    }
  });
  const elapsed = Date.now() - start;

  console.log(`  → batch of ${pairs.length} pairs took ${elapsed}ms`);
  for (const r of results) {
    if (r.status === 'scored') console.log(`    id ${r.id}: ${r.score}`);
    else console.log(`    id ${r.id}: ERROR ${r.error}`);
  }

  assert.equal(results.length, pairs.length);
  const scored = results.filter((r) => r.status === 'scored');
  assert.ok(scored.length >= 3, `Expected at least 3 of 5 scored, got ${scored.length}`);
  assert.ok(elapsed < 60_000, `Expected < 60s for concurrent batch, got ${elapsed}ms`);

  // Confirm DB writes happened without overlap corrupting rows
  for (const p of pairs) {
    const updated = candidateStore.getCandidate(p.id)!;
    const matchingResult = results.find((r) => r.id === p.id);
    if (matchingResult?.status === 'scored') {
      assert.equal(updated.status, 'scored');
      assert.equal(typeof updated.demandScore, 'number');
    }
  }
});
```

- [ ] **Step 7.5: Confirm `npm test` skips the real test**

Run: `npm test 2>&1 | grep -E "real API|skipped" | head -5`

Expected: 1 line with the new real-API test showing as `# skipped`.

- [ ] **Step 7.6: Run real API test**

Run: `npm run test:real 2>&1 | tail -30`

Expected: 2 real tests pass (Phase 0's 4 + this 1 new = 5 total). Output shows real scores and elapsed time. Total runtime ~60-90 seconds.

If a pair fails because the real API can't find anything for an unusual pair: that's still considered passing if `scored.length >= 3`. Read the output to confirm scores make sense.

- [ ] **Step 7.7: Commit**

```bash
git add server/index.ts tests/server/candidatePairs.real.test.ts
git commit -m "$(cat <<'EOF'
feat(bulk-mvp): wire stores into production + real-API concurrent test

Instantiate entityStore + candidateStore in index.ts. Real-API test
runs bulk preflight on 5 AI assistant pairs concurrently against live
DeepSeek + MiniMax, asserts no race conditions in candidate_pairs
writes and completes within 60s budget.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Admin UI Pool tab

**Files:**
- Modify: `src/admin/types.ts` — Add types
- Modify: `src/admin/adminApi.ts` — Add 8 client functions
- Modify: `src/admin/AdminApp.tsx` — New Pool tab with 3 sections

No new tests (no frontend test framework). Human smoke test at the end.

- [ ] **Step 8.1: Add types to `src/admin/types.ts`**

Append at the bottom:

```typescript
export type Entity = {
  id: number;
  name: string;
  category: string;
  createdAt: string;
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

export type BulkPreflightItemResult =
  | { id: number; status: 'scored'; result: DemandSenseResult }
  | { id: number; status: 'error'; error: string };

export type BulkPromoteResult = {
  promoted: FeaturedComparison[];
  skipped: Array<{
    candidateId: number;
    reason: 'already_promoted' | 'not_found' | 'create_failed';
  }>;
};
```

- [ ] **Step 8.2: Add client functions to `src/admin/adminApi.ts`**

Update the type imports near the top to include the new types:

```typescript
import type {
  AdminSummary,
  BulkPreflightItemResult,
  BulkPromoteResult,
  CallListItem,
  CandidatePair,
  CandidatePairStatus,
  DemandSenseResult,
  Entity,
  FeaturedComparison,
  ListResponse,
  ReportListItem,
  RunListItem,
  UserListItem,
} from './types';
```

Append at the bottom:

```typescript
export function getEntities(category?: string) {
  const qs = category ? `?category=${encodeURIComponent(category)}` : '';
  return request<{ items: Entity[]; categories: string[] }>(`/entities${qs}`);
}

export function addEntity(name: string, category: string) {
  return request<Entity>('/entities', {
    method: 'POST',
    body: JSON.stringify({ name, category }),
  });
}

export function bulkAddEntities(csv: string) {
  return request<{
    added: Entity[];
    skipped: Array<{ name: string; category: string; reason: 'duplicate' | 'invalid' }>;
  }>('/entities/bulk', {
    method: 'POST',
    body: JSON.stringify({ csv }),
  });
}

export function deleteEntity(id: number) {
  return request<{ ok: true }>(`/entities/${id}`, { method: 'DELETE' });
}

export function syncCandidates(category?: string) {
  return request<{ created: number; total: number }>('/candidates/sync', {
    method: 'POST',
    body: JSON.stringify({ category }),
  });
}

export function listCandidates(opts: {
  category?: string;
  status?: CandidatePairStatus;
  minScore?: number;
  limit?: number;
  offset?: number;
} = {}) {
  const params = new URLSearchParams();
  if (opts.category) params.set('category', opts.category);
  if (opts.status) params.set('status', opts.status);
  if (typeof opts.minScore === 'number') params.set('minScore', String(opts.minScore));
  if (typeof opts.limit === 'number') params.set('limit', String(opts.limit));
  if (typeof opts.offset === 'number') params.set('offset', String(opts.offset));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return request<{ items: CandidatePair[]; total: number }>(`/candidates${qs}`);
}

export function bulkPreflightCandidates(pairIds: number[], language: string) {
  return request<{ results: BulkPreflightItemResult[] }>('/candidates/bulk-preflight', {
    method: 'POST',
    body: JSON.stringify({ pairIds, language }),
  });
}

export function bulkPromoteCandidates(pairIds: number[], language: string, description?: string) {
  return request<BulkPromoteResult>('/candidates/bulk-promote', {
    method: 'POST',
    body: JSON.stringify({ pairIds, language, description }),
  });
}
```

- [ ] **Step 8.3: Add Pool tab to `src/admin/AdminApp.tsx`**

First add the tab to the type, around line 59:

```typescript
type AdminTab = 'overview' | 'runs' | 'calls' | 'users' | 'reports' | 'pool';
```

Add imports at the top — extend the existing `lucide-react` import to add `Database` and `Layers` icons (Database is already there; add `Layers`):

```typescript
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Check,
  Clock3,
  Database,
  Eye,
  FileText,
  Gauge,
  GitCompareArrows,
  Layers,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
```

(Adds `Layers` and `Upload`.)

Add the new client functions to the existing `from './adminApi'` import block:

```typescript
import {
  getAdminCalls,
  getAdminFeatured,
  getAdminReports,
  getAdminRuns,
  getAdminSession,
  getAdminSummary,
  getAdminUsers,
  loginAdmin,
  logoutAdmin,
  deleteAdminReport,
  addAdminFeatured,
  deleteAdminFeatured,
  patchAdminFeatured,
  backfillSources,
  preflightFeatured,
  getEntities,
  addEntity,
  bulkAddEntities,
  deleteEntity,
  syncCandidates,
  listCandidates,
  bulkPreflightCandidates,
  bulkPromoteCandidates,
} from './adminApi';
```

Add new types to the existing `from './types'` import:

```typescript
import type {
  AdminSummary,
  BulkPreflightItemResult,
  CallListItem,
  CandidatePair,
  CandidatePairStatus,
  DemandSenseResult,
  Entity,
  FeaturedComparison,
  ReportListItem,
  RunListItem,
  UserListItem,
} from './types';
```

Add state variables. Find the existing block where featured-tab state is set up (around line 354) and add after the `featured` state:

```typescript
  const [poolEntities, setPoolEntities] = useState<Entity[]>([]);
  const [poolCategories, setPoolCategories] = useState<string[]>([]);
  const [poolCategoryFilter, setPoolCategoryFilter] = useState<string>('');
  const [poolNewName, setPoolNewName] = useState('');
  const [poolNewCategory, setPoolNewCategory] = useState('');
  const [poolCsvText, setPoolCsvText] = useState('');
  const [poolCsvBusy, setPoolCsvBusy] = useState(false);
  const [poolCsvMsg, setPoolCsvMsg] = useState<string | null>(null);

  const [candidates, setCandidates] = useState<CandidatePair[]>([]);
  const [candidateStatusFilter, setCandidateStatusFilter] = useState<CandidatePairStatus | 'all'>('all');
  const [candidateMinScore, setCandidateMinScore] = useState<number>(0);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<'idle' | 'preflighting' | 'promoting' | 'syncing'>('idle');
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
```

Add a loader function. Find `loadDashboard` (around the existing data-loading area, ~line 380) and add a new function near it:

```typescript
  const loadPool = async () => {
    try {
      const ents = await getEntities(poolCategoryFilter || undefined);
      setPoolEntities(ents.items);
      setPoolCategories(ents.categories);

      const cands = await listCandidates({
        category: poolCategoryFilter || undefined,
        status: candidateStatusFilter === 'all' ? undefined : candidateStatusFilter,
        minScore: candidateMinScore > 0 ? candidateMinScore : undefined,
        limit: 200,
      });
      setCandidates(cands.items);
    } catch (loadErr: any) {
      setError(loadErr.message || 'Failed to load pool');
    }
  };
```

The existing useEffect (lines 402-411) only runs on mount. There is no tab-aware refetch. Add a new useEffect for the Pool tab right after the existing one:

```typescript
  useEffect(() => {
    if (authenticated && activeTab === 'pool') {
      loadPool();
    }
  }, [authenticated, activeTab, poolCategoryFilter, candidateStatusFilter, candidateMinScore]);
```

Add handlers near other handlers (e.g., near `handleAddFeatured`):

```typescript
  const handleAddPoolEntity = async (event: FormEvent) => {
    event.preventDefault();
    if (!poolNewName.trim() || !poolNewCategory.trim()) return;
    try {
      await addEntity(poolNewName.trim(), poolNewCategory.trim());
      setPoolNewName('');
      setPoolNewCategory('');
      await loadPool();
    } catch (addError: any) {
      setError(addError.message || 'Failed to add entity');
    }
  };

  const handleImportCsv = async () => {
    if (!poolCsvText.trim()) return;
    setPoolCsvBusy(true);
    setPoolCsvMsg(null);
    try {
      const result = await bulkAddEntities(poolCsvText);
      setPoolCsvMsg(`Added ${result.added.length}, skipped ${result.skipped.length}`);
      setPoolCsvText('');
      await loadPool();
    } catch (importError: any) {
      setError(importError.message || 'CSV import failed');
    } finally {
      setPoolCsvBusy(false);
    }
  };

  const handleDeleteEntity = async (id: number) => {
    try {
      await deleteEntity(id);
      await loadPool();
    } catch (deleteError: any) {
      setError(deleteError.message || 'Failed to delete entity');
    }
  };

  const handleSyncCandidates = async () => {
    setBulkBusy('syncing');
    setBulkMsg(null);
    try {
      const result = await syncCandidates(poolCategoryFilter || undefined);
      setBulkMsg(`${result.created} new pairs added (${result.total} total possible)`);
      await loadPool();
    } catch (syncError: any) {
      setError(syncError.message || 'Sync failed');
    } finally {
      setBulkBusy('idle');
    }
  };

  const toggleSelected = (id: number) => {
    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkPreflight = async () => {
    const ids = Array.from(selectedCandidateIds);
    if (ids.length === 0) return;
    if (ids.length > 50) {
      setError('Max 50 per batch');
      return;
    }
    setBulkBusy('preflighting');
    setBulkMsg(`Scoring ${ids.length} pairs...`);
    try {
      const result = await bulkPreflightCandidates(ids, 'en');
      const scored = result.results.filter((r) => r.status === 'scored').length;
      const errs = result.results.filter((r) => r.status === 'error').length;
      setBulkMsg(`Done: ${scored} scored, ${errs} errors`);
      setSelectedCandidateIds(new Set());
      await loadPool();
    } catch (pfError: any) {
      setError(pfError.message || 'Bulk preflight failed');
    } finally {
      setBulkBusy('idle');
    }
  };

  const handleBulkPromote = async () => {
    const ids = Array.from(selectedCandidateIds);
    if (ids.length === 0) return;
    if (ids.length > 50) {
      setError('Max 50 per batch');
      return;
    }
    setBulkBusy('promoting');
    setBulkMsg(`Promoting ${ids.length} pairs...`);
    try {
      const result = await bulkPromoteCandidates(ids, 'en');
      setBulkMsg(`Promoted ${result.promoted.length}, skipped ${result.skipped.length}`);
      setSelectedCandidateIds(new Set());
      await loadPool();
    } catch (promoteError: any) {
      setError(promoteError.message || 'Bulk promote failed');
    } finally {
      setBulkBusy('idle');
    }
  };
```

The tabs are defined as an array (line 599-605). Add a `pool` entry:

```typescript
  const tabs: Array<{ key: AdminTab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'runs', label: 'Runs' },
    { key: 'reports', label: 'Reports' },
    { key: 'calls', label: 'Calls' },
    { key: 'users', label: 'Users' },
    { key: 'pool', label: 'Pool' },
  ];
```

The tab navigation strip (line 643-656) renders these via `.map()`, so adding to the array is all that's needed for the tab button to appear.

The tab content area uses pattern `{activeTab === 'X' && (...)}`. The existing tabs appear in order around lines 658 (overview), 956 (runs/reports/calls/users — those use compact `&&` form). Add the Pool section after the users tab block (around line 959), wrapped in `{activeTab === 'pool' && (...)}`:

```typescript
{activeTab === 'pool' && (
  <div className="space-y-6">
    <section>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-neutral-200">
        <Database size={16} /> Entity Pool
      </div>

      <form onSubmit={handleAddPoolEntity} className="mb-3 flex items-center gap-2">
        <input
          type="text"
          value={poolNewName}
          onChange={(e) => setPoolNewName(e.target.value)}
          placeholder="Entity name (e.g., ChatGPT)"
          className="h-9 flex-1 rounded-lg border border-white/10 bg-neutral-900 px-3 text-sm text-white outline-none focus:border-indigo-400"
          required
        />
        <input
          type="text"
          value={poolNewCategory}
          onChange={(e) => setPoolNewCategory(e.target.value)}
          placeholder="Category (e.g., AI Assistant)"
          className="h-9 flex-1 rounded-lg border border-white/10 bg-neutral-900 px-3 text-sm text-white outline-none focus:border-indigo-400"
          required
        />
        <button type="submit" className="flex h-9 items-center gap-1 rounded-lg bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-500">
          <Plus size={14} /> Add
        </button>
      </form>

      <details className="mb-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm">
        <summary className="cursor-pointer text-neutral-300">Bulk import CSV</summary>
        <textarea
          value={poolCsvText}
          onChange={(e) => setPoolCsvText(e.target.value)}
          placeholder="name,category&#10;ChatGPT,AI Assistant&#10;Claude,AI Assistant&#10;Gemini,AI Assistant"
          rows={6}
          className="mt-2 w-full rounded-lg border border-white/10 bg-neutral-900 p-2 font-mono text-xs text-white outline-none focus:border-indigo-400"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={handleImportCsv}
            disabled={poolCsvBusy || !poolCsvText.trim()}
            className="flex h-8 items-center gap-1 rounded-lg bg-indigo-600 px-3 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {poolCsvBusy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            Import
          </button>
          {poolCsvMsg && <span className="text-xs text-neutral-400">{poolCsvMsg}</span>}
        </div>
      </details>

      <div className="mb-2 flex items-center gap-2">
        <select
          value={poolCategoryFilter}
          onChange={(e) => setPoolCategoryFilter(e.target.value)}
          className="h-8 rounded-lg border border-white/10 bg-neutral-900 px-2 text-xs text-white outline-none focus:border-indigo-400"
        >
          <option value="">All categories</option>
          {poolCategories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-xs text-neutral-500">{poolEntities.length} entities</span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {poolEntities.map((entity) => (
          <div key={entity.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
            <div>
              <div className="text-sm font-medium text-white">{entity.name}</div>
              <div className="text-[10px] uppercase tracking-wide text-neutral-500">{entity.category}</div>
            </div>
            <button
              onClick={() => handleDeleteEntity(entity.id)}
              className="rounded-lg p-1 text-neutral-500 hover:bg-red-500/10 hover:text-red-300"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </section>

    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-neutral-200">
          <Layers size={16} /> Candidate Pairs
        </div>
        <button
          onClick={handleSyncCandidates}
          disabled={bulkBusy !== 'idle'}
          className="flex h-8 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-neutral-200 hover:bg-white/10 disabled:opacity-50"
        >
          {bulkBusy === 'syncing' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Sync from Pool
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={candidateStatusFilter}
          onChange={(e) => setCandidateStatusFilter(e.target.value as any)}
          className="h-8 rounded-lg border border-white/10 bg-neutral-900 px-2 text-xs text-white outline-none focus:border-indigo-400"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="scored">Scored</option>
          <option value="promoted">Promoted</option>
          <option value="rejected">Rejected</option>
        </select>
        <select
          value={candidateMinScore}
          onChange={(e) => setCandidateMinScore(Number(e.target.value))}
          className="h-8 rounded-lg border border-white/10 bg-neutral-900 px-2 text-xs text-white outline-none focus:border-indigo-400"
        >
          <option value="0">Min score: any</option>
          <option value="4">≥ 4</option>
          <option value="6">≥ 6</option>
          <option value="8">≥ 8</option>
        </select>
        <span className="text-xs text-neutral-500">
          {candidates.length} pairs · {selectedCandidateIds.size} selected
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleBulkPreflight}
            disabled={bulkBusy !== 'idle' || selectedCandidateIds.size === 0}
            className="flex h-8 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-neutral-200 hover:bg-white/10 disabled:opacity-50"
          >
            {bulkBusy === 'preflighting' ? <Loader2 size={12} className="animate-spin" /> : <Gauge size={12} />}
            Bulk Preflight ({selectedCandidateIds.size})
          </button>
          <button
            onClick={handleBulkPromote}
            disabled={bulkBusy !== 'idle' || selectedCandidateIds.size === 0}
            className="flex h-8 items-center gap-1 rounded-lg bg-indigo-600 px-3 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {bulkBusy === 'promoting' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            Bulk Promote ({selectedCandidateIds.size})
          </button>
        </div>
      </div>

      {bulkMsg && (
        <div className="mb-3 rounded-lg border border-white/10 bg-white/[0.04] p-2 text-xs text-neutral-300">
          {bulkMsg}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/10 text-left text-neutral-500">
              <th className="px-2 py-2 w-8"></th>
              <th className="px-2 py-2">Pair</th>
              <th className="px-2 py-2">Category</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Score</th>
              <th className="px-2 py-2">Recommendation</th>
              <th className="px-2 py-2">Signals</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((pair) => {
              const signals = pair.signalsJson ? JSON.parse(pair.signalsJson) : null;
              const checked = selectedCandidateIds.has(pair.id);
              const canSelect = pair.status !== 'promoted';
              return (
                <tr key={pair.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!canSelect}
                      onChange={() => toggleSelected(pair.id)}
                    />
                  </td>
                  <td className="px-2 py-2 font-medium text-white">
                    {pair.itemAName} <span className="text-neutral-500">vs</span> {pair.itemBName}
                  </td>
                  <td className="px-2 py-2 text-neutral-400">{pair.category}</td>
                  <td className="px-2 py-2">
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] uppercase ${
                      pair.status === 'scored' ? 'bg-indigo-500/15 text-indigo-300'
                      : pair.status === 'promoted' ? 'bg-green-500/15 text-green-300'
                      : pair.status === 'rejected' ? 'bg-red-500/15 text-red-300'
                      : 'bg-white/5 text-neutral-400'
                    }`}>
                      {pair.status}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    {typeof pair.demandScore === 'number' ? (
                      <span className={`rounded-md px-2 py-0.5 font-mono ${
                        pair.demandScore >= 8 ? 'bg-green-500/20 text-green-300'
                        : pair.demandScore >= 6 ? 'bg-indigo-500/20 text-indigo-300'
                        : pair.demandScore >= 4 ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-red-500/20 text-red-300'
                      }`}>
                        {pair.demandScore.toFixed(1)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-2 py-2 text-neutral-400">{pair.recommendation || '—'}</td>
                  <td className="px-2 py-2 text-[10px] text-neutral-500">
                    {signals && (
                      <span>
                        art:{signals.existing_articles_count} ·
                        rdt:{signals.has_reddit_discussion ? '✓' : '✗'} ·
                        auth:{signals.has_authoritative_source ? '✓' : '✗'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {candidates.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-xs text-neutral-500">
            No candidates yet. Add entities above, then click "Sync from Pool".
          </div>
        )}
      </div>
    </section>
  </div>
)}
```

- [ ] **Step 8.4: Lint check**

Run: `npm run lint 2>&1 | grep -v "App.tsx" | tail -10`

Expected: no new TS errors (existing App.tsx errors remain).

If TS errors appear from the new code, fix inline. Common issues:
- Missing icon export from lucide-react: pin version or pick an alternative icon
- Wrong type for `setCandidateStatusFilter`: cast `e.target.value as any` (already in code)

- [ ] **Step 8.5: Human smoke test**

Run dev server (use a different port to avoid clash with production):

```bash
pkill -f "tsx server/index.ts" 2>/dev/null; sleep 1
API_SERVER_PORT=3099 ADMIN_PASSWORD=smoketest npm run dev &
sleep 6
```

Open in browser: `http://localhost:5173/admin` (Vite dev server). Or, if dev server runs only the backend, navigate via reverse proxy URL.

Steps:
1. Login with password `smoketest`
2. Click `Pool` tab
3. Use CSV bulk import:
   ```
   name,category
   ChatGPT,AI Assistant
   Claude,AI Assistant
   Gemini,AI Assistant
   Grok,AI Assistant
   ```
4. Confirm 4 entities appear
5. Click `[Sync from Pool]` → expect message "6 new pairs added"
6. See 6 pair rows in pending status
7. Select 3 checkboxes → click `[Bulk Preflight]` → wait ~30-60s → scores appear
8. Select 1 high-score pair → click `[Bulk Promote]` → toast confirms 1 promoted
9. Pool tab reload — status of that pair = `promoted` (checkbox disabled)
10. Switch to Featured tab — see 1 new row with reportId=null

Stop server: `pkill -f "tsx server/index.ts"`

Report any UI bugs as part of this step. If everything works visually, commit.

- [ ] **Step 8.6: Commit**

```bash
git add src/admin/types.ts src/admin/adminApi.ts src/admin/AdminApp.tsx
git commit -m "$(cat <<'EOF'
feat(admin): Pool tab for bulk featured workflow

New Pool tab with three sections — Entity Pool (single add + CSV
bulk import + per-row delete), Candidate Pairs (sync + filter +
table with checkbox selection), and Bulk actions ([Bulk Preflight]
+ [Bulk Promote] with selection counter).

Smoke verified: 4 entities → 6 pairs → 3 preflighted → 1 promoted.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] EntityPoolStore + CSV parser → Task 1
- [x] CandidatePairStore (schema, sync, updateScore, markPromoted) → Task 2
- [x] Entity endpoints (4) → Task 3
- [x] Candidate sync + list endpoints → Task 4
- [x] mapConcurrent helper → Task 5 (Steps 5.1-5.4)
- [x] Bulk preflight endpoint → Task 5 (Steps 5.5-5.8)
- [x] Bulk promote endpoint → Task 6
- [x] Production wiring → Task 7
- [x] Real API concurrent test → Task 7
- [x] Admin UI Pool tab → Task 8
- [x] Human smoke test → Task 8 (Step 8.5)

**Out of scope (explicitly per spec):**
- Cron jobs / background workers
- Quality gate after Phase 1-4
- Tier system + GSC integration
- Streaming progress
- Cross-category pairs

## Execution

After plan approval, two execution paths:

**1. Subagent-Driven (recommended)** — fresh subagent per Task, two-stage review

**2. Inline Execution** — execute all 8 Tasks in this session

User previously chose Inline + autonomous (no per-cycle pause). Recommend continuing with Inline.
