import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// In development the API runs separately (npm run dev:api) and is reached through this server,
// so cookies and the Origin header are those of the page.
const api = process.env.API_ORIGIN ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Alimentation',
        short_name: 'Alimentation',
        description: 'Mess and tiffin accounts for small kitchens.',
        start_url: '/app',
        scope: '/',
        display: 'standalone',
        background_color: '#EEF1EC',
        theme_color: '#1F4D3A',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        // Only the Latin letters of the fonts are kept for offline use.
        globPatterns: ['**/*.{js,css,html,svg,png}', '**/*-latin-*.woff2'],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/auth': { target: api, changeOrigin: false },
    },
  },
  build: { target: 'es2023', sourcemap: false },
});
