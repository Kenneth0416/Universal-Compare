# CompareAI production deployment

The supported layout uses immutable releases and a single atomic symlink:

```text
/var/www/compare-ai/
  current -> releases/<release-id>
  releases/
  shared/.env.local
  shared/compareai-analytics.db
  incoming/
```

`deploy.sh` builds in a new release (webhook mode) or installs a CI-built artifact, runs `npm ci --omit=dev`, switches `current` atomically, restarts the app, and checks `http://127.0.0.1:3001/`. A failed restart/health check restores the previous symlink and restarts it. It never moves the newly built `dist` out of its release. Deployments are serialized with `flock`.

## Server preparation

Use Node.js 22, Nginx, `curl`, `flock`, and either systemd or PM2. Create separate runtime/deployment users where practical:

```bash
sudo install -d -o compare-ai-deploy -g compare-ai-deploy /var/www/compare-ai/{source,releases,incoming}
sudo install -d -m 0750 -o compare-ai -g compare-ai /var/www/compare-ai/shared
sudo install -d -m 0750 -o compare-ai-deploy -g compare-ai-deploy /var/log/compare-ai /var/lib/compare-ai
sudo install -m 0600 -o compare-ai -g compare-ai /dev/null /var/www/compare-ai/shared/.env.local
# Keep compare-ai-deploy out of the compare-ai group: deploy.sh never reads runtime secrets.
```

Populate `shared/.env.local` directly on the server. Do not upload it or print it in CI. At minimum production requires:

```dotenv
NODE_ENV=production
AI_PROVIDER=grok
XAI_API_KEY=<server-side-secret>
SITE_URL=https://compare-anythings.com
APP_URL=https://compare-anythings.com
ADMIN_PASSWORD=<distinct-random-secret>
ADMIN_SESSION_SECRET=<distinct-random-secret>
AI_SOURCE_SIGNING_SECRET=<distinct-random-secret>
API_SERVER_HOST=127.0.0.1
ANALYTICS_DB_PATH=/var/www/compare-ai/shared/compareai-analytics.db
API_SERVER_PORT=3001
```

For MiniMax use `AI_PROVIDER=minimax`, `MINIMAX_API_KEY=<server-side-secret>`, and optionally `MINIMAX_BASE_URL`. The deployment user deliberately cannot read `shared/.env.local`; the application validates the selected provider key, admin secrets, and HTTPS site URL at startup. Invalid configuration fails the private health check and atomically rolls back. API keys are runtime server values only; Vite and GitHub's build job do not receive them.

Install `deployment/compare-ai.service` as `/etc/systemd/system/compare-ai.service`, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable compare-ai.service
```

The SSH/webhook deployment user must be narrowly authorized to restart this service. For a system where `command -v systemctl` is `/usr/bin/systemctl`, install a root-owned `0440` sudoers fragment containing only:

```sudoers
compare-ai-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart compare-ai.service
```

Adjust the absolute binary path to the host, validate with `visudo -cf`, and do not grant the deployment user any other sudo command. The shipped webhook unit uses this systemd path; PM2 is an alternative only when a complete runtime-user PM2 service is configured separately.

Install `deployment/nginx-site.conf` after setting the real TLS `server_name`/listen directives. Its root is `/var/www/compare-ai/current/dist`; API and dynamic SEO routes proxy to the Node service. It supplies CSP, clickjacking, MIME-sniffing, referrer, opener, and permissions headers. Validate before reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

The CSP allows Google Fonts and required inline styles, but does not permit inline executable scripts. Re-test the application whenever a new third-party browser origin is introduced rather than broadening CSP speculatively.

## GitHub Actions

Configure the `production` environment with approval protection and these secrets:

- `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY`
- `SERVER_KNOWN_HOSTS` (pre-verified `known_hosts` line; do not replace with runtime `ssh-keyscan`)
- `DEPLOY_PATH` (normally `/var/www/compare-ai`)
- `PUBLIC_HEALTHCHECK_URL` (an HTTPS URL served by the production Nginx site)

No AI API key is a GitHub build secret. The workflow runs locked install, type check, tests, build, full and production audits, a redacted current-tree secret scan, and Nginx syntax validation. It uploads `package.json`, `package-lock.json`, `server`, `shared`, `dist`, and `tsconfig.json`, then invokes `deploy.sh`. The final public check requires CSP and other security headers.

The production audit gate is `npm audit --omit=dev --audit-level=high`; the full dependency audit also runs at `high`.

## Manual deployment

From a trusted checkout at `/var/www/compare-ai/source`:

```bash
DEPLOY_ROOT=/var/www/compare-ai SOURCE_DIR=/var/www/compare-ai/source sudo -u compare-ai-deploy ./deploy.sh
```

Or deploy a prebuilt complete artifact:

```bash
DEPLOY_ROOT=/var/www/compare-ai ./deploy.sh --artifact /trusted/path/deploy-artifact.tar.gz
```

Never put `.env.local`, webhook secrets, private keys, or database files in the artifact.

## Secret exposure status

The complete MiniMax JWT was replaced by a placeholder in the currently tracked migration plan. Git history, forks, caches, and existing clones may still contain that value. History was **not** rewritten, and the MiniMax token was **not** rotated by this work; therefore historical exposure must not be described as safe or remediated. Current-tree scanning does not make old commits safe.
