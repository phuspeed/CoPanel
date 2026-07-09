import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const lowMemory = process.env.VITE_BUILD_LOW_MEMORY === '1' // serial Rollup ops (no-AVX / low-RAM hosts)

export default defineConfig({
  plugins: [react()],
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
    outDir: 'dist',
    sourcemap: !lowMemory,
    reportCompressedSize: !lowMemory,
    cssCodeSplit: !lowMemory,
    rollupOptions: {
      maxParallelFileOps: lowMemory ? 1 : undefined,
      output: lowMemory
        ? {
            manualChunks(id) {
              if (!id.includes('node_modules')) return
              if (id.includes('recharts')) return 'recharts'
              if (id.includes('lucide-react')) return 'lucide'
              if (id.includes('@xterm')) return 'xterm'
              return 'vendor'
            },
          }
        : undefined,
    },
  },
})
