import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const lowMemory = process.env.VITE_BUILD_LOW_MEMORY === '1' // serial Rollup + no esbuild minify (no-AVX / low-RAM)

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
    target: lowMemory ? 'es2020' : 'modules',
    minify: lowMemory ? false : 'esbuild',
    cssMinify: !lowMemory,
    sourcemap: !lowMemory,
    reportCompressedSize: !lowMemory,
    cssCodeSplit: !lowMemory,
    rollupOptions: {
      maxParallelFileOps: lowMemory ? 1 : undefined,
    },
  },
})
