import crypto from 'node:crypto';

export const ADMIN_SESSION_COOKIE = 'compareai_admin_session';
export const ADMIN_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function sign(secret: string, payload: string) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function createAdminSessionToken(secret: string, createdAt = Date.now()) {
  const timestamp = String(createdAt);
  const signature = sign(secret, timestamp);
  return `${timestamp}.${signature}`;
}

export function verifyAdminSessionToken(token: string | undefined, secret: string, now = Date.now()) {
  if (!token || !secret) return false;

  const [timestamp, signature, extra] = token.split('.');
  if (!timestamp || !signature || extra) return false;

  const createdAt = Number(timestamp);
  if (!Number.isFinite(createdAt)) return false;
  if (createdAt > now) return false;
  if (now - createdAt > ADMIN_SESSION_MAX_AGE_MS) return false;

  return safeEqual(signature, sign(secret, timestamp));
}

export function parseCookieHeader(header: string | undefined) {
  if (!header) return {} as Record<string, string>;

  return header.split(';').reduce<Record<string, string>>((cookies, part) => {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) return cookies;

    const key = part.slice(0, separatorIndex).trim();
    const rawValue = part.slice(separatorIndex + 1).trim();
    if (!key) return cookies;

    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      cookies[key] = rawValue;
    }

    return cookies;
  }, {});
}

export function getAdminSessionCookieOptions(maxAgeMs = ADMIN_SESSION_MAX_AGE_MS) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: maxAgeMs,
    path: '/',
  };
}
