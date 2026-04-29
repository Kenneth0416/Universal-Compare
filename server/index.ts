/**
 * Grok API Proxy Server
 * Proxies AI calls from frontend to Grok API, keeping API key server-side.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import path from 'node:path';
import OpenAI from 'openai';
import { createAnalyticsStore } from './analytics';
import { createFeaturedStore } from './featured';
import { createReportStore } from './reports';
import { createApp } from './app';

const PORT = process.env.API_SERVER_PORT || 3001;

const openai = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: 'https://api.x.ai/v1',
});

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
  openai: openai as any,
  adminPassword: process.env.ADMIN_PASSWORD,
  adminSessionSecret,
});

app.listen(PORT, () => {
  console.log(`Grok API proxy server running on port ${PORT}`);
});
