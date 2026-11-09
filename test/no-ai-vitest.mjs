// No test may use a model CLI, an AI host or T3 (Franz's rule, 9 Nov 2026): the guard of test/no-ai-core.mjs in every
// vitest process (vitest.config.js setupFiles). An attempt fails the test it happened in.
import { afterEach, beforeEach } from 'vitest'
import { installNoAiGuard } from './no-ai-core.mjs'

const guard = installNoAiGuard({ owner: true })
beforeEach(ctx => guard.testing(`${ctx.task.file?.filepath ?? '?'} › ${ctx.task.name}`))
afterEach(() => {
  const fresh = guard.take()
  if (fresh.length) throw new Error(`${fresh.join('\n')}\nTests use fakes, never a model CLI, an AI host or T3 (test/no-ai-core.mjs).`)
})
