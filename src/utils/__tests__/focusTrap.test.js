// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { focusableIn, trapTabKey } from '../focusTrap'

afterEach(() => { document.body.innerHTML = '' })

function setup() {
  document.body.innerHTML = `
    <button id="outside">Behind</button>
    <div id="layer" tabindex="-1">
      <button id="first">Close</button>
      <button disabled>Off</button>
      <button id="hidden" style="display:none">Hidden</button>
      <input id="mid">
      <button id="last">Next</button>
    </div>`
  return document.getElementById('layer')
}
const tab = (shiftKey = false) => new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true })

describe('focusTrap', () => {
  it('lists only reachable controls', () => {
    expect(focusableIn(setup()).map(el => el.id)).toEqual(['first', 'mid', 'last'])
  })

  it('wraps Tab from the last control to the first and Shift+Tab back', () => {
    const layer = setup()
    document.getElementById('last').focus()
    const forward = tab()
    expect(trapTabKey(forward, layer)).toBe(true)
    expect(forward.defaultPrevented).toBe(true)
    expect(document.activeElement.id).toBe('first')
    const back = tab(true)
    expect(trapTabKey(back, layer)).toBe(true)
    expect(document.activeElement.id).toBe('last')
  })

  it('brings focus from behind the layer back in and leaves inner moves to the browser', () => {
    const layer = setup()
    document.getElementById('outside').focus()
    expect(trapTabKey(tab(), layer)).toBe(true)
    expect(document.activeElement.id).toBe('first')
    const inner = tab()
    expect(trapTabKey(inner, layer)).toBe(false)
    expect(inner.defaultPrevented).toBe(false)
  })

  it('ignores other keys', () => {
    const layer = setup()
    expect(trapTabKey(new KeyboardEvent('keydown', { key: 'ArrowRight' }), layer)).toBe(false)
  })
})
