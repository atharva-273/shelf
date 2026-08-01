import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

/**
 * `npm run dev`       → http://localhost:5173 (desktop work)
 * `npm run dev:https` → https://<your-lan-ip>:5173 (testing on a phone)
 *
 * The HTTPS mode exists because getUserMedia only runs in a secure context.
 * localhost counts as secure; a plain http:// LAN address does not — so the
 * camera silently refuses to start when you open the dev server on a phone
 * over the network. A self-signed cert fixes that (Chrome will warn once;
 * tap Advanced → Proceed).
 */
export default defineConfig(({ mode }) => ({
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
