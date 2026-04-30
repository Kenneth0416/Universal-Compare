import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const siteUrl = 'https://compare-anythings.com';

function readProjectFile(filePath: string) {
  return readFileSync(path.join(root, filePath), 'utf8');
}

function readBinaryProjectFile(filePath: string) {
  return readFileSync(path.join(root, filePath));
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
  assert.match(html, new RegExp(`${siteUrl}/og-image\\.png`));
  assert.equal(existsSync(path.join(root, 'public', 'og-image.png')), true);
});

test('homepage exposes Google-search-friendly favicon assets', () => {
  const html = readProjectFile('index.html');

  assert.match(html, /<link rel="icon" href="\/favicon\.ico" sizes="any" \/>/);
  assert.match(html, /<link rel="icon" type="image\/png" sizes="48x48" href="\/favicon-48x48\.png" \/>/);
  assert.match(html, /<link rel="icon" type="image\/png" sizes="192x192" href="\/favicon-192x192\.png" \/>/);
  assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png" \/>/);

  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (const fileName of ['favicon-48x48.png', 'favicon-192x192.png', 'apple-touch-icon.png']) {
    assert.equal(existsSync(path.join(root, 'public', fileName)), true);
    assert.equal(readBinaryProjectFile(path.join('public', fileName)).subarray(0, 8).equals(pngSignature), true);
  }

  const ico = readBinaryProjectFile(path.join('public', 'favicon.ico'));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 1);
});

test('robots and sitemap expose only public crawl targets for phase one', () => {
  const robots = readProjectFile('public/robots.txt');
  const sitemap = readProjectFile('public/sitemap.xml');

  assert.match(robots, /User-agent: \*/);
  assert.match(robots, /Allow: \//);
  assert.match(robots, /Disallow: \/admin/);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, new RegExp(`Sitemap: ${siteUrl}/sitemap\\.xml`));

  assert.match(sitemap, new RegExp(`<loc>${siteUrl}/</loc>`));
  assert.match(sitemap, /<lastmod>2026-04-30<\/lastmod>/);
});

test('featured reports use crawlable links instead of script-only navigation', () => {
  const source = readProjectFile('src/components/FeaturedShowcase.tsx');

  assert.match(source, /<a\s/);
  assert.match(source, /href=\{`\/compare\/\$\{item\.slug\}`\}/);
  assert.doesNotMatch(source, /window\.location\.href\s*=/);
});
