// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import GallerySearchSelect from '../GallerySearchSelect.vue'

const mounted = []
afterEach(() => { for (const { app, host } of mounted.splice(0)) { app.unmount(); host.remove() } })

function mount() {
  const value = ref('a')
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    render: () => h(GallerySearchSelect, {
      modelValue: value.value,
      'onUpdate:modelValue': v => { value.value = v },
      placeholder: 'Search species...',
      options: [{ value: 'a', label: 'Mechanitis polymnia' }, { value: 'b', label: 'Ithomia salapia' }, { value: 'c', label: 'Oleria onega' }],
    }),
  })
  app.mount(host)
  mounted.push({ app, host })
  return { host, value, input: host.querySelector('input') }
}
const key = (el, k) => { const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }); el.dispatchEvent(e); return e }

describe('GallerySearchSelect', () => {
  it('picks an option with the arrow keys and Enter; options are not Tab stops', async () => {
    const { host, value, input } = mount()
    input.dispatchEvent(new Event('focus'))
    await nextTick()
    const options = [...host.querySelectorAll('[role="option"]')]
    expect(options).toHaveLength(3)
    expect(options.every(o => o.tabIndex === -1)).toBe(true)
    expect(input.getAttribute('aria-expanded')).toBe('true')
    key(input, 'ArrowDown'); key(input, 'ArrowDown')
    await nextTick()
    expect(host.querySelector('.gallery-search-option.active').textContent).toContain('Ithomia salapia')
    expect(input.getAttribute('aria-activedescendant')).toBe(host.querySelector('.gallery-search-option.active').id)
    expect(key(input, 'Enter').defaultPrevented).toBe(true)
    await nextTick()
    expect(value.value).toBe('b')
    expect(host.querySelector('[role="listbox"]')).toBeNull()
  })

  it('Escape closes the list without reaching the page while it is open', async () => {
    const { host, input } = mount()
    input.dispatchEvent(new Event('focus'))
    await nextTick()
    let reached = 0
    const onDoc = () => { reached++ }
    document.addEventListener('keydown', onDoc)
    key(input, 'Escape')
    await nextTick()
    expect(host.querySelector('[role="listbox"]')).toBeNull()
    expect(reached).toBe(0)
    key(input, 'Escape')
    expect(reached).toBe(1)
    document.removeEventListener('keydown', onDoc)
  })
})
