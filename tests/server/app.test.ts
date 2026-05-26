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
import { DemandSensingError } from '../../server/demandSensing';
import { createEntityPoolStore } from '../../server/entityPool';
import { createCandidatePairStore } from '../../server/candidatePairs';

const defaultSiteUrl = 'https://compare-anythings.com';

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
  assert.equal(summary.today.cachedTokens, 0);
  assert.equal(summary.today.reasoningTokens, 0);
  assert.equal(summary.today.aiCostUsd, 0);
  assert.equal(summary.today.webSearchCount, 0);
  assert.equal(summary.today.xSearchCount, 0);
  assert.equal(summary.recentRuns[0].status, 'completed');

  const calls = analyticsStore.listCalls({ limit: 1 });
  assert.equal(calls.items[0].promptTokens, 100);
  assert.equal(calls.items[0].completionTokens, 25);
  assert.equal(calls.items[0].totalTokens, 130);
  assert.equal(calls.items[0].cachedTokens, 0);
  assert.equal(calls.items[0].reasoningTokens, 0);
  assert.equal(calls.items[0].costUsd, 0);
  assert.equal(calls.items[0].costSource, 'unavailable');
  assert.equal(calls.items[0].webSearchCount, 0);
  assert.equal(calls.items[0].xSearchCount, 0);
  assert.equal(calls.items[0].toolUsageJson, null);
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
    assert.match(html, /href="\/"/);
    assert.match(html, /Create your own comparison/);
    assert.match(html, /BreadcrumbList/);
    assert.match(html, /SearchAction/);
  });
});

test('does not expose comparison request capture endpoints', async () => {
  const { app } = createTestApp();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/comparison-requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itemA: 'Cursor', itemB: 'Windsurf' }),
    });
    assert.equal(response.status, 404);
  });
});

test('serves related comparison links on report pages', async () => {
  const { app, reportStore, featuredStore } = createTestApp();
  const current = reportStore.saveReport({
    itemA: 'Claude',
    itemB: 'ChatGPT',
    language: 'en',
    result: createComparisonResult('Claude', 'ChatGPT'),
  });
  const related = reportStore.saveReport({
    itemA: 'Perplexity',
    itemB: 'ChatGPT',
    language: 'en',
    result: createComparisonResult('Perplexity', 'ChatGPT'),
  });
  assert.ok(current);
  assert.ok(related);
  featuredStore.addFeatured('Claude', 'ChatGPT', {
    language: 'en',
    description: 'Featured AI assistant comparison.',
    reportId: current.reportId,
  });
  featuredStore.addFeatured('Perplexity', 'ChatGPT', {
    language: 'en',
    description: 'Compare AI search and general chat workflows.',
    reportId: related.reportId,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/compare/claude-vs-chatgpt`);
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.match(html, /Related AI comparisons/);
    assert.match(html, /href="\/compare\/perplexity-vs-chatgpt"/);
    assert.match(html, /Perplexity <span>vs<\/span> ChatGPT/);
    assert.doesNotMatch(html, /href="\/compare\/claude-vs-chatgpt"/);
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
    assert.match(xml, new RegExp(`<loc>${defaultSiteUrl}/popular-ai-comparisons</loc>`));
    assert.match(xml, new RegExp(`<loc>${defaultSiteUrl}/compare/claude-vs-chatgpt</loc>`));
    assert.doesNotMatch(xml, new RegExp(featured.reportId));
    assert.doesNotMatch(xml, new RegExp(privateReport.reportId));
  });
});

test('serves a crawlable popular AI comparisons page', async () => {
  const { app, reportStore, featuredStore } = createTestApp();
  const claude = reportStore.saveReport({
    itemA: 'Claude',
    itemB: 'ChatGPT',
    language: 'en',
    result: createComparisonResult('Claude', 'ChatGPT'),
  });
  const cursor = reportStore.saveReport({
    itemA: 'Cursor',
    itemB: 'Windsurf',
    language: 'en',
    result: createComparisonResult('Cursor', 'Windsurf'),
  });
  assert.ok(claude);
  assert.ok(cursor);
  featuredStore.addFeatured('Claude', 'ChatGPT', {
    language: 'en',
    description: 'Compare AI assistants for writing, research, and coding.',
    reportId: claude.reportId,
  });
  featuredStore.addFeatured('Cursor', 'Windsurf', {
    language: 'en',
    description: 'Compare AI coding editors for developer workflows.',
    reportId: cursor.reportId,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/popular-ai-comparisons`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    const html = await response.text();

    assert.match(html, /<title>Popular AI Comparisons \| CompareAI<\/title>/);
    assert.match(html, /<link rel="canonical" href="https:\/\/compare-anythings\.com\/popular-ai-comparisons" \/>/);
    assert.match(html, /<h1>Popular AI Comparisons<\/h1>/);
    assert.match(html, /href="\/compare\/claude-vs-chatgpt"/);
    assert.match(html, /href="\/compare\/cursor-vs-windsurf"/);
  });
});

