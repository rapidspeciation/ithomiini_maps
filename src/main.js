import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './index.css'
import './style.css'
import { log } from './utils/logger'

// Import vue-multiselect CSS
import 'vue-multiselect/dist/vue-multiselect.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.mount('#app')

// Initialize theme store (applies stored theme on load)
import { useThemeStore } from './stores/theme'
const themeStore = useThemeStore(pinia)

// Log build info for debugging
log.data.info('Wings Atlas')
log.data.info('Build:', typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'dev')
log.data.info('Commit:', typeof __COMMIT_HASH__ !== 'undefined' ? __COMMIT_HASH__ : 'local')
log.data.info('Theme:', themeStore.currentTheme)

import { perf } from './utils/perfMonitor'
import { mem } from './utils/memoryMonitor'
window.perfReport = () => perf.report()
window.memReport = () => mem.report()

import('../test/exerciseApp.js').then(mod => {
  window.exerciseApp = mod.exerciseApp
}).catch(() => {})
