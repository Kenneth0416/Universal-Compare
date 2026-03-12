#!/usr/bin/env node

/**
 * GitHub Webhook 服務器
 * 監聽 GitHub push 事件並自動執行部署
 */

const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// 配置
const PORT = process.env.WEBHOOK_PORT || 9000;
const SECRET = process.env.WEBHOOK_SECRET || 'your-webhook-secret-here';
const DEPLOY_SCRIPT = process.env.DEPLOY_SCRIPT || path.join(__dirname, 'deploy.sh');
const LOG_FILE = process.env.LOG_FILE || '/var/log/webhook-deploy.log';

// 日誌函數
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(logMessage.trim());

  try {
    fs.appendFileSync(LOG_FILE, logMessage);
  } catch (err) {
    console.error('Failed to write to log file:', err.message);
  }
}

// 驗證 GitHub webhook 簽名
function verifySignature(payload, signature) {
  if (!signature) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', SECRET);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
}

// 執行部署腳本
function deploy() {
  return new Promise((resolve, reject) => {
    log('🚀 Starting deployment...');

    exec(`bash ${DEPLOY_SCRIPT}`, (error, stdout, stderr) => {
      if (error) {
        log(`❌ Deployment failed: ${error.message}`);
        log(`stderr: ${stderr}`);
        reject(error);
        return;
      }

      log(`✅ Deployment completed successfully`);
      log(`stdout: ${stdout}`);
      if (stderr) log(`stderr: ${stderr}`);
      resolve(stdout);
    });
  });
}

// 創建 HTTP 服務器
const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  let body = '';

  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', async () => {
    try {
      // 驗證簽名
      const signature = req.headers['x-hub-signature-256'];
      if (!verifySignature(body, signature)) {
        log('⚠️  Invalid signature - request rejected');
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('Unauthorized');
        return;
      }

      // 解析 payload
      const payload = JSON.parse(body);
      const event = req.headers['x-github-event'];

      log(`📥 Received ${event} event from ${payload.repository?.full_name}`);

      // 只處理 push 事件
      if (event === 'push') {
        const branch = payload.ref?.replace('refs/heads/', '');
        log(`📌 Push to branch: ${branch}`);

        // 只在 main 分支觸發部署（可根據需要修改）
        if (branch === 'main' || branch === 'master') {
          try {
            await deploy();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'success', message: 'Deployment completed' }));
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'error', message: error.message }));
          }
        } else {
          log(`ℹ️  Ignoring push to ${branch} branch`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ignored', message: `Branch ${branch} not configured for deployment` }));
        }
      } else {
        log(`ℹ️  Ignoring ${event} event`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ignored', message: 'Event not handled' }));
      }
    } catch (error) {
      log(`❌ Error processing webhook: ${error.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: error.message }));
    }
  });
});

server.listen(PORT, () => {
  log(`🎧 Webhook server listening on port ${PORT}`);
  log(`📝 Logs will be written to ${LOG_FILE}`);
  log(`🔐 Webhook secret is configured: ${SECRET !== 'your-webhook-secret-here'}`);
});

// 優雅關閉
process.on('SIGTERM', () => {
  log('📴 Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  log('📴 Received SIGINT, shutting down gracefully...');
  server.close(() => {
    log('✅ Server closed');
    process.exit(0);
  });
});
