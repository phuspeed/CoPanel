#!/usr/bin/env node
/**
 * Verify panel prebuilt dist has import map + vendor chunks for AppStore extensions.
 * Usage: node scripts/verify-prebuilt-dist.mjs [path/to/dist]
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));

const requiredVendors = [
  'react-vendor.js',
  'react-dom-vendor.js',
  'router-vendor.js',
  'lucide-vendor.js',
];

const errors = [];

const indexHtml = path.join(dist, 'index.html');
if (!existsSync(indexHtml)) {
  errors.push(`missing ${indexHtml}`);
} else {
  const html = readFileSync(indexHtml, 'utf8');
  if (!html.includes('type="importmap"') && !existsSync(path.join(dist, 'importmap.json'))) {
    errors.push('index.html has no inline import map and importmap.json is missing');
  }
  const mainJs = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
  if (mainJs) {
    const bundlePath = path.join(dist, mainJs[1].replace(/^\//, ''));
    if (existsSync(bundlePath)) {
      const bundle = readFileSync(bundlePath, 'utf8');
      if (!bundle.includes('extensions/index.json')) {
        errors.push('main bundle missing runtime extension loader (extensions/index.json fetch)');
      }
    }
  }
}

const assets = path.join(dist, 'assets');
for (const file of requiredVendors) {
  const p = path.join(assets, file);
  if (!existsSync(p)) {
    errors.push(`missing vendor chunk assets/${file}`);
  }
}

if (errors.length) {
  console.error('Prebuilt dist verification failed:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`OK: ${dist} has import map and vendor chunks for runtime extensions.`);
