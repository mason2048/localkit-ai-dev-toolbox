import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

describe('service worker cache isolation', () => {
  const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8')

  it('only removes old LocalKit caches and only reads the current cache', async () => {
    expect(source).toContain("const CACHE_PREFIX = 'localkit-'")
    expect(source).toContain('key.startsWith(CACHE_PREFIX) && key !== CACHE')
    expect(source).not.toMatch(/\bcaches\.match\(/)
    expect(source.match(/\bcaches\.delete\(/g)).toHaveLength(1)
    expect(source.match(/caches\.open\(CACHE\)/g)?.length).toBeGreaterThanOrEqual(3)

    type ServiceWorkerEvent = { waitUntil(task: Promise<unknown>): void }
    const listeners = new Map<string, (event: ServiceWorkerEvent) => void>()
    const deleted: string[] = []
    const cacheNames = [
      'localkit-v0.2.0',
      'localkit-v0.1.0',
      'scale-atlas-v1',
      'shared-static-assets',
      'unrelated-app-cache',
    ]

    const selfMock = {
      location: { origin: 'http://127.0.0.1:4185' },
      clients: { claim: async () => undefined },
      skipWaiting: () => undefined,
      addEventListener: (name: string, listener: (event: ServiceWorkerEvent) => void) => listeners.set(name, listener),
    }
    const cachesMock = {
      keys: async () => cacheNames,
      delete: async (key: string) => {
        deleted.push(key)
        return true
      },
      open: async () => ({
        addAll: async () => undefined,
        match: async () => undefined,
        put: async () => undefined,
      }),
    }

    runInNewContext(source.replace('__LOCALKIT_PRECACHE_ASSETS__', '[]'), {
      self: selfMock,
      caches: cachesMock,
      URL,
    })

    let activation: Promise<unknown> | undefined
    listeners.get('activate')?.({ waitUntil: (task) => { activation = task } })
    expect(activation).toBeDefined()
    await activation
    expect(deleted).toEqual(['localkit-v0.1.0'])
  })
})
