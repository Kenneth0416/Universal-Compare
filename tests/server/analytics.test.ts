import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAnalyticsStore } from '../../server/analytics';

function createTempStore() {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'compareai-analytics-')), 'analytics.db');
  return createAnalyticsStore(dbPath, 'test-secret');
}

test('records a visitor, comparison run, and successful AI call', () => {
  const store = createTempStore();
  const visitor = store.ensureVisitor({
    visitorId: undefined,
    userAgent: 'Test Agent',
    ipAddress: '127.0.0.1',
  });

  assert.match(visitor.visitorId, /^v_/);
  assert.equal(visitor.isNew, true);

  const run = store.startComparisonRun({
    runId: 'run_1',
    visitorId: visitor.visitorId,
    itemA: 'iPhone',
    itemB: 'Pixel',
    language: 'en',
  });

  store.logAiCall({
    runId: run.runId,
    visitorId: visitor.visitorId,
    callType: 'chat',
    model: 'grok-4',
    status: 'success',
    statusCode: 200,
    durationMs: 42,
  });

  store.finishComparisonRun({
    runId: run.runId,
    visitorId: visitor.visitorId,
    status: 'completed',
  });

  const summary = store.getSummary();
  assert.equal(summary.today.users, 1);
  assert.equal(summary.today.comparisons, 1);
  assert.equal(summary.today.aiCalls, 1);
  assert.equal(summary.today.successRate, 100);
  assert.equal(summary.today.averageDurationMs, 42);

  const runs = store.listRuns({ limit: 10 });
  assert.equal(runs.items.length, 1);
  assert.equal(runs.items[0].runId, 'run_1');
  assert.equal(runs.items[0].callCount, 1);
  assert.equal(runs.items[0].status, 'completed');
});

test('records token usage and cost for AI calls', () => {
  const store = createTempStore();
  store.logAiCall({
    runId: 'run_usage',
    visitorId: 'v_usage',
    callType: 'chat',
    model: 'grok-4-1-fast-reasoning',
    status: 'success',
    statusCode: 200,
    durationMs: 80,
    promptTokens: 1000,
    completionTokens: 250,
    totalTokens: 1300,
    cachedTokens: 120,
    reasoningTokens: 50,
    costUsd: 0.0123456789,
    costSource: 'provider',
  });

  const calls = store.listCalls({ limit: 10 });
  assert.equal(calls.items.length, 1);
  assert.equal(calls.items[0].promptTokens, 1000);
  assert.equal(calls.items[0].completionTokens, 250);
  assert.equal(calls.items[0].totalTokens, 1300);
  assert.equal(calls.items[0].cachedTokens, 120);
  assert.equal(calls.items[0].reasoningTokens, 50);
  assert.equal(calls.items[0].costUsd, 0.0123456789);
  assert.equal(calls.items[0].costSource, 'provider');

  const summary = store.getSummary();
  assert.equal(summary.today.promptTokens, 1000);
  assert.equal(summary.today.completionTokens, 250);
  assert.equal(summary.today.totalTokens, 1300);
  assert.equal(summary.today.cachedTokens, 120);
  assert.equal(summary.today.reasoningTokens, 50);
  assert.equal(summary.today.aiCostUsd, 0.0123456789);
});

test('aggregates failed calls and popular comparisons', () => {
  const store = createTempStore();
  const visitor = store.ensureVisitor({
    visitorId: 'v_existing',
    userAgent: 'Test Agent',
    ipAddress: '127.0.0.1',
  });

  store.startComparisonRun({
    runId: 'run_failed',
    visitorId: visitor.visitorId,
    itemA: 'React',
    itemB: 'Vue',
    language: 'zh',
  });

  store.logAiCall({
    runId: 'run_failed',
    visitorId: visitor.visitorId,
    callType: 'responses',
    model: 'grok-4',
    status: 'error',
    statusCode: 500,
    durationMs: 120,
    errorMessage: 'Upstream failed',
  });

  store.finishComparisonRun({
    runId: 'run_failed',
    visitorId: visitor.visitorId,
    status: 'failed',
    errorMessage: 'Comparison failed',
  });

  // Add a completed run for recent comparisons test
  store.startComparisonRun({
    runId: 'run_completed',
    visitorId: visitor.visitorId,
    itemA: 'React',
    itemB: 'Vue',
    language: 'en',
  });
  store.finishComparisonRun({
    runId: 'run_completed',
    visitorId: visitor.visitorId,
    status: 'completed',
  });

  const summary = store.getSummary();
  assert.equal(summary.today.failedCalls, 1);
  assert.equal(summary.today.successRate, 0);
  assert.equal(summary.recentFailedCalls.length, 1);
  assert.equal(summary.recentFailedCalls[0].errorMessage, 'Upstream failed');

  const recentComparisons = store.getRecentComparisons();
  assert.equal(recentComparisons[0].itemA, 'React');
  assert.equal(recentComparisons[0].itemB, 'Vue');

  const users = store.listUsers({ limit: 10 });
  assert.equal(users.items.length, 1);
  assert.equal(users.items[0].comparisonCount, 2);
  assert.equal(users.items[0].aiCallCount, 1);
});
