/**
 * App configuration — edit this file to customize for your own data.
 * See CUSTOMIZATION.md for detailed instructions.
 */
export default {
  // App identity
  title: 'Wings Atlas',
  subtitle: 'Neotropical Butterfly Distributions',
  logoPath: new URL('./assets/Map_icon.svg', import.meta.url).href,
  repoUrl: 'https://github.com/rapidspeciation/ithomiini_maps/',

  // Data configuration
  dataDir: '/data/',
  manifestFile: 'data_manifest.json',

  // Database update
  // The Cloudflare Worker that starts the «Update Database» workflow (scripts/cloudflare-worker.js).
  workerUrl: import.meta.env.VITE_WORKER_URL || 'https://ithomiini-maps-db-updater.franz-chandi.workers.dev/',
  githubOwner: import.meta.env.VITE_GITHUB_OWNER || 'rapidspeciation',
  githubRepo: import.meta.env.VITE_GITHUB_REPO || 'ithomiini_maps',

  // Feature flags — disable features you don't need
  features: {
    mimicrySelector: true,
    goatIntegration: true,
    databaseUpdate: true,
    imageGallery: true,
  }
}
