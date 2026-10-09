import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolveBuildCommit } from './src/shared/utils/build-commit.js';

// Đợt 5: mã commit của bản build, hiện ở Giới thiệu/Chẩn đoán và trong gói chẩn đoán.
const buildCommit = JSON.stringify(
  resolveBuildCommit({
    git: () => execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
    env: process.env
  })
);

export default defineConfig({
  main: {
    define: { __TUBMEDIA_BUILD_COMMIT__: buildCommit },
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
    define: { __TUBMEDIA_BUILD_COMMIT__: buildCommit },
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
