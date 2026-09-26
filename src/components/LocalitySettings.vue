<script setup>
import { Minus, Plus } from 'lucide-vue-next'
import { usePlanningStore } from '../stores/planning'

const planning = usePlanningStore()
function setMinimum(value) {
  const number = Number(value)
  planning.localitySettings.minRecords = Number.isFinite(number) ? Math.max(1, Math.min(10000, Math.floor(number))) : 10
}
function clampMinimum(event) {
  setMinimum(event.target.value)
  event.target.value = planning.localitySettings.minRecords
}
</script>

<template>
  <section class="locality-settings" aria-label="Location labels">
    <label class="locality-toggle">
      <span>Show location names</span>
      <input v-model="planning.localitySettings.enabled" type="checkbox" role="switch" />
      <span class="switch-track" aria-hidden="true"></span>
    </label>
    <div class="locality-minimum">
      <label for="site-min-records">Minimum records for labels</label>
      <div class="record-stepper">
        <button type="button" aria-label="Decrease minimum records" :disabled="!planning.localitySettings.enabled || planning.localitySettings.minRecords <= 1" @click="setMinimum(planning.localitySettings.minRecords - 1)"><Minus :size="14" /></button>
        <input id="site-min-records" :value="planning.localitySettings.minRecords" :disabled="!planning.localitySettings.enabled" type="number" min="1" max="10000" step="1" inputmode="numeric" @change="clampMinimum" @keydown.enter="$event.target.blur()" />
        <button type="button" aria-label="Increase minimum records" :disabled="!planning.localitySettings.enabled || planning.localitySettings.minRecords >= 10000" @click="setMinimum(planning.localitySettings.minRecords + 1)"><Plus :size="14" /></button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.locality-settings { padding: 0 16px 14px; margin-bottom: 14px; border-bottom: 1px solid var(--color-border); color: var(--color-text-primary); font-size: .78rem; }
.locality-toggle { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; }
.locality-toggle input { position: absolute; right: 0; width: 38px; height: 24px; opacity: 0; cursor: pointer; }
.switch-track { flex: none; width: 38px; height: 22px; border-radius: 12px; background: var(--color-bg-tertiary); border: 1px solid var(--color-border); pointer-events: none; }
.switch-track::after { content: ''; display: block; width: 16px; height: 16px; margin: 2px; border-radius: 50%; background: var(--color-text-secondary); transition: transform 160ms ease; }
.locality-toggle input:checked + .switch-track { background: var(--color-accent); border-color: var(--color-accent); }
.locality-toggle input:checked + .switch-track::after { transform: translateX(16px); background: var(--color-bg-primary); }
.locality-toggle input:focus-visible + .switch-track { outline: 2px solid var(--color-accent); outline-offset: 3px; }
.locality-minimum { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 12px; }
.record-stepper { display: flex; flex: none; align-items: center; border: 1px solid var(--color-border); border-radius: 6px; overflow: hidden; }
.record-stepper button { display: grid; place-items: center; width: 28px; height: 30px; padding: 0; border: 0; color: var(--color-text-primary); background: var(--color-bg-tertiary); cursor: pointer; }
.record-stepper input { width: 45px; height: 30px; padding: 0 2px; border: 0; border-radius: 0; text-align: center; color: var(--color-text-primary); background: var(--color-bg-primary); font: inherit; font-variant-numeric: tabular-nums; appearance: textfield; -moz-appearance: textfield; }
.record-stepper input::-webkit-inner-spin-button, .record-stepper input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.record-stepper :disabled { opacity: .45; cursor: default; }
.record-stepper button:hover:not(:disabled) { color: var(--color-accent); }
.record-stepper :focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; }
@media (prefers-reduced-motion: reduce) { .switch-track::after { transition: none; } }
</style>
