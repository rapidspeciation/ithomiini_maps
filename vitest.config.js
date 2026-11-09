import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.js'

export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    // No test may use a model CLI, an AI host or T3 (test/no-ai-core.mjs).
    setupFiles: ['./test/no-ai-vitest.mjs'],
    include: ['src/**/*.{test,spec}.{js,ts}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,vue}'],
      exclude: ['src/components/ui/**'],
    },
  },
}))
