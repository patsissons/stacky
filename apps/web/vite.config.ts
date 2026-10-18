import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const serverUrl = process.env.STACKY_DEV_SERVER ?? 'http://localhost:5005'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: serverUrl, changeOrigin: false },
      '/healthz': { target: serverUrl },
      '/ws': { target: serverUrl, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
