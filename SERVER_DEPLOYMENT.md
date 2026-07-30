# Webhook-based server deployment

GitHub Actions is preferred because it deploys an already verified artifact. If a server-side GitHub webhook is required, use the hardened ESM receiver and the same atomic `deploy.sh` release flow.

## 1. Source and runtime setup

Follow [DEPLOYMENT.md](DEPLOYMENT.md) to create `/var/www/compare-ai/{source,releases,shared}` and configure `shared/.env.local`. Clone only source code into `/var/www/compare-ai/source`; runtime secrets remain under `shared` or `/etc`.

The receiver accepts only signed `push` events for one configured repository and branch. It requires a UUID delivery ID, persists delivery and revision replay state for 24 hours across restarts, limits request bodies, serializes deployment, and invokes `/bin/bash` with `execFile` (never a constructed shell command). Request bodies, signatures, secrets, and deploy output are not logged.

## 2. Webhook secret configuration

Create a root-owned environment file; never place the value in the unit file or repository:

```bash
sudo install -d -m 0750 -o root -g compare-ai-deploy /etc/compare-ai
sudo sh -c 'umask 027; {
  printf "WEBHOOK_SECRET="; openssl rand -hex 32
  printf "WEBHOOK_REPOSITORY=Kenneth0416/Universal-Compare\n"
  printf "WEBHOOK_BRANCH=main\n"
} > /etc/compare-ai/webhook.env'
sudo chown root:compare-ai-deploy /etc/compare-ai/webhook.env
sudo chmod 0640 /etc/compare-ai/webhook.env
```

`WEBHOOK_SECRET` must be at least 32 characters and cannot be a common placeholder. `WEBHOOK_REPOSITORY` must be an exact `owner/repository`. Missing or placeholder configuration makes the process exit immediately.

Install and start the unit:

```bash
sudo cp webhook-deploy.service /etc/systemd/system/webhook-deploy.service
sudo systemctl daemon-reload
sudo systemctl enable --now webhook-deploy.service
sudo systemctl status webhook-deploy.service
```

The supplied unit binds `127.0.0.1:9000`, uses a non-root user, loads secrets from `/etc/compare-ai/webhook.env`, and applies systemd hardening. It restarts the shipped `compare-ai.service` through the single-command sudoers rule documented in [DEPLOYMENT.md](DEPLOYMENT.md). The unit intentionally omits `NoNewPrivileges` because that flag would block the narrowly scoped restart elevation; all other listed hardening remains enabled.

## 3. Safe checks without a real secret

The smoke/check mode does not read `WEBHOOK_SECRET` or any other runtime secret:

```bash
node webhook-server.js --smoke
# Webhook smoke check passed (synthetic secret only)
```

Starting normally with no configuration must fail:

```bash
env -u WEBHOOK_SECRET -u WEBHOOK_REPOSITORY node webhook-server.js
```

## 4. Reverse proxy and GitHub settings

Use the webhook server block in `deployment/nginx-site.conf`, terminate TLS, and expose only `POST /webhook`; do not open port 9000 publicly. Keep `client_max_body_size 1m` aligned with `WEBHOOK_MAX_PAYLOAD_BYTES`.

In GitHub repository **Settings → Webhooks**:

- Payload URL: the HTTPS webhook URL
- Content type: `application/json`
- Secret: the exact value from `/etc/compare-ai/webhook.env`
- Events: push only

GitHub webhook source IP ranges can be an additional Nginx/firewall control, but signature verification remains mandatory. Refresh allowlists from GitHub's published metadata rather than copying stale ranges into this repository.

## 5. Deployment behavior and recovery

A valid push to the configured branch passes its 40-character `after` revision to `deploy.sh`. The script fetches that branch, verifies the revision belongs to it, archives build inputs from that exact commit into a fresh staging release, runs `npm ci`, builds there, replaces dependencies with `npm ci --omit=dev`, and only then atomically switches `current`. It keeps the previous release for rollback and refuses overlapping runs both in the receiver and via `flock`.

Useful checks:

```bash
journalctl -u webhook-deploy.service -f
readlink -f /var/www/compare-ai/current
curl -fsS http://127.0.0.1:3001/ >/dev/null
sudo nginx -t
```

Do not log request bodies or rerun failed payloads with their signature in command history.

## Security limitation: historical token

The current migration-plan file no longer contains the complete MiniMax JWT. Existing Git history and clones may still contain it. This setup does not rewrite history or rotate that token, so historical exposure is not safe merely because current-tree CI scanning passes.
