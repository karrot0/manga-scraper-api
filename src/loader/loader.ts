/**
 * loader.ts
 *
 * Loads Paperback extensions from pre-downloaded IIFE bundles (index.js)
 * stored in data/extensions/<repoId>/<extName>/.
 *
 * Each bundle is run inside a Node.js vm sandbox with the Application global
 * injected. The bundle sets `var source = (()=>{...})()` which becomes a
 * property on the vm context object.
 *
 * globals.ts MUST have been imported before this file is used.
 */

import vm from 'vm'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { ApplicationImpl, setContext, clearInterceptors, setProviderId } from '../runtime/Application.js'
import { stateManager } from '../runtime/state.js'
import { registerProvider, clearRegistry } from './registry.js'

import { getLocalExtensions, downloadAll } from '../downloader/downloader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Load config.json for extension control
let config: { disabledExtensions?: string[] } = {}
try {
  const configPath = path.resolve(__dirname, '../../config.json')
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  }
} catch (e) {
  console.warn('[loader] Failed to load config.json:', e)
}

// CLOUDFLARE_BYPASS_PROVIDING = 16 in SourceIntents enum
const CLOUDFLARE_CAPABILITY = 16

/**
 * Build a vm context that has Application and all Node.js globals the
 * bundles may need (the bundles are esbuild CJS bundles built for browser-ish
 * environments but running in Node.js).
 */
function buildVmContext() {
  const context: Record<string, any> = {
    Application: ApplicationImpl,
    console,
    process,
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    URLSearchParams,
    TextDecoder,
    TextEncoder,
    AbortController,
    AbortSignal,
    atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
  }
  // Let globalThis in the vm refer to the context itself
  context.globalThis = context
  return vm.createContext(context)
}

export async function loadAllExtensions(skipDownload = false) {
  clearRegistry()

  if (!skipDownload) {
    console.log('[loader] Checking for extension updates...')
    await downloadAll(false)
  }

  let extensions = getLocalExtensions()
  if (config.disabledExtensions && Array.isArray(config.disabledExtensions)) {
    const disabledSet = new Set(config.disabledExtensions.map(x => x.toLowerCase()))
    extensions = extensions.filter(({ meta }) => {
      const id = (meta.id || meta.name || '').toLowerCase()
      if (disabledSet.has(id)) {
        console.log(`[loader] Skipping disabled extension: ${meta.name || meta.id}`)
        return false
      }
      return true
    })
  }
  if (extensions.length === 0) {
    console.warn('[loader] No extensions found in data/extensions/ (or all are disabled). Run with --force-download to refresh.')
    return []
  }

  const results: { name: string; success: boolean; error?: string }[] = []
  for (const { meta, indexPath } of extensions) {
    try {
      await loadExtensionBundle(meta.id || path.basename(path.dirname(indexPath)), indexPath, meta)
      results.push({ name: meta.name, success: true })
    } catch (err: any) {
      console.warn(`[loader] ⚠ Failed to load ${meta.name}: ${err?.message ?? err}`)
      results.push({ name: meta.name, success: false, error: err?.message ?? String(err) })
    }
  }
  return results
}

export async function loadExtensionBundle(providerId: string, indexPath: string, meta: any) {
  const ctx = `provider:${providerId}`

  // Clear any previously registered interceptors for this context
  clearInterceptors(ctx)

  // Set Application context so registerInterceptor() stores in the right chain
  setContext(ctx)
  setProviderId(providerId)

  // Preload state from disk
  stateManager.preload(providerId)

  // Read and execute the IIFE bundle in a fresh vm context
  const code = fs.readFileSync(indexPath, 'utf-8')
  const vmContext = buildVmContext()

  try {
    vm.runInContext(code, vmContext, { filename: indexPath })
  } catch (err: any) {
    throw new Error(`vm execution failed for ${providerId}: ${err.message}`)
  }

  const source = vmContext.source as Record<string, any> | undefined
  if (!source || typeof source !== 'object') {
    throw new Error(`Bundle did not export a "source" variable (got ${typeof source})`)
  }

  // Resolve the extension: some bundles export a class, others a pre-instantiated object.
  let instance: any

  const className = `${providerId}Extension`
  const directName = providerId

  if (typeof source[className] === 'function') {
    // Class export → instantiate
    instance = new source[className]()
  } else if (typeof source[className] === 'object' && source[className] !== null &&
             typeof source[className].initialise === 'function') {
    // Instance export with <Name>Extension key
    instance = source[className]
  } else if (typeof source[directName] === 'function') {
    // Class exported under the bare name
    instance = new source[directName]()
  } else if (typeof source[directName] === 'object' && source[directName] !== null &&
             typeof source[directName].initialise === 'function') {
    // Instance export under the bare name (e.g. MangaDemon)
    instance = source[directName]
  } else {
    // Last resort: first callable export
    const firstFn = Object.values(source).find(v => typeof v === 'function')
    if (firstFn) {
      instance = new (firstFn as any)()
    } else {
      // Maybe it's just an instance under any key
      const firstInst = Object.values(source).find(
        v => v !== null && typeof v === 'object' && typeof (v as any).initialise === 'function'
      )
      if (!firstInst) {
        throw new Error(
          `No extension class or instance found in ${indexPath}. Exports: ${Object.keys(source).join(', ')}`
        )
      }
      instance = firstInst
    }
  }

  // Call initialise() which registers interceptors via Application.registerInterceptor()
  if (typeof instance.initialise === 'function') {
    await instance.initialise()
  }

  const capabilities: number[] = Array.isArray(meta.capabilities) ? meta.capabilities : []
  const cloudflareEnabled =
    capabilities.includes(CLOUDFLARE_CAPABILITY) ||
    typeof instance.getCloudflareBypassRequest === 'function'

  // Extract the primary base URL from the bundle (first non-standard https:// URL)
  const baseUrl = extractBaseUrl(code)

  registerProvider({
    id: providerId,
    name: meta.name ?? providerId,
    version: meta.version ?? '0.0.0',
    instance,
    config: meta,
    capabilities,
    cloudflareEnabled,
    repoId: meta.repoId ?? 'unknown',
    language: meta.language ?? 'en',
    baseUrl: baseUrl ?? undefined,
  })

  console.log(`[loader] ✓ ${meta.repoId}/${providerId} v${meta.version}`)
}

/**
 * Extract the primary site base URL from a bundle's source code.
 * Skips well-known non-site URLs (w3.org, ibm.com, schema).
 */
function extractBaseUrl(code: string): string | null {
  const SKIP = ['w3.org', 'ibm.com', 'schema', 'github.com', 'npm', 'node_modules']
  const matches = [...code.matchAll(/"(https?:\/\/[a-z0-9.-]+)"/g)]
    .map(m => m[1])
    .filter(u => !SKIP.some(skip => u.includes(skip)))
  return matches[0] ?? null
}

