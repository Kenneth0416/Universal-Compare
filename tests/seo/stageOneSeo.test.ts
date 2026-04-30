import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

function readProjectFile(filePath: string) {
  return readFileSync(path.join(root, filePath), 'utf8');
}

test('homepage exposes English-first global SEO metadata and social preview image', () => {
  const html = readProjectFile('index.html');

  assert.match(
    html,
    /<title>CompareAI - AI Comparison Tool for Products, Apps, and Decisions<\/title>/,
  );
  assert.match(html, /<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large" \/>/);
  assert.match(html, /AI comparison tool/i);
  assert.match(html, /compare products/i);
  assert.match(html, /https:\/\/compare-ai\.com\/og-image\.png/);
  assert.equal(existsSync(path.join(root, 'public', 'og-image.png')), true);
});

test('robots and sitemap expose only public crawl targets for phase one', () => {
  const robots = readProjectFile('public/robots.txt');
  const sitemap = readProjectFile('public/sitemap.xml');

  assert.match(robots, /User-agent: \*/);
  assert.match(robots, /Allow: \//);
  assert.match(robots, /Disallow: \/admin/);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Sitemap: https:\/\/compare-ai\.com\/sitemap\.xml/);

  assert.match(sitemap, /<loc>https:\/\/compare-ai\.com\/<\/loc>/);
  assert.match(sitemap, /<lastmod>2026-04-30<\/lastmod>/);
});

test('featured reports use crawlable links instead of script-only navigation', () => {
  const source = readProjectFile('src/components/FeaturedShowcase.tsx');

  assert.match(source, /<a\s/);
  assert.match(source, /href=\{`\/compare\/\$\{item\.slug\}`\}/);
  assert.doesNotMatch(source, /window\.location\.href\s*=/);
});
