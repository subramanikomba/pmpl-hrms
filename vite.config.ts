import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'favicon-32.png', 'favicon-16.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'PMPL HRMS',
        short_name: 'PMPL HRMS',
        description: 'Polyfill Microns Pvt. Ltd. — Employee Management, Attendance & Payroll',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#F2F1ED',
        theme_color: '#2B3944',
        orientation: 'portrait-primary',
        icons: [
          { src: 'icons/icon-96.png', sizes: '96x96', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-144.png', sizes: '144x144', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-384.png', sizes: '384x384', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          {
            name: 'Mark attendance',
            short_name: 'Attendance',
            url: './#/attendance',
            icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Payroll',
            short_name: 'Payroll',
            url: './#/admin/payroll',
            icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,jpg,svg,woff2}'],
        // Take over immediately on a new deploy instead of waiting for every
        // tab to close, and drop stale precached bundles. Without this a
        // returning user can keep seeing the previous build.
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
        // Never cache Supabase auth/REST traffic — the SW must not be able to
        // serve a stale session or stale business data.
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
} as never);
