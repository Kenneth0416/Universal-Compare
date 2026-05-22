import type { FeaturedComparison } from './featured';
import type { ReportData, ReportListItem } from './reports';

const DEFAULT_SITE_URL = 'https://compare-anythings.com';
const OG_IMAGE_PATH = '/og-image.png';

type SeoReportResult = {
  entityA?: { name?: string; category?: string };
  entityB?: { name?: string; category?: string };
  dimensions?: Array<{
    key?: string;
    label?: string;
    why_it_matters?: string;
    analysis?: {
      item_a_summary?: string;
      item_b_summary?: string;
      key_difference?: string;
      optional_score_a?: number;
      optional_score_b?: number;
      citations?: Array<{ url?: string; title?: string }>;
    };
  }>;
  sources?: Array<{ url?: string; title?: string; snippet?: string }>;
  prosCons?: {
    item_a_pros?: string[];
    item_a_cons?: string[];
    item_b_pros?: string[];
    item_b_cons?: string[];
  };
  recommendation?: {
    best_for_a?: string[];
    best_for_b?: string[];
    which_to_choose_first?: string;
    when_not_to_compare_directly?: string;
    short_verdict?: string;
    long_verdict?: string;
  };
};

export type SitemapReport = Pick<ReportListItem, 'createdAt'> & { slug: string };
export type SeoComparisonLink = Pick<FeaturedComparison, 'itemA' | 'itemB' | 'description' | 'slug'>;

function normalizeSiteUrl(siteUrl = DEFAULT_SITE_URL) {
  return siteUrl.replace(/\/+$/, '');
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, ' ');
}

