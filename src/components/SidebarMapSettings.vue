<script setup>
import { useDataStore } from '../stores/data'
import { useLegendStore } from '../stores/legend'
import { Eye, EyeOff } from 'lucide-vue-next'

const store = useDataStore()
const legendStore = useLegendStore()

// Toggle legend visibility
function toggleLegend() {
  legendStore.showLegend = !legendStore.showLegend
  store.legendSettings.showLegend = legendStore.showLegend
}

function resetHeatmapSettings() {
  store.heatmapSettings = { ...store.DEFAULT_HEATMAP_SETTINGS }
}

function resetRangeSettings() {
  store.rangeSettings = { ...store.DEFAULT_RANGE_SETTINGS }
}
</script>

<template>
  <!-- Visualization Mode -->
  <div class="filter-section">
    <label class="section-label">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="12 2 2 7 12 12 22 7 12 2"/>
        <polyline points="2 17 12 22 22 17"/>
        <polyline points="2 12 12 17 22 12"/>
      </svg>
      Visualization
    </label>
    <div class="viz-mode-toggle">
      <button
        :class="{ active: store.visualizationMode === 'points' }"
        @click="store.visualizationMode = 'points'"
      >Points</button>
      <button
        :class="{ active: store.visualizationMode === 'clusters' }"
        @click="store.visualizationMode = 'clusters'"
      >Clusters</button>
      <button
        :class="{ active: store.visualizationMode === 'heatmap' }"
        @click="store.visualizationMode = 'heatmap'"
      >Heatmap</button>
      <button
        :class="{ active: store.visualizationMode === 'ranges' }"
        @click="store.visualizationMode = 'ranges'"
      >Ranges</button>
    </div>

    <!-- Points settings -->
    <div v-if="store.visualizationMode === 'points'" style="margin-top: 12px;">
      <label class="toggle-row scatter-toggle">
        <input type="checkbox" v-model="store.sizeByIndividuals" />
        <span>Size markers by individuals</span>
      </label>
      <p class="filter-hint">
        One marker per site; larger markers hold more individuals.
      </p>
    </div>

    <!-- Clusters settings -->
    <div v-if="store.visualizationMode === 'clusters'" class="settings-panel" style="margin-top: 12px;">
      <p class="filter-hint" style="margin-top: 0; margin-bottom: 8px;">
        Groups nearby points into clusters. Click a cluster to view all points.
      </p>
      <div class="setting-row">
        <label>Cluster Radius <span class="unit-label">(pixels)</span></label>
        <div class="slider-group">
          <input
            type="range"
            min="20"
            max="200"
            step="10"
            v-model.number="store.clusterSettings.radiusPixels"
          />
          <input
            type="number"
            class="setting-input"
            min="10"
            max="500"
            v-model.number.lazy="store.clusterSettings.radiusPixels"
            @keydown.enter="$event.target.blur()"
          />
        </div>
        <p class="count-mode-hint">
          Points within this pixel distance are grouped into clusters.
          Lower values create more clusters; higher values merge nearby points.
        </p>
      </div>

      <div class="setting-row">
        <label for="cluster-appearance">Cluster appearance</label>
        <select id="cluster-appearance" v-model="store.clusterSettings.compositionRings" class="style-select">
          <option :value="true">Taxon composition rings</option>
          <option :value="false">Plain numbered circles</option>
        </select>
        <p v-if="store.clusterSettings.compositionRings" class="count-mode-hint">Ring segments show proportions of records, using legend colours. The centre counts all matching records.</p>
      </div>

      <label class="toggle-row cluster-points-toggle">
        <input type="checkbox" v-model="store.clusterSettings.showClusterPoints" />
        <span>Show points of selected cluster</span>
      </label>
    </div>

    <!-- Heatmap settings -->
    <div v-if="store.visualizationMode === 'heatmap'" class="settings-panel" style="margin-top: 12px;">
      <div class="setting-row">
        <label>Radius</label>
        <div class="slider-group">
          <input type="range" min="5" max="50" step="1" v-model.number="store.heatmapSettings.radius" />
          <span class="slider-value">{{ store.heatmapSettings.radius }}px</span>
        </div>
      </div>
      <div class="setting-row">
        <label>Intensity</label>
        <div class="slider-group">
          <input type="range" min="0.1" max="3" step="0.1" v-model.number="store.heatmapSettings.intensity" />
          <span class="slider-value">{{ store.heatmapSettings.intensity.toFixed(1) }}</span>
        </div>
      </div>
      <div class="setting-row">
        <label>Opacity</label>
        <div class="slider-group">
          <input type="range" min="0" max="1" step="0.05" v-model.number="store.heatmapSettings.opacity" />
          <span class="slider-value">{{ Math.round(store.heatmapSettings.opacity * 100) }}%</span>
        </div>
      </div>
      <button class="btn-reset-heatmap" @click="resetHeatmapSettings">
        Reset to defaults
      </button>
    </div>

    <!-- Ranges settings -->
    <div v-if="store.visualizationMode === 'ranges'" class="settings-panel" style="margin-top: 12px;">
      <div class="setting-row">
        <label>Method</label>
        <select v-model="store.rangeSettings.method" class="style-select">
          <option value="hexbin">Hex Density</option>
          <option value="hulls">Hull Polygons</option>
        </select>
      </div>

      <!-- Hex Density controls -->
      <div v-if="store.rangeSettings.method === 'hexbin'" class="setting-row">
        <label>Cell size <span class="unit-label">(km)</span></label>
        <div class="slider-group">
          <input type="range" min="10" max="200" step="10" v-model.number="store.rangeSettings.hexSize" />
          <span class="slider-value">{{ store.rangeSettings.hexSize }}km</span>
        </div>
      </div>

      <!-- Hull Polygon controls -->
      <template v-if="store.rangeSettings.method === 'hulls'">
        <div class="setting-row">
          <label>Group by</label>
          <select v-model="store.rangeSettings.groupBy" class="style-select">
            <option value="species">Species</option>
            <option value="subspecies">Subspecies</option>
            <option value="genus">Genus</option>
            <option value="mimicry">Mimicry Ring</option>
          </select>
        </div>
        <div class="setting-row">
          <label>Smoothing <span class="unit-label">(buffer km)</span></label>
          <div class="slider-group">
            <input type="range" min="0" max="100" step="5" v-model.number="store.rangeSettings.bufferKm" />
            <span class="slider-value">{{ store.rangeSettings.bufferKm }}km</span>
          </div>
        </div>
        <div class="setting-row">
          <label>Min. points</label>
          <div class="slider-group">
            <input type="range" min="3" max="20" step="1" v-model.number="store.rangeSettings.minPoints" />
            <input
              type="number"
              class="setting-input"
              min="3"
              max="100"
              v-model.number.lazy="store.rangeSettings.minPoints"
              @keydown.enter="$event.target.blur()"
            />
          </div>
        </div>
      </template>

      <div class="setting-row">
        <label>Fill opacity</label>
        <div class="slider-group">
          <input type="range" min="0" max="1" step="0.05" v-model.number="store.rangeSettings.opacity" />
          <span class="slider-value">{{ Math.round(store.rangeSettings.opacity * 100) }}%</span>
        </div>
      </div>
      <label class="toggle-row range-points-toggle">
        <input type="checkbox" v-model="store.rangeSettings.showPoints" />
        <span>Show points underneath</span>
      </label>
      <button class="btn-reset-heatmap" @click="resetRangeSettings">
        Reset to defaults
      </button>
    </div>
  </div>

  <!-- Legend Toggle -->
  <div class="filter-section">
    <label class="toggle-row legend-toggle" @click="toggleLegend">
      <component :is="legendStore.showLegend ? Eye : EyeOff" :size="18" />
      <span>Show Legend</span>
      <span
        class="toggle-badge-inline"
        :class="{ active: legendStore.showLegend }"
      >
        {{ legendStore.showLegend ? 'ON' : 'OFF' }}
      </span>
    </label>
    <p class="filter-hint">
      Hover over legend on map for customization options (colors, labels, position, point styles)
    </p>
  </div>
