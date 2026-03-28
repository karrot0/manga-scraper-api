/**
 * index.ts — Emulator entry point
 *
 * ⚠ dotenv MUST be the very first import to load env vars before any module
 *   that reads process.env (like supabase.ts) is evaluated.
 * ⚠ globals.ts MUST be imported before any @paperback/types usage.
 */
import 'dotenv/config'
import './runtime/globals.js'

import { loadAllExtensions } from './loader/loader.js'
import { createApp } from './api/server.js'

const PORT = Number(process.env.PORT ?? 3001)
const forceDownload = process.argv.includes('--force-download')

async function main() {
  console.log('[emulator] Starting KakarotExtension emulator...')

  if (forceDownload) {
    console.log('[emulator] --force-download: re-downloading all extensions\n')
  }

  // Download/update extensions from gh-pages, then load them
  const results = await loadAllExtensions(false)

  const loaded = results.filter(r => r.success)
  const failed = results.filter(r => !r.success)

  console.log(`\n[emulator] Loaded ${loaded.length}/${results.length} extensions`)
  if (failed.length > 0) {
    console.log('[emulator] Failed:', failed.map(f => `${f.name} (${f.error})`).join(', '))
  }

  const app = createApp()
  app.listen(PORT, () => {
    console.log(`\n[emulator] ✓ Server running at http://localhost:${PORT}`)
    console.log(`[emulator] ✓ Providers: GET http://localhost:${PORT}/api/providers`)
    console.log(`[emulator] ✓ Update: POST http://localhost:${PORT}/api/extensions/update\n`)
  })
}

main().catch(err => {
  console.error('[emulator] Fatal error:', err)
  process.exit(1)
})
