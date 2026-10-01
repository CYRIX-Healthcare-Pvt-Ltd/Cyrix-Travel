import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

/**
 * Travel Expense lives at app.cyrix.in/travel, behind the portal's rewrite —
 * the same arrangement as KPI at /kpi and Revive Lab at /revive.
 */
export default defineConfig({
  base: '/travel/',
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    outDir: 'dist/travel',
    emptyOutDir: true,
  },
  server: { port: 5178 },
  test: {
    environment: 'node',
  },
} as never)
