import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': path.resolve(here, '../shared/src'),
    },
  },
  server: {
    port: 5173,
    // Shared game code lives outside the client root, so Vite has to be allowed to serve it.
    fs: { allow: [path.resolve(here, '..')] },
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
})
