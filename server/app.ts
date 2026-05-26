import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  ADMIN_SESSION_COOKIE,
  createAdminSessionToken,
  getAdminSessionCookieOptions,
  parseCookieHeader,
  verifyAdminSessionToken,
} from './adminAuth';
import { extractAiUsageMetrics } from './aiUsage';
import type { createAnalyticsStore } from './analytics';
import type { createFeaturedStore } from './featured';
import type { createReportStore } from './reports';
import { generateOgImage } from './og';
import {
  renderAboutHtml,
  renderHomepageHtml,
  renderLlmsTxt,
  renderMethodologyHtml,
  renderPopularComparisonsHtml,
  renderPrivacyPolicyHtml,
  renderReportNotFoundHtml,
  renderReportSeoHtml,
  renderRobotsTxt,
  renderSitemapXml,
  renderTermsHtml,
} from './seo';
import type { AIProvider } from './providers/types';
import { DemandSensingError, type DemandSensingService } from './demandSensing';
import { parseEntityCsv, type EntityPoolStore } from './entityPool';
import type { CandidatePairStore } from './candidatePairs';

const VISITOR_COOKIE = 'compareai_visitor_id';
const VISITOR_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

type AnalyticsStore = ReturnType<typeof createAnalyticsStore>;
type ReportStore = ReturnType<typeof createReportStore>;
type FeaturedStore = ReturnType<typeof createFeaturedStore>;

type RequestWithVisitor = Request & {
  visitorId?: string;
};

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