</template>

<style scoped>
.filter-section {
  margin-bottom: 20px;
}

.section-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--color-text-secondary, #aaa);
  margin-bottom: 10px;
}

.section-label svg {
  width: 14px;
  height: 14px;
  opacity: 0.7;
}

.viz-mode-toggle {
  display: flex;
  gap: 6px;
}

.viz-mode-toggle button {
  flex: 1;
  padding: 8px 12px;
  background: var(--color-bg-tertiary, #2d2d4a);
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 4px;
  color: var(--color-text-secondary, #aaa);
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.viz-mode-toggle button:hover {
  background: #353558;
  color: var(--color-text-primary, #e0e0e0);
}

.viz-mode-toggle button.active {
  background: var(--color-accent, #4ade80);
  border-color: var(--color-accent, #4ade80);
  color: var(--color-bg-primary, #1a1a2e);
}

.slider-value {
  min-width: 45px;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-accent, #4ade80);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.filter-hint {
  font-size: 0.7rem;
  color: var(--color-text-muted, #666);
  font-style: italic;
  margin-top: 6px;
}

/* Toggle Row */
.toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: var(--color-bg-tertiary, #2d2d4a);
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  transition: background 0.2s;
}

.toggle-row:hover {
  background: var(--color-bg-hover, #363653);
}

.toggle-row input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: var(--color-accent, #4ade80);
}

.toggle-row span {
  font-size: 0.9rem;
  color: var(--color-text-primary, #e0e0e0);
  font-weight: 500;
}

.scatter-toggle {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(59, 130, 246, 0.05) 100%);
  border: 1px solid rgba(59, 130, 246, 0.2);
}

.scatter-toggle:hover {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.08) 100%);
  border-color: rgba(59, 130, 246, 0.3);
}

.legend-toggle {
  background: linear-gradient(135deg, rgba(74, 222, 128, 0.1) 0%, rgba(74, 222, 128, 0.05) 100%);
  border: 1px solid rgba(74, 222, 128, 0.2);
}

.legend-toggle:hover {
  background: linear-gradient(135deg, rgba(74, 222, 128, 0.15) 0%, rgba(74, 222, 128, 0.08) 100%);
  border-color: rgba(74, 222, 128, 0.3);
}

/* Toggle Badges */
.toggle-badge-inline {
  margin-left: auto;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  background: rgba(107, 114, 128, 0.2);
  color: #888;
  border: 1px solid transparent;
}

.toggle-badge-inline:hover {
  background: rgba(107, 114, 128, 0.3);
  border-color: rgba(107, 114, 128, 0.4);
}

.toggle-badge-inline.active {
  background: rgba(74, 222, 128, 0.15);
  color: var(--color-accent, #4ade80);
  border-color: rgba(74, 222, 128, 0.3);
}

.toggle-badge-inline.active:hover {
  background: rgba(74, 222, 128, 0.25);
  border-color: rgba(74, 222, 128, 0.5);
}

/* Settings Panel & Rows */
.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 12px;
  background: var(--color-bg-primary, #1a1a2e);
  border-radius: 6px;
}

.setting-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.setting-row label {
  font-size: 0.75rem;
  color: var(--color-text-secondary, #aaa);
  font-weight: 500;
}

.count-mode-hint {
  font-size: 0.7rem;
  color: var(--color-text-muted, #666);
  font-style: italic;
  margin-top: 4px;
  margin-bottom: 0;
}

.unit-label {
  font-weight: 400;
  font-size: 0.65rem;
  color: var(--color-text-muted, #666);
}

.cluster-points-toggle,
.range-points-toggle {
  margin-top: 8px;
  background: linear-gradient(135deg, rgba(74, 222, 128, 0.08) 0%, rgba(74, 222, 128, 0.03) 100%);
  border: 1px solid rgba(74, 222, 128, 0.15);
}

.style-select {
  width: 100%;
  padding: 6px 10px;
  background: var(--color-bg-tertiary, #2d2d4a);
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 4px;
  color: var(--color-text-primary, #e0e0e0);
  font-size: 0.8rem;
  cursor: pointer;
}

.style-select:focus {
  outline: none;
  border-color: var(--color-accent, #4ade80);
}

/* Slider Group */
.slider-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.slider-group input[type="range"] {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--color-bg-tertiary, #2d2d4a);
  border-radius: 2px;
  outline: none;
}

.slider-group input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-accent, #4ade80);
  cursor: pointer;
  transition: transform 0.15s;
}

.slider-group input[type="range"]::-webkit-slider-thumb:hover {
  transform: scale(1.15);
}

.slider-group input[type="range"]::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: var(--color-accent, #4ade80);
  cursor: pointer;
}

/* Setting Input */
.setting-input {
  width: 55px;
  padding: 4px 6px;
  background: var(--color-bg-tertiary, #2d2d4a);
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 4px;
  color: var(--color-accent, #4ade80);
  font-size: 0.8rem;
  font-weight: 600;
  text-align: center;
  font-variant-numeric: tabular-nums;
  -moz-appearance: textfield;
}

.setting-input::-webkit-outer-spin-button,
.setting-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.setting-input:focus {
  outline: none;
  border-color: var(--color-accent, #4ade80);
  box-shadow: 0 0 0 2px rgba(74, 222, 128, 0.15);
}

/* Reset Heatmap Button */
.btn-reset-heatmap {
  width: 100%;
  padding: 6px 12px;
  margin-top: 4px;
  background: transparent;
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 4px;
  color: var(--color-text-secondary, #aaa);
  font-size: 0.7rem;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-reset-heatmap:hover {
  background: var(--color-bg-tertiary, #2d2d4a);
  color: var(--color-text-primary, #e0e0e0);
  border-color: var(--color-text-muted, #666);
}
</style>
