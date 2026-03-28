/**
 * Application.ts
 * Emulates the Paperback `Application` global that extensions expect.
 *
 * Must be set on globalThis BEFORE any @paperback/types usage.
 */

import nodeFetch from 'node-fetch'
import * as cheerio from 'cheerio'
import type { CheerioAPI } from 'cheerio'
import { cookieStore, type StoredCookie } from './cookies.js'
import { stateManager } from './state.js'

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// ---------- Selector Registry ----------

type AnyFn = (...args: any[]) => any

interface SelectorEntry {
  fn: AnyFn
}

let selectorCounter = 0
const selectorRegistry = new Map<string, SelectorEntry>()

// ---------- Interceptor Registry ----------

interface InterceptorEntry {
  id: string
  interceptRequest: AnyFn
  interceptResponse: AnyFn
}

// Keyed by context string → list of interceptors ordered by registration
const interceptorChains = new Map<string, InterceptorEntry[]>()
let _currentContext = 'default'

export function setContext(ctx: string) {
  _currentContext = ctx
}

export function getContext() {
  return _currentContext
}

export function clearInterceptors(ctx: string) {
  interceptorChains.delete(ctx)
}

// ---------- Provider Context ----------

let _currentProviderId = 'default'

export function setProviderId(id: string) {
  _currentProviderId = id
}

// ---------- Helpers ----------

function parseCookieHeader(header: string, domain: string): StoredCookie[] {
  // A single Set-Cookie header can contain one cookie; multiple cookies arrive in separate headers.
  // node-fetch sometimes concatenates them with ', ' but we handle both cases.
  const results: StoredCookie[] = []

  const parts = header.split(/,\s*(?=[^\s;,]+=[^;,]*)/)
  for (const part of parts) {
    const segments = part.split(';')
    const nameValue = segments[0]?.trim() ?? ''
    const eqIdx = nameValue.indexOf('=')
    if (eqIdx === -1) continue
    const name = nameValue.substring(0, eqIdx).trim()
    const value = nameValue.substring(eqIdx + 1).trim()
    if (!name) continue

    const cookie: StoredCookie = { name, value, domain }

    for (const seg of segments.slice(1)) {
      const [k, v] = seg.trim().split('=')
      const key = k?.trim().toLowerCase()
      if (key === 'domain') cookie.domain = v?.trim() ?? domain
      else if (key === 'path') cookie.path = v?.trim()
      else if (key === 'expires') {
        const d = new Date(v?.trim() ?? '')
        if (!isNaN(d.getTime())) cookie.expires = d.getTime()
      } else if (key === 'max-age') {
        const secs = parseInt(v?.trim() ?? '')
        if (!isNaN(secs)) cookie.expires = Date.now() + secs * 1000
      }
    }

    results.push(cookie)
  }
  return results
}

// ---------- Application Implementation ----------

