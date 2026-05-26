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

test('candidatePairs: sync with 3 entities same category creates 3 pairs', () => {
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

test('candidatePairs: sync is idempotent', () => {
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
  featuredStore.addFeatured('chatgpt', 'CLAUDE');
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

  const high = candidateStore.listCandidates({ status: 'scored', minScore: 6 });
  assert.equal(high.items.length, 1);
  assert.equal(high.items[0].demandScore, 8);

  const pending = candidateStore.listCandidates({ status: 'pending' });
  assert.equal(pending.items.length, 1);
  assert.equal(pending.items[0].id, items[2].id);
});