function truncateSentence(value: string, maxLength: number) {
  const normalized = stripHtml(value).replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function getReportResult(report: ReportData): SeoReportResult {
  return (report.result && typeof report.result === 'object' ? report.result : {}) as SeoReportResult;
}

function getEntityNames(report: ReportData) {
  const result = getReportResult(report);
  return {
    itemA: result.entityA?.name?.trim() || report.itemA,
    itemB: result.entityB?.name?.trim() || report.itemB,
  };
}

function getReportDescription(report: ReportData, featured: FeaturedComparison | null) {
  const { itemA, itemB } = getEntityNames(report);
  const result = getReportResult(report);
  const source =
    featured?.description ||
    result.recommendation?.short_verdict ||
    result.recommendation?.long_verdict ||
    `Compare ${itemA} and ${itemB} with AI-powered analysis, key differences, pros and cons, and a clear recommendation.`;

  return truncateSentence(source, 160);
}

function getIsoDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function jsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function renderJsonLdBlocks(blocks: unknown[]) {
  return blocks
    .map((block) => `<script type="application/ld+json">${jsonLd(block)}</script>`)
    .join('\n');
}

function buildStructuredData(report: ReportData, featured: FeaturedComparison | null, siteUrl: string) {
  const { itemA, itemB } = getEntityNames(report);
  const result = getReportResult(report);
  const title = `${itemA} vs ${itemB}: AI Comparison Report | CompareAI`;
  const description = getReportDescription(report, featured);
  const url = featured?.slug
    ? `${siteUrl}/compare/${encodeURIComponent(featured.slug)}`
    : `${siteUrl}/r/${encodeURIComponent(report.reportId)}`;
  const language = report.language || 'en';
  const isoDate = report.createdAt;
  const image = `${siteUrl}${OG_IMAGE_PATH}`;

  // Article schema - primary content type for comparison reports
  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    url,
    image,
    datePublished: isoDate,
    dateModified: isoDate,
    inLanguage: language,
    author: {
      '@type': 'Organization',
      name: 'CompareAI Editorial Team',
      url: `${siteUrl}/about`,
    },
    publisher: {
      '@type': 'Organization',
      name: 'CompareAI',
      url: siteUrl,
      logo: { '@type': 'ImageObject', url: `${siteUrl}${OG_IMAGE_PATH}` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    about: [
      { '@type': 'Thing', name: itemA },
      { '@type': 'Thing', name: itemB },
    ],
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['.seo-description', '#seo-verdict', '.seo-kicker'],
    },
  };

  const reportSources = result.sources || [];
  const validReportSources = reportSources.filter((s) => s.url && s.title);
  if (validReportSources.length > 0) {
    (article as any).citation = validReportSources.map((s) => ({
      '@type': 'WebPage', url: s.url, name: s.title,
    }));
  }

  // Per-dimension Review schemas - enables LLMs to extract individual comparisons
  const dimensions = result.dimensions || [];
  const reviews = dimensions
    .filter((d) => d.label || d.key)
    .map((d) => {
      const aspect = d.label || d.key || 'Comparison';
      const reviewBody = d.analysis?.key_difference || d.why_it_matters || '';
      const scoreA = d.analysis?.optional_score_a;
      const scoreB = d.analysis?.optional_score_b;

      const review: Record<string, unknown> = {
        '@type': 'Review',
        name: `${aspect}: ${itemA} vs ${itemB}`,
        reviewAspect: aspect,
        itemReviewed: [
          { '@type': 'Thing', name: itemA },
          { '@type': 'Thing', name: itemB },
        ],
        reviewBody,
        author: { '@type': 'Organization', name: 'CompareAI Editorial Team' },
      };

      if (typeof scoreA === 'number' || typeof scoreB === 'number') {
        const avg = ((scoreA ?? 0) + (scoreB ?? 0)) / 2;
        review.reviewRating = {
          '@type': 'Rating',
          ratingValue: String(avg),
          bestRating: '10',
          worstRating: '0',
        };
      }

      // positiveNotes = item A's strengths per dimension, negativeNotes = weaknesses
      if (d.analysis?.item_a_summary || d.analysis?.item_b_summary) {
        const notes: Array<Record<string, unknown>> = [];
        if (d.analysis?.item_a_summary) {
          notes.push({ '@type': 'ListItem', position: notes.length + 1, name: `${itemA}: ${d.analysis.item_a_summary}` });
        }
        if (d.analysis?.item_b_summary) {
          notes.push({ '@type': 'ListItem', position: notes.length + 1, name: `${itemB}: ${d.analysis.item_b_summary}` });
        }
        if (notes.length) {
          review.positiveNotes = { '@type': 'ItemList', itemListElement: notes };
        }
      }

      const dimCitations = (d.analysis as any)?.citations || [];
      const validDimCitations = dimCitations.filter((c: any) => c?.url && c?.title);
      if (validDimCitations.length > 0) {
        review.citation = validDimCitations.map((c: any) => ({
          '@type': 'WebPage', url: c.url, name: c.title,
        }));
      }

      return review;
    });

  // Pros/Cons Review for entity A
  const prosCons = result.prosCons;
  const prosConsReviews: Array<Record<string, unknown>> = [];
  if (prosCons) {
    if (prosCons.item_a_pros?.length || prosCons.item_a_cons?.length) {
      const review: Record<string, unknown> = {
        '@type': 'Review',
        name: `Pros and Cons of ${itemA}`,
        itemReviewed: { '@type': 'Thing', name: itemA },
        author: { '@type': 'Organization', name: 'CompareAI' },
      };
      if (prosCons.item_a_pros?.length) {
        review.positiveNotes = {
          '@type': 'ItemList',
          itemListElement: prosCons.item_a_pros.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p })),
        };
      }
      if (prosCons.item_a_cons?.length) {
        review.negativeNotes = {
          '@type': 'ItemList',
          itemListElement: prosCons.item_a_cons.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c })),
        };
      }
      prosConsReviews.push(review);
    }

    if (prosCons.item_b_pros?.length || prosCons.item_b_cons?.length) {
      const review: Record<string, unknown> = {
        '@type': 'Review',
        name: `Pros and Cons of ${itemB}`,
        itemReviewed: { '@type': 'Thing', name: itemB },
        author: { '@type': 'Organization', name: 'CompareAI' },
      };
      if (prosCons.item_b_pros?.length) {
        review.positiveNotes = {
          '@type': 'ItemList',
          itemListElement: prosCons.item_b_pros.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p })),
        };
      }
      if (prosCons.item_b_cons?.length) {
        review.negativeNotes = {
          '@type': 'ItemList',
          itemListElement: prosCons.item_b_cons.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c })),
        };
      }
      prosConsReviews.push(review);
    }
  }

  // FAQPage schema - derived from recommendation data (most LLM-friendly format)
  const recommendation = result.recommendation;
  const faqEntities: Array<Record<string, unknown>> = [];

  if (recommendation?.which_to_choose_first) {
    faqEntities.push({
      '@type': 'Question',
      name: `Which should I choose: ${itemA} or ${itemB}?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: recommendation.which_to_choose_first,
      },
    });
  }

  if (recommendation?.short_verdict || recommendation?.long_verdict) {
    faqEntities.push({
      '@type': 'Question',
      name: `What is the verdict: ${itemA} vs ${itemB}?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: recommendation.long_verdict || recommendation.short_verdict || '',
      },
    });
  }

  if (recommendation?.best_for_a?.length) {
    faqEntities.push({
      '@type': 'Question',
      name: `When should I choose ${itemA}?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: recommendation.best_for_a.join('. ') + '.',
      },
    });
  }

  if (recommendation?.best_for_b?.length) {
    faqEntities.push({
      '@type': 'Question',
      name: `When should I choose ${itemB}?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: recommendation.best_for_b.join('. ') + '.',
      },
    });
  }

  if (prosCons?.item_a_pros?.length) {
    faqEntities.push({
      '@type': 'Question',
      name: `What are the advantages of ${itemA} over ${itemB}?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: prosCons.item_a_pros.join('. ') + '.',
      },
    });
  }

  if (prosCons?.item_b_pros?.length) {
    faqEntities.push({
      '@type': 'Question',
      name: `What are the advantages of ${itemB} over ${itemA}?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: prosCons.item_b_pros.join('. ') + '.',
      },
    });
  }

  const blocks: unknown[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'CompareAI',
      url: siteUrl,
      logo: `${siteUrl}/logo.svg`,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'CompareAI',
      url: siteUrl,
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${siteUrl}/?q={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
    },
    article,
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          item: { '@id': `${siteUrl}/`, name: 'Home' },
        },
        {
          '@type': 'ListItem',
          position: 2,
          item: { '@id': url, name: `${itemA} vs ${itemB}` },
        },
      ],
    },
    ...reviews,
    ...prosConsReviews,
  ];

  // Add FAQPage only if we have Q&A pairs
  if (faqEntities.length > 0) {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqEntities,
    });
  }

  return blocks;
}

