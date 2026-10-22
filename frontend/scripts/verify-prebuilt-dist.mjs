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

function parseImportMapFromHtml(html) {
  const m = html.match(/<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try {
    return JSON.parse(m[1].trim());
  } catch {
    return null;
  }
}

function checkMainBundleExtensionLoader(html) {
  const mainJs = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
  if (!mainJs) return;
  const bundlePath = path.join(dist, mainJs[1].replace(/^\//, ''));
  if (!existsSync(bundlePath)) return;
  const bundle = readFileSync(bundlePath, 'utf8');
  if (!bundle.includes('extensions/index.json')) {
    errors.push('main bundle missing runtime extension loader (extensions/index.json fetch)');
  }
}

function loadImportMap() {
  const indexHtml = path.join(dist, 'index.html');
  if (!existsSync(indexHtml)) {
    errors.push(`missing ${indexHtml}`);
    return null;
  }
  const html = readFileSync(indexHtml, 'utf8');
  checkMainBundleExtensionLoader(html);

  let map = parseImportMapFromHtml(html);
  if (!map) {
    const mapPath = path.join(dist, 'importmap.json');
    if (!existsSync(mapPath)) {
      errors.push('index.html has no inline import map and importmap.json is missing');
      return null;
    }
    try {
      map = JSON.parse(readFileSync(mapPath, 'utf8'));
    } catch {
      errors.push('importmap.json is not valid JSON');
      return null;
    }
  }
  if (!map?.imports || typeof map.imports !== 'object') {
    errors.push('import map is missing imports');
    return null;
  }
  return map;
}

function resolveMappedFile(urlPath) {
  const rel = urlPath.replace(/^\//, '');
  return path.join(dist, rel);
}

function vendorExportsNamedApi(filePath, names) {
  const src = readFileSync(filePath, 'utf8');
  const missing = [];
  for (const name of names) {
    const patterns = [
      new RegExp(`\\bexport\\s*\\{[^}]*\\b${name}\\b`),
      new RegExp(`\\bexport\\s*\\*\\s*from\\s*['"]`),
      new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+${name}\\b`),
      new RegExp(`\\bexport\\s*\\{\\s*[^}]*\\bas\\s+${name}\\b`),
      new RegExp(`\\b${name}\\s+as\\s+${name}\\b`),
    ];
    if (!patterns.some((re) => re.test(src))) {
      missing.push(name);
    }
  }
  return missing;
}

const importMap = loadImportMap();

const assets = path.join(dist, 'assets');
for (const file of requiredVendors) {
  const p = path.join(assets, file);
  if (!existsSync(p)) {
    errors.push(`missing vendor chunk assets/${file}`);
  }
}

if (importMap) {
  for (const [specifier, urlPath] of Object.entries(importMap.imports)) {
    if (typeof urlPath !== 'string' || !urlPath.startsWith('/')) {
      errors.push(`import map entry ${specifier} is not an absolute path: ${urlPath}`);
      continue;
    }
    const mapped = resolveMappedFile(urlPath);
    if (!existsSync(mapped)) {
      errors.push(`import map ${specifier} → ${urlPath} but file missing: ${mapped}`);
    }
  }

  const reactUrl = importMap.imports.react;
  const reactDomUrl = importMap.imports['react-dom'];
  if (typeof reactUrl === 'string') {
    const reactFile = resolveMappedFile(reactUrl);
    if (existsSync(reactFile)) {
      const missing = vendorExportsNamedApi(reactFile, ['useCallback', 'useRef']);
      if (missing.length) {
        errors.push(`react vendor ${reactUrl} missing named exports: ${missing.join(', ')}`);
      }
    }
  }
  if (typeof reactDomUrl === 'string') {
    const domFile = resolveMappedFile(reactDomUrl);
    if (existsSync(domFile)) {
      const missing = vendorExportsNamedApi(domFile, ['createPortal']);
      if (missing.length) {
        errors.push(`react-dom vendor ${reactDomUrl} missing named exports: ${missing.join(', ')}`);
      }
    }
  }
}

if (errors.length) {
  console.error('Prebuilt dist verification failed:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`OK: ${dist} has import map and vendor chunks for runtime extensions.`);
