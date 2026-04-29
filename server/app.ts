import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  ADMIN_SESSION_COOKIE,
  createAdminSessionToken,
  getAdminSessionCookieOptions,
  parseCookieHeader,
  verifyAdminSessionToken,
} from './adminAuth';
import type { createAnalyticsStore } from './analytics';

const VISITOR_COOKIE = 'compareai_visitor_id';
const VISITOR_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

type AnalyticsStore = ReturnType<typeof createAnalyticsStore>;

type AiClient = {
  responses: {
    create: (params: Record<string, unknown>) => Promise<unknown>;
  };
  chat: {
    completions: {
      create: (params: Record<string, unknown>) => Promise<unknown>;
    };
  };
};

type RequestWithVisitor = Request & {
  visitorId?: string;
};

type CreateAppOptions = {
  analyticsStore: AnalyticsStore;
  openai: AiClient;
  adminPassword?: string;
  adminSessionSecret: string;
};

type ResponsesAPITool = { type: 'web_search' } | { type: 'x_search' };

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

export function createApp({ analyticsStore, openai, adminPassword, adminSessionSecret }: CreateAppOptions) {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

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

  app.post('/api/ai', async (req: RequestWithVisitor, res) => {
    const { callType, params, runId } = req.body || {};

    if (!callType || !params) {
      res.status(400).json({ error: 'Missing callType or params' });
      return;
    }

    const startedAt = Date.now();
    const model = typeof params?.model === 'string' ? params.model : '';
    const resolvedRunId = typeof runId === 'string' ? runId : undefined;

    try {
      let response;

      switch (callType) {
        case 'responses':
          response = await openai.responses.create({
            ...params,
            tools: params.tools as ResponsesAPITool[],
          });
          break;

        case 'chat':
          response = await openai.chat.completions.create(params);
          break;

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
      });

      res.json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI API call failed';
      console.error('AI API error:', error);
      analyticsStore.logAiCall({
        runId: resolvedRunId,
        visitorId: req.visitorId,
        callType,
        model,
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

  app.get('/api/admin/summary', (_req, res) => {
    res.json(analyticsStore.getSummary());
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

  return app;
}
