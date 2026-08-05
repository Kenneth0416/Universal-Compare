import crypto from 'node:crypto';
import type { Request } from 'express';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Recognizes requests from the local batch publisher job. The secret header is
 * the gate; the loopback socket check ensures the bypass can never be reached
 * through nginx from outside even if the secret leaks into logs.
 */
export function isInternalBatchRequest(req: Request): boolean {
  const secret = process.env.BATCH_INTERNAL_SECRET;
  if (!secret) return false;
  const presented = req.get('x-internal-batch');
  if (typeof presented !== 'string' || !presented) return false;
  const socketAddress = req.socket?.remoteAddress || '';
  if (!LOOPBACK_ADDRESSES.has(socketAddress)) return false;
  const left = Buffer.from(presented);
  const right = Buffer.from(secret);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
