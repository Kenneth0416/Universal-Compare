import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  ADMIN_SESSION_COOKIE,
  createAdminSessionToken,
  createVisitorIdToken,
  getAdminSessionCookieOptions,
  parseCookieHeader,
  verifyAdminSessionToken,
  verifyVisitorIdToken,
} from './adminAuth';
import { createComparisonAgentRouter, verifyReportToken } from './comparisonAgentApi';
import type { createAnalyticsStore } from './analytics';
import type { createFeaturedStore } from './featured';
import { toPublicReportDto, type createReportStore } from './reports';
import { generateOgImage } from './og';
import {
  renderAboutHtml,
  renderHomepageHtml,
  renderLlmsFullTxt,
  renderLlmsTxt,
  type LlmsFullEntry,
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
import { mapConcurrent } from './concurrency';
import { normalizeSafeHttpUrl, serializeComparisonResult } from '../shared/comparisonSchema';
import { consumePersistentLimit } from './rateLimit';
import { isInternalBatchRequest } from './internalBatch';
import type { ComparisonRunner } from './comparisonRunner';

const VISITOR_COOKIE = 'compareai_visitor_id';
const VISITOR_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

type AnalyticsStore = ReturnType<typeof createAnalyticsStore>;
type ReportStore = ReturnType<typeof createReportStore>;
type FeaturedStore = ReturnType<typeof createFeaturedStore>;

type RequestWithVisitor = Request & {
  visitorId?: string;
  /** True when the visitor id came from a verified signed cookie (capable of ownership checks). */
  visitorVerified?: boolean;
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
  comparisonRunner?: ComparisonRunner;
};

function getRequestIp(req: Request) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function applyRateLimit(res: Response, result: { allowed: boolean; retryAfterSeconds: number }) {
  if (result.allowed) return false;
  res.set('Retry-After', String(result.retryAfterSeconds)).status(429).json({ error: 'Too many requests' });
  return true;
}

function requestAbortController(req: Request, res: Response) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.once('aborted', abort);
  res.once('close', () => {
    if (!res.writableEnded) abort();
  });
  return controller;
}

