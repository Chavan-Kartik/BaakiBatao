import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    // The API is a separate process; proxying keeps the session cookie first-party.
    proxy: { '/api': { target: process.env['FC_API_URL'] ?? 'http://localhost:3000', changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: true },
});
