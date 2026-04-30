import type { FeaturedComparison } from './featured';
import type { ReportData, ReportListItem } from './reports';

const DEFAULT_SITE_URL = 'https://compare-ai.com';
const OG_IMAGE_PATH = '/og-image.png';

type SeoReportResult = {
  entityA?: { name?: string };
  entityB?: { name?: string };
  dimensions?: Array<{
    key?: string;
    label?: string;
    why_it_matters?: string;
    analysis?: {
      item_a_summary?: string;
      item_b_summary?: string;
      key_difference?: string;
    };
  }>;
  recommendation?: {
    short_verdict?: string;
    long_verdict?: string;
  };
};

export type SitemapReport = Pick<ReportListItem, 'reportId' | 'createdAt'>;

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
  const title = `${itemA} vs ${itemB}: AI Comparison Report | CompareAI`;
  const description = getReportDescription(report, featured);
  const url = `${siteUrl}/r/${encodeURIComponent(report.reportId)}`;

  return [
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
    {
      '@context': 'https://schema.org',
      '@type': 'SiteNavigationElement',
      url: [`${siteUrl}/`, `${siteUrl}/sitemap.xml`],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: title,
      url,
      description,
      inLanguage: report.language || 'en',
      datePublished: report.createdAt,
      dateModified: report.createdAt,
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
          item: { '@id': url, name: `${itemA} vs ${itemB}` },
        },
      ],
    },
  ];
}

function renderDimensionSummary(report: ReportData) {
  const result = getReportResult(report);
  const dimensions = result.dimensions || [];
  if (!dimensions.length) return '';

  const items = dimensions.slice(0, 6).map((dimension) => {
    const label = dimension.label || dimension.key || 'Comparison dimension';
    const summary =
      dimension.analysis?.key_difference ||
      dimension.why_it_matters ||
      dimension.analysis?.item_a_summary ||
      dimension.analysis?.item_b_summary ||
      '';
    return `<li><strong>${escapeHtml(label)}</strong>${summary ? `: ${escapeHtml(summary)}` : ''}</li>`;
  });

  return `<section class="seo-section"><h2>Key differences</h2><ul>${items.join('')}</ul></section>`;
}

function renderReportSummary(report: ReportData, featured: FeaturedComparison | null) {
  const { itemA, itemB } = getEntityNames(report);
  const result = getReportResult(report);
  const description = getReportDescription(report, featured);
  const verdict = result.recommendation?.short_verdict || result.recommendation?.long_verdict || '';

  return `
    <article id="seo-report-summary" class="seo-report-summary">
      <p class="seo-kicker">AI comparison report</p>
      <h1>${escapeHtml(itemA)} <span>vs</span> ${escapeHtml(itemB)}</h1>
      <p class="seo-description">${escapeHtml(description)}</p>
      ${verdict ? `<section class="seo-section"><h2>Recommendation</h2><p>${escapeHtml(verdict)}</p></section>` : ''}
      ${renderDimensionSummary(report)}
    </article>
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
}: {
  report: ReportData;
  featured: FeaturedComparison | null;
  indexHtml: string;
  siteUrl?: string;
}) {
  const siteUrl = normalizeSiteUrl(rawSiteUrl);
  const { itemA, itemB } = getEntityNames(report);
  const title = `${itemA} vs ${itemB}: AI Comparison Report | CompareAI`;
  const description = getReportDescription(report, featured);
  const url = `${siteUrl}/r/${encodeURIComponent(report.reportId)}`;
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

  return injectSeoIntoHtml(indexHtml, head, renderReportSummary(report, featured));
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
    ...reports.map((report) => ({
      loc: `${normalizedSiteUrl}/r/${encodeURIComponent(report.reportId)}`,
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
  return `# CompareAI robots.txt
User-agent: GPTBot
User-agent: ClaudeBot
User-agent: CCBot
User-agent: Google-Extended
Disallow: /

User-agent: *
Allow: /
Disallow: /admin
Disallow: /admin/
Disallow: /api/
Disallow: /out/
Disallow: /*/search

Sitemap: ${normalizedSiteUrl}/sitemap.xml
`;
}
