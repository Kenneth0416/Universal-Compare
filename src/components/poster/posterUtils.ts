export const POSTER_SCORE_MAX = 10;
export const MAX_POSTER_DIMENSIONS = 6;
export const MAX_POSTER_FILENAME_LENGTH = 120;

/** Shared 0–10 score normalization for result charts and every poster surface. */
export function normalizeComparisonScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(POSTER_SCORE_MAX, Math.max(0, value));
}

// Kept as an alias for existing poster callers.
export const normalizePosterScore = normalizeComparisonScore;

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function stableDimensionKeys(
  dimensions: ReadonlyArray<{ key?: unknown; label?: unknown }>
): string[] {
  const occurrences = new Map<string, number>();
  return dimensions.map((dimension) => {
    const rawKey = typeof dimension.key === 'string' ? dimension.key.normalize('NFKC').trim() : '';
    const rawLabel = typeof dimension.label === 'string' ? dimension.label.normalize('NFKC').trim() : '';
    const candidate = rawKey || rawLabel || 'dimension';
    const base = candidate.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'dimension';
    const identity = `${rawKey.toLocaleLowerCase()}\u0000${rawLabel.toLocaleLowerCase()}`;
    const stableBase = `${base}-${stableHash(identity)}`;
    const occurrence = (occurrences.get(stableBase) ?? 0) + 1;
    occurrences.set(stableBase, occurrence);
    return occurrence === 1 ? stableBase : `${stableBase}-${occurrence}`;
  });
}

export function averagePosterScores(values: unknown[]): number | null {
  const scores = values
    .map(normalizeComparisonScore)
    .filter((value): value is number => value !== null);
  if (!scores.length) return null;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

export function formatPosterScore(value: number | null): string {
  return value === null ? '—' : value.toFixed(1);
}

export function clampPosterText(value: unknown, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function sanitizePosterFilename(value: string, fallback = 'compareai-poster'): string {
  const sanitized = value
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, MAX_POSTER_FILENAME_LENGTH);
  return sanitized || fallback;
}

/** Truncates the descriptive base before appending the uniqueness suffix. */
export function buildPosterFilename(
  descriptiveBase: string,
  uniqueSuffix: string,
  extension: 'png' | 'zip' = 'png'
): string {
  const suffix = sanitizePosterFilename(uniqueSuffix, 'poster').slice(-36);
  const reservedLength = suffix.length + extension.length + 2;
  const base = sanitizePosterFilename(descriptiveBase).slice(
    0,
    Math.max(1, MAX_POSTER_FILENAME_LENGTH - reservedLength)
  ).replace(/[. ]+$/g, '') || 'compareai';
  return `${base}-${suffix}.${extension}`;
}
