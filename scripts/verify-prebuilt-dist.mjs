#!/usr/bin/env node
/**
 * Wrapper — canonical verifier lives in frontend/scripts/verify-prebuilt-dist.mjs
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(__dirname, '..', 'frontend', 'scripts', 'verify-prebuilt-dist.mjs');
const args = process.argv.slice(2);
const res = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' });
process.exit(res.status ?? 1);