test('serves an empty state on the popular comparisons page before featured reports exist', async () => {
  const { app } = createTestApp();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/popular-ai-comparisons`);
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.match(html, /<h1>Popular AI Comparisons<\/h1>/);
    assert.match(html, /New public comparison reports will appear here soon/);
  });
});

test('deduplicates featured comparison slugs with stable numeric suffixes', () => {
  const { featuredStore } = createTestApp();

  const first = featuredStore.addFeatured('Claude', 'ChatGPT');
  const second = featuredStore.addFeatured('Claude', 'ChatGPT');

  assert.equal(first.slug, 'claude-vs-chatgpt');
  assert.equal(second.slug, 'claude-vs-chatgpt-2');
});

async function loginAsAdmin(baseUrl: string): Promise<string> {
  const resp = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'admin-password' }),
  });
  assert.equal(resp.status, 200);
  return extractCookie(resp.headers.get('set-cookie') || '', ADMIN_SESSION_COOKIE);
}

test('POST /api/admin/featured/preflight requires admin auth', async () => {
  const { app } = createTestApp();
  await withServer(app, async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/api/admin/featured/preflight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itemA: 'A', itemB: 'B', language: 'en' }),
    });
    assert.equal(resp.status, 401);
  });
});

test('POST /api/admin/featured/preflight: 200 with DemandSenseResult', async () => {
  const mockResult = {
    score: 8,
    recommendation: 'good',
    signals: {
      existing_articles_count: 5,
      has_reddit_discussion: true,
      has_authoritative_source: true,
      competition_level: 'medium',
      freshness: 'fresh',
    },
    reasoning: 'Strong demand.',
    topSources: [{ url: 'https://example.com', title: 'Test' }],
    partial: false,
    metrics: { durationMs: 1000, totalTokens: 200 },
  };
  const { app } = createTestApp({
    demandSensingService: { scorePair: async () => mockResult },
  });

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAsAdmin(baseUrl);
    const resp = await fetch(`${baseUrl}/api/admin/featured/preflight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ itemA: 'ChatGPT', itemB: 'Claude', language: 'en' }),
    });
    assert.equal(resp.status, 200);
    const body = (await resp.json()) as any;
    assert.equal(body.score, 8);
    assert.equal(body.recommendation, 'good');
    assert.equal(body.signals.existing_articles_count, 5);
  });
});

test('POST /api/admin/featured/preflight: 400 when itemA missing', async () => {
  const { app } = createTestApp({
    demandSensingService: {
      scorePair: async () => {
        throw new DemandSensingError('itemA and itemB must be non-empty strings', 400);
      },
    },
  });

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAsAdmin(baseUrl);
    const resp = await fetch(`${baseUrl}/api/admin/featured/preflight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ itemB: 'Claude', language: 'en' }),
    });
    assert.equal(resp.status, 400);
  });
});

test('POST /api/admin/featured/preflight: 502 when service throws DemandSensingError(502)', async () => {
  const { app } = createTestApp({
    demandSensingService: {
      scorePair: async () => {
        throw new DemandSensingError('upstream failed', 502);
      },
    },
  });

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAsAdmin(baseUrl);
    const resp = await fetch(`${baseUrl}/api/admin/featured/preflight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ itemA: 'A', itemB: 'B', language: 'en' }),
    });
    assert.equal(resp.status, 502);
    const body = (await resp.json()) as any;
    assert.match(body.error, /upstream failed/);
  });
});

test('POST /api/admin/featured/preflight: 503 when service not configured', async () => {
  const { app } = createTestApp();
  await withServer(app, async (baseUrl) => {
    const cookie = await loginAsAdmin(baseUrl);
    const resp = await fetch(`${baseUrl}/api/admin/featured/preflight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ itemA: 'A', itemB: 'B', language: 'en' }),
    });
    assert.equal(resp.status, 503);
  });
});

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
    assert.equal(body.skipped.length, 1);
    assert.equal(body.skipped[0].reason, 'duplicate');
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
      scorePair: async (a: string, b: string) => {
        if (a === 'C' || b === 'C') throw new Error('intentional fail');
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
    assert.equal(errors.length, 2);
    assert.equal(scored.length, 1);
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

    assert.equal(candidateStore.getCandidate(ids[0])!.status, 'promoted');
    assert.equal(candidateStore.getCandidate(ids[1])!.status, 'promoted');

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
