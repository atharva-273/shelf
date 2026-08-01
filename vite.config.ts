import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

/**
 * `npm run dev`       → http://localhost:5173 (desktop work)
 * `npm run dev:https` → https://<your-lan-ip>:5173 (testing on a phone)
 * `npm run build`     → dist/, served from a subpath on GitHub Pages
 *
 * The HTTPS mode exists because getUserMedia only runs in a secure context.
 * localhost counts as secure; a plain http:// LAN address does not — so the
 * camera silently refuses to start when you open the dev server on a phone
 * over the network. A self-signed cert fixes that, though Chrome warns first.
 *
 * BASE_PATH matters: GitHub Pages serves a project repo from /<repo>/, so
 * every absolute asset URL has to be prefixed. Anything referencing a public/
 * file must go through `import.meta.env.BASE_URL` (TS) or `%BASE_URL%` (HTML)
 * rather than a bare leading slash.
 */
const BASE_PATH = process.env.VITE_BASE_PATH ?? '/'

export default defineConfig(({ mode }) => ({
  base: BASE_PATH,
  plugins: [react(), tailwindcss(), ...(mode === 'https' ? [basicSsl()] : [])],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
}))