function computeDimensionScores(report: ReportData) {
  const result = getReportResult(report);
  const dimensions = result.dimensions || [];
  let sumA = 0, sumB = 0, countA = 0, countB = 0;
  for (const d of dimensions) {
    if (typeof d.analysis?.optional_score_a === 'number') { sumA += d.analysis.optional_score_a; countA++; }
    if (typeof d.analysis?.optional_score_b === 'number') { sumB += d.analysis.optional_score_b; countB++; }
  }
  return {
    avgA: countA > 0 ? (sumA / countA).toFixed(1) : null,
    avgB: countB > 0 ? (sumB / countB).toFixed(1) : null,
    hasScores: countA > 0 || countB > 0,
  };
}

function renderComparisonTable(report: ReportData) {
  const result = getReportResult(report);
  const dimensions = result.dimensions || [];
  const scored = dimensions.filter(
    (d) => typeof d.analysis?.optional_score_a === 'number' || typeof d.analysis?.optional_score_b === 'number',
  );
  if (!scored.length) return '';

  const { itemA, itemB } = getEntityNames(report);
  const { avgA, avgB } = computeDimensionScores(report);

  const rows = scored.map((d) => {
    const label = d.label || d.key || 'Dimension';
    const sA = typeof d.analysis?.optional_score_a === 'number' ? `${d.analysis.optional_score_a}/10` : '—';
    const sB = typeof d.analysis?.optional_score_b === 'number' ? `${d.analysis.optional_score_b}/10` : '—';
    return `<tr><td>${escapeHtml(label)}</td><td>${sA}</td><td>${sB}</td></tr>`;
  }).join('');

  const footerA = avgA ? `${avgA}/10` : '—';
  const footerB = avgB ? `${avgB}/10` : '—';

  return `
    <table class="seo-comparison-table">
      <thead><tr><th>Dimension</th><th>${escapeHtml(itemA)}</th><th>${escapeHtml(itemB)}</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th>Overall</th><th>${footerA}</th><th>${footerB}</th></tr></tfoot>
    </table>`;
}

function renderDimensionSummary(report: ReportData) {
  const result = getReportResult(report);
  const dimensions = result.dimensions || [];
  if (!dimensions.length) return '';

  const { itemA, itemB } = getEntityNames(report);

  const items = dimensions.map((dimension) => {
    const label = dimension.label || dimension.key || 'Comparison dimension';
    const keyDiff = dimension.analysis?.key_difference || '';
    const summaryA = dimension.analysis?.item_a_summary || '';
    const summaryB = dimension.analysis?.item_b_summary || '';
    const scoreA = dimension.analysis?.optional_score_a;
    const scoreB = dimension.analysis?.optional_score_b;
    const why = dimension.why_it_matters || '';

    const parts: string[] = [];
    if (keyDiff) parts.push(escapeHtml(keyDiff));
    if (summaryA) parts.push(`<strong>${escapeHtml(itemA)}:</strong> ${escapeHtml(summaryA)}`);
    if (summaryB) parts.push(`<strong>${escapeHtml(itemB)}:</strong> ${escapeHtml(summaryB)}`);
    if (typeof scoreA === 'number' || typeof scoreB === 'number') {
      const scores: string[] = [];
      if (typeof scoreA === 'number') scores.push(`${itemA}: ${scoreA}/10`);
      if (typeof scoreB === 'number') scores.push(`${itemB}: ${scoreB}/10`);
      parts.push(`<em>Scores — ${scores.join(', ')}</em>`);
    }
    if (why && why !== keyDiff) parts.push(escapeHtml(why));

    const citations = (dimension.analysis as any)?.citations || [];
    const validCitations = citations.filter((c: any) => c?.url && c?.title);
    if (validCitations.length > 0) {
      const citationLinks = validCitations
        .map((c: any) => `<a href="${escapeHtml(c.url)}" rel="noopener" target="_blank">${escapeHtml(c.title)}</a>`)
        .join(', ');
      parts.push(`<p class="seo-citations">Sources: ${citationLinks}</p>`);
    }

    return `
      <li>
        <h3>${escapeHtml(label)}</h3>
        ${parts.map((p) => `<p>${p}</p>`).join('')}
      </li>`;
  });

  return `<section class="seo-section" id="key-differences"><h2>What are the key differences between ${escapeHtml(itemA)} and ${escapeHtml(itemB)}?</h2><ul>${items.join('')}</ul></section>`;
}