function getQueryNumber(value: unknown, fallback: number) {
  const firstValue = Array.isArray(value) ? value[0] : value;
  const parsed = Number(firstValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Tokens that appear across unrelated product lines and would otherwise link
// every "X Pro" to every other "Y Pro".
const GENERIC_ENTITY_TOKENS = new Set([
  'pro', 'max', 'ultra', 'plus', 'mini', 'lite', 'air', 'plan', 'free', 'best',
  'edition', 'version', 'series', 'model', 'model3', 'generation', 'standard', 'premium',
  '2023', '2024', '2025', '2026', '2027',
]);

/** Collapses an entity name to a comparable key ("iPhone 17 Pro" -> "iphone17pro"). */
function normalizeEntityName(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Distinctive words of an entity name, used for partial relatedness matches. */
function entityTokens(value: string) {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 4 && !GENERIC_ENTITY_TOKENS.has(token));
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
  comparisonRunner,
}: CreateAppOptions) {
  const app = express();
  app.set('trust proxy', 'loopback');
  const rateLimit = (
    bucket: string,
    identity: string,
    limit: number,
    windowMs: number,
  ) => consumePersistentLimit({
    db: analyticsStore.getDb(), secret: adminSessionSecret,
    key: `${bucket}:${identity}`, limit, windowMs,
  });
  const limitByIpAndVisitor = (
    req: RequestWithVisitor,
    res: Response,
    bucket: string,
    limit: number,
    windowMs: number,
  ) => {
    if (isInternalBatchRequest(req)) return false;
    const results = [rateLimit(bucket, `ip:${getRequestIp(req)}`, limit, windowMs)];
    if (req.visitorId) results.push(rateLimit(bucket, `visitor:${req.visitorId}`, limit, windowMs));
    const blocked = results.find((result) => !result.allowed);
    return blocked ? applyRateLimit(res, blocked) : false;
  };
  const adminIdempotency = new Map<string, { status: 'processing' | 'done'; statusCode?: number; body?: unknown; expiresAt: number }>();

  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    });
    next();
  });
  app.use(express.json({ limit: '512kb' }));

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
    // Only list entries that resolve to a live report; slug-only rows would be dead links.
    const featured = featuredStore.listFeatured().filter((item) => item.reportId && item.slug);
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('text/plain; charset=utf-8').send(renderLlmsTxt({ featured, siteUrl }));
  });

  // Rebuilding the digest walks every report's JSON, so memoize for an hour.
  let llmsFullCache: { body: string; expiresAt: number } | null = null;
  app.get('/llms-full.txt', (_req, res) => {
    if (!llmsFullCache || llmsFullCache.expiresAt < Date.now()) {
      const featured = featuredStore
        .listFeatured()
        .filter((item) => item.reportId && item.slug)
        .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
        .slice(0, 400);
      const entries: LlmsFullEntry[] = [];
      const seenPairs = new Set<string>();
      for (const item of featured) {
        const pairKey = [item.itemA, item.itemB].map((s) => s.toLowerCase().trim()).sort().join('|');
        if (seenPairs.has(pairKey)) continue;
        const report = reportStore.getReport(item.reportId as string);
        if (!report) continue;
        seenPairs.add(pairKey);
        const result = report.result as {
          recommendation?: { short_verdict?: string };
          dimensions?: Array<{ analysis?: { key_difference?: string } }>;
        };
        entries.push({
          itemA: item.itemA,
          itemB: item.itemB,
          slug: item.slug,
          language: report.language || 'en',
          shortVerdict: (result.recommendation?.short_verdict || '').trim(),
          keyFacts: (result.dimensions || [])
            .map((dimension) => (dimension.analysis?.key_difference || '').trim())
            .filter(Boolean)
            .slice(0, 6),
        });
      }
      llmsFullCache = { body: renderLlmsFullTxt({ entries, siteUrl }), expiresAt: Date.now() + 60 * 60 * 1_000 };
    }
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('text/plain; charset=utf-8').send(llmsFullCache.body);
  });

  app.get('/indexnow-key.txt', (_req, res) => {
    const key = process.env.INDEXNOW_KEY;
    if (!key || !/^[A-Za-z0-9-]{8,128}$/.test(key)) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('text/plain').send(key);
  });

  app.get('/', (_req, res) => {
    const indexHtml = readClientIndexHtml();
    res.set('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600');
    res.type('text/html').send(
      renderHomepageHtml({
        indexHtml,
        siteUrl,
        featuredComparisons: featuredStore.listHotFeatured('en', 8),
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
        comparisons: featuredStore.listHotFeatured('en', 48),
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
        relatedComparisons: featuredStore.listHotFeatured(report.language || featured.language || 'en', 7)
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
    // Internal batch/runner requests are server-to-server: no visitor identity
    // should be created or attached for them.
    if (isInternalBatchRequest(req)) {
      next();
      return;
    }
    try {
      const cookies = parseCookieHeader(req.headers.cookie);
      const verifiedVisitorId = verifyVisitorIdToken(cookies[VISITOR_COOKIE], adminSessionSecret) || undefined;
      if (!verifiedVisitorId) {
        const identityCreation = rateLimit('visitor-create', `ip:${getRequestIp(req)}`, 20, 24 * 60 * 60 * 1_000);
        if (!identityCreation.allowed) {
          next();
          return;
        }
      }
      const visitor = analyticsStore.ensureVisitor({
        visitorId: verifiedVisitorId,
        userAgent: req.get('user-agent') || '',
        ipAddress: getRequestIp(req),
      });

      req.visitorId = visitor.visitorId;
      req.visitorVerified = Boolean(verifiedVisitorId);
      if (!verifiedVisitorId || visitor.isNew) {
        res.cookie(VISITOR_COOKIE, createVisitorIdToken(visitor.visitorId, adminSessionSecret), {
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
    if (limitByIpAndVisitor(req, res, 'comparison-run', 30, 60 * 60 * 1_000)) return;
    const { runId, itemA, itemB, language } = req.body || {};

    if (typeof itemA !== 'string' || typeof itemB !== 'string' || !itemA.trim() || !itemB.trim()) {
      res.status(400).json({ error: 'Missing comparison items' });
      return;
    }

    if (runId !== undefined) {
      res.status(403).json({ error: 'runId is generated by the server' });
      return;
    }

    const run = analyticsStore.startComparisonRun({
      runId: undefined,
      visitorId: req.visitorId || '',
      itemA,
      itemB,
      language: typeof language === 'string' ? language : 'en',
    });

    res.json(run);
  });

  const getOwnedRun = (req: RequestWithVisitor, runId: string) => {
    const run = analyticsStore.getDb().prepare(`
      SELECT run_id AS runId, visitor_id AS visitorId, item_a AS itemA, item_b AS itemB,
             language, status, error_message AS errorMessage
      FROM comparison_runs WHERE run_id = ?
    `).get(runId) as {
      runId: string; visitorId: string; itemA: string; itemB: string;
      language: string; status: string; errorMessage: string | null;
    } | undefined;
    if (!run) return { error: 404 as const };
    if (!req.visitorId || run.visitorId !== req.visitorId) return { error: 403 as const };
    return { run };
  };

  app.post('/api/comparison-runs/:runId/generate', (req: RequestWithVisitor, res) => {
    if (!comparisonRunner) {
      res.status(503).json({ error: 'Server-side generation unavailable' });
      return;
    }
    const owned = getOwnedRun(req, req.params.runId);
    if ('error' in owned) {
      res.status(owned.error).json({ error: owned.error === 404 ? 'Comparison run not found' : 'Run does not belong to this visitor' });
      return;
    }
    const existingReportId = reportStore.getReportIdByRunId(owned.run.runId);
    if (existingReportId) {
      res.json({ started: false, reportId: existingReportId });
      return;
    }
    if (owned.run.status !== 'started') {
      res.status(409).json({ error: 'Comparison run already finished' });
      return;
    }
    // Budget server-side runs per visitor and IP; the internal phase calls
    // themselves bypass public limits, so this is the enforcement point.
    if (limitByIpAndVisitor(req, res, 'server-run', 12, 24 * 60 * 60 * 1_000)) return;
    const outcome = comparisonRunner.start({
      runId: owned.run.runId,
      itemA: owned.run.itemA,
      itemB: owned.run.itemB,
      language: owned.run.language || 'en',
      visitorId: owned.run.visitorId || undefined,
    });
    if (!outcome.started && outcome.reason === 'busy') {
      res.set('Retry-After', '15').status(503).json({ error: 'AI service is busy' });
      return;
    }
    res.status(202).json({ started: true });
  });

  app.get('/api/comparison-runs/:runId/progress', (req: RequestWithVisitor, res) => {
    const owned = getOwnedRun(req, req.params.runId);
    if ('error' in owned) {
      res.status(owned.error).json({ error: owned.error === 404 ? 'Comparison run not found' : 'Run does not belong to this visitor' });
      return;
    }
    const progress = comparisonRunner?.getProgress(owned.run.runId);
    if (progress) {
      res.json({
        status: progress.status,
        stepKey: progress.stepKey,
        dimensionCount: progress.dimensionCount,
        partial: progress.partial,
        result: progress.status === 'completed' ? progress.result : undefined,
        reportId: progress.reportId,
        reportUrl: progress.reportUrl,
        error: progress.error,
      });
      return;
    }
    // No in-memory state (e.g. server restarted): fall back to durable records.
    const reportId = reportStore.getReportIdByRunId(owned.run.runId);
    if (reportId) {
      const report = reportStore.getReport(reportId);
      res.json({
        status: 'completed',
        reportId,
        reportUrl: `/r/${reportId}`,
        result: report?.result,
      });
      return;
    }
    res.json({
      status: owned.run.status === 'started' ? 'unknown' : owned.run.status,
      error: owned.run.errorMessage || undefined,
    });
  });

  app.get('/api/me/activity', (req: RequestWithVisitor, res) => {
    if (!req.visitorVerified || !req.visitorId) {
      res.json({ reports: [], activeRuns: [] });
      return;
    }
    const reports = reportStore.listReportsByVisitor(req.visitorId, 50).map((item) => {
      const featured = featuredStore.getFeaturedByReportId(item.reportId);
      return {
        reportId: item.reportId,
        itemA: item.itemA,
        itemB: item.itemB,
        language: item.language,
        createdAt: item.createdAt,
        url: featured?.slug ? `/compare/${featured.slug}` : `/r/${item.reportId}`,
      };
    });
    const activeRuns = analyticsStore.getDb().prepare(`
      SELECT run_id AS runId, item_a AS itemA, item_b AS itemB, started_at AS startedAt
      FROM comparison_runs
      WHERE visitor_id = ? AND status = 'started' AND started_at > datetime('now', '-30 minutes')
      ORDER BY started_at DESC
      LIMIT 5
    `).all(req.visitorId);
    res.json({ reports, activeRuns });
  });

  app.patch('/api/comparison-runs/:runId', (req: RequestWithVisitor, res) => {
    const { status, errorMessage } = req.body || {};

    if (status !== 'completed' && status !== 'failed') {
      res.status(400).json({ error: 'Invalid run status' });
      return;
    }

    // Cookie-less clients cannot carry a persistent identity; the server-issued
    // unguessable run id is the capability. Verified visitors get ownership checks.
    const finished = analyticsStore.finishComparisonRun({
      runId: req.params.runId,
      visitorId: req.visitorVerified ? req.visitorId : undefined,
      status,
      errorMessage: typeof errorMessage === 'string' ? errorMessage : undefined,
    });

    if (!finished.updated) {
      res.status(404).json({ error: 'Comparison run not found' });
      return;
    }
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
      const limit = Math.min(Math.max(getQueryNumber(req.query.limit, 12), 1), 48);
      res.set('Cache-Control', 'public, max-age=300');
      res.json({ items: featuredStore.listHotFeatured(lang, limit) });
    } catch {
      res.json({ items: [] });
    }
  });

  // Topically related reports for the report page. Falls back to the hot list so
  // the block is never empty, and never 404s on an unknown slug.
  app.get('/api/related-comparisons', (req, res) => {
    try {
      const slug = typeof req.query.slug === 'string' ? req.query.slug : '';
      const requestedLang = typeof req.query.lang === 'string' ? req.query.lang : 'en';
      const limit = Math.min(Math.max(getQueryNumber(req.query.limit, 6), 1), 24);
      res.set('Cache-Control', 'public, max-age=300');

      const current = slug ? featuredStore.getFeaturedBySlug(slug) : null;
      const language = current?.language || requestedLang;
      const taken = new Set<string>(slug ? [slug] : []);
      const items: Array<{
        id: number;
        itemA: string;
        itemB: string;
        slug: string;
        description: string;
        viewCount: number;
      }> = [];

      const push = (item: { id: number; itemA: string; itemB: string; slug: string; description: string; viewCount: number }) => {
        if (items.length >= limit || !item.slug || taken.has(item.slug)) return;
        taken.add(item.slug);
        items.push({
          id: item.id,
          itemA: item.itemA,
          itemB: item.itemB,
          slug: item.slug,
          description: item.description || '',
          viewCount: Number(item.viewCount || 0),
        });
      };

      if (current) {
        const sides = [current.itemA, current.itemB];
        const names = new Set(sides.map(normalizeEntityName).filter(Boolean));
        const tokens = new Set(sides.flatMap(entityTokens));

        // 2 = the candidate shares a whole entity, 1 = it only shares a distinctive word.
        const scoreCandidate = (candidate: { itemA: string; itemB: string }) => {
          const candidateSides = [candidate.itemA, candidate.itemB];
          if (candidateSides.some((side) => names.has(normalizeEntityName(side)))) return 2;
          if (candidateSides.some((side) => entityTokens(side).some((token) => tokens.has(token)))) return 1;
          return 0;
        };

        featuredStore
          .listPublishedFeatured(language, slug)
          .map((candidate) => ({ candidate, score: scoreCandidate(candidate) }))
          .filter((entry) => entry.score > 0)
          .sort((left, right) => right.score - left.score || right.candidate.viewCount - left.candidate.viewCount)
          .forEach((entry) => push(entry.candidate));
      }

      if (items.length < limit) {
        for (const hot of featuredStore.listHotFeatured(language, limit * 3)) {
          if (items.length >= limit) break;
          push(hot);
        }
      }

      res.json({ items });
    } catch {
      res.json({ items: [] });
    }
  });

  // Only named comparison phases are exposed. Prompts, schemas, models, and tools
  // are selected in the server router and cannot be supplied by callers.
  app.use('/api/ai/phases', createComparisonAgentRouter({
    provider,
    analyticsStore,
    rateLimitSecret: adminSessionSecret,
  }));

  app.post('/api/admin/login', (req, res) => {
    if (applyRateLimit(res, rateLimit('admin-login', `ip:${getRequestIp(req)}`, 8, 15 * 60 * 1_000))) return;
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
  app.use('/api/admin', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      next();
      return;
    }
    const rawKey = req.body?.idempotencyKey;
    if (rawKey === undefined) {
      next();
      return;
    }
    if (typeof rawKey !== 'string' || !/^[A-Za-z0-9:_-]{16,200}$/.test(rawKey)) {
      res.status(400).json({ error: 'Invalid idempotencyKey' });
      return;
    }
    const now = Date.now();
    for (const [key, value] of adminIdempotency) {
      if (value.expiresAt <= now) adminIdempotency.delete(key);
    }
    const cacheKey = `${req.method}:${req.path}:${rawKey}`;
    const cached = adminIdempotency.get(cacheKey);
    if (cached?.status === 'processing') {
      res.status(409).json({ error: 'Identical operation is already in progress' });
      return;
    }
    if (cached?.status === 'done') {
      res.status(cached.statusCode || 200).json(cached.body);
      return;
    }
    adminIdempotency.set(cacheKey, { status: 'processing', expiresAt: now + 24 * 60 * 60 * 1_000 });
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (res.statusCode < 500) {
        adminIdempotency.set(cacheKey, {
          status: 'done', statusCode: res.statusCode, body, expiresAt: Date.now() + 24 * 60 * 60 * 1_000,
        });
      } else adminIdempotency.delete(cacheKey);
      return originalJson(body);
    }) as typeof res.json;
    res.once('close', () => {
      if (adminIdempotency.get(cacheKey)?.status === 'processing') adminIdempotency.delete(cacheKey);
    });
    next();
  });

  app.post('/api/admin/logout', (_req, res) => {
    res.clearCookie(ADMIN_SESSION_COOKIE, getAdminSessionCookieOptions(0));
    res.json({ authenticated: false });
  });

  app.get('/api/admin/session', (_req, res) => {
    res.json({ authenticated: true });
  });

  app.get('/api/admin/summary', (req, res) => {
    const period = req.query.period === undefined ? 1 : Number(req.query.period);
    try {
      res.json(analyticsStore.getSummary(period));
    } catch (error) {
      if (error instanceof RangeError) {
        res.status(400).json({ error: error.message });
        return;
      }
      throw error;
    }
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
    const type = req.query.type === 'human' || req.query.type === 'ai' || req.query.type === 'bot'
      ? req.query.type
      : undefined;
    const sort = req.query.sort === 'comparisons' || req.query.sort === 'visits' || req.query.sort === 'recent'
      ? req.query.sort
      : undefined;
    res.json(
      analyticsStore.listUsers({
        limit: getQueryNumber(req.query.limit, 50),
        offset: getQueryNumber(req.query.offset, 0),
        type,
        minComparisons: getQueryNumber(req.query.minComparisons, 0),
        sort,
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
    const controller = requestAbortController(req, res);

    try {
      const result = await demandSensingService.scorePair(itemA, itemB, language, controller.signal);
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
    const controller = requestAbortController(req, res);

    const results = await mapConcurrent(pairs, 5, async (pair) => {
      try {
        const result = await demandSensingService.scorePair(pair.itemAName, pair.itemBName, lang, controller.signal);
        candidateStore.updateScore(pair.id, result);
        return { id: pair.id, status: 'scored' as const, result };
      } catch (err) {
        return { id: pair.id, status: 'error' as const, error: (err as Error).message };
      }
    });

    res.json({ results });
  });

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

      try {
        const promotion = candidateStore.promoteCandidate(
          id,
          (pair) => featuredStore.addFeatured(pair.itemAName, pair.itemBName, {
            language: lang,
            description: desc,
          }),
          ['pending', 'scored'],
        );
        if (!promotion.promoted && 'reason' in promotion) {
          skipped.push({
            candidateId: id,
            reason: promotion.reason === 'not_found' ? 'not_found' : 'already_promoted',
          });
          continue;
        }
        promoted.push(promotion.value);
      } catch (err) {
        console.error(`bulk-promote create_failed for candidate ${id}:`, err);
        skipped.push({ candidateId: id, reason: 'create_failed' });
      }
    }

    res.json({ promoted, skipped });
  });

  app.post('/api/admin/reports/:reportId/backfill-sources', async (req, res) => {
    const controller = requestAbortController(req, res);
    const report = reportStore.getReport(req.params.reportId);
    if (!report) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    try {
      const result = report.result as any;

      // Research both items to get sources
      const [resA, resB] = await Promise.all([
        provider.research(report.itemA, undefined, controller.signal),
        provider.research(report.itemB, undefined, controller.signal),
      ]);

      const allSourcesRaw = [...(resA.sources || []), ...(resB.sources || [])];
      const seen = new Set<string>();
      const allSources = allSourcesRaw.flatMap((source) => {
        const url = normalizeSafeHttpUrl(source?.url);
        if (!url || typeof source?.title !== 'string' || !source.title.trim()) return [];
        const normalized = url.replace(/\/+$/, '').toLowerCase();
        if (seen.has(normalized)) return [];
        seen.add(normalized);
        return [{ url, title: source.title.trim().slice(0, 500) }];
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
          enableThinking: false,
          signal: controller.signal,
        });

        try {
          const parsed = JSON.parse(citationResult.json) as { citations?: unknown };
          const allowed = new Map(allSources.map((source) => [source.url.replace(/\/+$/, '').toLowerCase(), source]));
          const citations = Array.isArray(parsed.citations) ? parsed.citations.slice(0, 2) : [];
          dim.analysis.citations = citations.flatMap((citation) => {
            if (!citation || typeof citation !== 'object') return [];
            const url = normalizeSafeHttpUrl((citation as { url?: unknown }).url);
            const matched = url && allowed.get(url.replace(/\/+$/, '').toLowerCase());
            return matched ? [matched] : [];
          });
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
    if (limitByIpAndVisitor(req, res, 'report-write', 12, 60 * 60 * 1_000)) return;
    const { runId, itemA, itemB, language, result, reportToken } = req.body || {};

    if (typeof itemA !== 'string' || typeof itemB !== 'string' || !itemA.trim() || !itemB.trim()
      || itemA.length > 200 || itemB.length > 200) {
      res.status(400).json({ error: 'Missing itemA or itemB' });
      return;
    }

    if (!result) {
      res.status(400).json({ error: 'Missing result data' });
      return;
    }

    try {
      const normalizedRunId = typeof runId === 'string' && runId.trim() ? runId.trim() : undefined;
      if (normalizedRunId) {
        const ownedRun = analyticsStore.getDb().prepare(`
          SELECT visitor_id AS visitorId, item_a AS itemA, item_b AS itemB
          FROM comparison_runs WHERE run_id = ?
        `).get(normalizedRunId) as { visitorId?: string; itemA?: string; itemB?: string } | undefined;
        if (!ownedRun || ownedRun.visitorId !== req.visitorId
          || ownedRun.itemA?.trim() !== itemA.trim() || ownedRun.itemB?.trim() !== itemB.trim()) {
          res.status(403).json({ error: 'runId does not belong to this report' });
          return;
        }
      }
      const normalizedLanguage = typeof language === 'string' ? language : 'en';
      if (!['en', 'zh-CN', 'zh-TW'].includes(normalizedLanguage)) {
        res.status(400).json({ error: 'Unsupported language' });
        return;
      }
      const serializedResult = serializeComparisonResult(result);
      const reportScope = normalizedRunId
        ? `run:${normalizedRunId}`
        : `ip:${getRequestIp(req)}`;
      if (!serializedResult || !verifyReportToken(
        reportToken,
        reportScope,
        normalizedLanguage as 'en' | 'zh-CN' | 'zh-TW',
        serializedResult,
      )) {
        res.status(403).json({ error: 'Missing or invalid report grant' });
        return;
      }
      const normalizedResult = JSON.parse(serializedResult) as {
        entityA: { name: string };
        entityB: { name: string };
      };
      const idempotencyRunId = normalizedRunId || `grant_${crypto.createHash('sha256').update(String(reportToken)).digest('hex')}`;
      const saved = reportStore.saveReport({
        runId: idempotencyRunId,
        itemA: normalizedResult.entityA.name,
        itemB: normalizedResult.entityB.name,
        language: normalizedLanguage,
        result: normalizedResult,
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
    res.json(toPublicReportDto(report));
  });

  app.get('/api/reports/:reportId', (req, res) => {
    const report = reportStore.getReport(req.params.reportId);

    if (!report) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    reportStore.incrementViewCount(req.params.reportId);
    res.json(toPublicReportDto(report));
  });

  app.get('/api/reports/:reportId/feedback', (req, res) => {
    res.json(reportStore.getFeedbackStats(req.params.reportId));
  });

  app.post('/api/reports/:reportId/feedback', (req: RequestWithVisitor, res) => {
    if (limitByIpAndVisitor(req, res, 'feedback', 30, 60 * 60 * 1_000)) return;
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
    try {
      res.json(reportStore.submitFeedback(req.params.reportId, visitorId, helpful));
    } catch (error) {
      if (error instanceof Error && error.message.includes('missing report')) {
        res.status(404).json({ error: 'Report not found' });
        return;
      }
      res.status(400).json({ error: 'Unable to save feedback' });
    }
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
