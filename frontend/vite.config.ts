import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
    sourcemap: process.env.VITE_BUILD_LOW_MEMORY !== '1',
    rollupOptions: {
      maxParallelFileOps: process.env.VITE_BUILD_LOW_MEMORY === '1' ? 1 : undefined,
    },
  },
})