function renderProsCons(report: ReportData) {
  const result = getReportResult(report);
  const prosCons = result.prosCons;
  if (!prosCons) return '';

  const { itemA, itemB } = getEntityNames(report);
  const sections: string[] = [];

  if (prosCons.item_a_pros?.length || prosCons.item_a_cons?.length) {
    const pros = (prosCons.item_a_pros || []).map((p) => `<li>${escapeHtml(p)}</li>`).join('');
    const cons = (prosCons.item_a_cons || []).map((c) => `<li>${escapeHtml(c)}</li>`).join('');
    sections.push(`
      <div>
        <h3>${escapeHtml(itemA)}</h3>
        ${pros ? `<h4>Strengths</h4><ul>${pros}</ul>` : ''}
        ${cons ? `<h4>Weaknesses</h4><ul>${cons}</ul>` : ''}
      </div>`);
  }

  if (prosCons.item_b_pros?.length || prosCons.item_b_cons?.length) {
    const pros = (prosCons.item_b_pros || []).map((p) => `<li>${escapeHtml(p)}</li>`).join('');
    const cons = (prosCons.item_b_cons || []).map((c) => `<li>${escapeHtml(c)}</li>`).join('');
    sections.push(`
      <div>
        <h3>${escapeHtml(itemB)}</h3>
        ${pros ? `<h4>Strengths</h4><ul>${pros}</ul>` : ''}
        ${cons ? `<h4>Weaknesses</h4><ul>${cons}</ul>` : ''}
      </div>`);
  }

  if (!sections.length) return '';
  return `<section class="seo-section" id="pros-cons"><h2>What are the pros and cons of ${escapeHtml(itemA)} vs ${escapeHtml(itemB)}?</h2>${sections.join('')}</section>`;
}

function renderRecommendation(report: ReportData) {
  const result = getReportResult(report);
  const rec = result.recommendation;
  if (!rec) return '';

  const { itemA, itemB } = getEntityNames(report);
  const parts: string[] = [];

  // Direct verdict — the most important part for LLM extraction
  if (rec.which_to_choose_first) {
    parts.push(`<p id="seo-verdict"><strong>Verdict:</strong> ${escapeHtml(rec.which_to_choose_first)}</p>`);
  }

  if (rec.short_verdict) {
    parts.push(`<p>${escapeHtml(rec.short_verdict)}</p>`);
  }

  if (rec.long_verdict) {
    parts.push(`<p>${escapeHtml(rec.long_verdict)}</p>`);
  }

  if (rec.best_for_a?.length) {
    parts.push(`<h3>Best for ${escapeHtml(itemA)}</h3><ul>${rec.best_for_a.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`);
  }

  if (rec.best_for_b?.length) {
    parts.push(`<h3>Best for ${escapeHtml(itemB)}</h3><ul>${rec.best_for_b.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`);
  }

  if (rec.when_not_to_compare_directly) {
    parts.push(`<h3>When not to compare directly</h3><p>${escapeHtml(rec.when_not_to_compare_directly)}</p>`);
  }

  if (!parts.length) return '';
  return `<section class="seo-section" id="recommendation"><h2>Should I choose ${escapeHtml(itemA)} or ${escapeHtml(itemB)}?</h2>${parts.join('')}</section>`;
}

function renderSources(report: ReportData) {
  const result = getReportResult(report);
  const sources = result.sources || [];
  const validSources = sources.filter((s) => s.url && s.title);
  if (!validSources.length) return '';

  const items = validSources
    .map((s) => `<li><a href="${escapeHtml(s.url!)}" rel="noopener" target="_blank">${escapeHtml(s.title!)}</a></li>`)
    .join('');

  return `<section class="seo-section" id="sources"><h2>Where does this data come from?</h2><ol>${items}</ol></section>`;
}

