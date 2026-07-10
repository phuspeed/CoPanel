/**
 * Vite lib build for a single CoPanel AppStore module extension.
 * Env: MODULE_ID, EXTENSION_OUT_DIR
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const copanelFrontend = __dirname;

const moduleId = process.env.MODULE_ID;
const outDir = process.env.EXTENSION_OUT_DIR;

if (!moduleId || !outDir) {
  throw new Error('MODULE_ID and EXTENSION_OUT_DIR env vars required');
}

const entry = path.join(copanelFrontend, 'src', 'modules', moduleId, 'index.tsx');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.join(copanelFrontend, 'src'),
    },
  },
  build: {
    lib: {
      entry,
      formats: ['es'],
      fileName: () => 'module.js',
    },
    outDir,
    emptyOutDir: true,
    target: 'es2020',
    minify: 'esbuild',
    rollupOptions: {
      external: [
        'react',
        'react/jsx-runtime',
        'react-dom',
        'react-dom/client',
        'react-router-dom',
        'lucide-react',
        /^lucide-react\//,
      ],
      output: {
        assetFileNames: 'module.[ext]',
      },
    },
  },
});
