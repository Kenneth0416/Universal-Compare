# 域名配置指南 - compare-anythings.com

## 步驟 1：在 Cloudflare 配置 DNS

1. 登入 Cloudflare Dashboard：https://dash.cloudflare.com
2. 選擇域名 `compare-anythings.com`
3. 進入 **DNS** → **Records**
4. 添加以下 DNS 記錄：

### A 記錄（主域名）
- **Type**: A
- **Name**: @
- **IPv4 address**: 207.148.116.138
- **Proxy status**: DNS only（灰色雲朵）⚠️ 重要：先不要開啟 Proxy
- **TTL**: Auto

### A 記錄（www 子域名）
- **Type**: A
- **Name**: www
- **IPv4 address**: 207.148.116.138
- **Proxy status**: DNS only（灰色雲朵）
- **TTL**: Auto

## 步驟 2：等待 DNS 傳播

DNS 記錄通常需要 5-30 分鐘生效。你可以使用以下命令檢查：

```bash
# 檢查主域名
dig compare-anythings.com +short

# 檢查 www 子域名
dig www.compare-anythings.com +short

# 應該都返回：207.148.116.138
```

或訪問：https://dnschecker.org/#A/compare-anythings.com

## 步驟 3：配置 SSL 證書（DNS 生效後執行）

DNS 生效後，在服務器上執行：

```bash
ssh root@207.148.116.138

# 獲取 SSL 證書
certbot --nginx -d compare-anythings.com -d www.compare-anythings.com

# 按照提示操作：
# 1. 輸入郵箱地址
# 2. 同意服務條款 (Y)
# 3. 選擇是否接收郵件 (Y/N)
# 4. 選擇重定向 HTTP 到 HTTPS (2)
```

證書會自動配置並每 90 天自動續期。

## 步驟 4：更新 GitHub Webhook URL

1. 進入：https://github.com/Kenneth0416/Universal-Compare/settings/hooks
2. 編輯現有的 webhook
3. 更新 **Payload URL** 為：`http://compare-anythings.com:9000/webhook`
4. 保存更改

## 步驟 5：開啟 Cloudflare Proxy（可選）

SSL 證書配置完成後，可以開啟 Cloudflare 的 Proxy 功能獲得額外保護：

1. 回到 Cloudflare DNS 設置
2. 點擊 A 記錄的雲朵圖標，變為橙色（Proxied）
3. 這會啟用 Cloudflare 的 CDN、DDoS 防護和 WAF

**注意**：開啟 Proxy 後，webhook URL 需要改為 HTTPS：
- `https://compare-anythings.com:9000/webhook`

## 驗證配置

配置完成後，訪問以下 URL 確認：

- ✅ http://compare-anythings.com
- ✅ http://www.compare-anythings.com
- ✅ https://compare-anythings.com（SSL 配置後）
- ✅ https://www.compare-anythings.com（SSL 配置後）

## 當前狀態

- ✅ 服務器 nginx 已配置域名
- ✅ Certbot 已安裝
- ⏳ 等待你在 Cloudflare 配置 DNS
- ⏳ DNS 生效後配置 SSL
- ⏳ 更新 GitHub webhook URL

## 故障排查

### DNS 未生效
- 等待更長時間（最多 48 小時）
- 檢查 Cloudflare 中的 DNS 記錄是否正確
- 確認域名 nameservers 已指向 Cloudflare

### SSL 證書獲取失敗
- 確認 DNS 已完全生效
- 確認防火牆開放了 80 和 443 端口
- 檢查 nginx 配置是否正確

### Webhook 不工作
- 確認 GitHub webhook URL 正確
- 檢查防火牆開放了 9000 端口
- 查看日誌：`tail -f /var/log/webhook-deploy.log`
