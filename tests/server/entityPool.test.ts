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

test('entityPool: duplicate uniqueness is case-insensitive', () => {
  const store = makeStore();
  store.addEntity('ChatGPT', 'AI Assistant');
  assert.throws(() => store.addEntity('chatgpt', 'ai assistant'), /duplicate/i);
});

test('entityPool: Unicode case variants share the same normalized identity', () => {
  const store = makeStore();
  store.addEntity('Éclair', 'Dessert');
  assert.throws(() => store.addEntity('éclair', 'dessert'), /duplicate/i);
});

test('entityPool: safely migrates legacy case-variant duplicates', () => {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'entity-migration-')), 'analytics.db');
  const analyticsStore = createAnalyticsStore(dbPath, 'test-secret');
  const db = analyticsStore.getDb();
  db.exec(`
    CREATE TABLE entity_pool (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(name, category)
    )
  `);
  db.prepare('INSERT INTO entity_pool (name, category, created_at) VALUES (?, ?, ?)')
    .run('ChatGPT', 'AI', new Date().toISOString());
  db.prepare('INSERT INTO entity_pool (name, category, created_at) VALUES (?, ?, ?)')
    .run('chatgpt', 'ai', new Date().toISOString());

  const store = createEntityPoolStore(db);
  assert.equal(store.listEntities().length, 1);
  assert.throws(() => store.addEntity('CHATGPT', 'AI'), /duplicate/i);
});

test('entityPool: migration remaps candidate references and preserves promoted collisions', () => {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'entity-candidate-migration-')), 'analytics.db');
  const db = createAnalyticsStore(dbPath, 'test-secret').getDb();
  db.exec(`
    CREATE TABLE entity_pool (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(name, category)
    );
    CREATE TABLE candidate_pairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_a_id INTEGER NOT NULL,
      entity_b_id INTEGER NOT NULL,
      item_a_name TEXT NOT NULL,
      item_b_name TEXT NOT NULL,
      status TEXT NOT NULL,
      UNIQUE(entity_a_id, entity_b_id),
      CHECK(entity_a_id < entity_b_id)
    );
  `);
  const insertEntity = db.prepare('INSERT INTO entity_pool (name, category, created_at) VALUES (?, ?, ?)');
  insertEntity.run('Alpha', 'X', new Date().toISOString());
  insertEntity.run('alpha', 'x', new Date().toISOString());
  insertEntity.run('Beta', 'X', new Date().toISOString());
  db.prepare(`
    INSERT INTO candidate_pairs (entity_a_id, entity_b_id, item_a_name, item_b_name, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(1, 3, 'Alpha', 'Beta', 'pending');
  db.prepare(`
    INSERT INTO candidate_pairs (entity_a_id, entity_b_id, item_a_name, item_b_name, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(2, 3, 'alpha', 'Beta', 'promoted');

  createEntityPoolStore(db);
  const rows = db.prepare(`
    SELECT entity_a_id AS entityAId, entity_b_id AS entityBId, status
    FROM candidate_pairs
  `).all();
  assert.deepEqual(rows, [{ entityAId: 1, entityBId: 3, status: 'promoted' }]);
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
    { name: 'ChatGPT', category: 'AI Assistant' },
    { name: 'Claude', category: 'AI Assistant' },
    { name: '', category: 'AI Assistant' },
    { name: 'Gemini', category: '' },
    { name: 'Grok', category: 'AI Assistant' },
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
  assert.equal(store.removeEntity(e.id), false);
  assert.equal(store.removeEntity(99999), false);
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

test('parseEntityCsv: accepts a UTF-8 BOM on the exact header', () => {
  assert.deepEqual(parseEntityCsv('\uFEFFname,category\nChatGPT,AI').items, [
    { name: 'ChatGPT', category: 'AI' },
  ]);
});

test('parseEntityCsv: parses quoted commas, escaped quotes, and embedded newlines', () => {
  const csv = 'name,category\n"Acme, Inc.","Business ""Suite"""\n"Line\nBreak",Other';
  const result = parseEntityCsv(csv);
  assert.deepEqual(result, {
    items: [
      { name: 'Acme, Inc.', category: 'Business "Suite"' },
      { name: 'Line\nBreak', category: 'Other' },
    ],
    rejectedRows: 0,
  });
});

test('parseEntityCsv: only skips an exact recognized header', () => {
  const result = parseEntityCsv('nameplate,category theory\nValid,Cat');
  assert.deepEqual(result.items, [
    { name: 'nameplate', category: 'category theory' },
    { name: 'Valid', category: 'Cat' },
  ]);
  assert.equal(parseEntityCsv('name,category,extra\nValid,Cat').rejectedRows, 1);
});

test('parseEntityCsv: rejects malformed quoting and extra columns', () => {
  const result = parseEntityCsv('"Unclosed,Category\nGood,Cat,Extra');
  assert.equal(result.items.length, 0);
  assert.equal(result.rejectedRows, 1);
});

test('parseEntityCsv: skips empty lines, trims, drops invalid', () => {
  const csv = '\n  ChatGPT , AI  \n\n,AI\nNotion,\nValid,Cat\n';
  const result = parseEntityCsv(csv);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].name, 'ChatGPT');
  assert.equal(result.items[0].category, 'AI');
  assert.equal(result.items[1].name, 'Valid');
  assert.equal(result.rejectedRows, 2);
});

test('parseEntityCsv: counts delimiter-only records as rejected', () => {
  assert.deepEqual(parseEntityCsv('name,category\n,'), { items: [], rejectedRows: 1 });
  assert.deepEqual(parseEntityCsv('name,category\n"",""'), { items: [], rejectedRows: 1 });
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
