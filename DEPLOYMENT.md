# 自動部署配置指南

## 方案一：GitHub Actions 自動部署（推薦）

### 1. 在 GitHub 設置 Secrets

進入你的 GitHub repo → Settings → Secrets and variables → Actions，添加以下 secrets：

- `XAI_API_KEY`: 你的 XAI API 密鑰
- `SERVER_USER`: 服務器 SSH 用戶名（如 `root` 或 `ubuntu`）
- `SERVER_SSH_KEY`: 服務器 SSH 私鑰（完整內容）
- `DEPLOY_PATH`: 服務器部署路徑（如 `/var/www/compare-ai`）

### 2. 生成 SSH 密鑰（如果還沒有）

在本地執行：
```bash
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/github_actions
```

將公鑰添加到服務器：
```bash
ssh-copy-id -i ~/.ssh/github_actions.pub user@207.148.116.138
```

將私鑰內容複製到 GitHub Secrets 的 `SERVER_SSH_KEY`：
```bash
cat ~/.ssh/github_actions
```

### 3. 服務器配置

在服務器 207.148.116.138 上：

```bash
# 安裝 Node.js（如果還沒有）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 創建部署目錄
sudo mkdir -p /var/www/compare-ai
sudo chown $USER:$USER /var/www/compare-ai

# 安裝 nginx（如果還沒有）
sudo apt-get install -y nginx

# 配置 nginx
sudo nano /etc/nginx/sites-available/compare-ai
```

Nginx 配置示例：
```nginx
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

    location / {
        try_files $uri $uri/ /index.html;
    }

    # 啟用 gzip 壓縮
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
}
```

啟用站點：
```bash
sudo ln -s /etc/nginx/sites-available/compare-ai /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 4. 測試部署

推送代碼到 GitHub main 分支：
```bash
git add .
git commit -m "Setup auto deployment"
git push origin main
```

GitHub Actions 會自動觸發部署。

---

## 方案二：GitHub Webhooks + 服務器腳本

如果不想使用 GitHub Actions，可以在服務器上設置 webhook 接收器。

### 服務器端設置

1. 克隆項目到服務器：
```bash
cd /var/www
git clone https://github.com/你的用戶名/universal-compare.git compare-ai
cd compare-ai
npm install
```

2. 創建 webhook 接收腳本（需要額外配置）

---

## 環境變量配置

在服務器上創建 `.env.local`：
```bash
cd /var/www/compare-ai
echo "XAI_API_KEY=your_api_key_here" > .env.local
echo "SITE_URL=https://compare-ai.com" >> .env.local
```

注意：由於 Vite 在構建時注入環境變量，你需要在 GitHub Actions 中設置 `XAI_API_KEY` secret。

動態報告頁 SEO、API、`robots.txt` 和 `sitemap.xml` 需要 Node 服務常駐運行：
```bash
API_SERVER_PORT=3001 npm run server
```

---

## 故障排查

- 檢查 GitHub Actions 日誌：repo → Actions 標籤
- 檢查服務器日誌：`sudo tail -f /var/log/nginx/error.log`
- 測試 SSH 連接：`ssh -i ~/.ssh/github_actions user@207.148.116.138`
