import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'node:http';
import { ADMIN_SESSION_COOKIE } from '../../server/adminAuth';
import { createAddressInfo } from './helpers';
import { createApp } from '../../server/app';
import { createAnalyticsStore } from '../../server/analytics';
import { createFeaturedStore } from '../../server/featured';
import { createReportStore } from '../../server/reports';

function createTestApp() {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'compareai-app-')), 'analytics.db');
  const analyticsStore = createAnalyticsStore(dbPath, 'test-secret');
  const reportStore = createReportStore(analyticsStore.getDb());
  const featuredStore = createFeaturedStore(analyticsStore.getDb());
  const app = createApp({
    analyticsStore,
    reportStore,
    featuredStore,
    adminPassword: 'admin-password',
    adminSessionSecret: 'session-secret',
    openai: {
      responses: {
        create: async () => ({ output_text: 'ok' }),
      },
      chat: {
        completions: {
          create: async () => ({ id: 'chatcmpl_test', choices: [] }),
        },
      },
    },
  });

  return { app, analyticsStore };
}

async function withServer<T>(app: ReturnType<typeof createApp>, callback: (baseUrl: string) => Promise<T>) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = createAddressInfo(server.address()).baseUrl;

  try {
    return await callback(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function extractCookie(setCookieHeader: string, name: string) {
  const match = setCookieHeader.match(new RegExp(`${name}=[^;,]+`));
  assert.ok(match, `Expected ${name} cookie in ${setCookieHeader}`);
  return match[0];
}

test('tracks comparison runs and logs AI proxy calls', async () => {
  const { app, analyticsStore } = createTestApp();

  await withServer(app, async (baseUrl) => {
    const startResponse = await fetch(`${baseUrl}/api/comparison-runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itemA: 'A', itemB: 'B', language: 'en' }),
    });
    assert.equal(startResponse.status, 200);
    const visitorCookie = extractCookie(startResponse.headers.get('set-cookie') || '', 'compareai_visitor_id');
    const { runId } = (await startResponse.json()) as { runId: string };
    assert.match(runId, /^run_/);

    const aiResponse = await fetch(`${baseUrl}/api/ai`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: visitorCookie,
      },
      body: JSON.stringify({ runId, callType: 'chat', params: { model: 'grok-test' } }),
    });
    assert.equal(aiResponse.status, 200);

    const finishResponse = await fetch(`${baseUrl}/api/comparison-runs/${runId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: visitorCookie,
      },
      body: JSON.stringify({ status: 'completed' }),
    });
    assert.equal(finishResponse.status, 200);
  });

  const summary = analyticsStore.getSummary();
  assert.equal(summary.today.users, 1);
  assert.equal(summary.today.comparisons, 1);
  assert.equal(summary.today.aiCalls, 1);
  assert.equal(summary.recentRuns[0].status, 'completed');
});

test('protects admin summary behind password login', async () => {
  const { app } = createTestApp();

  await withServer(app, async (baseUrl) => {
    const blocked = await fetch(`${baseUrl}/api/admin/summary`);
    assert.equal(blocked.status, 401);

    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'admin-password' }),
    });
    assert.equal(login.status, 200);
    const adminCookie = extractCookie(login.headers.get('set-cookie') || '', ADMIN_SESSION_COOKIE);
    assert.match(adminCookie, /compareai_admin_session=/);

    const summary = await fetch(`${baseUrl}/api/admin/summary`, {
      headers: { cookie: adminCookie },
    });
    assert.equal(summary.status, 200);
    assert.equal(typeof (await summary.json()), 'object');
  });
});
