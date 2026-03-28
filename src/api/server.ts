import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { providersRouter } from './routes/providers.js'
import { searchRouter } from './routes/search.js'
import { mangaRouter } from './routes/manga.js'
import { chaptersRouter } from './routes/chapters.js'
import { chapterDetailsRouter } from './routes/chapterDetails.js'
import { discoverRouter } from './routes/discover.js'
import { cloudflareRouter } from './routes/cloudflare.js'
import { extensionsRouter } from './routes/extensions.js'
import { scrapeRouter } from './routes/scrape.js'
import { sourcesRouter } from './routes/sources.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.resolve(__dirname, '../../public')

export function createApp() {
  const app = express()
  app.use(express.json())

  // Serve dashboard static files
  app.use(express.static(PUBLIC_DIR))

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  app.use('/api/extensions', extensionsRouter)
  app.use('/api/scrape', scrapeRouter)
  app.use('/api/scrape', sourcesRouter)
  app.use('/api/providers', providersRouter)
  app.use('/api/providers', searchRouter)
  app.use('/api/providers', mangaRouter)
  app.use('/api/providers', chaptersRouter)
  app.use('/api/providers', chapterDetailsRouter)
  app.use('/api/providers', discoverRouter)
  app.use('/api/providers', cloudflareRouter)

  // Global error handler
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err.status ?? 500
    console.error('[api] Error:', err.message)
    res.status(status).json({ error: err.message ?? 'Internal server error' })
  })

  return app
}
