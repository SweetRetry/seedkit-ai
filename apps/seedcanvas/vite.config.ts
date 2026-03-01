import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react(), tailwindcss()],

  // Prevent Vite from clearing terminal output on dev
  clearScreen: false,

  server: {
    // Tauri expects a fixed port; fail if not available
    port: 1420,
    strictPort: true,
    // If Tauri is used in mobile, bind to host
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
  },

  // Env prefix for Tauri env variables
  envPrefix: ['VITE_', 'TAURI_ENV_*'],

  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS/Linux
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari14',
    // Disable minification for debug builds
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    // Source maps for debug builds
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
})
