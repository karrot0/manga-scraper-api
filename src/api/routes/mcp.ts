import { Router } from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { listProviders, getProvider } from '../../loader/registry.js'

export const mcpRouter = Router()

function slugify(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function buildMcpServer() {
  const server = new McpServer({
    name: 'manga-scraper',
    version: '1.0.0',
  })

  // ── list_providers ──────────────────────────────────────────────────────────
  server.tool(
    'list_providers',
    'List all loaded manga providers',
    {},
    async () => {
      const providers = listProviders().map(p => ({
        id: p.id,
        name: p.name,
        version: p.version,
        repoId: p.repoId,
        language: p.language,
        cloudflareEnabled: p.cloudflareEnabled,
      }))
      return { content: [{ type: 'text', text: JSON.stringify(providers, null, 2) }] }
    },
  )

  // ── search_manga ────────────────────────────────────────────────────────────
  server.tool(
    'search_manga',
    'Search for manga on a specific provider',
    {
      providerId: z.string().describe('Provider ID (use list_providers to get IDs)'),
      query: z.string().default('').describe('Search title (empty = browse/featured)'),
      page: z.number().int().min(1).default(1).describe('Page number'),
    },
    async ({ providerId, query, page }) => {
      const entry = getProvider(providerId)
      if (!entry) return { isError: true, content: [{ type: 'text', text: `Provider "${providerId}" not found` }] }

      try {
        const results = await entry.instance.getSearchResults({ title: query, filters: [], sorting: undefined }, page)
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] }
      } catch (e: any) {
        return { isError: true, content: [{ type: 'text', text: e.message }] }
      }
    },
  )

  // ── get_manga ───────────────────────────────────────────────────────────────
  server.tool(
    'get_manga',
    'Get manga details and metadata from a provider',
    {
      providerId: z.string().describe('Provider ID'),
      mangaId: z.string().describe('Manga ID from the provider (from search results)'),
    },
    async ({ providerId, mangaId }) => {
      const entry = getProvider(providerId)
      if (!entry) return { isError: true, content: [{ type: 'text', text: `Provider "${providerId}" not found` }] }

      try {
        const manga = await entry.instance.getMangaDetails(mangaId)
        return { content: [{ type: 'text', text: JSON.stringify(manga, null, 2) }] }
      } catch (e: any) {
        return { isError: true, content: [{ type: 'text', text: e.message }] }
      }
    },
  )

  // ── get_chapters ────────────────────────────────────────────────────────────
  server.tool(
    'get_chapters',
    'Get the chapter list for a manga from a provider',
    {
      providerId: z.string().describe('Provider ID'),
      mangaId: z.string().describe('Manga ID from the provider'),
    },
    async ({ providerId, mangaId }) => {
      const entry = getProvider(providerId)
      if (!entry) return { isError: true, content: [{ type: 'text', text: `Provider "${providerId}" not found` }] }

      try {
        const chapters = await entry.instance.getChapters(mangaId)
        return { content: [{ type: 'text', text: JSON.stringify(chapters, null, 2) }] }
      } catch (e: any) {
        return { isError: true, content: [{ type: 'text', text: e.message }] }
      }
    },
  )

  // ── list_series ─────────────────────────────────────────────────────────────
  server.tool(
    'list_series',
    'List manga series stored in the local database',
    {
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(24),
      search: z.string().optional().describe('Filter by title'),
    },
    async ({ page, limit, search }) => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (search) params.set('search', search)
      const res = await fetch(`http://localhost:${process.env.PORT ?? 3001}/api/scrape/series?${params}`)
      const data = await res.json()
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  // ── check_exists ────────────────────────────────────────────────────────────
  server.tool(
    'check_exists',
    'Check if a manga series already exists in the database by title slug',
    {
      title: z.string().describe('Manga title (will be slugified for lookup)'),
    },
    async ({ title }) => {
      const slug = slugify(title)
      const res = await fetch(`http://localhost:${process.env.PORT ?? 3001}/api/scrape/exists/${encodeURIComponent(slug)}`)
      const data = await res.json()
      return { content: [{ type: 'text', text: JSON.stringify({ slug, ...data }, null, 2) }] }
    },
  )

  // ── scrape_manga ────────────────────────────────────────────────────────────
  server.tool(
    'scrape_manga',
    'Scrape a manga series from a provider and add all chapters to the database. This may take a while for large series.',
    {
      providerId: z.string().describe('Provider ID'),
      mangaId: z.string().describe('Manga ID from the provider'),
      scrapePages: z.boolean().default(true).describe('Whether to also scrape individual page URLs'),
      maxChapters: z.number().int().optional().describe('Limit the number of chapters to scrape'),
    },
    async ({ providerId, mangaId, scrapePages, maxChapters }) => {
      const entry = getProvider(providerId)
      if (!entry) return { isError: true, content: [{ type: 'text', text: `Provider "${providerId}" not found` }] }

      const logs: string[] = []
      let result: any = null

      const body = JSON.stringify({ providerId, mangaId, scrapePages, maxChapters })
      const res = await fetch(`http://localhost:${process.env.PORT ?? 3001}/api/scrape/series`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const chunk of parts) {
          const lines = chunk.split('\n')
          let evt = '', data = ''
          for (const line of lines) {
            if (line.startsWith('event: ')) evt = line.slice(7)
            if (line.startsWith('data: ')) data = line.slice(6)
          }
          if (!evt || !data) continue
          try {
            const parsed = JSON.parse(data)
            if (evt === 'log') logs.push(`[${parsed.type ?? 'info'}] ${parsed.msg}`)
            else if (evt === 'done') result = parsed
            else if (evt === 'error') return { isError: true, content: [{ type: 'text', text: parsed.message }] }
          } catch {}
        }
      }

      const summary = result
        ? `Done! ${result.chaptersCount} chapters, ${result.pagesTotal ?? 0} pages. Slug: ${result.slug}`
        : 'Scrape completed (no summary received)'

      return {
        content: [{
          type: 'text',
          text: `${summary}\n\nLog:\n${logs.join('\n')}`,
        }],
      }
    },
  )

  return server
}

// ── HTTP handler ──────────────────────────────────────────────────────────────
// Stateless: new server + transport per request (no session state needed)
mcpRouter.post('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  const server = buildMcpServer()
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (e: any) {
    if (!res.headersSent) res.status(500).json({ error: e.message })
  } finally {
    await transport.close()
    await server.close()
  }
})

// GET /mcp — for MCP inspector discovery (returns capabilities as JSON)
mcpRouter.get('/mcp', (_req, res) => {
  res.json({
    name: 'manga-scraper',
    version: '1.0.0',
    transport: 'streamable-http',
    endpoint: '/mcp',
    tools: [
      'list_providers',
      'search_manga',
      'get_manga',
      'get_chapters',
      'list_series',
      'check_exists',
      'scrape_manga',
    ],
  })
})
