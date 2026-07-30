import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import type { createFeaturedStore } from './featured';
import type { createReportStore } from './reports';
import { normalizeComparisonResult } from '../shared/comparisonSchema';

type ReportStore = ReturnType<typeof createReportStore>;
type FeaturedStore = ReturnType<typeof createFeaturedStore>;

type SatoriFont = { name: string; data: Buffer; weight: 700; style: 'normal' };

function probeFont(name: string, candidates: string[]): SatoriFont | null {
  for (const candidate of candidates) {
    try {
      const data = readFileSync(candidate);
      if (data.length > 0) return { name, data, weight: 700, style: 'normal' };
    } catch { /* Optional system and bundled fonts vary by deployment. */ }
  }
  return null;
}

// Inter does not cover CJK. Probe a separate Unicode font without making a
// missing platform-specific font fatal at module startup.
const latinFont = probeFont('Inter', [
  path.resolve(process.cwd(), 'public', 'fonts', 'Inter-Bold.ttf'),
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
]);
const cjkFont = probeFont('CJK Fallback', [
  path.resolve(process.cwd(), 'public', 'fonts', 'NotoSansCJK-Bold.ttf'),
  path.resolve(process.cwd(), 'public', 'fonts', 'NotoSansCJK-Bold.otf'),
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/Library/Fonts/Arial Unicode.ttf',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttf',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.otf',
]);
const ogFonts = [latinFont, cjkFont].filter((font): font is SatoriFont => font !== null);

type OgData = {
  itemA: string;
  itemB: string;
  verdict?: string;
  scoreA?: string | null;
  scoreB?: string | null;
  dimensionCount?: number;
};

function buildOgElement(data: OgData) {
  const { itemA, itemB, verdict, scoreA, scoreB, dimensionCount } = data;

  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: 'linear-gradient(135deg, #0a0f1f 0%, #1a1040 50%, #0d1530 100%)',
        padding: '60px',
        fontFamily: 'Inter, CJK Fallback, sans-serif',
        color: 'white',
      },
      children: [
        // Header
        {
          type: 'div',
          props: {
            style: { display: 'flex', alignItems: 'center', marginBottom: '40px' },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: '24px',
                    fontWeight: 700,
                    background: 'linear-gradient(90deg, #667eea, #764ba2)',
                    backgroundClip: 'text',
                    color: '#667eea',
                    letterSpacing: '-0.5px',
                  },
                  children: 'CompareAI',
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    marginLeft: '16px',
                    fontSize: '14px',
                    color: '#94a3b8',
                    borderLeft: '1px solid #334155',
                    paddingLeft: '16px',
                  },
                  children: 'AI Comparison Report',
                },
              },
            ],
          },
        },
        // Main title: Item A vs Item B
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: '1',
              gap: '24px',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: itemA.length > 20 ? '36px' : '44px',
                    fontWeight: 700,
                    textAlign: 'right',
                    flex: '1',
                    lineHeight: '1.1',
                  },
                  children: itemA,
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: '28px',
                    fontWeight: 700,
                    color: '#667eea',
                    padding: '8px 16px',
                    border: '2px solid #667eea',
                    borderRadius: '12px',
                  },
                  children: 'VS',
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: itemB.length > 20 ? '36px' : '44px',
                    fontWeight: 700,
                    textAlign: 'left',
                    flex: '1',
                    lineHeight: '1.1',
                  },
                  children: itemB,
                },
              },
            ],
          },
        },
        // Bottom: scores + verdict
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              marginTop: '40px',
            },
            children: [
              // Scores
              scoreA || scoreB
                ? {
                    type: 'div',
                    props: {
                      style: { display: 'flex', gap: '24px', fontSize: '18px' },
                      children: [
                        scoreA ? {
                          type: 'div',
                          props: {
                            style: { color: '#a5b4fc' },
                            children: `${itemA.slice(0, 15)}: ${scoreA}/10`,
                          },
                        } : null,
                        scoreB ? {
                          type: 'div',
                          props: {
                            style: { color: '#c4b5fd' },
                            children: `${itemB.slice(0, 15)}: ${scoreB}/10`,
                          },
                        } : null,
                      ].filter(Boolean),
                    },
                  }
                : dimensionCount
                  ? {
                      type: 'div',
                      props: {
                        style: { fontSize: '16px', color: '#94a3b8' },
                        children: `${dimensionCount} dimensions analyzed`,
                      },
                    }
                  : { type: 'div', props: { children: '' } },
              // Verdict snippet
              verdict
                ? {
                    type: 'div',
                    props: {
                      style: {
                        fontSize: '14px',
                        color: '#94a3b8',
                        maxWidth: '400px',
                        textAlign: 'right',
                        lineHeight: '1.4',
                      },
                      children: verdict.length > 100 ? `${verdict.slice(0, 97)}...` : verdict,
                    },
                  }
                : { type: 'div', props: { children: '' } },
            ],
          },
        },
      ],
    },
  };
}

const ogCache = new Map<string, { png: Buffer; ts: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_MAX_ENTRIES = 100;

function getCachedImage(slug: string, now: number) {
  for (const [key, value] of ogCache) {
    if (now - value.ts >= CACHE_TTL_MS) ogCache.delete(key);
  }
  const cached = ogCache.get(slug);
  if (!cached) return null;
  // Reinsertion makes Map iteration order an LRU order.
  ogCache.delete(slug);
  ogCache.set(slug, cached);
  return cached.png;
}

function cacheImage(slug: string, png: Buffer, now: number) {
  ogCache.delete(slug);
  ogCache.set(slug, { png, ts: now });
  while (ogCache.size > CACHE_MAX_ENTRIES) {
    const oldest = ogCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    ogCache.delete(oldest);
  }
}

export async function generateOgImage(slug: string, reportStore: ReportStore, featuredStore: FeaturedStore): Promise<Buffer | null> {
  const now = Date.now();
  const cached = getCachedImage(slug, now);
  if (cached) return cached;

  const featured = featuredStore.getFeaturedBySlug(slug);
  const report = featured?.reportId ? reportStore.getReport(featured.reportId) : null;
  if (!report) return null;

  const result = normalizeComparisonResult(report.result, { allowLegacyDimensionCount: true });
  if (!result) return null;
  const itemA = result.entityA.name;
  const itemB = result.entityB.name;

  // Compute scores
  const dimensions = result.dimensions;
  let sumA = 0, sumB = 0, countA = 0, countB = 0;
  for (const d of dimensions) {
    if (typeof d.analysis?.optional_score_a === 'number') { sumA += d.analysis.optional_score_a; countA++; }
    if (typeof d.analysis?.optional_score_b === 'number') { sumB += d.analysis.optional_score_b; countB++; }
  }

  const ogData: OgData = {
    itemA,
    itemB,
    verdict: result.recommendation?.short_verdict || result.recommendation?.which_to_choose_first,
    scoreA: countA > 0 ? (sumA / countA).toFixed(1) : null,
    scoreB: countB > 0 ? (sumB / countB).toFixed(1) : null,
    dimensionCount: dimensions.length || undefined,
  };

  const element = buildOgElement(ogData);

  try {
    const svg = await satori(element as any, {
      width: 1200,
      height: 630,
      fonts: ogFonts,
    });

    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width' as const, value: 1200 },
    });
    const png = resvg.render().asPng();

    const buffer = Buffer.from(png);
    cacheImage(slug, buffer, now);
    return buffer;
  } catch (err) {
    console.error('OG image generation failed:', err);
    return null;
  }
}
