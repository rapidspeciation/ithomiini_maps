// Theme presets for Wings Atlas
// Each theme has both light and dark variants defined in index.css

export const themes = {
  emerald: {
    name: 'Emerald',
    description: 'Classic green theme for scientific data visualization',
    accentColor: '#4ade80', // Green
    previewBgDark: '#1a1a2e',
    previewBgLight: '#f8f9fa',
  },

  ocean: {
    name: 'Ocean',
    description: 'Cool blue theme inspired by the deep sea',
    accentColor: '#00d4ff', // Cyan
    previewBgDark: '#0d1b2a',
    previewBgLight: '#f0f7fa',
  },

  forest: {
    name: 'Forest',
    description: 'Natural green theme inspired by tropical forests',
    accentColor: '#8bc34a', // Lime green
    previewBgDark: '#1a2e1a',
    previewBgLight: '#f5f9f0',
  },

  sunset: {
    name: 'Sunset',
    description: 'Warm theme with orange tones',
    accentColor: '#ff7f50', // Coral
    previewBgDark: '#2e1a1a',
    previewBgLight: '#fdf8f3',
  },

  lavender: {
    name: 'Lavender',
    description: 'Elegant purple theme',
    accentColor: '#a78bfa', // Violet
    previewBgDark: '#1f1a2e',
    previewBgLight: '#faf8fc',
  }
}

// Default theme
export const DEFAULT_THEME = 'emerald'
export const DEFAULT_MODE = 'dark'

// Get theme by name with fallback to default
export function getTheme(name) {
  return themes[name] || themes[DEFAULT_THEME]
}

// Get theme options for select dropdowns
export function getThemeOptions() {
  return Object.entries(themes).map(([key, theme]) => ({
    value: key,
    label: theme.name,
    description: theme.description,
    accentColor: theme.accentColor,
    previewBgDark: theme.previewBgDark,
    previewBgLight: theme.previewBgLight,
  }))
}
