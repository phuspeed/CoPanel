#!/usr/bin/env node
/**
 * Build a CoPanel AppStore module as a runtime extension bundle (ESM + manifest).
 *
 * Output is suitable for ZIP packages with frontend_install=prebuilt:
 *   frontend/dist/manifest.json
 *   frontend/dist/module.js
 *
 * Usage:
 *   node scripts/build-extension.mjs <module_id> [--out <dir>]
 *
 * Env (optional): MODULE_ID, EXTENSION_OUT_DIR — same as vite.extension.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.join(__dirname, '..');

function usage() {
  console.error(
    'Usage: node scripts/build-extension.mjs <module_id> [--out frontend/dist]\n' +
      '  Builds module.js externalizing react/lucide (panel import map provides them).',
  );
  process.exit(1);
}

const args = process.argv.slice(2);
let moduleId = process.env.MODULE_ID || '';
let outDir = process.env.EXTENSION_OUT_DIR || '';

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out' && args[i + 1]) {
    outDir = args[++i];
  } else if (!moduleId && !a.startsWith('-')) {
    moduleId = a;
  } else {
    usage();
  }
}

if (!moduleId) usage();
if (!outDir) {
  outDir = path.join(frontendRoot, 'src', 'modules', moduleId, 'dist');
}

const configPath = path.join(frontendRoot, 'src', 'modules', moduleId, 'config.ts');
if (!existsSync(configPath)) {
  console.error(`Module config not found: ${configPath}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const viteConfig = path.join(frontendRoot, 'vite.extension.mjs');
const env = {
  ...process.env,
  MODULE_ID: moduleId,
  EXTENSION_OUT_DIR: outDir,
};

const build = spawnSync(
  process.execPath,
  [path.join(frontendRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', viteConfig],
  { cwd: frontendRoot, env, stdio: 'inherit' },
);

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const manifestPath = path.join(outDir, 'manifest.json');
if (!existsSync(manifestPath)) {
  const configSrc = readFileSync(configPath, 'utf8');
  const nameMatch = configSrc.match(/name:\s*['"]([^'"]+)['"]/);
  const pathMatch = configSrc.match(/path:\s*['"]([^'"]+)['"]/);
  const iconMatch = configSrc.match(/icon:\s*['"]([^'"]+)['"]/);
  const descMatch = configSrc.match(/description:\s*['"]([^'"]+)['"]/);
  const windowMode = /\bwindowMode:\s*true\b/.test(configSrc);
  const manifest = {
    schema: 1,
    id: moduleId,
    name: nameMatch?.[1] || moduleId,
    path: pathMatch?.[1] || `/${moduleId.replace(/_/g, '-')}`,
    icon: iconMatch?.[1] || 'Grid',
    description: descMatch?.[1] || '',
    windowMode,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Wrote ${manifestPath}`);
}

const moduleJs = path.join(outDir, 'module.js');
if (!existsSync(moduleJs)) {
  console.error(`Build did not emit module.js in ${outDir}`);
  process.exit(1);
}

console.log(`Extension bundle ready: ${outDir}`);
