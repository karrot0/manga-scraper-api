/**
 * scrape.ts
 *
 * POST /api/scrape/preview  — Search a provider and return results (no DB write)
 * POST /api/scrape/series   — Scrape a manga + all chapters + pages → save to Supabase
 *                             Uses Server-Sent Events (SSE) to stream progress.
 * GET  /api/scrape/exists/:slug — Check if a series slug already exists in DB
 */

import { Router, Request, Response } from 'express'
import { getProvider } from '../../loader/registry.js'
import { setContext, setProviderId } from '../../runtime/Application.js'
import {
  slugify,
  upsertSeries,
  upsertChapters,
  upsertSeriesSource,
  upsertChapterSources,
  getChapterMap,
  supabase,
} from '../../db/supabase.js'
import type { DbChapter, DbChapterSource, PageEntry } from '../../db/supabase.js'

export const scrapeRouter = Router()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function providerCtx(providerId: string) {
  setContext(`provider:${providerId}`)
  setProviderId(providerId)
}

/** Send an SSE "data:" line */
function sse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

// ---------------------------------------------------------------------------
// POST /api/scrape/preview
// ---------------------------------------------------------------------------

scrapeRouter.post('/preview', async (req: Request, res: Response) => {
  const { providerId, query, page = 1 } = req.body as {
    providerId: string
    query: string
    page?: number
  }

  const provider = getProvider(providerId)
  if (!provider) {
    res.status(404).json({ error: `Provider "${providerId}" not found` })
    return
  }

  try {
    providerCtx(providerId)

    // Resolve default sorting option for providers that require it (e.g. ComixTo)
    let sortingOption: any
    if (typeof provider.instance.getSortingOptions === 'function') {
      try {
        const opts = await provider.instance.getSortingOptions()
        if (Array.isArray(opts) && opts.length > 0) sortingOption = opts[0]
      } catch { /* ignore */ }
    }

    const results = await provider.instance.getSearchResults(
      { title: query, filters: [], includedTags: [], excludedTags: [] },
      { page },
      sortingOption,
    )

    const rawItems = results?.results ?? results?.items ?? results ?? []
    const items = (Array.isArray(rawItems) ? rawItems : []).map((item: any) => ({
      mangaId: item.mangaId ?? item.id,
      title: item.title ?? item.mangaInfo?.primaryTitle ?? item.mangaInfo?.titles?.[0] ?? 'Unknown',
      imageUrl: item.imageUrl ?? item.image ?? item.thumbnailUrl ?? item.mangaInfo?.thumbnailUrl ?? null,
    }))

    // hasMore: prefer explicit field, then check metadata (Paperback pattern), then length heuristic
    const hasMore = results?.hasMore
      ?? (results?.metadata != null && results?.metadata !== undefined)
      ?? (items.length >= 20)

    res.json({ items, hasMore })
  } catch (err: any) {
    if (err?.type === 'cloudflareError' || err?.message?.includes('Cloudflare')) {
      res.status(403).json({ error: 'Cloudflare bypass is required', cloudflare: true })
      return
    }
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// POST /api/scrape/series   (SSE streaming)
// ---------------------------------------------------------------------------

scrapeRouter.post('/series', async (req: Request, res: Response) => {
  const {
    providerId,
    mangaId,
    scrapePages = true,
    maxChapters,
  } = req.body as {
    providerId: string
    mangaId: string
    scrapePages?: boolean
    maxChapters?: number
  }

  const provider = getProvider(providerId)
  if (!provider) {
    res.status(404).json({ error: `Provider "${providerId}" not found` })
    return
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const log = (msg: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') =>
    sse(res, 'log', { msg, type })

  try {
    // 1. Fetch manga details
    log(`📖 Fetching details for manga "${mangaId}" from ${providerId}…`)
    providerCtx(providerId)

    let details: any = {}
    try {
      const raw = await provider.instance.getMangaDetails(mangaId)
      details = (raw?.mangaInfo ?? raw) || {}
    } catch (e: any) {
      log(`⚠ getMangaDetails failed: ${e.message}`, 'warn')
    }

    const rawTitle: string =
      details.primaryTitle ?? details.titles?.[0] ?? details.title ?? details.name ?? mangaId

    const slug = slugify(rawTitle)
    log(`🔖 Slug: ${slug}`)

    const statusMap: Record<string, string> = {
      Ongoing: 'ongoing', ONGOING: 'ongoing', ongoing: 'ongoing',
      Completed: 'completed', COMPLETED: 'completed', completed: 'completed',
      Hiatus: 'hiatus', HIATUS: 'hiatus', hiatus: 'hiatus',
      Cancelled: 'cancelled', CANCELLED: 'cancelled', cancelled: 'cancelled',
    }

    // Extract genres: tagGroups[].tags[].title OR flat tags/genres array
    let genres: string[] = []
    if (Array.isArray(details.tagGroups)) {
      genres = details.tagGroups.flatMap((g: any) =>
        (g.tags ?? []).map((t: any) => typeof t === 'string' ? t : t.title ?? t.label ?? '')
      ).filter(Boolean)
    } else if (Array.isArray(details.tags ?? details.genres)) {
      genres = (details.tags ?? details.genres ?? []).map((t: any) =>
        typeof t === 'string' ? t : t.title ?? t.label ?? t.id ?? ''
      ).filter(Boolean)
    }

    const seriesData = {
      slug,
      title: rawTitle,
      alt_titles: details.secondaryTitles ?? details.altTitles ?? [],
      description: details.synopsis ?? details.desc ?? details.description ?? null,
      cover_url: details.thumbnailUrl ?? details.image ?? details.coverUrl ?? null,
      status: statusMap[details.status ?? ''] ?? 'ongoing',
      type: 'manga',
      genres,
      author: details.author ?? null,
      artist: details.artist ?? null,
      year: details.year ? parseInt(details.year) : undefined,
    }

    // 2. Upsert series
    log(`💾 Saving series "${rawTitle}" to database…`)
    const saved = await upsertSeries(seriesData)
    log(`✅ Series saved (id: ${saved.id})`, 'success')
    sse(res, 'series', { id: saved.id, slug: saved.slug, title: rawTitle })

    // 2a. Record this provider as a source for the series
    await upsertSeriesSource({ series_id: saved.id, provider_id: providerId, provider_manga_id: mangaId })
    log(`🔗 Source linked: ${providerId} → ${saved.id}`)

    // 3. Fetch chapters
    log(`📋 Fetching chapters…`)
    providerCtx(providerId)
    let chapters: any[] = []
    try {
      // getChapters expects a sourceManga object: { mangaId }
      const sourceManga = { mangaId }
      const chapResult = await provider.instance.getChapters(sourceManga)
      chapters = Array.isArray(chapResult) ? chapResult : []
    } catch (e: any) {
      log(`⚠ getChapters failed: ${e.message}`, 'warn')
    }

    if (maxChapters && maxChapters > 0) {
      chapters = chapters.slice(0, maxChapters)
    }

    log(`📋 Found ${chapters.length} chapters`)
    sse(res, 'chapters_count', { count: chapters.length })

    // 4. Build chapter metadata records (fast synchronous pass, no page fetching yet)
    // providerChapIds maps chapNum → provider-side chapter ID (needed for chapter_sources)
    const dbChapters: DbChapter[] = []
    const providerChapIds: Map<number, string> = new Map()
    let pagesTotal = 0

    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i]
      const chapId = ch.chapterId ?? ch.id ?? ch.chapId ?? String(i)
      const chapNum = parseFloat(ch.chapNum ?? ch.chapterNumber ?? ch.number ?? (i + 1))
      const volNum = (ch.volume != null && ch.volume !== 0) ? parseInt(ch.volume) : undefined
      const chapTitle = ch.title ?? ch.name ?? null
      const pubAt = ch.publishDate ?? ch.time ?? ch.langAvailableAt ?? ch.date ?? null

      providerChapIds.set(chapNum, chapId)
      dbChapters.push({
        series_id: saved.id,
        chapter_number: chapNum,
        volume_number: volNum,
        title: chapTitle,
        pages: [],
        published_at: pubAt
          ? (pubAt instanceof Date ? pubAt : new Date(pubAt)).toISOString()
          : new Date().toISOString(),
      })
    }

    // 4b. Fetch pages concurrently with bounded concurrency
    if (scrapePages) {
      const CONCURRENCY = 8
      let completed = 0
      const idxQueue = dbChapters.map((_, i) => i)
      log(`📄 Fetching pages for ${chapters.length} chapters (concurrency: ${CONCURRENCY})…`)

      const worker = async () => {
        while (true) {
          const idx = idxQueue.shift()
          if (idx === undefined) break
          const origCh = chapters[idx]
          const chapId = origCh.chapterId ?? origCh.id ?? origCh.chapId ?? String(idx)
          const chapNum = dbChapters[idx].chapter_number
          const MAX_RETRIES = 5
          let lastErr = ''
          for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
              providerCtx(providerId)
              const pageData = await provider.instance.getChapterDetails(
                { chapterId: chapId, sourceManga: { mangaId } }
              )
              const urls: any[] = Array.isArray(pageData)
                ? pageData
                : pageData?.pages ?? pageData?.imageUrls ?? []
              if (urls.length === 0 && attempt < MAX_RETRIES) {
                lastErr = 'empty page list'
                await new Promise(r => setTimeout(r, attempt * 500))
                continue
              }
              dbChapters[idx].pages = urls.map((u: any) =>
                typeof u === 'string' ? { url: u } : { url: u.url ?? u, referer: u.referer }
              )
              pagesTotal += dbChapters[idx].pages.length
              break
            } catch (e: any) {
              lastErr = e.message
              if (attempt < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, attempt * 500))
              }
            }
          }
          if (dbChapters[idx].pages.length === 0) {
            log(`  ⚠ Chapter ${chapNum} pages failed after ${MAX_RETRIES} attempts: ${lastErr}`, 'warn')
          }
          completed++
          sse(res, 'progress', { current: completed, total: chapters.length, chapNum })
        }
      }

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chapters.length) }, worker))
    } else {
      sse(res, 'progress', { current: chapters.length, total: chapters.length, chapNum: 0 })
    }

    // 5. Upsert chapters
    if (dbChapters.length > 0) {
      log(`💾 Saving ${dbChapters.length} chapters to database…`)
      const CHUNK = 100
      for (let i = 0; i < dbChapters.length; i += CHUNK) {
        await upsertChapters(dbChapters.slice(i, i + CHUNK))
      }
      log(`✅ ${dbChapters.length} chapters saved (${pagesTotal} pages total)`, 'success')

      // 5a. Persist chapter sources so each chapter knows which provider supplied its pages
      if (scrapePages) {
        log(`🔗 Linking chapter sources to ${providerId}…`)
        const { data: savedChapters } = await supabase
          .from('chapters')
          .select('id, chapter_number')
          .eq('series_id', saved.id)

        const sources: DbChapterSource[] = []
        for (const row of savedChapters ?? []) {
          const chapNum = Number(row.chapter_number)
          const providerChapId = providerChapIds.get(chapNum)
          const chapPages = dbChapters.find(c => c.chapter_number === chapNum)?.pages ?? []
          if (providerChapId && chapPages.length > 0) {
            sources.push({
              chapter_id: row.id,
              provider_id: providerId,
              provider_chapter_id: providerChapId,
              pages: chapPages,
            })
          }
        }
        if (sources.length > 0) {
          await upsertChapterSources(sources)
          log(`✅ ${sources.length} chapter sources linked`, 'success')
        }
      }
    }

    sse(res, 'done', {
      seriesId: saved.id,
      slug: saved.slug,
      title: rawTitle,
      chaptersCount: dbChapters.length,
      pagesTotal,
    })
  } catch (err: any) {
    log(`❌ Fatal error: ${err.message}`, 'error')
    sse(res, 'error', { message: err.message })
  } finally {
    res.end()
  }
})

