import { createHmac } from 'node:crypto';

type DatabaseConnection = {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    get: (...params: unknown[]) => any;
    run: (...params: unknown[]) => { changes: number };
  };
};

const initialized = new WeakSet<object>();

function initialize(db: DatabaseConnection) {
  if (initialized.has(db as object)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_rate_limits (
      key_hash     TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      request_count INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_api_rate_window ON api_rate_limits(window_start);
  `);
  initialized.add(db as object);
}

export function consumePersistentLimit({
  db,
  secret,
  key,
  limit,
  windowMs,
  now = Date.now(),
}: {
  db: DatabaseConnection;
  secret: string;
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}) {
  initialize(db);
  const keyHash = createHmac('sha256', secret).update(`rate-limit:${key}`).digest('hex');
  const resetBefore = now - windowMs;
  const row = db.prepare(`
    INSERT INTO api_rate_limits (key_hash, window_start, request_count)
    VALUES (?, ?, 1)
    ON CONFLICT(key_hash) DO UPDATE SET
      request_count = CASE
        WHEN api_rate_limits.window_start <= ? THEN 1
        ELSE api_rate_limits.request_count + 1
      END,
      window_start = CASE
        WHEN api_rate_limits.window_start <= ? THEN excluded.window_start
        ELSE api_rate_limits.window_start
      END
    RETURNING window_start AS windowStart, request_count AS requestCount
  `).get(keyHash, now, resetBefore, resetBefore) as { windowStart: number; requestCount: number };

  // Opportunistic bounded cleanup; failures must not accidentally allow requests.
  if (Math.random() < 0.01) {
    db.prepare('DELETE FROM api_rate_limits WHERE window_start < ?').run(now - 7 * 24 * 60 * 60 * 1_000);
  }

  return {
    allowed: row.requestCount <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((row.windowStart + windowMs - now) / 1_000)),
  };
}
