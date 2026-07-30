/**
 * AI Comparison Server
 * Supports Grok and MiniMax providers via AI_PROVIDER env var.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import path from 'node:path';
import OpenAI from 'openai';
import { createAnalyticsStore } from './analytics';
import { createFeaturedStore } from './featured';
import { createReportStore } from './reports';
import { createProvider } from './providers/index';
import { createApp } from './app';
import { DemandSensingService } from './demandSensing';
import { createEntityPoolStore } from './entityPool';
import { createCandidatePairStore } from './candidatePairs';

const PORT = Number(process.env.API_SERVER_PORT || 3001);
const HOST = process.env.API_SERVER_HOST || '127.0.0.1';
const AI_PROVIDER = process.env.AI_PROVIDER || 'grok';

if (!Number.isSafeInteger(PORT) || PORT < 1 || PORT > 65_535) {
  throw new Error('API_SERVER_PORT must be an integer between 1 and 65535');
}
if (!/^(?:127\.0\.0\.1|::1|localhost)$/.test(HOST) && process.env.ALLOW_PUBLIC_API_BIND !== 'true') {
  throw new Error('API_SERVER_HOST must be loopback unless ALLOW_PUBLIC_API_BIND=true');
}
if (process.env.NODE_ENV === 'production') {
  const requireSecret = (name: string) => {
    const value = process.env[name]?.trim() || '';
    if (value.length < 16 || /[<>]/.test(value)
      || /(?:change[-_ ]?me|replace[-_ ]?me|placeholder|example|server[-_ ]?side[-_ ]?secret|distinct[-_ ]?random[-_ ]?secret|your[-_ ]?(?:api[-_ ]?)?(?:key|secret|token)?)/i.test(value)) {
      throw new Error(`${name} must be a non-placeholder production secret`);
    }
  };
  if (AI_PROVIDER === 'grok') requireSecret('XAI_API_KEY');
  else if (AI_PROVIDER === 'minimax') {
    requireSecret('MINIMAX_API_KEY');
    requireSecret('DEEPSEEK_API_KEY');
  } else throw new Error('AI_PROVIDER must be grok or minimax');
  requireSecret('ADMIN_PASSWORD');
  requireSecret('ADMIN_SESSION_SECRET');
  requireSecret('AI_SOURCE_SIGNING_SECRET');
  const siteUrl = process.env.SITE_URL || process.env.APP_URL || '';
  try {
    const parsedSiteUrl = new URL(siteUrl);
    const forbiddenHosts = new Set([
      'example.com', 'www.example.com', 'localhost',
      'your-domain.com', 'www.your-domain.com', 'yourdomain.com', 'domain.com',
    ]);
    if (parsedSiteUrl.protocol !== 'https:' || !parsedSiteUrl.hostname || parsedSiteUrl.username
      || parsedSiteUrl.password || forbiddenHosts.has(parsedSiteUrl.hostname.toLowerCase())
      || parsedSiteUrl.hostname.endsWith('.example.com')
      || (parsedSiteUrl.pathname !== '/' && parsedSiteUrl.pathname !== '')) {
      throw new Error('invalid');
    }
  } catch {
    throw new Error('SITE_URL must be a valid HTTPS origin in production');
  }
}

const grokClient = process.env.XAI_API_KEY
  ? new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: 'https://api.x.ai/v1' })
  : undefined;

const minimaxBaseUrl = process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1';
const minimaxClient = process.env.MINIMAX_API_KEY
  ? new OpenAI({ apiKey: process.env.MINIMAX_API_KEY, baseURL: minimaxBaseUrl })
  : undefined;

const deepseekClient = process.env.DEEPSEEK_API_KEY
  ? new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' })
  : undefined;

const provider = createProvider(AI_PROVIDER, {
  grokClient,
  minimaxClient,
  minimaxSearchApiKey: process.env.MINIMAX_API_KEY,
  minimaxBaseUrl: minimaxBaseUrl.replace('/v1', ''),
  deepseekClient,
  deepseekModel: process.env.DEEPSEEK_MODEL,
});

const demandSensingService = deepseekClient && process.env.MINIMAX_API_KEY
  ? new DemandSensingService({
      minimaxSearchApiKey: process.env.MINIMAX_API_KEY,
      minimaxSearchBaseUrl: minimaxBaseUrl.replace('/v1', ''),
      deepseekClient,
      deepseekModel: process.env.DEEPSEEK_MODEL,
    })
  : undefined;

const analyticsDbPath =
  process.env.ANALYTICS_DB_PATH || path.resolve(process.cwd(), 'server', 'compareai-analytics.db');
const adminSessionSecret =
  process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || process.env.XAI_API_KEY || 'dev-admin-secret';

const analyticsStore = createAnalyticsStore(analyticsDbPath, adminSessionSecret);
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
  provider,
  demandSensingService,
  adminPassword: process.env.ADMIN_PASSWORD,
  adminSessionSecret,
  siteUrl: process.env.SITE_URL || process.env.APP_URL,
});

app.listen(PORT, HOST, () => {
  console.log(`AI comparison server running on http://${HOST}:${PORT} (provider: ${AI_PROVIDER})`);
});
