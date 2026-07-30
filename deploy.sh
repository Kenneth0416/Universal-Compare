#!/usr/bin/env bash

# Build/install each version in an isolated release, then atomically switch current.
# Runtime secrets stay in the shared env file and are never copied into artifacts.

set -Eeuo pipefail
umask 027

DEPLOY_ROOT="${DEPLOY_ROOT:-/var/www/compare-ai}"
SOURCE_DIR="${SOURCE_DIR:-$DEPLOY_ROOT/source}"
RELEASES_DIR="${RELEASES_DIR:-$DEPLOY_ROOT/releases}"
CURRENT_LINK="${CURRENT_LINK:-$DEPLOY_ROOT/current}"
SHARED_ENV_FILE="${SHARED_ENV_FILE:-$DEPLOY_ROOT/shared/.env.local}"
DEPLOY_LOCK_FILE="${DEPLOY_LOCK_FILE:-$RELEASES_DIR/.deploy.lock}"
DEPLOY_STATE_FILE="${DEPLOY_STATE_FILE:-$RELEASES_DIR/.last-deployed-sha}"
APP_RESTART_METHOD="${APP_RESTART_METHOD:-systemd}"
APP_SERVICE="${APP_SERVICE:-compare-ai.service}"
PM2_APP="${PM2_APP:-compare-ai}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:3001/}"
HEALTHCHECK_ATTEMPTS="${HEALTHCHECK_ATTEMPTS:-15}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-$RELEASES_DIR/.npm-cache}"
export NPM_CONFIG_CACHE
ARTIFACT=""
PREBUILT=false

usage() {
  echo "Usage: $0 [--artifact PATH]" >&2
  echo "Without --artifact, the checkout at SOURCE_DIR is built in the new release." >&2
}

