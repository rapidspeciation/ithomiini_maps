import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

function sourceRevision() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA
  try {
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    try {
      execFileSync('git', ['diff', '--quiet', 'HEAD'], { stdio: 'ignore' })
      return revision
    } catch {
      return `${revision}-dirty`
    }
  } catch {
    return 'unknown'
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  
  // GitHub Pages deployment - repository name as base path
  // Change this if your repo name is different
  base: '/ithomiini_maps/',
  
  // Build optimization
  build: {
    // Generate source maps for debugging
    sourcemap: false,
    
    // Chunk size warnings
    chunkSizeWarningLimit: 1000,
    
    // Rollup options
    rollupOptions: {
      output: {
        // Manual chunk splitting for better caching
        manualChunks: {
          'maplibre': ['maplibre-gl'],
          'vue-vendor': ['vue', 'pinia'],
        }
      }
    }
  },
  
  // Define global constants (for citation versioning)
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __COMMIT_HASH__: JSON.stringify(sourceRevision()),
  },
  
  // Dev server options
  server: {
    port: 5173,
    open: true,
    watch: {
      ignored: ['**/.omx/**'],
    },
  }
})