function getRequestIp(req: Request) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function getQueryNumber(value: unknown, fallback: number) {
  const firstValue = Array.isArray(value) ? value[0] : value;
  const parsed = Number(firstValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isAdminPasswordValid(input: unknown, adminPassword: string) {
  if (typeof input !== 'string' || !adminPassword) return false;
  const left = Buffer.from(input);
  const right = Buffer.from(adminPassword);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function readClientIndexHtml() {
  const distIndex = path.resolve(process.cwd(), 'dist', 'index.html');
  const sourceIndex = path.resolve(process.cwd(), 'index.html');
  const indexPath = existsSync(distIndex) ? distIndex : sourceIndex;
  return readFileSync(indexPath, 'utf8');
}

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
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  app.get('/robots.txt', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('text/plain').send(renderRobotsTxt(siteUrl));
  });

  app.get('/sitemap.xml', (_req, res) => {
    const seenReportIds = new Set<string>();
    const reports = featuredStore
      .listFeatured()
      .flatMap((item) => {
        if (!item.reportId || seenReportIds.has(item.reportId)) return [];
        seenReportIds.add(item.reportId);
        const report = reportStore.getReport(item.reportId);
        return report ? [{ slug: item.slug, createdAt: report.createdAt }] : [];
      });

    res.set('Cache-Control', 'public, max-age=3600');
    res.type('application/xml').send(renderSitemapXml(reports, siteUrl));
  });

  app.get('/llms.txt', (_req, res) => {
    const featured = featuredStore.listFeatured();
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('text/plain; charset=utf-8').send(renderLlmsTxt({ featured, siteUrl }));
  });

  const listPublicFeaturedComparisons = (language = 'en') =>
    featuredStore
      .listFeatured(language)
      .filter((item) => item.reportId && item.slug);

  app.get('/', (_req, res) => {
    const indexHtml = readClientIndexHtml();
    res.set('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600');
    res.type('text/html').send(
      renderHomepageHtml({
        indexHtml,
        siteUrl,
        featuredComparisons: listPublicFeaturedComparisons('en').slice(0, 8),
      }),
    );
  });

  app.get('/methodology', (_req, res) => {
    const indexHtml = readClientIndexHtml();
    const { total: totalReports } = reportStore.listReports({ limit: 1 });
    const totalFeatured = featuredStore.listFeatured().length;
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('text/html').send(
      renderMethodologyHtml({
        indexHtml,
        siteUrl,
        stats: { totalReports, totalFeatured },
      }),
    );
  });

  app.get('/about', (_req, res) => {
    const indexHtml = readClientIndexHtml();
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('text/html').send(renderAboutHtml({ indexHtml, siteUrl }));
  });

  app.get('/privacy', (_req, res) => {
    const indexHtml = readClientIndexHtml();
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('text/html').send(renderPrivacyPolicyHtml({ indexHtml, siteUrl }));
  });

  app.get('/terms', (_req, res) => {
    const indexHtml = readClientIndexHtml();
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('text/html').send(renderTermsHtml({ indexHtml, siteUrl }));
  });

  app.get('/popular-ai-comparisons', (_req, res) => {
    const indexHtml = readClientIndexHtml();
    res.set('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600');
    res.type('text/html').send(
      renderPopularComparisonsHtml({
        comparisons: listPublicFeaturedComparisons('en'),
        indexHtml,
        siteUrl,
      }),
    );
  });

  app.get('/og/:slug.png', async (req, res) => {
    try {
      const png = await generateOgImage(req.params.slug, reportStore, featuredStore);
      if (!png) {
        res.status(404).end();
        return;
      }
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
      res.send(png);
    } catch {
      res.status(500).end();
    }
  });

  app.get('/compare/:slug', (req, res) => {
    const indexHtml = readClientIndexHtml();
    const featured = featuredStore.getFeaturedBySlug(req.params.slug);
    const report = featured?.reportId ? reportStore.getReport(featured.reportId) : null;

    if (!featured || !report) {
      res.set('Cache-Control', 'public, max-age=60, s-maxage=60');
      res.status(404).type('text/html').send(renderReportNotFoundHtml(indexHtml, siteUrl));
      return;
    }

    const feedbackStats = reportStore.getFeedbackStats(report.reportId);
    res.set('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
    res.type('text/html').send(
      renderReportSeoHtml({
        report,
        featured,
        indexHtml,
        siteUrl,
        feedbackStats,
        relatedComparisons: listPublicFeaturedComparisons(report.language || featured.language || 'en')
          .filter((item) => item.slug !== featured.slug)
          .slice(0, 6),
      }),
    );
  });

  app.get('/r/:reportId', (req, res) => {
    const indexHtml = readClientIndexHtml();
    const report = reportStore.getReport(req.params.reportId);

    if (!report) {
      res.set('Cache-Control', 'public, max-age=60, s-maxage=60');
      res.status(404).type('text/html').send(renderReportNotFoundHtml(indexHtml, siteUrl));
      return;
    }

    const featured = featuredStore.getFeaturedByReportId(report.reportId);
    if (featured) {
      res.redirect(301, `/compare/${featured.slug}`);
      return;
    }

    const feedbackStats = reportStore.getFeedbackStats(report.reportId);
    res.set('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
    res.type('text/html').send(
      renderReportSeoHtml({
        report,
        featured,
        indexHtml,
        siteUrl,
        feedbackStats,
      }),
    );
  });

  app.use('/api', (req: RequestWithVisitor, res, next) => {
    try {
      const cookies = parseCookieHeader(req.headers.cookie);
      const visitor = analyticsStore.ensureVisitor({
        visitorId: cookies[VISITOR_COOKIE],
        userAgent: req.get('user-agent') || '',
        ipAddress: getRequestIp(req),
      });

      req.visitorId = visitor.visitorId;
      if (!cookies[VISITOR_COOKIE] || visitor.isNew) {
        res.cookie(VISITOR_COOKIE, visitor.visitorId, {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          maxAge: VISITOR_MAX_AGE_MS,
          path: '/',
        });
      }
    } catch (error) {
      console.warn('Visitor tracking failed:', error);
    }

    next();
  });

  app.post('/api/comparison-runs', (req: RequestWithVisitor, res) => {
    const { runId, itemA, itemB, language } = req.body || {};

    if (typeof itemA !== 'string' || typeof itemB !== 'string' || !itemA.trim() || !itemB.trim()) {
      res.status(400).json({ error: 'Missing comparison items' });
      return;
    }

    const run = analyticsStore.startComparisonRun({
      runId: typeof runId === 'string' ? runId : undefined,
      visitorId: req.visitorId || '',
      itemA,
      itemB,
      language: typeof language === 'string' ? language : 'en',
    });

    res.json(run);
  });

  app.patch('/api/comparison-runs/:runId', (req: RequestWithVisitor, res) => {
    const { status, errorMessage } = req.body || {};

    if (status !== 'completed' && status !== 'failed') {
      res.status(400).json({ error: 'Invalid run status' });
      return;
    }

    analyticsStore.finishComparisonRun({
      runId: req.params.runId,
      visitorId: req.visitorId,
      status,
      errorMessage: typeof errorMessage === 'string' ? errorMessage : undefined,
    });

    res.json({ ok: true });
  });

  app.get('/api/suggestions', (req, res) => {
    try {
      const lang = typeof req.query.lang === 'string' ? req.query.lang : undefined;
      const featured = featuredStore.listFeatured(lang);
      const recent = analyticsStore.getRecentComparisons();
      res.json({ featured, recent });
    } catch {
      res.json({ featured: [], recent: [] });
    }
  });

  app.get('/api/popular-comparisons', (req, res) => {
    try {
      const lang = typeof req.query.lang === 'string' ? req.query.lang : 'en';
      res.json({ items: listPublicFeaturedComparisons(lang) });
    } catch {
      res.json({ items: [] });
    }
  });

  app.post('/api/ai', async (req: RequestWithVisitor, res) => {
    const { callType, params, runId } = req.body || {};

    if (!callType || !params) {
      res.status(400).json({ error: 'Missing callType or params' });
      return;
    }

    const startedAt = Date.now();
    const resolvedRunId = typeof runId === 'string' ? runId : undefined;

    try {
      let response: unknown;
      let model = '';

      switch (callType) {
        case 'responses': {
          const input = params.input || [];
          const tools = params.tools || [];
          const result = await provider.research('', {
            input,
            tools,
            tool_choice: params.tool_choice,
          });
          model = result.metrics.model;
          response = { output_text: result.text, sources: result.sources };
          break;
        }

        case 'chat': {
          const result = await provider.chatCompletion({
            messages: params.messages || [],
            schema: params.response_format?.json_schema?.schema || {},
            schemaName: params.response_format?.json_schema?.name || 'response',
            temperature: params.temperature,
          });
          model = result.metrics.model;
          response = {
            choices: [{ message: { content: result.json } }],
            usage: {
              prompt_tokens: result.metrics.promptTokens,
              completion_tokens: result.metrics.completionTokens,
              total_tokens: result.metrics.totalTokens,
            },
          };
          break;
        }

        default:
          res.status(400).json({ error: `Unknown callType: ${callType}` });
          return;
      }

      analyticsStore.logAiCall({
        runId: resolvedRunId,
        visitorId: req.visitorId,
        callType,
        model,
        status: 'success',
        statusCode: 200,
        durationMs: Date.now() - startedAt,
        ...extractAiUsageMetrics(response, model),
      });

      res.json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI API call failed';
      console.error('AI API error:', error);
      analyticsStore.logAiCall({
        runId: resolvedRunId,
        visitorId: req.visitorId,
        callType,
        model: '',
        status: 'error',
        statusCode: 500,
        durationMs: Date.now() - startedAt,
        errorMessage: message,
      });

      res.status(500).json({ error: message });
    }
  });

  app.post('/api/admin/login', (req, res) => {
    if (!adminPassword) {
      res.status(503).json({ error: 'Admin password is not configured' });
      return;
    }

    if (!isAdminPasswordValid(req.body?.password, adminPassword)) {
      res.status(401).json({ error: 'Invalid password' });
      return;
    }

    const token = createAdminSessionToken(adminSessionSecret);
    res.cookie(ADMIN_SESSION_COOKIE, token, getAdminSessionCookieOptions());
    res.json({ authenticated: true });
  });

  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    const cookies = parseCookieHeader(req.headers.cookie);
    if (!verifyAdminSessionToken(cookies[ADMIN_SESSION_COOKIE], adminSessionSecret)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  };

  app.use('/api/admin', requireAdmin);

  app.post('/api/admin/logout', (_req, res) => {
    res.clearCookie(ADMIN_SESSION_COOKIE, getAdminSessionCookieOptions(0));
    res.json({ authenticated: false });
  });

  app.get('/api/admin/session', (_req, res) => {
    res.json({ authenticated: true });
  });

  app.get('/api/admin/summary', (req, res) => {
    const period = req.query.period ? Number(req.query.period) : 1;
    res.json(analyticsStore.getSummary(period || 1));
  });

  app.get('/api/admin/runs', (req, res) => {
    res.json(
      analyticsStore.listRuns({
        limit: getQueryNumber(req.query.limit, 50),
        offset: getQueryNumber(req.query.offset, 0),
      }),
    );
  });

  app.get('/api/admin/calls', (req, res) => {
    const status = req.query.status === 'success' || req.query.status === 'error' ? req.query.status : undefined;
    res.json(
      analyticsStore.listCalls({
        limit: getQueryNumber(req.query.limit, 50),
        offset: getQueryNumber(req.query.offset, 0),
        status,
      }),
    );
  });

  app.get('/api/admin/users', (req, res) => {
    res.json(
      analyticsStore.listUsers({
        limit: getQueryNumber(req.query.limit, 50),
        offset: getQueryNumber(req.query.offset, 0),
      }),
    );
  });

  // --- Featured comparisons (admin) ---

  app.get('/api/admin/featured', (_req, res) => {
    res.json({ items: featuredStore.listFeatured() });
  });

  app.post('/api/admin/featured', (req, res) => {
    const { itemA, itemB, language, description, reportId } = req.body || {};

    if (typeof itemA !== 'string' || typeof itemB !== 'string' || !itemA.trim() || !itemB.trim()) {
      res.status(400).json({ error: 'Missing itemA or itemB' });
      return;
    }

    const created = featuredStore.addFeatured(itemA.trim(), itemB.trim(), {
      language: typeof language === 'string' ? language : 'en',
      description: typeof description === 'string' ? description : '',
      reportId: typeof reportId === 'string' ? reportId : undefined,
    });
    res.status(201).json(created);
  });

  app.delete('/api/admin/featured/:id', (req, res) => {
    const deleted = featuredStore.removeFeatured(Number(req.params.id));

    if (!deleted) {
      res.status(404).json({ error: 'Featured comparison not found' });
      return;
    }

    res.json({ ok: true });
  });

  app.patch('/api/admin/featured/:id', (req, res) => {
    const { reportId } = req.body || {};

    if (typeof reportId !== 'string' || !reportId.trim()) {
      res.status(400).json({ error: 'Missing reportId' });
      return;
    }

    const updated = featuredStore.updateReportId(Number(req.params.id), reportId.trim());

    if (!updated) {
      res.status(404).json({ error: 'Featured comparison not found' });
      return;
    }

    res.json({ ok: true });
  });

  app.post('/api/admin/featured/preflight', async (req, res) => {
    if (!demandSensingService) {
      res.status(503).json({ error: 'Demand sensing service is not configured' });
      return;
    }

    const { itemA, itemB, language } = req.body || {};

    try {
      const result = await demandSensingService.scorePair(itemA, itemB, language);
      res.json(result);
    } catch (err) {
      if (err instanceof DemandSensingError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Preflight unexpected error:', err);
      res.status(502).json({ error: 'Demand sensing failed' });
    }
  });

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

  app.post('/api/admin/reports/:reportId/backfill-sources', async (req, res) => {
    const report = reportStore.getReport(req.params.reportId);
    if (!report) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    try {
      const result = report.result as any;

      // Research both items to get sources
      const [resA, resB] = await Promise.all([
        provider.research(report.itemA),
        provider.research(report.itemB),
      ]);

      const allSourcesRaw = [...(resA.sources || []), ...(resB.sources || [])];
      const seen = new Set<string>();
      const allSources = allSourcesRaw.filter((s) => {
        const norm = (s.url || '').replace(/\/+$/, '').toLowerCase();
        if (!norm || seen.has(norm)) return false;
        seen.add(norm);
        return true;
      }).slice(0, 20);

      // For each dimension, match citations
      const dimensions = result.dimensions || [];
      let dimensionsUpdated = 0;

      for (const dim of dimensions) {
        if (!dim.analysis) continue;

        const citationResult = await provider.chatCompletion({
          messages: [
            {
              role: 'user',
              content: `Given this analysis and available sources, pick 1-2 most relevant sources that directly support the analysis.

Analysis dimension: ${dim.label || dim.key}
Key difference: ${dim.analysis.key_difference || ''}
Item A summary: ${dim.analysis.item_a_summary || ''}
Item B summary: ${dim.analysis.item_b_summary || ''}

Available sources:
${allSources.map((s: any, i: number) => `[${i + 1}] ${s.title} — ${s.url}`).join('\n')}

Return ONLY the citations array.`,
            },
          ],
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              citations: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    url: { type: 'string' },
                    title: { type: 'string' },
                  },
                  required: ['url', 'title'],
                },
              },
            },
            required: ['citations'],
          },
          schemaName: 'citation_match',
          temperature: 0.1,
        });

        try {
          const parsed = JSON.parse(citationResult.json);
          dim.analysis.citations = parsed.citations || [];
          dimensionsUpdated++;
        } catch {
          dim.analysis.citations = [];
        }
      }

      // Update report with sources and citations
      result.sources = allSources;
      reportStore.updateReportResult(report.reportId, result);

      res.json({
        success: true,
        sourcesCount: allSources.length,
        dimensionsUpdated,
      });
    } catch (error) {
      console.error('Backfill failed:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Backfill failed',
      });
    }
  });

  // --- Report endpoints ---

  app.post('/api/reports', (req: RequestWithVisitor, res) => {
    const { runId, itemA, itemB, language, result } = req.body || {};

    if (typeof itemA !== 'string' || typeof itemB !== 'string' || !itemA.trim() || !itemB.trim()) {
      res.status(400).json({ error: 'Missing itemA or itemB' });
      return;
    }

    if (!result) {
      res.status(400).json({ error: 'Missing result data' });
      return;
    }

    try {
      const saved = reportStore.saveReport({
        runId: typeof runId === 'string' ? runId : undefined,
        itemA,
        itemB,
        language: typeof language === 'string' ? language : 'en',
        result,
        visitorId: req.visitorId,
      });

      if (!saved) {
        res.status(400).json({ error: 'Invalid result structure' });
        return;
      }

      res.status(201).json(saved);
    } catch (err) {
      console.error('Failed to save report:', err);
      res.status(500).json({ error: 'Failed to save report' });
    }
  });

  app.get('/api/reports/by-slug/:slug', (req, res) => {
    const featured = featuredStore.getFeaturedBySlug(req.params.slug);
    const report = featured?.reportId ? reportStore.getReport(featured.reportId) : null;

    if (!featured || !report) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    reportStore.incrementViewCount(report.reportId);
    res.json(report);
  });

  app.get('/api/reports/:reportId', (req, res) => {
    const report = reportStore.getReport(req.params.reportId);

    if (!report) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    // Increment view count (fire-and-forget)
    reportStore.incrementViewCount(req.params.reportId);

    res.json(report);
  });

  app.get('/api/reports/:reportId/feedback', (req, res) => {
    res.json(reportStore.getFeedbackStats(req.params.reportId));
  });

  app.post('/api/reports/:reportId/feedback', (req: RequestWithVisitor, res) => {
    const { helpful } = req.body || {};
    if (typeof helpful !== 'boolean') {
      res.status(400).json({ error: 'Missing helpful (boolean)' });
      return;
    }
    const visitorId = req.visitorId || '';
    if (!visitorId) {
      res.status(400).json({ error: 'Missing visitor identity' });
      return;
    }
    res.json(reportStore.submitFeedback(req.params.reportId, visitorId, helpful));
  });

  app.get('/api/admin/reports', (req, res) => {
    res.json(
      reportStore.listReports({
        limit: getQueryNumber(req.query.limit, 50),
        offset: getQueryNumber(req.query.offset, 0),
      }),
    );
  });

  app.delete('/api/admin/reports/:reportId', (req, res) => {
    const deleted = reportStore.deleteReport(req.params.reportId);

    if (!deleted) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    res.json({ ok: true });
  });

  return app;
}
