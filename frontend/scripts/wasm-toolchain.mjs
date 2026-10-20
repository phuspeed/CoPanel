/**
 * Pure-JS/WASM Rollup + esbuild for CPUs without AVX (no native @esbuild / @rollup/*).
 *
 * Usage:
 *   node scripts/wasm-toolchain.mjs install   # swap packages on disk (after npm i + wasm deps)
 *   node scripts/wasm-toolchain.mjs verify    # exit 0 only if WASM toolchain is active
 *   node scripts/wasm-toolchain.mjs report    # print resolved implementations (stdout)
 */
import { createRequire } from 'node:module'
import { existsSync, readdirSync, rmSync, cpSync, renameSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const cmd = process.argv[2] || 'verify'
const cwd = process.cwd()
const nm = join(cwd, 'node_modules')

function rmrf(path) {
  if (existsSync(path)) rmSync(path, { recursive: true, force: true })
}

function copyTree(src, dest) {
  rmrf(dest)
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(src, dest, { recursive: true })
}

export function installWasmToolchain(root = nm) {
  const esWasm = join(root, 'esbuild-wasm')
  const esBuild = join(root, 'esbuild')
  if (existsSync(esWasm)) {
    rmrf(esBuild)
    renameSync(esWasm, esBuild)
  }
  const rollWasm = join(root, '@rollup', 'wasm-node')
  const roll = join(root, 'rollup')
  if (existsSync(rollWasm)) {
    rmrf(roll)
    renameSync(rollWasm, roll)
  }
  rmrf(join(root, '@esbuild'))
  const rollupScope = join(root, '@rollup')
  if (existsSync(rollupScope)) {
    for (const name of readdirSync(rollupScope)) {
      if (name.startsWith('rollup-')) {
        rmrf(join(rollupScope, name))
      }
    }
  }
  if (existsSync(esBuild)) {
    walkForName(root, 'esbuild', (full) => {
      if (full === esBuild || full.startsWith(esBuild + '/')) return
      copyTree(esBuild, full)
    })
  }
  if (existsSync(roll)) {
    walkForName(root, 'rollup', (full) => {
      if (full === roll || full.startsWith(roll + '/')) return
      if (full.includes('/@rollup/')) return
      copyTree(roll, full)
    })
  }
}

function walkForName(root, name, fn) {
  function walk(dir) {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      const full = join(dir, ent.name)
      if (ent.name === name) fn(full)
      else if (ent.name !== '.bin') walk(full)
    }
  }
  walk(root)
}

export function verifyWasmToolchain(workdir = cwd) {
  const errors = []
  const require = createRequire(join(workdir, 'package.json'))
  let esPkg
  let rollPkg
  try {
    esPkg = require(require.resolve('esbuild/package.json'))
  } catch {
    errors.push('esbuild package not found')
  }
  try {
    rollPkg = require(require.resolve('rollup/package.json'))
  } catch {
    errors.push('rollup package not found')
  }
  if (esPkg) {
    const esDir = dirname(require.resolve('esbuild/package.json'))
    if (!String(esPkg.name || '').includes('wasm') || !existsSync(join(esDir, 'esbuild.wasm'))) {
      errors.push(`esbuild is still native (${esPkg.name || 'unknown'})`)
    }
  }
  if (rollPkg) {
    if (!String(rollPkg.name || '').includes('wasm')) {
      errors.push(`rollup is still native (${rollPkg.name || 'unknown'})`)
    }
  }
  const root = join(workdir, 'node_modules')
  if (existsSync(join(root, '@esbuild'))) {
    errors.push('native @esbuild binaries are still installed')
  }
  const rollupScope = join(root, '@rollup')
  if (existsSync(rollupScope)) {
    for (const name of readdirSync(rollupScope)) {
      if (name.startsWith('rollup-')) {
        errors.push(`native optional package @rollup/${name} is still installed`)
      }
    }
  }
  return errors
}

export function reportWasmToolchain(workdir = cwd) {
  const require = createRequire(join(workdir, 'package.json'))
  const lines = []
  try {
    const esPkg = require(require.resolve('esbuild/package.json'))
    lines.push(`esbuild: ${esPkg.name}@${esPkg.version}`)
  } catch (e) {
    lines.push(`esbuild: (missing) ${e.message}`)
  }
  try {
    const rollPkg = require(require.resolve('rollup/package.json'))
    lines.push(`rollup: ${rollPkg.name}@${rollPkg.version}`)
  } catch (e) {
    lines.push(`rollup: (missing) ${e.message}`)
  }
  const nativeEs = existsSync(join(workdir, 'node_modules', '@esbuild'))
  lines.push(`node_modules/@esbuild: ${nativeEs ? 'present (bad)' : 'absent'}`)
  const rollupScope = join(workdir, 'node_modules', '@rollup')
  let nativeRoll = []
  if (existsSync(rollupScope)) {
    nativeRoll = readdirSync(rollupScope).filter((n) => n.startsWith('rollup-'))
  }
  lines.push(`node_modules/@rollup/rollup-linux-*: ${nativeRoll.length ? nativeRoll.join(', ') : 'none'}`)
  return lines.join('\n')
}

if (cmd === 'install') {
  installWasmToolchain(nm)
  const errs = verifyWasmToolchain(cwd)
  if (errs.length) {
    console.error(errs.join('\n'))
    process.exit(1)
  }
  console.log(reportWasmToolchain(cwd))
  process.exit(0)
}

if (cmd === 'report') {
  console.log(reportWasmToolchain(cwd))
  process.exit(0)
}

if (cmd === 'verify') {
  const errs = verifyWasmToolchain(cwd)
  if (errs.length) {
    console.error(errs.join('\n'))
    process.exit(1)
  }
  console.log(reportWasmToolchain(cwd))
  process.exit(0)
}

console.error(`Unknown command: ${cmd}`)
process.exit(2)
