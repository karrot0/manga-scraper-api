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

// Inject the Application namespace into the global scope
;(globalThis as any).Application = ApplicationImpl

// Ensure fetch is available globally (node 18+ has it natively; fallback for older)
if (typeof globalThis.fetch === 'undefined') {
  const { default: nodeFetch } = await import('node-fetch')
  ;(globalThis as any).fetch = nodeFetch
}
