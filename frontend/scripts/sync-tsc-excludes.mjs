/**
 * Write tsconfig.build.json: typecheck core panel sources only.
 * App Store modules under src/modules/<id>/ are excluded when they are not
 * part of the git tree at the source checkout (preserved third-party installs).
 */
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const modulesDir = resolve(frontendRoot, 'src/modules')
const copanelHome = process.env.COPANEL_HOME || '/opt/copanel'
const skipTscMarker = resolve(frontendRoot, '.copanel-skip-tsc')

function listDiskModuleIds() {
  try {
    return readdirSync(modulesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
}

function repoCandidates() {
  const seen = new Set()
  const out = []
  for (const dir of [
    process.env.COPANEL_REPO_DIR,
    process.env.REPO_DIR,
    resolve(frontendRoot, '..'),
    copanelHome,
  ]) {
    if (!dir || seen.has(dir)) continue
    seen.add(dir)
    out.push(dir)
  }
  return out
}

function gitCoreFrontendModuleIds() {
  for (const repo of repoCandidates()) {
    try {
      execSync(`git -C "${repo}" rev-parse --git-dir`, { stdio: 'ignore' })
      const out = execSync(
        `git -C "${repo}" ls-tree -d --name-only HEAD:frontend/src/modules`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      )
      return out
        .trim()
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    } catch {
      continue
    }
  }
  return null
}

function extraFromEnv() {
  return (process.env.COPANEL_EXTRA_FRONTEND_MODULES || '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function stripJsonComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function clearSkipTscMarker() {
  try {
    unlinkSync(skipTscMarker)
  } catch {
    /* absent */
  }
}

function markSkipTsc() {
  writeFileSync(skipTscMarker, 'vite-only\n')
}

const diskIds = listDiskModuleIds()
const coreIds = gitCoreFrontendModuleIds()
const extras = new Set(extraFromEnv())

if (coreIds) {
  for (const id of diskIds) {
    if (!coreIds.includes(id)) {
      extras.add(id)
    }
  }
  clearSkipTscMarker()
} else if (extras.size > 0) {
  clearSkipTscMarker()
} else {
  markSkipTsc()
  process.exit(0)
}

const base = JSON.parse(stripJsonComments(readFileSync(resolve(frontendRoot, 'tsconfig.json'), 'utf8')))
const exclude = [...(base.exclude || [])]
for (const id of extras) {
  exclude.push(`src/modules/${id}`)
}

const build = { extends: './tsconfig.json', exclude: [...new Set(exclude)] }
writeFileSync(resolve(frontendRoot, 'tsconfig.build.json'), JSON.stringify(build, null, 2) + '\n')
