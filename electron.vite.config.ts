import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main')
      }
    },
    build: { sourcemap: process.env.NODE_ENV !== 'production' }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: {
      sourcemap: process.env.NODE_ENV !== 'production',
      rollupOptions: {
        output: {
          // Electron sandboxed preload scripts do not support ESM imports.
          // Emit one CommonJS preload file and point BrowserWindow to it.
          format: 'cjs',
          entryFileNames: 'index.cjs',
          chunkFileNames: 'chunks/[name]-[hash].cjs'
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()],
    build: { sourcemap: process.env.NODE_ENV !== 'production' }
  }
});