export const ApplicationImpl = {
  // Constants
  isResourceLimited: false,
  filterAdultTitles: false,
  filterMatureTitles: false,

  // SelectorRegistry (exposed as object)
  SelectorRegistry: {
    get(id: string): AnyFn | undefined {
      return selectorRegistry.get(id)?.fn
    },
  },

  // Creates a SelectorID: stores the bound method and returns a unique string ID
  Selector<T extends object>(obj: T, symbol: keyof T): string {
    const id = `sel_${++selectorCounter}`
    const fn = (obj[symbol] as unknown as AnyFn).bind(obj)
    selectorRegistry.set(id, { fn })
    return id
  },

  // Register an interceptor by its two SelectorIDs
  registerInterceptor(interceptorId: string, reqSelectorId: string, resSelectorId: string) {
    const reqFn = selectorRegistry.get(reqSelectorId)?.fn
    const resFn = selectorRegistry.get(resSelectorId)?.fn
    if (!reqFn || !resFn) {
      console.warn(`[Application] registerInterceptor: missing selectors for ${interceptorId}`)
      return
    }
    const chain = interceptorChains.get(_currentContext) ?? []
    // Replace if already exists
    const idx = chain.findIndex(i => i.id === interceptorId)
    if (idx !== -1) chain.splice(idx, 1)
    chain.push({ id: interceptorId, interceptRequest: reqFn, interceptResponse: resFn })
    interceptorChains.set(_currentContext, chain)
  },

  unregisterInterceptor(interceptorId: string) {
    const chain = interceptorChains.get(_currentContext) ?? []
    const idx = chain.findIndex(i => i.id === interceptorId)
    if (idx !== -1) {
      chain.splice(idx, 1)
      interceptorChains.set(_currentContext, chain)
    }
  },

  // State management (synchronous, as required by @paperback/types)
  getState(key: string): unknown {
    return stateManager.get(_currentProviderId, key)
  },

  // Note: Paperback API is setState(value, key) — value first!
  setState(value: unknown, key: string) {
    stateManager.set(_currentProviderId, key, value)
  },

  getSecureState(key: string): unknown {
    return stateManager.get(_currentProviderId, `__secure__${key}`)
  },

  setSecureState(value: unknown, key: string) {
    stateManager.set(_currentProviderId, `__secure__${key}`, value)
  },

  resetAllState() {
    stateManager.resetAll(_currentProviderId)
  },

  // Utility
  async sleep(seconds: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, seconds * 1000))
  },

  async getDefaultUserAgent(): Promise<string> {
    return DEFAULT_UA
  },

  arrayBufferToUTF8String(arrayBuffer: ArrayBuffer): string {
    return new TextDecoder('utf-8').decode(arrayBuffer)
  },

  arrayBufferToASCIIString(arrayBuffer: ArrayBuffer): string {
    return new TextDecoder('ascii').decode(arrayBuffer)
  },

  arrayBufferToUTF16String(arrayBuffer: ArrayBuffer): string {
    return new TextDecoder('utf-16le').decode(arrayBuffer)
  },

  base64Encode<T extends string | ArrayBuffer>(value: T): T {
    if (typeof value === 'string') {
      return Buffer.from(value).toString('base64') as T
    }
    return Buffer.from(value as ArrayBuffer).toString('base64') as T
  },

  base64Decode<T extends string | ArrayBuffer>(value: T): T {
    if (typeof value === 'string') {
      return Buffer.from(value, 'base64').toString('utf-8') as T
    }
    const str = new TextDecoder().decode(value as ArrayBuffer)
    return Buffer.from(str, 'base64') as unknown as T
  },

  decodeHTMLEntities(str: string): string {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&apos;/g, "'")
  },

  // Core HTTP method — runs interceptor chain, makes real request, runs response chain
  async scheduleRequest(request: { url: string; method: string; headers?: Record<string, string>; body?: any; cookies?: Record<string, string> }): Promise<[any, ArrayBuffer]> {
    const ctx = _currentContext
    const chain = interceptorChains.get(ctx) ?? []

    // Run request interceptors
    let req: any = { ...request }
    for (const interceptor of chain) {
      try {
        req = await interceptor.interceptRequest(req)
      } catch (err) {
        console.warn(`[Application] interceptRequest error in ${interceptor.id}:`, err)
      }
    }

    // Build Cookie header: merge request.cookies (from CookieStorageInterceptor) + our stored cloudflare cookies
    const cookieDict: Record<string, string> = { ...(req.cookies ?? {}) }
    const storedCookies = cookieStore.getForDomain(_currentProviderId, new URL(req.url).hostname)
    for (const sc of storedCookies) {
      if (!cookieDict[sc.name]) {
        cookieDict[sc.name] = sc.value
      }
    }

    const cookieHeader = Object.entries(cookieDict)
      .map(([n, v]) => `${n}=${v}`)
      .join('; ')

    const fetchHeaders: Record<string, string> = { ...(req.headers ?? {}) }
    if (cookieHeader) fetchHeaders['Cookie'] = cookieHeader

    // Handle body
    let fetchBody: string | Buffer | undefined
    if (req.body != null) {
      if (typeof req.body === 'string') {
        fetchBody = req.body
      } else if (req.body instanceof ArrayBuffer || ArrayBuffer.isView(req.body)) {
        fetchBody = Buffer.from(req.body as ArrayBuffer)
      } else if (typeof req.body === 'object') {
        fetchBody = JSON.stringify(req.body)
        if (!fetchHeaders['Content-Type']) {
          fetchHeaders['Content-Type'] = 'application/json'
        }
      }
    }

    const nodeResponse = await nodeFetch(req.url, {
      method: req.method ?? 'GET',
      headers: fetchHeaders,
      body: fetchBody,
      redirect: 'follow',
    })

    // Parse Set-Cookie headers and persist them
    const setCookies = nodeResponse.headers.raw()['set-cookie'] ?? []
    const parsedStoredCookies: StoredCookie[] = []
    for (const cookieStr of setCookies) {
      parsedStoredCookies.push(...parseCookieHeader(cookieStr, new URL(req.url).hostname))
    }
    if (parsedStoredCookies.length > 0) {
      cookieStore.setCookies(_currentProviderId, parsedStoredCookies)
    }

    // Build PB Response object (with cookies array for CookieStorageInterceptor)
    const responseCookies = setCookies.flatMap(h => parseCookieHeader(h, new URL(req.url).hostname)).map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path ?? '/',
      expires: c.expires ? new Date(c.expires) : undefined,
    }))

    const pbResponse = {
      url: nodeResponse.url,
      status: nodeResponse.status,
      headers: Object.fromEntries(nodeResponse.headers.entries()),
      mimeType: nodeResponse.headers.get('content-type') ?? undefined,
      cookies: responseCookies,
    }

    const arrayBuffer = await nodeResponse.arrayBuffer()

    // Run response interceptors
    let buf = arrayBuffer
    for (const interceptor of chain) {
      try {
        buf = await interceptor.interceptResponse(req, pbResponse, buf)
      } catch (err: any) {
        // Re-throw Cloudflare errors so callers can handle them properly
        if (err?.type === 'cloudflareError' || err?.message?.includes('Cloudflare')) {
          throw err
        }
        console.warn(`[Application] interceptResponse error in ${interceptor.id}:`, err)
      }
    }

    return [pbResponse, buf]
  },

  // fetchCheerio — used by extensions that call this.fetchCheerio(request)
  async fetchCheerio(request: { url: string; method: string; headers?: Record<string, string> }): Promise<CheerioAPI> {
    const [, buffer] = await ApplicationImpl.scheduleRequest(request)
    const html = ApplicationImpl.arrayBufferToUTF8String(buffer)
    return cheerio.load(html, { xmlMode: false })
  },

  // Stubs for discover section registration (not needed for API use)
  registerDiscoverSection(_section: unknown, _selector?: unknown) {},
  unregisterDiscoverSection(_sectionId: string) {},
  registeredDiscoverSections(): unknown[] { return [] },
  invalidateDiscoverSections() {},

  // Stubs for search filter registration
  registerSearchFilter(_filter: unknown) {},
  unregisterSearchFilter(_id: string) {},
  registeredSearchFilters(): unknown[] { return [] },
  invalidateSearchFilters() {},

  // executeInWebView stub — Cloudflare bypass must be done manually
  async executeInWebView(_context: unknown): Promise<unknown> {
    throw new Error('executeInWebView is not supported. Use the /cloudflare/cookies API to set bypass cookies manually.')
  },
}
