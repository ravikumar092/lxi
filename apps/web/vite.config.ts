import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig(() => {
  return {
  plugins: [react()],
  // Load .env from the monorepo root (two levels up from apps/web)
  envDir: path.resolve(__dirname, '../../'),
  envPrefix: ['VITE_', 'GEMINI_', 'GROQ_'],
  server: {
    proxy: {
      // Local backend — Admin API (metrics, logs, etc.)
      '/api/admin': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      // Local backend — advance list PDF proxy (must be before /api catch-all)
      '/api/advance-list-proxy': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      // Local backend — PDF parsing offload endpoint
      '/api/v1': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      // Local backend — communication hub
      '/api/communication': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      // Local backend — filing bundle PDF generation
      '/api/generate-bundle': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      // Supreme Court API (catch-all — keep last)
      '/api': {
        target: 'https://lex-t.vercel.app',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path,
      },
      // eCourts India partner REST API — local backend adds Bearer token
      '/ecourts-api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      // eCourts PDF proxy
      '/ecourts-pdf': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      // SC office report
      '/sci-report': {
        target: 'https://api.sci.gov.in',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/sci-report/, ''),
      },
      // SC cause list
      '/sci-causelist': {
        target: 'https://sci.gov.in',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/sci-causelist/, ''),
      },
      // SC website WordPress AJAX — local backend proxies this
      '/sci-wp': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      // SC diary status, case number lookups — local backend
      '/sc-diary-status': { target: 'http://localhost:3001', changeOrigin: true, secure: false },
      '/sc-case-number':  { target: 'http://localhost:3001', changeOrigin: true, secure: false },
      '/sc-case-session': { target: 'http://localhost:3001', changeOrigin: true, secure: false },
      '/sc-captcha-img':  { target: 'http://localhost:3001', changeOrigin: true, secure: false },
      '/causelist-test':  { target: 'http://localhost:3001', changeOrigin: true, secure: false },
      // India Post tracking
      '/indiapost': {
        target: 'https://www.indiapost.gov.in',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/indiapost/, ''),
      },
    },
  },
  
    build: {
      // Increase chunk size warning limit to 1MB
      chunkSizeWarningLimit: 1000,
    },
  };
});
