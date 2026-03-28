import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import * as esbuild from 'esbuild'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB_DIR = path.resolve(__dirname, '../../web')
const HTML_FILE = path.join(WEB_DIR, 'index.html')
const ENTRY_FILE = path.join(WEB_DIR, 'index.tsx')

export const webRouter = express.Router()

let cachedBundle: string | null = null

webRouter.get('/bundle.js', async (_req, res) => {
  try {
    if (!cachedBundle) {
      const result = await esbuild.build({
        entryPoints: [ENTRY_FILE],
        bundle: true,
        write: false,
        format: 'iife',
        jsx: 'automatic',
        minify: false,
        sourcemap: 'inline',
        logLevel: 'warning',
      })
      cachedBundle = result.outputFiles[0].text
    }
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
    res.send(cachedBundle)
  } catch (e: any) {
    console.error('[web] Bundle error:', e.message)
    res.status(500).type('js').send(`console.error('[web] Bundle error: ' + ${JSON.stringify(e.message)})`)
  }
})

// Invalidate cache when bundle.js is re-requested after a source change
// (In dev with tsx watch, the server restarts automatically, resetting the cache)
webRouter.get('/', (_req, res) => {
  res.sendFile(HTML_FILE)
})