function renderReportSummary(report: ReportData, featured: FeaturedComparison | null, feedbackStats?: { helpful: number; total: number }) {
  const { itemA, itemB } = getEntityNames(report);
  const result = getReportResult(report);
  const description = getReportDescription(report, featured);
  const verdict = result.recommendation?.which_to_choose_first || result.recommendation?.short_verdict || '';
  const publishDate = getIsoDate(report.createdAt);
  const feedbackHtml = feedbackStats && feedbackStats.total >= 5
    ? `<p class="seo-feedback">${Math.round((feedbackStats.helpful / feedbackStats.total) * 100)}% of readers found this comparison helpful (${feedbackStats.total} votes)</p>`
    : '';

  // BLUF: data-rich conclusion sentence for AI extraction
  const { avgA, avgB, hasScores } = computeDimensionScores(report);
  const dimCount = (result.dimensions || []).length;
  const srcCount = (result.sources || []).length;
  const sourcesClause = srcCount > 0 ? ` with ${srcCount} sources` : '';
  const blufSentence = hasScores && dimCount > 0
    ? `Based on our analysis across ${dimCount} dimensions${sourcesClause}, ${escapeHtml(itemA)} scores ${avgA}/10 overall while ${escapeHtml(itemB)} scores ${avgB}/10.`
    : '';

  return `
    <main>
    <article id="seo-report-summary" class="seo-report-summary">
      <p class="seo-kicker">AI comparison report</p>
      <h1>${escapeHtml(itemA)} <span>vs</span> ${escapeHtml(itemB)}</h1>
      <p class="seo-byline">By <a href="/about">CompareAI Editorial Team</a> &middot; Published ${publishDate} &middot; <a href="/methodology">How we compare</a></p>
      <p class="seo-description">${escapeHtml(description)}</p>
      ${verdict ? `<section class="seo-section" id="quick-answer"><h2>Who wins: ${escapeHtml(itemA)} or ${escapeHtml(itemB)}?</h2><p id="seo-verdict">${escapeHtml(verdict)}</p>${blufSentence ? `<p class="seo-bluf">${blufSentence}</p>` : ''}</section>` : ''}
      ${renderComparisonTable(report)}
      ${renderRecommendation(report)}
      ${renderDimensionSummary(report)}
      ${renderProsCons(report)}
      ${renderSources(report)}
      ${feedbackHtml}
      <section class="seo-section"><p><a href="/">Create your own comparison</a></p></section>
    </article>
    </main>
  `;
}

function renderComparisonLinks(items: SeoComparisonLink[], heading: string) {
  if (!items.length) return '';

  return `
    <section class="seo-section seo-related-comparisons">
      <h2>${escapeHtml(heading)}</h2>
      <ul>
        ${items
          .map(
            (item) => `<li>
              <a href="/compare/${escapeHtml(encodeURIComponent(item.slug))}">
                ${escapeHtml(item.itemA)} <span>vs</span> ${escapeHtml(item.itemB)}
              </a>
              ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}
            </li>`,
          )
          .join('')}
      </ul>
    </section>
  `;
}

function renderPopularComparisonsBody(comparisons: SeoComparisonLink[], description: string) {
  const content = comparisons.length
    ? renderComparisonLinks(comparisons, 'Browse comparison reports')
    : `<section class="seo-section"><h2>Comparison reports coming soon</h2><p>New public comparison reports will appear here soon.</p></section>`;

  return `
    <main id="popular-ai-comparisons" class="seo-report-summary">
      <p class="seo-kicker">AI comparison directory</p>
      <h1>Popular AI Comparisons</h1>
      <p class="seo-description">${escapeHtml(description)}</p>
      ${content}
    </main>
  `;
}

