import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // React e o catálogo mudam pouco: ficam em arquivos próprios e o navegador guarda entre atualizações
        manualChunks(id) {
          if (/node_modules\/\.pnpm\/(react|react-dom|scheduler)@/.test(id)) return 'vendor-react';
          if (/vgfa-runtime\/src\/(catalog-ps1|catalog-ps2|store-catalog|cover-urls)\.ts$/.test(id)) return 'catalog';
          return undefined;
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    // Headers obrigatórios para SharedArrayBuffer em Safari, Chrome, Edge e Firefox
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8787',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
