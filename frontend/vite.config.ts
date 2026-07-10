import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const lowMemory = process.env.VITE_BUILD_LOW_MEMORY === '1'
const outDir = process.env.VITE_BUILD_OUTDIR || 'dist'

const VENDOR_CHUNK_NAMES = new Set([
  'react-vendor',
  'react-dom-vendor',
  'router-vendor',
  'lucide-vendor',
])

function extensionImportMapPlugin(): Plugin {
  const vendorFiles: Record<string, string> = {}

  return {
    name: 'copanel-extension-importmap',
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk' && VENDOR_CHUNK_NAMES.has(item.name)) {
          vendorFiles[item.name] = `/${item.fileName}`
        }
      }
    },
    closeBundle() {
      if (Object.keys(vendorFiles).length === 0) return

      const imports: Record<string, string> = {}
      if (vendorFiles['react-vendor']) imports['react'] = vendorFiles['react-vendor']
      if (vendorFiles['react-vendor']) imports['react/jsx-runtime'] = vendorFiles['react-vendor']
      if (vendorFiles['react-dom-vendor']) {
        imports['react-dom'] = vendorFiles['react-dom-vendor']
        imports['react-dom/client'] = vendorFiles['react-dom-vendor']
      }
      if (vendorFiles['router-vendor']) imports['react-router-dom'] = vendorFiles['router-vendor']
      if (vendorFiles['lucide-vendor']) imports['lucide-react'] = vendorFiles['lucide-vendor']

      const absOut = resolve(outDir)
      writeFileSync(resolve(absOut, 'importmap.json'), JSON.stringify({ imports }, null, 2) + '\n')

      const indexPath = resolve(absOut, 'index.html')
      if (existsSync(indexPath)) {
        let html = readFileSync(indexPath, 'utf8')
        if (!html.includes('importmap.json')) {
          html = html.replace(
            '</head>',
            '    <script type="importmap" src="/importmap.json"></script>\n  </head>',
          )
          writeFileSync(indexPath, html)
        }
      }
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
    target: lowMemory ? 'es2020' : 'modules',
    minify: lowMemory ? false : 'esbuild',
    cssMinify: !lowMemory,
    sourcemap: !lowMemory,
    reportCompressedSize: !lowMemory,
    cssCodeSplit: !lowMemory,
    modulePreload: !lowMemory,
    rollupOptions: {
      maxParallelFileOps: lowMemory ? 1 : undefined,
      // Rollup rejects manualChunks when inlineDynamicImports is set (no-AVX / low-memory path).
      output: lowMemory
        ? {
            inlineDynamicImports: true,
            chunkFileNames: 'assets/[name]-[hash].js',
          }
        : {
            manualChunks(id) {
              if (id.includes('node_modules/lucide-react')) return 'lucide-vendor'
              if (id.includes('node_modules/react-router')) return 'router-vendor'
              if (id.includes('node_modules/react-dom')) return 'react-dom-vendor'
              if (id.includes('node_modules/react/') || id.endsWith('node_modules/react')) {
                return 'react-vendor'
              }
              return undefined
            },
            chunkFileNames(chunk) {
              if (VENDOR_CHUNK_NAMES.has(chunk.name)) return `assets/${chunk.name}.js`
              return 'assets/[name]-[hash].js'
            },
          },
    },
  },
  esbuild: lowMemory
    ? {
        target: 'es2020',
        legalComments: 'none',
      }
    : undefined,
  optimizeDeps: lowMemory
    ? {
        esbuildOptions: { target: 'es2020' },
      }
    : undefined,
})