while (($#)); do
  case "$1" in
    --artifact)
      [[ $# -ge 2 ]] || { usage; exit 64; }
      ARTIFACT="$2"
      PREBUILT=true
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage
      exit 64
      ;;
  esac
done

for number in "$HEALTHCHECK_ATTEMPTS" "$KEEP_RELEASES"; do
  [[ "$number" =~ ^[1-9][0-9]*$ ]] || { echo "Deployment count settings must be positive integers" >&2; exit 64; }
done

mkdir -p "$RELEASES_DIR" "$NPM_CONFIG_CACHE"
chmod 0750 "$NPM_CONFIG_CACHE"
exec 9>"$DEPLOY_LOCK_FILE"
if ! flock -n 9; then
  echo "Another deployment is already running" >&2
  exit 75
fi

[[ "$SHARED_ENV_FILE" == "$DEPLOY_ROOT/shared/"* ]] || {
  echo "SHARED_ENV_FILE must stay under DEPLOY_ROOT/shared" >&2
  exit 78
}
# The deployment identity intentionally cannot read runtime secrets. The app
# process validates them at startup; a configuration failure fails the health
# check and triggers an atomic rollback.

source_revision=""
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
[[ "$DEPLOY_BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "Invalid DEPLOY_BRANCH" >&2; exit 64; }
[[ -d "$SOURCE_DIR/.git" ]] || { echo "Source Git checkout not found: $SOURCE_DIR" >&2; exit 66; }
git -C "$SOURCE_DIR" fetch --quiet --prune origin "$DEPLOY_BRANCH"
branch_head="$(git -C "$SOURCE_DIR" rev-parse --verify "origin/$DEPLOY_BRANCH^{commit}")"
if $PREBUILT; then
  [[ "${GITHUB_SHA:-}" =~ ^[0-9a-fA-F]{40}$ ]] || { echo "Prebuilt artifacts require a full GITHUB_SHA" >&2; exit 64; }
  source_revision="$(git -C "$SOURCE_DIR" rev-parse --verify "$GITHUB_SHA^{commit}")"
else
  source_revision="${GITHUB_SHA:-$branch_head}"
  [[ "$source_revision" =~ ^[0-9a-fA-F]{40}$ ]] || { echo "Invalid source revision" >&2; exit 64; }
  source_revision="$(git -C "$SOURCE_DIR" rev-parse --verify "$source_revision^{commit}")"
fi
if [[ "$source_revision" != "$branch_head" ]]; then
  echo "Requested revision is not the current head of origin/$DEPLOY_BRANCH" >&2
  exit 66
fi
if [[ -f "$DEPLOY_STATE_FILE" ]]; then
  deployed_revision="$(tr -d '[:space:]' < "$DEPLOY_STATE_FILE")"
  [[ "$deployed_revision" =~ ^[0-9a-fA-F]{40}$ ]] || { echo "Invalid deployment state file" >&2; exit 78; }
  if ! git -C "$SOURCE_DIR" merge-base --is-ancestor "$deployed_revision" "$source_revision"; then
    if [[ "${ALLOW_DEPLOY_DOWNGRADE:-false}" != "true" ]]; then
      echo "Refusing non-forward deployment from $deployed_revision to $source_revision" >&2
      exit 66
    fi
    echo "WARNING: explicit ALLOW_DEPLOY_DOWNGRADE=true accepted a non-forward deployment" >&2
  fi
fi
GITHUB_SHA="$source_revision"

release_id="$(date -u +%Y%m%dT%H%M%SZ)-${GITHUB_SHA:-artifact}-${GITHUB_RUN_ID:-$$}"
release_id="${release_id//[^A-Za-z0-9._-]/-}"
final_release="$RELEASES_DIR/$release_id"
work_dir="$(mktemp -d "$RELEASES_DIR/.staging-${release_id}.XXXXXX")"
release_dir="$work_dir/release"
mkdir -p "$release_dir"

cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

copy_checkout() {
  local source="$1"
  for file in package.json package-lock.json tsconfig.json vite.config.ts index.html; do
    [[ -f "$source/$file" ]] || { echo "Missing build input: $file" >&2; exit 66; }
    cp "$source/$file" "$release_dir/$file"
  done
  for directory in src public server shared; do
    [[ -d "$source/$directory" ]] || { echo "Missing build input: $directory" >&2; exit 66; }
    cp -a "$source/$directory" "$release_dir/$directory"
  done
}

copy_artifact() {
  local artifact="$1"
  local extracted="$work_dir/artifact"
  mkdir -p "$extracted"
  if [[ -f "$artifact" ]]; then
    tar -tzf "$artifact" >/dev/null
    if tar -tzf "$artifact" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
      echo "Artifact contains an unsafe path" >&2
      exit 66
    fi
    tar -xzf "$artifact" -C "$extracted" --no-same-owner --no-same-permissions
  elif [[ -d "$artifact" ]]; then
    cp -a "$artifact/." "$extracted/"
  else
    echo "Artifact not found" >&2
    exit 66
  fi
  for required in package.json package-lock.json server shared dist; do
    [[ -e "$extracted/$required" ]] || { echo "Incomplete artifact: missing $required" >&2; exit 66; }
  done
  cp -a "$extracted/package.json" "$extracted/package-lock.json" "$extracted/server" "$extracted/shared" "$extracted/dist" "$release_dir/"
  if [[ -f "$extracted/tsconfig.json" ]]; then
    cp "$extracted/tsconfig.json" "$release_dir/"
  fi
}

if $PREBUILT; then
  copy_artifact "$ARTIFACT"
else
  archived_source="$work_dir/source"
  mkdir -p "$archived_source"
  git -C "$SOURCE_DIR" archive "$source_revision" -- package.json package-lock.json tsconfig.json vite.config.ts index.html src public server shared \
    | tar -x -C "$archived_source"
  copy_checkout "$archived_source"
fi

cd "$release_dir"
if ! $PREBUILT; then
  echo "Installing build dependencies and building release $release_id"
  npm ci
  npm run build
  rm -rf node_modules
fi

[[ -f dist/index.html ]] || { echo "Build did not produce dist/index.html" >&2; exit 70; }
echo "Installing production dependencies"
npm ci --omit=dev
ln -s "$SHARED_ENV_FILE" .env.local

# Keep the release readable by the runtime service without making it writable.
find "$release_dir" -type d -exec chmod 0755 {} +
chmod -R go-w "$release_dir"

mv "$release_dir" "$final_release"
previous_release=""
if [[ -L "$CURRENT_LINK" ]]; then
  previous_release="$(readlink -f "$CURRENT_LINK" || true)"
fi
ln -s "$final_release" "$CURRENT_LINK.next"
mv -Tf "$CURRENT_LINK.next" "$CURRENT_LINK"

restart_application() {
  case "$APP_RESTART_METHOD" in
    systemd)
      [[ "$APP_SERVICE" =~ ^[A-Za-z0-9@_.-]+$ ]] || return 64
      if [[ $EUID -eq 0 ]]; then
        systemctl restart "$APP_SERVICE"
      else
        sudo -n systemctl restart "$APP_SERVICE"
      fi
      ;;
    pm2)
      [[ "$PM2_APP" =~ ^[A-Za-z0-9@_.-]+$ ]] || return 64
      pm2 restart "$PM2_APP" --update-env
      ;;
    *)
      echo "APP_RESTART_METHOD must be systemd or pm2" >&2
      return 64
      ;;
  esac
}

health_check() {
  local attempt
  for ((attempt = 1; attempt <= HEALTHCHECK_ATTEMPTS; attempt++)); do
    if curl --fail --silent --show-error --max-time 5 "$HEALTHCHECK_URL" >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

rollback() {
  echo "Release failed health validation; rolling back" >&2
  if [[ -n "$previous_release" && -d "$previous_release" ]]; then
    ln -s "$previous_release" "$CURRENT_LINK.rollback"
    mv -Tf "$CURRENT_LINK.rollback" "$CURRENT_LINK"
    restart_application || true
  else
    rm -f "$CURRENT_LINK"
  fi
  rm -rf "$final_release"
}

if ! restart_application || ! health_check; then
  rollback
  exit 70
fi

state_tmp="${DEPLOY_STATE_FILE}.${release_id}.tmp"
printf '%s\n' "$source_revision" > "$state_tmp"
chmod 0640 "$state_tmp"
mv -f "$state_tmp" "$DEPLOY_STATE_FILE"
echo "Release $release_id is healthy and active"

# Remove old inactive releases only after a successful restart and health check.
mapfile -t old_releases < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d ! -name '.staging-*' -printf '%T@ %p\n' | sort -nr | tail -n "+$((KEEP_RELEASES + 1))" | cut -d' ' -f2-)
for old_release in "${old_releases[@]}"; do
  [[ "$old_release" == "$final_release" || "$old_release" == "$previous_release" ]] || rm -rf "$old_release"
done
