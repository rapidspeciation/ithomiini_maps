// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { themes } from '../presets'

// The colour tokens of index.css, every palette in light and dark, held to their contrast bars:
// text 4.5:1 (body text 7:1), control edges, focus rings and other non-text 3:1.
const css = readFileSync(resolve(import.meta.dirname, '../../index.css'), 'utf8')

function body(selectorRe) {
  const m = new RegExp(`${selectorRe}[^{}]*\\{([^}]*)\\}`).exec(css)
  if (!m) throw new Error(`no block for ${selectorRe}`)
  return Object.fromEntries([...m[1].matchAll(/--([a-z-]+):\s*([^;]+);/g)].map(x => [x[1], x[2].trim()]))
}
const shared = { light: body(':root,\\s*\\[data-mode="light"\\]\\s*'), dark: body('\\n\\[data-mode="dark"\\]\\s*') }
const palettes = Object.keys(themes)
const tokens = (palette, mode) => ({ ...shared[mode], ...body(`\\[data-theme="${palette}"\\]\\[data-mode="${mode}"\\]`) })

const parse = (value, t) => {
  const v = /^var\(--([a-z-]+)\)$/.exec(value)
  if (v) return parse(t[v[1]], t)
  let m = /^#([0-9a-f]{6})$/i.exec(value)
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).concat(1)
  m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(value)
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]]
  throw new Error(`not a colour: ${value}`)
}
const over = (fg, bg) => [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1)
const lum = c => {
  const ch = v => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])
}
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const hsl = value => {
  const [h, s, l] = value.split(/\s+/).map(parseFloat)
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
  const f = n => { const k = (n + h / 30) % 12; return 255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) }
  return [f(0), f(8), f(4), 1]
}

/** `fg` on `bg`, where a translucent `bg` lies on `base` (a surface token). */
function ratio(t, fg, bg, base = 'color-bg-secondary') {
  const b = over(parse(t[bg], t), parse(t[base], t))
  return contrast(over(parse(t[fg], t), b), b)
}

const surfaces = ['color-bg-primary', 'color-bg-secondary', 'color-bg-tertiary']
// [foreground, backgrounds, bar]
const rules = [
  ['color-text-primary', surfaces, 7],
  ['color-text-secondary', surfaces, 4.5],
  ['color-text-muted', [...surfaces, 'color-bg-overlay'], 4.5],
  ['color-accent-text', [...surfaces, 'color-accent-subtle'], 4.5],
  ['color-on-accent', ['color-accent', 'color-accent-hover'], 4.5],
  ['color-border-control', [...surfaces, 'color-bg-overlay'], 3],
  ['color-focus', [...surfaces, 'color-accent-subtle'], 3],
  ['color-accent', surfaces, 3],
  ['color-danger-text', surfaces, 4.5],
  ['color-warning-text', surfaces, 4.5],
  ['color-success-text', surfaces, 4.5],
  ['color-info-text', surfaces, 4.5],
  ['color-on-danger', ['color-danger-fill'], 4.5],
  ['color-on-info', ['color-info-fill'], 4.5],
  ['color-sex-male', ['color-sex-male-bg', ...surfaces], 4.5],
  ['color-sex-female', ['color-sex-female-bg', ...surfaces], 4.5],
]

describe('theme tokens', () => {
  for (const mode of ['light', 'dark']) {
    for (const palette of palettes) {
      it(`${palette} ${mode} meets its contrast bars`, () => {
        const t = tokens(palette, mode)
        const fails = []
        for (const [fg, bgs, bar] of rules) {
          for (const bg of bgs) {
            for (const base of surfaces) {
              const r = ratio(t, fg, bg, base)
              if (r < bar) fails.push(`${fg} on ${bg} (over ${base}) ${r.toFixed(2)} < ${bar}`)
            }
          }
        }
        expect(fails).toEqual([])
      })
      it(`${palette} ${mode} keeps the shadcn primitives readable`, () => {
        const t = body(`\\[data-theme="${palette}"\\]\\[data-mode="${mode}"\\]`)
        const fails = [
          ['foreground', 'background', 7], ['foreground', 'card', 7],
          ['muted-foreground', 'background', 4.5], ['muted-foreground', 'muted', 4.5],
          ['primary-foreground', 'primary', 4.5], ['ring', 'background', 3],
        ].map(([fg, bg, bar]) => [`${fg} on ${bg}`, contrast(hsl(t[fg]), hsl(t[bg])), bar]).filter(([, r, bar]) => r < bar)
        expect(fails).toEqual([])
      })
    }
  }

  it('keeps muted labels readable on the accent-tinted Location Summary box (accent-subtle over the popup)', () => {
    const fails = []
    for (const mode of ['light', 'dark']) {
      for (const p of palettes) {
        const t = tokens(p, mode)
        const box = over(parse(t['color-accent-subtle'], t), parse(t['color-bg-primary'], t))
        const r = contrast(parse(t['color-text-muted'], t), box)
        if (r < 4.5) fails.push(`${p} ${mode} ${r.toFixed(2)}`)
      }
    }
    expect(fails).toEqual([])
  })

  it('keeps every -rgb channel token equal to its colour (used as rgb(var(--x-rgb) / a) for tints)', () => {
    for (const mode of ['light', 'dark']) {
      for (const p of palettes) {
        const t = tokens(p, mode)
        for (const [name, channels] of Object.entries(t).filter(([k]) => k.endsWith('-rgb'))) {
          expect(channels.split(' ').map(Number)).toEqual(parse(t[name.slice(0, -4)], t).slice(0, 3))
        }
      }
    }
  })

  it('lets white text on the scrim read over the brightest photo', () => {
    for (const mode of ['light', 'dark']) {
      const t = shared[mode]
      const veil = over(parse(t['color-scrim'], t), [255, 255, 255, 1])
      expect(contrast(parse(t['color-on-scrim'], t), veil)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('names the same roles in every palette and mode', () => {
    const names = (p, m) => Object.keys(tokens(p, m)).filter(k => k !== 'radius').sort()
    for (const p of palettes) for (const m of ['light', 'dark']) expect(names(p, m)).toEqual(names('emerald', 'light'))
  })

  it('paints the boot screen and browser bar with each palette\'s page colour', () => {
    const html = readFileSync(resolve(import.meta.dirname, '../../../index.html'), 'utf8')
    for (const p of palettes) {
      expect(tokens(p, 'light')['color-bg-primary'].toLowerCase()).toBe(themes[p].previewBgLight)
      expect(tokens(p, 'dark')['color-bg-primary'].toLowerCase()).toBe(themes[p].previewBgDark)
      expect(html).toContain(`${p}:['${themes[p].previewBgLight}','${themes[p].previewBgDark}']`)
    }
  })
})
