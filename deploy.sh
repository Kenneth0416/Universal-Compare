#!/bin/bash

# 服務器端部署腳本
# 將此文件放在服務器的項目目錄中

set -e  # 遇到錯誤立即退出

# 配置
PROJECT_DIR="/var/www/compare-ai"
WEB_ROOT="/var/www/compare-ai"
BRANCH="main"

cd "$PROJECT_DIR"

echo "🚀 Starting deployment..."
echo "📍 Working directory: $(pwd)"
echo "🌿 Target branch: $BRANCH"

# 1. 拉取最新代碼
echo "📥 Pulling latest code from GitHub..."
git fetch origin
git reset --hard origin/$BRANCH

# 2. 安裝依賴
echo "📦 Installing dependencies..."
npm ci --production=false

# 3. 構建項目
echo "🔨 Building project..."
npm run build

# 4. 備份舊版本（可選）
if [ -d "$WEB_ROOT/dist.backup" ]; then
  echo "🗑️  Removing old backup..."
  rm -rf "$WEB_ROOT/dist.backup"
fi
if [ -d "$WEB_ROOT/dist" ]; then
  echo "💾 Backing up current version..."
  mv "$WEB_ROOT/dist" "$WEB_ROOT/dist.backup"
fi

# 5. 部署新版本
echo "📤 Deploying new version..."
# dist 已經在當前目錄，無需複製

# 6. 設置權限
echo "🔐 Setting permissions..."
chown -R www-data:www-data "$WEB_ROOT/dist"
chmod -R 755 "$WEB_ROOT/dist"

# 7. 重啟服務（如果需要）
echo "🔄 Reloading nginx..."
systemctl reload nginx || echo "⚠️  Failed to reload nginx (may not be critical)"

echo "✅ Deployment completed successfully!"
echo "🌐 Site should be live at http://207.148.116.138"
