/**
 * downloader.ts
 *
 * Downloads (and updates) Paperback extension bundles from two gh-pages repos:
 *   - karrot0/KakarotExtension  (branch: gh-pages, path: 0.9/stable/<ExtName>/)
 *   - inkdex/general-extensions (branch: gh-pages, path: 0.9/stable/<ExtName>/)
 *
 * Downloaded files are stored at:
 *   data/extensions/<repoId>/<ExtName>/index.js
 *   data/extensions/<repoId>/<ExtName>/info.json
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXTENSIONS_DIR = path.resolve(__dirname, '../../data/extensions')

export interface ExtensionSource {
  repoId: string
  repoOwner: string
  repoName: string
  branch: string
  pathPrefix: string // e.g. "0.9/stable"
}

// Load extension sources from config.json
let EXTENSION_SOURCES: ExtensionSource[] = []
try {
  const configPath = path.resolve(__dirname, '../../config.json')
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    if (Array.isArray(config.extensionSources)) {
      EXTENSION_SOURCES = config.extensionSources
    }
  }
} catch (e) {
  console.warn('[downloader] Failed to load extensionSources from config.json:', e)
}

export interface ExtensionMeta {
  id: string
  name: string
  description?: string
  version: string
  language: string
  contentRating: string
  capabilities: number[]
  badges?: { label: string; textColor: string; backgroundColor: string }[]
  developers?: { name: string }[]
  repoId: string
}

interface TreeEntry {
  path: string
  type: string
}

async function githubFetch(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'MangaIce-Scraper/1.0',
    },
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${url}`)
  return res.json()
}

async function rawFetch(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'MangaIce-Scraper/1.0' },
  })
  if (!res.ok) throw new Error(`Raw fetch ${res.status}: ${url}`)
  return res.text()
}

/** Returns list of extension names available in a repo's gh-pages tree */
async function listExtensions(source: ExtensionSource): Promise<string[]> {
  const treeUrl = `https://api.github.com/repos/${source.repoOwner}/${source.repoName}/git/trees/${source.branch}?recursive=1`
  const data = await githubFetch(treeUrl) as { tree: TreeEntry[] }

  const names = new Set<string>()
  const prefix = source.pathPrefix + '/'
  for (const entry of data.tree) {
    if (entry.type === 'tree' && entry.path.startsWith(prefix)) {
      const rest = entry.path.slice(prefix.length)
      // Only direct children (no slash in rest = top-level extension dir)
      if (!rest.includes('/') && rest) {
        names.add(rest)
      }
    }
  }
  return [...names]
}

/** Downloads index.js and info.json for one extension */
async function downloadExtension(
  source: ExtensionSource,
  extName: string,
  force = false,
): Promise<boolean> {
  const destDir = path.join(EXTENSIONS_DIR, source.repoId, extName)
  const indexFile = path.join(destDir, 'index.js')
  const infoFile = path.join(destDir, 'info.json')

  const rawBase = `https://raw.githubusercontent.com/${source.repoOwner}/${source.repoName}/${source.branch}/${source.pathPrefix}/${extName}`

  try {
    // Fetch info.json first to check version
    const infoRaw = await rawFetch(`${rawBase}/info.json`)
    const info = JSON.parse(infoRaw) as ExtensionMeta

    // Check if already up to date
    if (!force && fs.existsSync(infoFile)) {
      const existing = JSON.parse(fs.readFileSync(infoFile, 'utf-8')) as ExtensionMeta
      if (existing.version === info.version && fs.existsSync(indexFile)) {
        return false // already current
      }
    }

    // Download index.js
    const indexCode = await rawFetch(`${rawBase}/index.js`)

    // Persist
    fs.mkdirSync(destDir, { recursive: true })
    fs.writeFileSync(infoFile, JSON.stringify(info, null, 2))
    fs.writeFileSync(indexFile, indexCode)

    return true // downloaded/updated
  } catch (err: any) {
    console.warn(`  [downloader] ⚠ ${source.repoId}/${extName}: ${err.message}`)
    return false
  }
}

export interface DownloadResult {
  repoId: string
  name: string
  status: 'updated' | 'skipped' | 'failed'
}

/** Downloads/updates all extensions from all sources */
export async function downloadAll(force = false): Promise<DownloadResult[]> {
  const results: DownloadResult[] = []

  for (const source of EXTENSION_SOURCES) {
    console.log(`[downloader] Syncing ${source.repoOwner}/${source.repoName} (gh-pages)...`)
    let names: string[]
    try {
      names = await listExtensions(source)
    } catch (err: any) {
      console.error(`[downloader] Failed to list extensions from ${source.repoId}: ${err.message}`)
      continue
    }

    for (const name of names) {
      try {
        const updated = await downloadExtension(source, name, force)
        results.push({ repoId: source.repoId, name, status: updated ? 'updated' : 'skipped' })
        if (updated) {
          console.log(`  [downloader] ✓ ${source.repoId}/${name}`)
        }
      } catch {
        results.push({ repoId: source.repoId, name, status: 'failed' })
      }
    }

    const updated = results.filter(r => r.repoId === source.repoId && r.status === 'updated').length
    const total = results.filter(r => r.repoId === source.repoId).length
    console.log(`[downloader] ${source.repoId}: ${updated} updated, ${total - updated} unchanged`)
  }

  return results
}

/** Returns all locally downloaded extension metadata */
export function getLocalExtensions(): { meta: ExtensionMeta; indexPath: string }[] {
  const result: { meta: ExtensionMeta; indexPath: string }[] = []
  if (!fs.existsSync(EXTENSIONS_DIR)) return result

  for (const repoId of fs.readdirSync(EXTENSIONS_DIR)) {
    const repoDir = path.join(EXTENSIONS_DIR, repoId)
    if (!fs.statSync(repoDir).isDirectory()) continue

    for (const extName of fs.readdirSync(repoDir)) {
      const extDir = path.join(repoDir, extName)
      if (!fs.statSync(extDir).isDirectory()) continue

      const infoFile = path.join(extDir, 'info.json')
      const indexFile = path.join(extDir, 'index.js')

      if (fs.existsSync(infoFile) && fs.existsSync(indexFile)) {
        try {
          const meta = JSON.parse(fs.readFileSync(infoFile, 'utf-8')) as ExtensionMeta
          meta.repoId = repoId
          result.push({ meta, indexPath: indexFile })
        } catch {}
      }
    }
  }

  return result
}
