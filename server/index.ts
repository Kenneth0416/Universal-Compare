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

const PORT = process.env.API_SERVER_PORT || 3001;
const AI_PROVIDER = process.env.AI_PROVIDER || 'grok';

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
const app = createApp({
  analyticsStore,
  reportStore,
  featuredStore,
  provider,
  demandSensingService,
  adminPassword: process.env.ADMIN_PASSWORD,
  adminSessionSecret,
  siteUrl: process.env.SITE_URL || process.env.APP_URL,
});

app.listen(PORT, () => {
  console.log(`AI comparison server running on port ${PORT} (provider: ${AI_PROVIDER})`);
});
