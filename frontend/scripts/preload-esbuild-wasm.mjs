/**
 * Refuse to start Vite when `esbuild` is still the native Go binary.
 *
 * install.sh replaces node_modules/esbuild with esbuild-wasm. The WASM
 * package's Node entry spawns `node bin/esbuild`, which loads esbuild.wasm.
 * The native ELF binary segfaults on CPUs without AVX, so this guard runs
 * before Vite can spawn it.
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

let pkgJson = ''
try {
  pkgJson = require.resolve('esbuild/package.json')
} catch {
  pkgJson = ''
}

if (pkgJson) {
  const root = dirname(pkgJson)
  const wasmFile = join(root, 'esbuild.wasm')
  const bin = join(root, 'bin', 'esbuild')
  if (!existsSync(wasmFile)) {
    throw new Error(
      'CoPanel expected esbuild-wasm, but esbuild.wasm is missing. The native esbuild binary segfaults on CPUs without AVX.',
    )
  }
  if (existsSync(bin)) {
    const head = readFileSync(bin).subarray(0, 4)
    if (head.length >= 4 && head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) {
      throw new Error(
        'node_modules/esbuild/bin/esbuild is a native ELF binary. Refusing to run it on a CPU without AVX.',
      )
    }
  }
}