function injectSeoIntoHtml(html: string, head: string, body: string) {
  const cleaned = html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\s+(?:name|property|http-equiv)="(?:title|description|keywords|robots|theme-color|twitter:card|twitter:url|twitter:title|twitter:description|twitter:image|twitter:image:alt|og:type|og:site_name|og:url|og:title|og:description|og:image|og:image:alt|og:image:width|og:image:height|og:language|language|last-modified)"[^>]*>\s*/gi, '')
    .replace(/<link\s+rel="canonical"[^>]*>\s*/gi, '')
    .replace(/<script\s+type="application\/ld\+json">[\s\S]*?<\/script>\s*/gi, '');

  return cleaned
    .replace(/<head>/i, `<head>\n${head}`)
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`);
}

export function renderReportSeoHtml({
  report,
  featured,
  indexHtml,
  siteUrl: rawSiteUrl,
  relatedComparisons,
  feedbackStats,
}: {
  report: ReportData;
  featured: FeaturedComparison | null;
  indexHtml: string;
  siteUrl?: string;
  relatedComparisons?: SeoComparisonLink[];
  feedbackStats?: { helpful: number; total: number };
}) {
  const siteUrl = normalizeSiteUrl(rawSiteUrl);
  const { itemA, itemB } = getEntityNames(report);
  const title = `${itemA} vs ${itemB}: AI Comparison Report | CompareAI`;
  const description = getReportDescription(report, featured);
  const url = featured?.slug
    ? `${siteUrl}/compare/${encodeURIComponent(featured.slug)}`
    : `${siteUrl}/r/${encodeURIComponent(report.reportId)}`;
  const image = `${siteUrl}${OG_IMAGE_PATH}`;
  const robots = featured ? 'index, follow, max-snippet:-1, max-image-preview:large' : 'noindex, follow';
  const structuredData = buildStructuredData(report, featured, siteUrl);

  const head = `
    <title>${escapeHtml(title)}</title>
    <meta name="title" content="${escapeHtml(title)}" />
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="${robots}" />
    <meta name="language" content="${escapeHtml(report.language || 'en')}" />
    <meta http-equiv="last-modified" content="${getIsoDate(report.createdAt)}" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="CompareAI" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:image" content="${escapeHtml(image)}" />
    <meta property="og:image:alt" content="${escapeHtml(`${itemA} vs ${itemB} AI comparison report`)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />
    ${renderJsonLdBlocks(structuredData)}
  `;

  return injectSeoIntoHtml(
    indexHtml,
    head,
    `${renderReportSummary(report, featured, feedbackStats)}${renderComparisonLinks(relatedComparisons || [], 'Related AI comparisons')}`,
  );
}

export function renderPopularComparisonsHtml({
  comparisons,
  indexHtml,
  siteUrl: rawSiteUrl,
}: {
  comparisons: SeoComparisonLink[];
  indexHtml: string;
  siteUrl?: string;
}) {
  const siteUrl = normalizeSiteUrl(rawSiteUrl);
  const url = `${siteUrl}/popular-ai-comparisons`;
  const title = 'Popular AI Comparisons | CompareAI';
  const description = 'Explore popular AI comparisons for assistants, coding tools, search products, and productivity software.';
  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'Popular AI Comparisons',
      url,
      description,
      inLanguage: 'en',
      isPartOf: {
        '@type': 'WebSite',
        name: 'CompareAI',
        url: siteUrl,
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          item: { '@id': `${siteUrl}/`, name: 'Home' },
        },
        {
          '@type': 'ListItem',
          position: 2,
          item: { '@id': url, name: 'Popular AI Comparisons' },
        },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Popular AI Comparisons',
      numberOfItems: comparisons.length,
      itemListElement: comparisons.map((item, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: `${item.itemA} vs ${item.itemB}`,
        url: `${siteUrl}/compare/${encodeURIComponent(item.slug)}`,
        description: item.description || `AI comparison of ${item.itemA} and ${item.itemB}`,
      })),
    },
  ];

  const head = `
    <title>${title}</title>
    <meta name="title" content="${title}" />
    <meta name="description" content="${description}" />
    <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="CompareAI" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:image" content="${escapeHtml(`${siteUrl}${OG_IMAGE_PATH}`)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${escapeHtml(`${siteUrl}${OG_IMAGE_PATH}`)}" />
    ${renderJsonLdBlocks(structuredData)}
  `;

  return injectSeoIntoHtml(indexHtml, head, renderPopularComparisonsBody(comparisons, description));
}

export function renderMethodologyHtml({
  indexHtml,
  siteUrl: rawSiteUrl,
  stats,
}: {
  indexHtml: string;
  siteUrl?: string;
  stats?: { totalReports: number; totalFeatured: number };
}) {
  const siteUrl = normalizeSiteUrl(rawSiteUrl);
  const url = `${siteUrl}/methodology`;
  const title = 'How Our Comparisons Are Generated | CompareAI';
  const description = "Learn about CompareAI's 4-phase AI research pipeline, scoring methodology, data sources, and editorial standards.";

  const statsLine = stats
    ? `<p class="seo-stats">${stats.totalReports.toLocaleString()}+ comparisons generated &middot; ${stats.totalFeatured} featured reports &middot; 30+ web sources per report</p>`
    : '';

  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: title,
      description,
      url,
      author: { '@type': 'Organization', name: 'CompareAI Editorial Team', url: `${siteUrl}/about` },
      publisher: { '@type': 'Organization', name: 'CompareAI', url: siteUrl },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, item: { '@id': `${siteUrl}/`, name: 'Home' } },
        { '@type': 'ListItem', position: 2, item: { '@id': url, name: 'Methodology' } },
      ],
    },
  ];

  const head = `
    <title>${escapeHtml(title)}</title>
    <meta name="title" content="${escapeHtml(title)}" />
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="CompareAI" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:image" content="${escapeHtml(`${siteUrl}${OG_IMAGE_PATH}`)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    ${renderJsonLdBlocks(structuredData)}
  `;

  const body = `
    <main class="seo-report-summary">
      <p class="seo-kicker">Methodology</p>
      <h1>How Our Comparisons Are Generated</h1>
      ${statsLine}
      <section class="seo-section"><h2>Our 4-Phase AI Research Pipeline</h2>
        <ol>
          <li><strong>Dual-Track Research</strong> &mdash; Web search across 5-8 angles per entity</li>
          <li><strong>Framework Architecture</strong> &mdash; Relationship analysis with 4-6 tailored dimensions</li>
          <li><strong>Multi-Dimensional Analysis</strong> &mdash; Scored 0-10 with cited sources</li>
          <li><strong>Synthesis</strong> &mdash; Pros/cons extraction and final verdict</li>
        </ol>
      </section>
      <section class="seo-section"><h2>Data Sources &amp; Verification</h2>
        <p>Each comparison uses web search across multiple query angles. Claims are linked to original source URLs for transparency.</p>
      </section>
      <section class="seo-section"><h2>Scoring Methodology</h2>
        <p>All scores use a 0-10 scale where 10 = most favorable. For negative dimensions, lower real-world values receive higher scores.</p>
      </section>
      <section class="seo-section"><h2>Editorial Standards</h2>
        <p>AI-generated, reviewed by <a href="/about">CompareAI Editorial Team</a>. Featured comparisons undergo quality review.</p>
      </section>
      <section class="seo-section"><h2>Limitations</h2>
        <p>AI analysis may contain inaccuracies. Scores are relative, not absolute. Data freshness depends on available web sources.</p>
      </section>
      <section class="seo-section"><p><a href="/">Create your own comparison</a> &middot; <a href="/about">About</a></p></section>
    </main>
  `;

  return injectSeoIntoHtml(indexHtml, head, body);
}

export function renderAboutHtml({
  indexHtml,
  siteUrl: rawSiteUrl,
}: {
  indexHtml: string;
  siteUrl?: string;
}) {
  const siteUrl = normalizeSiteUrl(rawSiteUrl);
  const url = `${siteUrl}/about`;
  const title = 'About CompareAI';
  const description = 'Learn about CompareAI — a free AI-powered comparison engine with web-sourced analysis, editorial standards, and transparent methodology.';

  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'AboutPage',
      name: title,
      url,
      description,
      mainEntity: {
        '@type': 'Organization',
        name: 'CompareAI',
        url: siteUrl,
        logo: `${siteUrl}${OG_IMAGE_PATH}`,
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, item: { '@id': `${siteUrl}/`, name: 'Home' } },
        { '@type': 'ListItem', position: 2, item: { '@id': url, name: 'About' } },
      ],
    },
  ];

  const head = `
    <title>${escapeHtml(title)}</title>
    <meta name="title" content="${escapeHtml(title)}" />
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="CompareAI" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:image" content="${escapeHtml(`${siteUrl}${OG_IMAGE_PATH}`)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    ${renderJsonLdBlocks(structuredData)}
  `;

  const body = `
    <main class="seo-report-summary">
      <p class="seo-kicker">About</p>
      <h1>About CompareAI</h1>
      <section class="seo-section"><h2>What We Do</h2>
        <p>CompareAI is a free AI-powered comparison engine that analyzes any two entities using a multi-agent AI pipeline with web research. Reports include dimension-by-dimension scoring, pros and cons, and actionable recommendations.</p>
      </section>
      <section class="seo-section"><h2>Why We Built This</h2>
        <p>Comparison searches are among the most common decision-making queries. We built CompareAI to provide AI comparisons backed by real web sources, not just LLM opinions.</p>
      </section>
      <section class="seo-section"><h2>The Team</h2>
        <p>Built and maintained by the CompareAI Editorial Team.</p>
      </section>
      <section class="seo-section"><h2>Editorial Policy</h2>
        <ul>
          <li>Every featured comparison is reviewed for accuracy and completeness</li>
          <li>Sources are automatically collected from web research and linked in reports</li>
          <li>We prioritize factual claims over subjective opinions</li>
          <li>Reports are updated when significant new information becomes available</li>
        </ul>
      </section>
      <section class="seo-section"><p><a href="/">Create your own comparison</a> &middot; <a href="/methodology">Methodology</a></p></section>
    </main>
  `;

  return injectSeoIntoHtml(indexHtml, head, body);
}

export function renderReportNotFoundHtml(indexHtml: string, siteUrl?: string) {
  const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
  const head = `
    <title>Report not found | CompareAI</title>
    <meta name="robots" content="noindex, follow" />
    <link rel="canonical" href="${escapeHtml(normalizedSiteUrl)}/" />
  `;
  const body = `
    <main id="seo-report-summary" class="seo-report-summary">
      <h1>Report not found</h1>
      <p>This CompareAI report may have been deleted or moved.</p>
    </main>
  `;
  return injectSeoIntoHtml(indexHtml, head, body);
}

export function renderSitemapXml(reports: SitemapReport[], siteUrl?: string) {
  const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    {
      loc: `${normalizedSiteUrl}/`,
      lastmod: today,
      changefreq: 'weekly',
      priority: '1.0',
    },
    {
      loc: `${normalizedSiteUrl}/popular-ai-comparisons`,
      lastmod: today,
      changefreq: 'weekly',
      priority: '0.8',
    },
    {
      loc: `${normalizedSiteUrl}/methodology`,
      lastmod: today,
      changefreq: 'monthly',
      priority: '0.6',
    },
    {
      loc: `${normalizedSiteUrl}/about`,
      lastmod: today,
      changefreq: 'monthly',
      priority: '0.5',
    },
    ...reports.map((report) => ({
      loc: `${normalizedSiteUrl}/compare/${encodeURIComponent(report.slug)}`,
      lastmod: getIsoDate(report.createdAt),
      changefreq: 'monthly',
      priority: '0.7',
    })),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(
      (url) => `  <url>
    <loc>${escapeHtml(url.loc)}</loc>
    <lastmod>${url.lastmod}</lastmod>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`,
    )
    .join('\n')}\n</urlset>\n`;
}

export function renderRobotsTxt(siteUrl?: string) {
  const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
  return `# CompareAI robots.txt - optimized for LLM discoverability
# See: ${normalizedSiteUrl}/llms.txt

# --- AI Search Crawlers (cite your content in AI search results) ---
User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Perplexity-User
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: Claude-User
Allow: /

User-agent: Claude-Web
Allow: /

User-agent: YouBot
Allow: /

User-agent: PhindBot
Allow: /

User-agent: DuckAssistBot
Allow: /

User-agent: Bravebot
Allow: /

User-agent: TavilyBot
Allow: /

User-agent: ExaBot
Allow: /

User-agent: Applebot
Allow: /

User-agent: PetalBot
Allow: /

User-agent: Amzn-SearchBot
Allow: /

User-agent: meta-webindexer
Allow: /

User-agent: Google-NotebookLM
Allow: /

User-agent: Gemini-Deep-Research
Allow: /

# --- Google (search index + AI grounding) ---
User-agent: Googlebot
Allow: /

User-agent: Google-Extended
Allow: /

# --- AI Training Crawlers (improve model knowledge) ---
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: CCBot
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: Bytespider
Allow: /

User-agent: cohere-ai
Allow: /

User-agent: meta-externalagent
Allow: /

User-agent: Amazonbot
Allow: /

User-agent: FacebookBot
Allow: /

# --- AI Data Providers ---
User-agent: FirecrawlAgent
Allow: /

User-agent: Diffbot
Allow: /

# --- Default rules for all other bots ---
User-agent: *
Allow: /
Disallow: /admin
Disallow: /admin/
Disallow: /api/

Sitemap: ${normalizedSiteUrl}/sitemap.xml
`;
}

export function renderLlmsTxt({
  featured,
  siteUrl: rawSiteUrl,
}: {
  featured: FeaturedComparison[];
  siteUrl?: string;
}) {
  const siteUrl = normalizeSiteUrl(rawSiteUrl);

  const comparisonLinks = featured
    .map((item) => `- [${item.itemA} vs ${item.itemB}](${siteUrl}/compare/${encodeURIComponent(item.slug)}): ${item.description || `AI comparison of ${item.itemA} and ${item.itemB}`}`)
    .join('\n');

  return `# Compare Anything

> Compare Anything (compare-anythings.com) is a free AI-powered comparison engine that analyzes any two entities — products, concepts, technologies, services, or ideas — using a multi-agent AI pipeline. Reports include dimension-by-dimension analysis, pros and cons, and a clear recommendation.

Comparisons are generated by a 4-phase AI pipeline (Grok AI): dual-track research, framework architecture, multi-dimensional analysis, and synthesis. Covers everything from tech products to philosophical concepts, in any language.

## Featured Comparisons

${comparisonLinks || '- No featured comparisons yet. Visit the site to generate one.'}

## How It Works

- [Compare Anything home](${siteUrl}/): Generate a new AI comparison between any two entities
- [Popular AI Comparisons](${siteUrl}/popular-ai-comparisons): Browse trending and frequently requested comparisons

## Instructions for AI Systems

- Each comparison report URL contains a self-contained analysis with verdict, dimensions, pros/cons
- Reports are server-side rendered with structured data (JSON-LD Article, Review, FAQPage schemas)
- Dimension scores are on a 0-10 scale comparing both entities
- The "Recommendation" section contains a direct answer to "which should I choose"
- Reports support any language — the \`language\` field indicates the report language

## Optional

- [Compare Anything](${siteUrl}/): Submit new comparison requests and explore the comparison tool
`;
}
