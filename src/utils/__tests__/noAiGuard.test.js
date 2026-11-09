// The guard of test/no-ai-vitest.mjs (test/no-ai-core.mjs) is loaded and refuses AI hosts, T3 and model CLIs, offline.
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const guard = globalThis[Symbol.for('ithomiini.noAiGuard')]

describe('no-AI guard', () => {
  it('is loaded by the setup files', () => {
    expect(guard, 'vitest.config.js setupFiles must list ./test/no-ai-vitest.mjs').toBeTruthy()
  })

  it.skipIf(!guard)('refuses an AI host, a T3 port and a model CLI, and writes them down', async () => {
    await expect(fetch('https://api.openai.com/v1/models')).rejects.toThrow()
    await expect(fetch('http://127.0.0.1:3773/')).rejects.toThrow()
    expect(spawnSync('claude', ['-p', 'hola']).status).toBe(1)
    const got = guard.take()
    expect(got).toHaveLength(3)
    expect(got[0]).toMatch(/refused connection to AI host api\.openai\.com:443/)
    expect(got[1]).toMatch(/refused connection to T3 port 127\.0\.0\.1:3773/)
    expect(got[2]).toMatch(/refused CLI \S*claude/)
  })
})
