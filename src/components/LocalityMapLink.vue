<script setup>
import { computed } from 'vue'
import { MapPinned } from 'lucide-vue-next'

const props = defineProps({
  site: { type: Object, required: true }
})

const points = computed(() => (props.site.recordedPoints || []).filter(point =>
  Array.isArray(point) && point.length === 2 &&
  Number.isFinite(point[0]) && Math.abs(point[0]) <= 180 &&
  Number.isFinite(point[1]) && Math.abs(point[1]) <= 90
))
const mapsUrl = ([longitude, latitude]) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`
</script>

<template>
  <a
    v-if="points.length === 1"
    class="locality-map-link"
    :href="mapsUrl(points[0])"
    target="_blank"
    rel="noopener noreferrer"
    title="Open in Google Maps"
    aria-label="Open in Google Maps"
  ><MapPinned :size="15" aria-hidden="true" /></a>
  <details v-else-if="points.length > 1" class="locality-map-choices">
    <summary class="locality-map-link" title="Open in Google Maps" aria-label="Open in Google Maps">
      <MapPinned :size="15" aria-hidden="true" />
    </summary>
    <div class="locality-map-options">
      <a
        v-for="point in points"
        :key="JSON.stringify(point)"
        :href="mapsUrl(point)"
        target="_blank"
        rel="noopener noreferrer"
      >{{ point[1] }}, {{ point[0] }}</a>
    </div>
  </details>
</template>

<style scoped>
.locality-map-link { display: inline-flex; align-items: center; justify-content: center; flex: none; box-sizing: border-box; width: 32px; height: 32px; border: 1px solid transparent; border-radius: 4px; color: var(--color-accent, #4ade80); cursor: pointer; list-style: none; }
.locality-map-link::-webkit-details-marker { display: none; }
.locality-map-link:hover { border-color: var(--color-accent, #4ade80); background: var(--color-accent-subtle, rgba(74, 222, 128, .15)); }
.locality-map-link:focus-visible, .locality-map-options a:focus-visible { outline: 2px solid var(--color-accent, #4ade80); outline-offset: 2px; }
.locality-map-choices { flex: none; width: 32px; }
.locality-map-choices[open] { width: 155px; }
.locality-map-choices summary { margin-left: auto; }
.locality-map-options { box-sizing: border-box; width: 100%; max-height: 180px; overflow-y: auto; padding: 4px; border: 1px solid var(--color-border, #3d3d5c); border-radius: 5px; background: var(--color-bg-primary, #1a1a2e); box-shadow: 0 4px 12px var(--color-shadow-color, rgba(0, 0, 0, .5)); }
.locality-map-options a { display: block; padding: 5px 7px; border-radius: 3px; color: var(--color-text-primary, #e0e0e0); font-size: .72rem; white-space: nowrap; font-variant-numeric: tabular-nums; text-decoration: none; }
.locality-map-options a:hover { background: var(--color-bg-tertiary, #2d2d4a); }
</style>
