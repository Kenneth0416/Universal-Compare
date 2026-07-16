export const POSTER_SCORE_MAX = 10;

export function normalizePosterScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(POSTER_SCORE_MAX, Math.max(0, value));
}

export function averagePosterScores(values: unknown[]): number | null {
  const scores = values
    .map(normalizePosterScore)
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
    .slice(0, 120);
  return sanitized || fallback;
}
