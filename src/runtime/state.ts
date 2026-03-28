import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../../data/state')

function stateFile(providerId: string) {
  return path.join(DATA_DIR, `${providerId}.json`)
}

function load(providerId: string): Record<string, unknown> {
  const file = stateFile(providerId)
  if (!fs.existsSync(file)) return {}
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>
    // Revive Date objects in cookie arrays (stored by CookieStorageInterceptor)
    for (const [k, v] of Object.entries(raw)) {
      if (Array.isArray(v)) {
        raw[k] = v.map((item: any) => {
          if (item && typeof item === 'object' && typeof item.expires === 'string') {
            return { ...item, expires: new Date(item.expires) }
          }
          return item
        })
      }
    }
    return raw
  } catch {
    return {}
  }
}

function save(providerId: string, state: Record<string, unknown>) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(stateFile(providerId), JSON.stringify(state, null, 2))
}

// Per-provider in-memory cache to support synchronous getState/setState
const cache = new Map<string, Record<string, unknown>>()

function getCache(providerId: string): Record<string, unknown> {
  if (!cache.has(providerId)) {
    cache.set(providerId, load(providerId))
  }
  return cache.get(providerId)!
}

export const stateManager = {
  get(providerId: string, key: string): unknown {
    return getCache(providerId)[key]
  },

  set(providerId: string, key: string, value: unknown) {
    const state = getCache(providerId)
    state[key] = value
    save(providerId, state)
  },

  remove(providerId: string, key: string) {
    const state = getCache(providerId)
    delete state[key]
    save(providerId, state)
  },

  resetAll(providerId: string) {
    cache.set(providerId, {})
    save(providerId, {})
  },

  preload(providerId: string) {
    cache.set(providerId, load(providerId))
  },
}
