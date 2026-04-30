# 服務器端自動部署配置指南

## 方案：GitHub Webhook + 服務器監聽

這個方案在服務器端運行一個 webhook 服務器，當 GitHub 有代碼推送時自動觸發部署。

---

## 一、服務器端配置

### 1. 準備服務器環境

SSH 連接到服務器 207.148.116.138：

```bash
ssh user@207.148.116.138
```

安裝必要軟件：

```bash
# 更新系統
sudo apt update && sudo apt upgrade -y

# 安裝 Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 安裝 nginx
sudo apt-get install -y nginx

# 安裝 git
sudo apt-get install -y git
```

### 2. 克隆項目到服務器

```bash
# 創建項目目錄
sudo mkdir -p /var/www/compare-ai
sudo chown $USER:$USER /var/www/compare-ai

# 克隆項目
cd /var/www
git clone https://github.com/你的用戶名/universal-compare.git compare-ai
cd compare-ai

# 安裝依賴
npm install

# 首次構建
npm run build
```

### 3. 配置環境變量

創建 `.env.local` 文件：

```bash
cd /var/www/compare-ai
nano .env.local
```

添加內容：
```
XAI_API_KEY=your_api_key_here
SITE_URL=https://compare-anythings.com
```

動態報告頁 SEO、API、`robots.txt` 和 `sitemap.xml` 需要 Node 服務常駐運行：
```bash
API_SERVER_PORT=3001 npm run server
```

### 4. 設置 Webhook 服務器

生成一個安全的 webhook secret：

```bash
openssl rand -hex 32
```

複製生成的字符串，稍後會用到。

編輯 systemd 服務文件：

```bash
sudo nano /etc/systemd/system/webhook-deploy.service
```

將項目中的 `webhook-deploy.service` 內容複製進去，並修改：
- `WEBHOOK_SECRET=` 改為你剛才生成的 secret
- 確認路徑正確

複製 webhook 服務器文件：

```bash
sudo cp /var/www/compare-ai/webhook-server.js /var/www/compare-ai/
sudo chmod +x /var/www/compare-ai/webhook-server.js
sudo chmod +x /var/www/compare-ai/deploy.sh
```

啟動 webhook 服務：

```bash
# 創建日誌文件
sudo touch /var/log/webhook-deploy.log
sudo chown www-data:www-data /var/log/webhook-deploy.log

# 重新加載 systemd
sudo systemctl daemon-reload

# 啟動服務
sudo systemctl start webhook-deploy

# 設置開機自啟
sudo systemctl enable webhook-deploy

# 檢查狀態
sudo systemctl status webhook-deploy

# 查看日誌
sudo tail -f /var/log/webhook-deploy.log
```

### 5. 配置 Nginx

創建 nginx 配置：

```bash
sudo nano /etc/nginx/sites-available/compare-ai
```

添加內容：

```nginx
# 主站點配置
server {
    listen 80;
    server_name 207.148.116.138;  # 或你的域名

    root /var/www/compare-ai/dist;
    index index.html;

    # Dynamic SEO and API routes served by the Node app.
    # Keep these above the SPA fallback so report pages return page-specific
    # title, description, robots, canonical, OG, sitemap, and structured data.
    location = /robots.txt {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = /sitemap.xml {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ^~ /r/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ^~ /compare/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ^~ /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SPA 路由支持
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 靜態資源緩存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # 啟用 gzip 壓縮
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/json application/javascript;
}

# Webhook 端點配置
server {
    listen 80;
    server_name webhook.207.148.116.138;  # 或使用子域名

    location /webhook {
        proxy_pass http://localhost:9000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

啟用站點：

```bash
sudo ln -s /etc/nginx/sites-available/compare-ai /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 6. 配置防火牆（如果啟用了）

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 9000/tcp  # webhook 端口
sudo ufw reload
```

---

## 二、GitHub 配置

### 1. 設置 Webhook

1. 進入你的 GitHub repo
2. 點擊 **Settings** → **Webhooks** → **Add webhook**
3. 填寫配置：
   - **Payload URL**: `http://207.148.116.138:9000/webhook` 或 `http://webhook.207.148.116.138/webhook`
   - **Content type**: `application/json`
   - **Secret**: 填入你之前生成的 webhook secret
   - **Which events**: 選擇 "Just the push event"
   - **Active**: 勾選
4. 點擊 **Add webhook**

### 2. 測試 Webhook

推送一個測試提交：

```bash
git commit --allow-empty -m "Test webhook deployment"
git push origin main
```

檢查：
1. GitHub webhook 頁面顯示綠色勾號
2. 服務器日誌顯示部署過程：`sudo tail -f /var/log/webhook-deploy.log`
3. 訪問 http://207.148.116.138 查看更新

---

## 三、日常使用

### 自動部署流程

1. 本地開發並提交代碼
2. 推送到 GitHub：`git push origin main`
3. GitHub 自動觸發 webhook
4. 服務器接收 webhook 並執行部署
5. 網站自動更新

### 監控和維護

查看 webhook 服務狀態：
```bash
sudo systemctl status webhook-deploy
```

查看部署日誌：
```bash
sudo tail -f /var/log/webhook-deploy.log
```

手動重啟 webhook 服務：
```bash
sudo systemctl restart webhook-deploy
```

手動執行部署：
```bash
cd /var/www/compare-ai
sudo bash deploy.sh
```

---

## 四、故障排查

### Webhook 沒有觸發

1. 檢查 GitHub webhook 配置頁面的 "Recent Deliveries"
2. 確認服務器防火牆允許端口 9000
3. 檢查 webhook 服務是否運行：`sudo systemctl status webhook-deploy`

### 部署失敗

1. 查看日誌：`sudo tail -100 /var/log/webhook-deploy.log`
2. 檢查 git 權限：確保服務器可以訪問 GitHub repo
3. 檢查構建錯誤：手動運行 `npm run build`

### 網站沒有更新

1. 檢查 nginx 配置：`sudo nginx -t`
2. 重新加載 nginx：`sudo systemctl reload nginx`
3. 清除瀏覽器緩存
4. 檢查 dist 目錄權限：`ls -la /var/www/compare-ai/dist`

---

## 五、安全建議

1. **使用 HTTPS**：配置 Let's Encrypt SSL 證書
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d 207.148.116.138
   ```

2. **限制 webhook 訪問**：在 nginx 中添加 IP 白名單（GitHub webhook IP 範圍）

3. **定期更新**：保持系統和依賴包更新

4. **備份**：定期備份項目和配置文件

---

## 六、優勢對比

### 服務器端方案 vs GitHub Actions

**服務器端方案優勢：**
- ✅ 不需要配置 GitHub Secrets
- ✅ 部署速度更快（無需上傳文件）
- ✅ 完全控制部署流程
- ✅ 可以直接訪問服務器資源

**GitHub Actions 優勢：**
- ✅ 無需維護額外服務
- ✅ 內建 CI/CD 功能
- ✅ 更好的日誌和監控
- ✅ 支持多環境部署

根據你的需求，服務器端方案更適合單服務器部署場景。
