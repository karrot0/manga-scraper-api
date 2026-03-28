import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../../data/cookies')

export interface StoredCookie {
  name: string
  value: string
  domain: string
  path?: string
  expires?: number // unix timestamp ms
}

function cookieFile(providerId: string) {
  return path.join(DATA_DIR, `${providerId}.json`)
}

function load(providerId: string): StoredCookie[] {
  const file = cookieFile(providerId)
  if (!fs.existsSync(file)) return []
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return []
  }
}

function save(providerId: string, cookies: StoredCookie[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(cookieFile(providerId), JSON.stringify(cookies, null, 2))
}

export const cookieStore = {
  getAll(providerId: string): StoredCookie[] {
    const now = Date.now()
    return load(providerId).filter(c => !c.expires || c.expires > now)
  },

  getForDomain(providerId: string, domain: string): StoredCookie[] {
    return this.getAll(providerId).filter(c => {
      const cookieDomain = c.domain.replace(/^\./, '')
      return domain === cookieDomain || domain.endsWith('.' + cookieDomain)
    })
  },

  setCookies(providerId: string, cookies: StoredCookie[]) {
    const existing = load(providerId).filter(
      e => !cookies.some(nc => nc.name === e.name && nc.domain === e.domain)
    )
    save(providerId, [...existing, ...cookies])
  },

  clearForProvider(providerId: string) {
    save(providerId, [])
  },
}
