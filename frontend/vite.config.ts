import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    // The CSP allows no inline scripts, so nothing may be inlined into HTML.
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    proxy: {
      // Mirrors how CloudFront routes the API in production, so local
      // development exercises the same same-origin paths.
      '/assessments': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
