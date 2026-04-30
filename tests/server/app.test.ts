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

const defaultSiteUrl = 'https://compare-anythings.com';

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
          create: async () => ({
            id: 'chatcmpl_test',
            choices: [],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 25,
              total_tokens: 130,
              prompt_tokens_details: { cached_tokens: 10 },
              completion_tokens_details: { reasoning_tokens: 5 },
              cost_in_usd_ticks: 2_500_000,
              server_side_tool_usage_details: {
                web_search_calls: 2,
                x_search_calls: 1,
              },
            },
          }),
        },
      },
    },
  });

  return { app, analyticsStore, reportStore, featuredStore };
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

function createComparisonResult(itemA = 'Claude', itemB = 'ChatGPT') {
  return {
    entityA: { name: itemA },
    entityB: { name: itemB },
    relationship: {
      relationship_type: 'alternatives',
      comparison_goal: `Choose between ${itemA} and ${itemB}`,
      reasoning: 'Both tools can be evaluated as AI assistants.',
    },
    dimensions: [
      {
        key: 'reasoning',
        label: 'Reasoning quality',
        why_it_matters: 'Reasoning quality affects complex decisions.',
        analysis: {
          item_a_summary: `${itemA} is strong for careful written analysis.`,
          item_b_summary: `${itemB} is strong for broad everyday tasks.`,
          key_difference: `${itemA} favors depth while ${itemB} favors versatility.`,
        },
      },
    ],
    prosCons: {
      item_a_pros: ['Careful long-form answers'],
      item_a_cons: ['Less familiar to some users'],
      item_b_pros: ['Broad ecosystem'],
      item_b_cons: ['Can be less focused'],
    },
    recommendation: {
      short_verdict: `${itemA} is better for careful analysis.`,
      long_verdict: `Choose ${itemA} for deep reasoning and ${itemB} for broad daily workflows.`,
    },
  };
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
  assert.equal(summary.today.promptTokens, 100);
  assert.equal(summary.today.completionTokens, 25);
  assert.equal(summary.today.totalTokens, 130);
  assert.equal(summary.today.cachedTokens, 10);
  assert.equal(summary.today.reasoningTokens, 5);
  assert.equal(summary.today.aiCostUsd, 0.00025);
  assert.equal(summary.today.webSearchCount, 2);
  assert.equal(summary.today.xSearchCount, 1);
  assert.equal(summary.recentRuns[0].status, 'completed');

  const calls = analyticsStore.listCalls({ limit: 1 });
  assert.equal(calls.items[0].promptTokens, 100);
  assert.equal(calls.items[0].completionTokens, 25);
  assert.equal(calls.items[0].totalTokens, 130);
  assert.equal(calls.items[0].cachedTokens, 10);
  assert.equal(calls.items[0].reasoningTokens, 5);
  assert.equal(calls.items[0].costUsd, 0.00025);
  assert.equal(calls.items[0].costSource, 'provider');
  assert.equal(calls.items[0].webSearchCount, 2);
  assert.equal(calls.items[0].xSearchCount, 1);
  assert.equal(calls.items[0].toolUsageJson, '{"web_search_calls":2,"x_search_calls":1}');
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

test('returns linked report view counts for admin featured comparisons', async () => {
  const { app } = createTestApp();

  await withServer(app, async (baseUrl) => {
    const reportResponse = await fetch(`${baseUrl}/api/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        itemA: 'Claude',
        itemB: 'ChatGPT',
        language: 'en',
        result: {
          entityA: { name: 'Claude' },
          entityB: { name: 'ChatGPT' },
          dimensions: [],
          recommendation: { winner: 'tie' },
        },
      }),
    });
    assert.equal(reportResponse.status, 201);
    const { reportId } = (await reportResponse.json()) as { reportId: string };

    assert.equal((await fetch(`${baseUrl}/api/reports/${reportId}`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/reports/${reportId}`)).status, 200);

    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'admin-password' }),
    });
    assert.equal(login.status, 200);
    const adminCookie = extractCookie(login.headers.get('set-cookie') || '', ADMIN_SESSION_COOKIE);

    const featuredResponse = await fetch(`${baseUrl}/api/admin/featured`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: adminCookie,
      },
      body: JSON.stringify({
        itemA: 'Claude',
        itemB: 'ChatGPT',
        language: 'en',
        description: '',
        reportId,
      }),
    });
    assert.equal(featuredResponse.status, 201);

    const listResponse = await fetch(`${baseUrl}/api/admin/featured`, {
      headers: { cookie: adminCookie },
    });
    assert.equal(listResponse.status, 200);
    const featured = (await listResponse.json()) as { items: Array<{ reportId: string; slug: string; viewCount: number }> };
    assert.equal(featured.items[0].reportId, reportId);
    assert.equal(featured.items[0].slug, 'claude-vs-chatgpt');
    assert.equal(featured.items[0].viewCount, 2);
  });
});

