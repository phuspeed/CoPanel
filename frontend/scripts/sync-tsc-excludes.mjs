/**
 * Write tsconfig.build.json: typecheck core panel sources only.
 * App Store modules under src/modules/<id>/ are excluded when they are not
 * part of the git tree at COPANEL_HOME (preserved third-party installs).
 */
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const modulesDir = resolve(frontendRoot, 'src/modules')
const copanelHome = process.env.COPANEL_HOME || '/opt/copanel'

function listDiskModuleIds() {
  try {
    return readdirSync(modulesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
}

function gitCoreFrontendModuleIds() {
  try {
    const out = execSync(
      `git -C "${copanelHome}" ls-tree -d --name-only HEAD:frontend/src/modules`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    return out
      .trim()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return null
  }
}

function extraFromEnv() {
  return (process.env.COPANEL_EXTRA_FRONTEND_MODULES || '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
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
}

function stripJsonComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const base = JSON.parse(stripJsonComments(readFileSync(resolve(frontendRoot, 'tsconfig.json'), 'utf8')))
const exclude = [...(base.exclude || [])]
for (const id of extras) {
  exclude.push(`src/modules/${id}`)
}

const build = { extends: './tsconfig.json', exclude: [...new Set(exclude)] }
writeFileSync(resolve(frontendRoot, 'tsconfig.build.json'), JSON.stringify(build, null, 2) + '\n')
