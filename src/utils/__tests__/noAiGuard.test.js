// The guard of test/no-ai-vitest.mjs (test/no-ai-core.mjs) is loaded and refuses AI hosts, T3 and model CLIs, offline.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
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

  // Round 3 (review 9 Nov): a worker thread, a child's own env, a shell given a script, a T3 port on another address.
  it.skipIf(!guard)('guards worker threads, children with their own env and shells; T3 ports on any address', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'no-ai-worker-'))
    writeFileSync(join(dir, 'w.mjs'), "import net from 'node:net'; import { parentPort } from 'node:worker_threads'; net.connect(3774, '127.0.0.1').on('error', e => parentPort.postMessage(e.code))")
    const w = new Worker(join(dir, 'w.mjs'))
    expect(await new Promise(res => w.once('message', res))).toBe('ECONNREFUSED')
    await w.terminate()
    const out = execFileSync(process.execPath, ['-e', "process.stdout.write(String(!!globalThis[Symbol.for('ithomiini.noAiGuard')]))"], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' })
    expect(out).toBe('true')
    expect(spawnSync('bash', ['-c', '/opt/elsewhere/claude -p hola']).status).toBe(1)
    await expect(fetch('http://100.83.134.33:3775/')).rejects.toThrow()
    const got = guard.take()
    expect(got).toHaveLength(3)
    expect(got[0]).toMatch(/T3 port 127\.0\.0\.1:3774/)
    expect(got[1]).toMatch(/refused CLI \/opt\/elsewhere\/claude/)
    expect(got[2]).toMatch(/T3 port 100\.83\.134\.33:3775/)
  })

  // Round 4 (review 9 Nov): a Python child of a node test, ordinary shell lines.
  it.skipIf(!guard)('gives Python children the Python guard; ordinary shell lines are not refused', async () => {
    const { blockedInShell } = await import('../../../test/no-ai-core.mjs')
    const py = "import socket, sys\ntry: socket.create_connection(('127.0.0.1', 3774), timeout=1)\nexcept OSError: pass\nprint('no_ai_guard' in sys.modules)"
    expect(execFileSync('python3', ['-c', py], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } }).trim()).toBe('True')
    const got = guard.take()
    expect(got).toHaveLength(1)
    expect(got[0]).toMatch(/T3 port 127\.0\.0\.1:3774/)
    for (const line of ['ls /etc/ssh', 'grep -c "claude" notes.txt', 'git log -- server/t3']) expect(blockedInShell(line), line).toBeNull()
  })
})
