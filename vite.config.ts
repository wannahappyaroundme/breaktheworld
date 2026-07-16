import { defineConfig } from 'vite'

// GitHub Pages serves from https://<user>.github.io/breaktheworld/.
// Use the repo sub-path for production builds and root for local dev.
// If you fork/rename the repo, change '/breaktheworld/' to match.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/breaktheworld/' : '/',
  build: {
    target: 'es2020',
    outDir: 'dist',
    rollupOptions: {
      input: {
        game: 'index.html',
        admin: 'admin.html',
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}))