// ---------------------------------------------------------------------------
// GET /api/scrape/exists/:slug
// ---------------------------------------------------------------------------

scrapeRouter.get('/exists/:slug', async (req: Request, res: Response) => {
  const { slug } = req.params
  const { data } = await supabase
    .from('series')
    .select('id, slug, title')
    .eq('slug', slug)
    .maybeSingle()

  res.json({ exists: !!data, series: data ?? null })
})

// ---------------------------------------------------------------------------
// POST /api/scrape/batch-exists  — check multiple slugs at once
// ---------------------------------------------------------------------------

scrapeRouter.post('/batch-exists', async (req: Request, res: Response) => {
  const { slugs } = req.body as { slugs?: unknown }
  if (!Array.isArray(slugs) || slugs.length === 0) {
    res.json({ found: [] })
    return
  }
  const clean = (slugs as unknown[]).filter(s => typeof s === 'string').slice(0, 200) as string[]
  const { data } = await supabase.from('series').select('slug').in('slug', clean)
  res.json({ found: (data ?? []).map((r: any) => r.slug) })
})

// ---------------------------------------------------------------------------
// GET /api/scrape/series  — list all series in DB (with pagination + search)
// ---------------------------------------------------------------------------

scrapeRouter.get('/series', async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? '24', 10)))
  const search = ((req.query.search as string) ?? '').trim()
  const offset = (page - 1) * limit

  let query = supabase
    .from('series')
    .select('id, slug, title, cover_url, status, type, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (search) {
    query = query.ilike('title', `%${search}%`)
  }

  const { data, error, count } = await query

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ items: data ?? [], total: count ?? 0, page, limit })
})

