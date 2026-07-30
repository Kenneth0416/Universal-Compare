#!/usr/bin/env node

/**
 * Minimal GitHub webhook receiver. Secrets and request bodies are never logged.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024;
const DELIVERY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DELIVERIES = 10_000;
const PLACEHOLDER_PATTERN = /^(?:change[-_ ]?me|replace[-_ ]?me|your[-_ ]|example|placeholder|secret(?:-here)?)/i;
const DELIVERY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function log(message, logFile) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, `${line}\n`, { mode: 0o640 });
  } catch {
    console.error('Unable to append to the webhook log file');
  }
}

function requiredSecret(value) {
  const secret = value?.trim();
  if (!secret || secret.length < 32 || PLACEHOLDER_PATTERN.test(secret)) {
    throw new Error('WEBHOOK_SECRET must be a non-placeholder value of at least 32 characters');
  }
  return secret;
}

function requiredRepository(value) {
  const repository = value?.trim();
  if (!repository || PLACEHOLDER_PATTERN.test(repository)
    || repository.toLowerCase() === 'owner/repository'
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('WEBHOOK_REPOSITORY must be an owner/repository name');
  }
  return repository.toLowerCase();
}

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function verifySignature(payload, signature, secret) {
  if (!Buffer.isBuffer(payload) || typeof signature !== 'string' || !/^sha256=[0-9a-f]{64}$/i.test(signature)) {
    return false;
  }
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
  const providedBuffer = Buffer.from(signature, 'ascii');
  const expectedBuffer = Buffer.from(expected, 'ascii');
  return providedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function createReplayGuard(stateFile = '') {
  const deliveries = new Map();
  if (stateFile) {
    try {
      const stored = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (stored && typeof stored === 'object') {
        for (const [id, seenAt] of Object.entries(stored)) {
          if (typeof seenAt === 'number' && Number.isFinite(seenAt)) deliveries.set(id, seenAt);
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error('Unable to read webhook replay state');
    }
  }

  const persist = () => {
    if (!stateFile) return;
    fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o750 });
    const temporary = `${stateFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(Object.fromEntries(deliveries)), { mode: 0o600 });
    fs.renameSync(temporary, stateFile);
  };
  const prune = (now) => {
    for (const [id, seenAt] of deliveries) {
      if (now - seenAt <= DELIVERY_TTL_MS) continue;
      deliveries.delete(id);
    }
    while (deliveries.size > MAX_DELIVERIES) deliveries.delete(deliveries.keys().next().value);
  };

  return {
    remember(keys, now = Date.now()) {
      prune(now);
      if (keys.some((key) => deliveries.has(key))) return false;
      for (const key of keys) deliveries.set(key, now);
      prune(now);
      persist();
      return true;
    },
    forget(keys) {
      let changed = false;
      for (const key of keys) changed = deliveries.delete(key) || changed;
      if (changed) persist();
    },
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function runDeployment(script, timeoutMs, revision, branch) {
  const childEnvironment = { ...process.env, GITHUB_SHA: revision, DEPLOY_BRANCH: branch };
  delete childEnvironment.WEBHOOK_SECRET;
  return new Promise((resolve, reject) => {
    execFile('/bin/bash', [script], {
      env: childEnvironment,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function loadConfig() {
  const script = path.resolve(process.env.DEPLOY_SCRIPT || path.join(path.dirname(fileURLToPath(import.meta.url)), 'deploy.sh'));
  fs.accessSync(script, fs.constants.R_OK);
  const branch = process.env.WEBHOOK_BRANCH?.trim() || 'main';
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) throw new Error('WEBHOOK_BRANCH is invalid');
  const host = process.env.WEBHOOK_HOST || '127.0.0.1';
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw new Error('WEBHOOK_HOST must be a loopback address');
  }
  return {
    host,
    port: positiveInteger(process.env.WEBHOOK_PORT, 9000, 'WEBHOOK_PORT'),
    secret: requiredSecret(process.env.WEBHOOK_SECRET),
    repository: requiredRepository(process.env.WEBHOOK_REPOSITORY),
    branch,
    script,
    logFile: process.env.LOG_FILE || '',
    maxPayloadBytes: positiveInteger(process.env.WEBHOOK_MAX_PAYLOAD_BYTES, DEFAULT_MAX_PAYLOAD_BYTES, 'WEBHOOK_MAX_PAYLOAD_BYTES'),
    deployTimeoutMs: positiveInteger(process.env.DEPLOY_TIMEOUT_MS, 15 * 60 * 1000, 'DEPLOY_TIMEOUT_MS'),
    replayFile: process.env.WEBHOOK_REPLAY_FILE || '/var/lib/compare-ai/webhook-deliveries.json',
  };
}

export function createWebhookServer(config) {
  const replayGuard = createReplayGuard(config.replayFile);
  let deploymentPromise = null;

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/webhook') {
      sendJson(res, 404, { status: 'not_found' });
      return;
    }

    const contentLength = Number(req.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > config.maxPayloadBytes) {
      sendJson(res, 413, { status: 'payload_too_large' });
      req.resume();
      return;
    }

    const chunks = [];
    let bytes = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) return;
      bytes += chunk.length;
      if (bytes > config.maxPayloadBytes) {
        rejected = true;
        chunks.length = 0;
        sendJson(res, 413, { status: 'payload_too_large' });
        return;
      }
      chunks.push(chunk);
    });

    req.on('error', () => {
      if (!res.headersSent) sendJson(res, 400, { status: 'bad_request' });
    });

    req.on('end', async () => {
      if (rejected || res.writableEnded) return;
      const body = Buffer.concat(chunks, bytes);
      const signature = req.headers['x-hub-signature-256'];
      if (!verifySignature(body, signature, config.secret)) {
        log('Rejected webhook with invalid signature', config.logFile);
        sendJson(res, 401, { status: 'unauthorized' });
        return;
      }

      const event = req.headers['x-github-event'];
      const delivery = req.headers['x-github-delivery'];
      if (event !== 'push' || typeof delivery !== 'string' || !DELIVERY_PATTERN.test(delivery)) {
        log('Rejected webhook with invalid event or delivery identifier', config.logFile);
        sendJson(res, 400, { status: 'invalid_webhook' });
        return;
      }
      let payload;
      try {
        payload = JSON.parse(body.toString('utf8'));
      } catch {
        sendJson(res, 400, { status: 'invalid_json' });
        return;
      }

      if (payload?.repository?.full_name?.toLowerCase() !== config.repository) {
        log('Rejected webhook for an unexpected repository', config.logFile);
        sendJson(res, 403, { status: 'repository_mismatch' });
        return;
      }
      if (payload.ref !== `refs/heads/${config.branch}`) {
        sendJson(res, 202, { status: 'ignored_branch' });
        return;
      }
      if (payload.deleted || !/^[0-9a-f]{40}$/i.test(payload.after || '')) {
        sendJson(res, 400, { status: 'invalid_revision' });
        return;
      }
      if (deploymentPromise) {
        log('Rejected concurrent deployment request', config.logFile);
        sendJson(res, 409, { status: 'deployment_in_progress' });
        return;
      }
      const replayKeys = [`delivery:${delivery}`, `revision:${payload.after.toLowerCase()}`];
      if (!replayGuard.remember(replayKeys)) {
        log('Rejected replayed webhook delivery or revision', config.logFile);
        sendJson(res, 409, { status: 'replayed_delivery' });
        return;
      }

      log(`Starting deployment for authenticated delivery ${delivery}`, config.logFile);
      const acceptedDeployment = runDeployment(config.script, config.deployTimeoutMs, payload.after, config.branch);
      deploymentPromise = acceptedDeployment;
      sendJson(res, 202, { status: 'deployment_started' });
      acceptedDeployment
        .then(() => log(`Deployment completed for delivery ${delivery}`, config.logFile))
        .catch((error) => {
          replayGuard.forget(replayKeys);
          const detail = error?.killed ? 'timeout' : `exit ${error?.code ?? 'unknown'}`;
          log(`Deployment failed (${detail}) for delivery ${delivery}`, config.logFile);
        })
        .finally(() => {
          if (deploymentPromise === acceptedDeployment) deploymentPromise = null;
        });
    });
  });

  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  return server;
}

function runSmokeCheck() {
  const secret = 'smoke-only-secret-not-loaded-from-environment-1234567890';
  const payload = Buffer.from('{"smoke":true}');
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
  if (!verifySignature(payload, signature, secret)) throw new Error('valid signature check failed');
  if (verifySignature(payload, 'sha256=short', secret)) throw new Error('short signature was accepted');
  const replay = createReplayGuard();
  const delivery = 'delivery:123e4567-e89b-42d3-a456-426614174000';
  if (!replay.remember([delivery], 1) || replay.remember([delivery], 2)) throw new Error('replay guard check failed');
  console.log('Webhook smoke check passed (synthetic secret only)');
}

function start() {
  const config = loadConfig();
  const server = createWebhookServer(config);
  server.listen(config.port, config.host, () => {
    log(`Webhook server listening on ${config.host}:${config.port}`, config.logFile);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    if (process.argv.includes('--smoke') || process.argv.includes('--check')) runSmokeCheck();
    else start();
  } catch (error) {
    console.error(`Webhook configuration error: ${error.message}`);
    process.exitCode = 1;
  }
}