test('serves featured report pages at crawlable comparison slugs', async () => {
  const { app, reportStore, featuredStore } = createTestApp();
  const saved = reportStore.saveReport({
    itemA: 'Claude',
    itemB: 'ChatGPT',
    language: 'en',
    result: createComparisonResult('Claude', 'ChatGPT'),
  });
  assert.ok(saved);
  featuredStore.addFeatured('Claude', 'ChatGPT', {
    language: 'en',
    description: 'Compare Claude and ChatGPT for AI writing, research, and reasoning workflows.',
    reportId: saved.reportId,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/compare/claude-vs-chatgpt`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    const html = await response.text();

    assert.match(html, /<title>Claude vs ChatGPT: AI Comparison Report \| CompareAI<\/title>/);
    assert.match(html, /<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large" \/>/);
    assert.match(html, new RegExp(`<link rel="canonical" href="${defaultSiteUrl}/compare/claude-vs-chatgpt" />`));
    assert.match(html, /<meta property="og:title" content="Claude vs ChatGPT: AI Comparison Report \| CompareAI" \/>/);
    assert.match(html, new RegExp(`<meta property="og:url" content="${defaultSiteUrl}/compare/claude-vs-chatgpt" />`));
    assert.match(html, /Compare Claude and ChatGPT for AI writing, research, and reasoning workflows/);
    assert.match(html, /<h1>Claude <span>vs<\/span> ChatGPT<\/h1>/);
    assert.match(html, /Reasoning quality/);
    assert.match(html, /BreadcrumbList/);
    assert.match(html, /SearchAction/);
  });
});

test('redirects legacy report ids to their featured comparison slug', async () => {
  const { app, reportStore, featuredStore } = createTestApp();
  const saved = reportStore.saveReport({
    itemA: 'Claude',
    itemB: 'ChatGPT',
    language: 'en',
    result: createComparisonResult('Claude', 'ChatGPT'),
  });
  assert.ok(saved);
  featuredStore.addFeatured('Claude', 'ChatGPT', {
    language: 'en',
    description: 'Featured AI assistant comparison.',
    reportId: saved.reportId,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/r/${saved.reportId}`, { redirect: 'manual' });

    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), '/compare/claude-vs-chatgpt');
  });
});

test('keeps non-featured generated reports out of the search index', async () => {
  const { app, reportStore } = createTestApp();
  const saved = reportStore.saveReport({
    itemA: 'Private Tool A',
    itemB: 'Private Tool B',
    language: 'en',
    result: createComparisonResult('Private Tool A', 'Private Tool B'),
  });
  assert.ok(saved);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/r/${saved.reportId}`);
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.match(html, /<meta name="robots" content="noindex, follow" \/>/);
    assert.match(html, /Private Tool A vs Private Tool B/);
  });
});

test('serves a dynamic sitemap that includes only homepage and featured reports', async () => {
  const { app, reportStore, featuredStore } = createTestApp();
  const featured = reportStore.saveReport({
    itemA: 'Claude',
    itemB: 'ChatGPT',
    language: 'en',
    result: createComparisonResult('Claude', 'ChatGPT'),
  });
  const privateReport = reportStore.saveReport({
    itemA: 'Internal A',
    itemB: 'Internal B',
    language: 'en',
    result: createComparisonResult('Internal A', 'Internal B'),
  });
  assert.ok(featured);
  assert.ok(privateReport);
  featuredStore.addFeatured('Claude', 'ChatGPT', {
    language: 'en',
    description: 'Featured AI assistant comparison.',
    reportId: featured.reportId,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/sitemap.xml`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /xml/);
    const xml = await response.text();

    assert.match(xml, new RegExp(`<loc>${defaultSiteUrl}/</loc>`));
    assert.match(xml, new RegExp(`<loc>${defaultSiteUrl}/compare/claude-vs-chatgpt</loc>`));
    assert.doesNotMatch(xml, new RegExp(featured.reportId));
    assert.doesNotMatch(xml, new RegExp(privateReport.reportId));
  });
});

test('deduplicates featured comparison slugs with stable numeric suffixes', () => {
  const { featuredStore } = createTestApp();

  const first = featuredStore.addFeatured('Claude', 'ChatGPT');
  const second = featuredStore.addFeatured('Claude', 'ChatGPT');

  assert.equal(first.slug, 'claude-vs-chatgpt');
  assert.equal(second.slug, 'claude-vs-chatgpt-2');
});
