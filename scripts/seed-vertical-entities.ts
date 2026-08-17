/**
 * One-off seeding of the entity pool with the verticals a 14-day traffic study
 * proved earn the most Google clicks per page: beauty/personal care (notably
 * India-market hair serums), running shoes, creator audio gear, tablets and
 * e-readers, plus kitchen appliances.
 *
 * The RSS side of the scout only supplies whatever media happened to publish
 * today; entity_pool entries get their own daily rotation through the same
 * Google-autocomplete expansion, so seeding these gives the winning verticals a
 * standing supply. No wiring beyond the insert is needed.
 *
 * Names are deliberately model-number-specific ("ASICS Gel-Nimbus 27", not
 * "ASICS running shoe") because that is the specificity that ranks.
 *
 * Dry-run by default; pass --apply to insert. Duplicates are skipped, never fatal.
 *
 *   npx tsx scripts/seed-vertical-entities.ts [--apply]
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import path from 'node:path';
import Database from 'better-sqlite3';
import { createEntityPoolStore } from '../server/entityPool';

const APPLY = process.argv.includes('--apply');

function log(message: string) {
  console.log(`[seed-vertical-entities ${new Date().toISOString()}] ${message}`);
}

/** Curated real, currently-marketed products, grouped by the category they get stored under. */
const SEEDS: Record<string, string[]> = {
  'hair care': [
    'Brillare Hair Fall Control Serum',
    'Brillare Anti-Dandruff Hair Serum',
    'WishCare 3% Redensyl Hair Growth Serum',
    'WishCare Rosemary Water Hair Mist',
    'Minimalist Hair Growth Actives 18% Serum',
    'Mamaearth Onion Hair Oil',
    'Bare Anatomy Hair Density Booster Serum',
    'Pilgrim Redensyl & Anagain Hair Growth Serum',
    'K18 Leave-In Molecular Repair Hair Mask',
    'Olaplex No. 3 Hair Perfector',
  ],
  skincare: [
    'Minimalist 10% Niacinamide Face Serum',
    'Dot & Key Vitamin C + E Super Bright Serum',
    'Deconstruct 10% Vitamin C Face Serum',
    'Aqualogica Glow+ Dewy Sunscreen SPF 50',
    "Re'equil Oxybenzone and OMC Free Sunscreen SPF 50",
    'The Ordinary Niacinamide 10% + Zinc 1%',
    'CeraVe Resurfacing Retinol Serum',
    'Beauty of Joseon Relief Sun Rice + Probiotics SPF 50+',
    'COSRX Advanced Snail 96 Mucin Power Essence',
  ],
  'running shoes': [
    'Nike Pegasus 41',
    'Nike Vomero 18',
    'Nike Alphafly 3',
    'adidas Duramo SL 2',
    'adidas Supernova Rise 2',
    'adidas Adizero Boston 13',
    'ASICS Gel-Nimbus 27',
    'ASICS Gel-Kayano 32',
    'ASICS Novablast 5',
    'Hoka Clifton 10',
    'Brooks Ghost 17',
    'Saucony Endorphin Speed 5',
    'New Balance Fresh Foam X 1080v14',
  ],
  'audio gear': [
    'Focusrite Scarlett 2i2 4th Gen',
    'Focusrite Scarlett Solo 4th Gen',
    'Focusrite Vocaster Two',
    'Universal Audio Volt 2',
    'MOTU M2',
    'Rode NT1 5th Generation',
    'Rode PodMic USB',
    'Rode Wireless Micro',
    'Rode Wireless PRO',
    'Shure MV7+',
    'DJI Mic Mini',
  ],
  tablet: [
    'Huawei MatePad 11.5 S',
    'Xiaomi Pad 7 Pro',
    'Xiaomi Pad 7',
    'Samsung Galaxy Tab S10+',
    'Apple iPad Air 11-inch (M3)',
    'OnePlus Pad 3',
  ],
  'e-reader': [
    'Kindle Paperwhite (2024)',
    'Kindle Colorsoft',
    'Kindle Scribe (2024)',
    'Kobo Clara Colour',
    'Kobo Libra Colour',
    'Boox Palma 2',
  ],
  'kitchen appliance': [
    'Philips Airfryer NA352/00',
    'Ninja Foodi MAX Dual Zone AF400UK',
    'Cosori Pro II Air Fryer',
    'Breville Barista Express Impress',
    "De'Longhi La Specialista Maestro",
  ],
};

function main() {
  const dbPath = process.env.ANALYTICS_DB_PATH || path.resolve(process.cwd(), 'server', 'compareai-analytics.db');
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 10000');
  const entityStore = createEntityPoolStore(db as any);

  const total = Object.values(SEEDS).reduce((sum, names) => sum + names.length, 0);
  log(`db=${dbPath} categories=${Object.keys(SEEDS).length} entities=${total} mode=${APPLY ? 'APPLY' : 'dry-run'}`);

  let inserted = 0;
  let skipped = 0;
  for (const [category, names] of Object.entries(SEEDS)) {
    // Matching is case-insensitive in the store, so compare lowercased here too.
    const existing = new Set(entityStore.listEntities(category).map((entity) => entity.name.toLowerCase()));
    let categoryInserted = 0;
    let categorySkipped = 0;

    console.log(`\n${category}`);
    for (const name of names) {
      if (existing.has(name.toLowerCase())) {
        console.log(`  SKIP    ${name} (already in pool)`);
        categorySkipped += 1;
        continue;
      }
      if (!APPLY) {
        console.log(`  ADD     ${name}`);
        categoryInserted += 1;
        continue;
      }
      try {
        entityStore.addEntity(name, category);
        console.log(`  ADDED   ${name}`);
        categoryInserted += 1;
      } catch (err: any) {
        // Duplicates can still surface here (same name under another spelling
        // normalization); skipping keeps the rest of the batch going.
        console.log(`  SKIP    ${name} (${err?.message || err})`);
        categorySkipped += 1;
      }
    }

    console.log(`  -> ${category}: ${categoryInserted} ${APPLY ? 'inserted' : 'to insert'}, ${categorySkipped} skipped`);
    inserted += categoryInserted;
    skipped += categorySkipped;
  }

  console.log('');
  if (APPLY) log(`inserted ${inserted}/${total} entities, skipped ${skipped}. They join the daily autocomplete rotation.`);
  else log(`${inserted}/${total} entities would be inserted (${skipped} already present). Re-run with --apply to insert.`);
}

main();