// ---------------------------------------------------------------------------
// POST /api/scrape/rescrape-all  — re-scrape every series, adding new chapters only
// ---------------------------------------------------------------------------

const STATUS_MAP: Record<string, string> = {
  Ongoing: 'ongoing', ONGOING: 'ongoing', ongoing: 'ongoing',
  continuing: 'ongoing', active: 'ongoing',
  Completed: 'completed', COMPLETED: 'completed', completed: 'completed',
  ended: 'completed', finished: 'completed',
  Hiatus: 'hiatus', HIATUS: 'hiatus', hiatus: 'hiatus',
  paused: 'hiatus',
  Cancelled: 'cancelled', CANCELLED: 'cancelled', cancelled: 'cancelled',
  dropped: 'cancelled',
}

scrapeRouter.post('/rescrape-all', async (req: Request, res: Response) => {
  const { scrapePages = true } = req.body as { scrapePages?: boolean }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const log = (msg: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') =>
    sse(res, 'log', { msg, type })

  try {
    // 1. Fetch all series (paginate to handle large libraries)
    const allSeries: Array<{ id: string; slug: string; title: string }> = []
    let page = 0
    const PAGE_SIZE = 100
    while (true) {
      const { data, error } = await supabase
        .from('series')
        .select('id, slug, title')
        .order('created_at', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      if (error) throw new Error(`Failed to list series: ${error.message}`)
      if (!data || data.length === 0) break
      allSeries.push(...data)
      if (data.length < PAGE_SIZE) break
      page++
    }

    log(`📚 ${allSeries.length} series to rescrape`)

    let processed = 0
    let newChaptersTotal = 0

    for (const series of allSeries) {
      try {
        log(`🔄 [${processed + 1}/${allSeries.length}] "${series.title}"`)

        // 2. Get first available source
        const { data: sources } = await supabase
          .from('series_sources')
          .select('provider_id, provider_manga_id')
          .eq('series_id', series.id)
          .limit(1)

        if (!sources?.length) {
          log(`  ⚠ No source linked — skipping`, 'warn')
          processed++
          sse(res, 'progress', { current: processed, total: allSeries.length })
          continue
        }

        const { provider_id: providerId, provider_manga_id: mangaId } = sources[0]
        const provider = getProvider(providerId)
        if (!provider) {
          log(`  ⚠ Provider "${providerId}" not loaded — skipping`, 'warn')
          processed++
          sse(res, 'progress', { current: processed, total: allSeries.length })
          continue
        }

        providerCtx(providerId)

        // 3. Re-fetch series metadata and update (title, cover, status, description)
        try {
          const raw = await provider.instance.getMangaDetails(mangaId)
          const details = (raw?.mangaInfo ?? raw) || {}
          const rawTitle: string =
            details.primaryTitle ?? details.titles?.[0] ?? details.title ?? details.name ?? series.title

          let genres: string[] = []
          if (Array.isArray(details.tagGroups)) {
            genres = details.tagGroups.flatMap((g: any) =>
              (g.tags ?? []).map((t: any) => typeof t === 'string' ? t : t.title ?? t.label ?? '')
            ).filter(Boolean)
          } else if (Array.isArray(details.tags ?? details.genres)) {
            genres = (details.tags ?? details.genres ?? []).map((t: any) =>
              typeof t === 'string' ? t : t.title ?? t.label ?? t.id ?? ''
            ).filter(Boolean)
          }

          await upsertSeries({
            slug: series.slug,
            title: rawTitle,
            alt_titles: details.secondaryTitles ?? details.altTitles ?? [],
            description: details.synopsis ?? details.desc ?? details.description ?? undefined,
            cover_url: details.thumbnailUrl ?? details.image ?? details.coverUrl ?? undefined,
            status: STATUS_MAP[details.status ?? ''] ?? undefined,
            genres,
            author: details.author ?? undefined,
            artist: details.artist ?? undefined,
            year: details.year ? parseInt(details.year) : undefined,
          })
        } catch (e: any) {
          log(`  ⚠ metadata update failed: ${e.message}`, 'warn')
        }

        // 4. Fetch chapter list from provider
        providerCtx(providerId)
        let providerChapters: any[] = []
        try {
          const chapResult = await provider.instance.getChapters({ mangaId })
          providerChapters = Array.isArray(chapResult) ? chapResult : []
        } catch (e: any) {
          log(`  ⚠ getChapters failed: ${e.message}`, 'warn')
          processed++
          sse(res, 'progress', { current: processed, total: allSeries.length })
          continue
        }

        // 5. Only process chapters missing from DB
        const chapMap = await getChapterMap(series.id)
        const newRawChapters = providerChapters.filter((ch: any, i: number) => {
          const num = parseFloat(ch.chapNum ?? ch.chapterNumber ?? ch.number ?? String(i + 1))
          return !chapMap.has(num)
        })

        if (newRawChapters.length === 0) {
          log(`  ✓ No new chapters`)
          await supabase.from('series').update({ updated_at: new Date().toISOString() }).eq('id', series.id)
          processed++
          sse(res, 'progress', { current: processed, total: allSeries.length })
          continue
        }

        log(`  📋 ${newRawChapters.length} new chapter(s)`)

        // 6. Build DbChapter records for new chapters
        const dbChapters: DbChapter[] = []
        const providerChapIds = new Map<number, string>()

        for (let i = 0; i < newRawChapters.length; i++) {
          const ch = newRawChapters[i]
          const chapId = ch.chapterId ?? ch.id ?? ch.chapId ?? String(i)
          const chapNum = parseFloat(ch.chapNum ?? ch.chapterNumber ?? ch.number ?? String(i + 1))
          const volNum = (ch.volume != null && ch.volume !== 0) ? parseInt(ch.volume) : undefined
          const pubAt = ch.publishDate ?? ch.time ?? ch.langAvailableAt ?? ch.date ?? null
          providerChapIds.set(chapNum, chapId)
          dbChapters.push({
            series_id: series.id,
            chapter_number: chapNum,
            volume_number: volNum,
            title: ch.title ?? ch.name ?? null,
            pages: [],
            published_at: pubAt
              ? (pubAt instanceof Date ? pubAt : new Date(pubAt)).toISOString()
              : new Date().toISOString(),
          })
        }

        // 7. Fetch pages for new chapters only
        if (scrapePages && dbChapters.length > 0) {
          const CONCURRENCY = 8
          const idxQueue = dbChapters.map((_, i) => i)

          const worker = async () => {
            while (true) {
              const idx = idxQueue.shift()
              if (idx === undefined) break
              const origCh = newRawChapters[idx]
              const chapId = origCh.chapterId ?? origCh.id ?? origCh.chapId ?? String(idx)
              const chapNum = dbChapters[idx].chapter_number
              const MAX_RETRIES = 5
              let lastErr = ''
              for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                  providerCtx(providerId)
                  const pageData = await provider.instance.getChapterDetails(
                    { chapterId: chapId, sourceManga: { mangaId } }
                  )
                  const urls: any[] = Array.isArray(pageData)
                    ? pageData
                    : pageData?.pages ?? pageData?.imageUrls ?? []
                  if (urls.length === 0 && attempt < MAX_RETRIES) {
                    lastErr = 'empty page list'
                    await new Promise(r => setTimeout(r, attempt * 500))
                    continue
                  }
                  dbChapters[idx].pages = urls.map((u: any) =>
                    typeof u === 'string' ? { url: u } : { url: u.url ?? u, referer: u.referer }
                  )
                  break
                } catch (e: any) {
                  lastErr = e.message
                  if (attempt < MAX_RETRIES) {
                    await new Promise(r => setTimeout(r, attempt * 500))
                  }
                }
              }
              if (dbChapters[idx].pages.length === 0) {
                log(`  ⚠ Ch.${chapNum} pages failed after ${MAX_RETRIES} attempts: ${lastErr}`, 'warn')
              }
            }
          }
          await Promise.all(Array.from({ length: Math.min(CONCURRENCY, dbChapters.length) }, worker))
        }

        // 8. Save new chapters
        const CHUNK = 100
        for (let i = 0; i < dbChapters.length; i += CHUNK) {
          await upsertChapters(dbChapters.slice(i, i + CHUNK))
        }

        // 8a. Link chapter sources for new chapters
        if (scrapePages) {
          const { data: savedChapters } = await supabase
            .from('chapters')
            .select('id, chapter_number')
            .eq('series_id', series.id)
            .in('chapter_number', dbChapters.map(c => c.chapter_number))

          const sources: DbChapterSource[] = []
          for (const row of savedChapters ?? []) {
            const chapNum = Number(row.chapter_number)
            const providerChapId = providerChapIds.get(chapNum)
            const chapPages = dbChapters.find(c => c.chapter_number === chapNum)?.pages ?? []
            if (providerChapId && chapPages.length > 0) {
              sources.push({
                chapter_id: row.id,
                provider_id: providerId,
                provider_chapter_id: providerChapId,
                pages: chapPages,
              })
            }
          }
          if (sources.length > 0) await upsertChapterSources(sources)
        }

        // 9. Touch updated_at
        await supabase.from('series').update({ updated_at: new Date().toISOString() }).eq('id', series.id)

        newChaptersTotal += dbChapters.length
        log(`  ✅ +${dbChapters.length} chapter(s)`, 'success')

      } catch (e: any) {
        log(`  ❌ Error: ${e.message}`, 'error')
      }

      processed++
      sse(res, 'progress', { current: processed, total: allSeries.length })
    }

    log(`🎉 Rescrape complete — ${processed} series processed, ${newChaptersTotal} new chapters added`, 'success')
    sse(res, 'done', { processed, newChapters: newChaptersTotal })

  } catch (e: any) {
    sse(res, 'error', { message: e.message })
  } finally {
    res.end()
  }
})

// ---------------------------------------------------------------------------
// DELETE /api/scrape/series/:id  — delete a series (and cascade chapters)
// ---------------------------------------------------------------------------

scrapeRouter.delete('/series/:id', async (req: Request, res: Response) => {
  const { id } = req.params

  // Delete chapters first (if no cascade)
  await supabase.from('chapters').delete().eq('series_id', id)

  const { error } = await supabase.from('series').delete().eq('id', id)
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ success: true, id })
})
