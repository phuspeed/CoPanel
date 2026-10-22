import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const lowMemory = process.env.VITE_BUILD_LOW_MEMORY === '1'
/** CPUs without AVX: WASM esbuild can SIGPIPE during minify/render — avoid esbuild minify. */
const noAvx = process.env.COPANEL_NOAVX === '1'
const conservativeBuild = lowMemory || noAvx
const outDir = process.env.VITE_BUILD_OUTDIR || 'dist'
const rootDir = resolve(__dirname)

const VENDOR_CHUNK_NAMES = new Set([
  'react-vendor',
  'react-dom-vendor',
  'router-vendor',
  'lucide-vendor',
])

const IMPORT_MAP_SPECIFIERS = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'react-router-dom',
  'lucide-react',
])

const VENDOR_ENTRY_FILES: Record<string, string> = {
  'react-vendor': resolve(rootDir, 'vendor/react-vendor.ts'),
  'react-dom-vendor': resolve(rootDir, 'vendor/react-dom-vendor.ts'),
  'router-vendor': resolve(rootDir, 'vendor/router-vendor.ts'),
  'lucide-vendor': resolve(rootDir, 'vendor/lucide-vendor.ts'),
}

function extensionRuntimeExternal(id: string, importer?: string): boolean {
  if (!IMPORT_MAP_SPECIFIERS.has(id)) return false
  const imp = (importer ?? '').replace(/\\/g, '/')

  if (imp.includes('/vendor/react-vendor')) return false

  if (imp.includes('/vendor/react-dom-vendor')) {
    return id === 'react' || id === 'react/jsx-runtime'
  }

  if (imp.includes('/vendor/router-vendor') || imp.includes('/vendor/lucide-vendor')) {
    return (
      id === 'react' ||
      id === 'react/jsx-runtime' ||
      id === 'react-dom' ||
      id === 'react-dom/client'
    )
  }

  if (imp.includes('/vendor/')) return false

  // Keep React inside react-vendor (jsx-runtime's internal react import must not stay bare).
  if ((id === 'react' || id === 'react/jsx-runtime') && imp.includes('node_modules/react/')) {
    return false
  }

  if (imp.includes('/src/')) return true

  if (imp.includes('node_modules')) return true

  return true
}

function buildImportMap(vendorFiles: Record<string, string>) {
  const imports: Record<string, string> = {}
  if (vendorFiles['react-vendor']) {
    imports['react'] = vendorFiles['react-vendor']
    imports['react/jsx-runtime'] = vendorFiles['react-vendor']
  }
  if (vendorFiles['react-dom-vendor']) {
    imports['react-dom'] = vendorFiles['react-dom-vendor']
    imports['react-dom/client'] = vendorFiles['react-dom-vendor']
  }
  if (vendorFiles['router-vendor']) imports['react-router-dom'] = vendorFiles['router-vendor']
  if (vendorFiles['lucide-vendor']) imports['lucide-react'] = vendorFiles['lucide-vendor']
  return { imports }
}

function patchIndexHtmlImportMap(indexPath: string, importMap: { imports: Record<string, string> }) {
  if (!existsSync(indexPath)) return

  let html = readFileSync(indexPath, 'utf8')
  const inlineTag =
    `    <script type="importmap">\n${JSON.stringify(importMap, null, 2)}\n    </script>\n`
  if (html.includes('type="importmap"')) {
    html = html.replace(/<script type="importmap"[^>]*>[\s\S]*?<\/script>\s*/i, inlineTag)
    html = html.replace(/<script type="importmap" src="\/importmap\.json"><\/script>\s*/i, '')
  } else {
    html = html.replace('</head>', `${inlineTag}  </head>`)
  }
  writeFileSync(indexPath, html)
}

/**
 * AppStore extensions (`/extensions/<id>/module.js`) import React etc. as bare
 * specifiers. Browsers need an import map pointing at stable vendor chunks.
 */
function extensionImportMapPlugin(): Plugin {
  const vendorFiles: Record<string, string> = {}

  return {
    name: 'copanel-extension-importmap',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const key of Object.keys(vendorFiles)) delete vendorFiles[key]

      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk' && item.name && VENDOR_CHUNK_NAMES.has(item.name)) {
          vendorFiles[item.name] = `/${item.fileName}`
        }
      }
    },
    writeBundle() {
      if (Object.keys(vendorFiles).length === 0) {
        console.warn(
          '[copanel-extension-importmap] No vendor chunks emitted — AppStore extensions will fail to load.',
        )
        return
      }

      const absOut = resolve(outDir)
      const importMap = buildImportMap(vendorFiles)
      writeFileSync(resolve(absOut, 'importmap.json'), JSON.stringify(importMap, null, 2) + '\n')
      patchIndexHtmlImportMap(resolve(absOut, 'index.html'), importMap)
    },
  }
}

export default defineConfig({
  plugins: [react(), extensionImportMapPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir,
    target: conservativeBuild ? 'es2020' : 'modules',
    minify: conservativeBuild ? false : 'esbuild',
    cssMinify: !conservativeBuild,
    sourcemap: !conservativeBuild,
    reportCompressedSize: !conservativeBuild,
    cssCodeSplit: !conservativeBuild,
    modulePreload: !conservativeBuild,
    rollupOptions: {
      preserveEntrySignatures: 'strict',
      maxParallelFileOps: conservativeBuild ? 1 : undefined,
      input: {
        main: resolve(rootDir, 'index.html'),
        ...VENDOR_ENTRY_FILES,
      },
      external(id, importer) {
        return extensionRuntimeExternal(id, importer)
      },
      output: {
        minifyInternalExports: false,
        entryFileNames(chunk) {
          if (chunk.name && VENDOR_CHUNK_NAMES.has(chunk.name)) return `assets/${chunk.name}.js`
          return 'assets/[name]-[hash].js'
        },
        chunkFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
  esbuild: conservativeBuild
    ? {
        target: 'es2020',
        legalComments: 'none',
      }
    : undefined,
  optimizeDeps: conservativeBuild
    ? {
        esbuildOptions: { target: 'es2020' },
      }
    : undefined,
})
