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

test('parseEntityCsv: skips empty lines, trims, drops invalid', () => {
  const csv = '\n  ChatGPT , AI  \n\n,AI\nNotion,\nValid,Cat\n';
  const result = parseEntityCsv(csv);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].name, 'ChatGPT');
  assert.equal(result.items[0].category, 'AI');
  assert.equal(result.items[1].name, 'Valid');
  assert.equal(result.rejectedRows, 2);
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
