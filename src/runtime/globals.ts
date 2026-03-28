/**
 * globals.ts
 *
 * ⚠ MUST be imported before any @paperback/types usage.
 *
 * Sets `globalThis.Application` to the emulator implementation so that
 * @paperback/types classes (PaperbackInterceptor, BasicRateLimiter, etc.)
 * resolve it at runtime.
 */

import { ApplicationImpl } from './Application.js'

;(globalThis as any).Application = ApplicationImpl

if (typeof globalThis.fetch === 'undefined') {
  const { default: nodeFetch } = await import('node-fetch')
  ;(globalThis as any).fetch = nodeFetch
}

{
  const { webcrypto } = await import('crypto')
  ;(globalThis as any).SubtleCrypto = function SubtleCrypto() { return webcrypto.subtle }
  console.log('[globals] SubtleCrypto shim installed, type:', typeof (globalThis as any).SubtleCrypto)
  try {
    if (typeof (globalThis as any).crypto === 'undefined') {
      Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
    }
  } catch { /* already defined */ }
}
