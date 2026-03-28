/**
 * sources.ts
 *
 * POST /api/scrape/find-sources
 *   Search all loaded providers for a series by title/alt-titles and link matching
 *   providers as sources for that series (and optionally sync chapter sources too).
 *
 * Body:
 *   { seriesId: string, linkChapters?: boolean }
 *
 * Response: SSE stream (same format as /api/scrape/series)
 */

import { Router, Request, Response } from 'express'
import { listProviders } from '../../loader/registry.js'
import { setContext, setProviderId } from '../../runtime/Application.js'
import {
  slugify,
  upsertSeriesSource,
  upsertChapters,
  upsertChapterSources,
  getChapterMap,
  supabase,
} from '../../db/supabase.js'
import type { DbChapter, DbChapterSource, PageEntry } from '../../db/supabase.js'

export const sourcesRouter = Router()

function sse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Compute a simple similarity score between two normalized strings:
 * - 1.0 = exact match
 * - >0.6 = likely same title
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1
  const longer = a.length > b.length ? a : b
  const shorter = a.length > b.length ? b : a
  if (longer.length === 0) return 1
  // Check containment (e.g. "one piece" vs "one piece: romance dawn")
  if (longer.startsWith(shorter) || shorter.startsWith(longer)) {
    return shorter.length / longer.length
  }
  // Bigram overlap
  const bigrams = (s: string) => {
    const set = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
    return set
  }
  const bg1 = bigrams(a)
  const bg2 = bigrams(b)
  let overlap = 0
  for (const g of bg1) if (bg2.has(g)) overlap++
  return (2 * overlap) / (bg1.size + bg2.size)
}

// ---------------------------------------------------------------------------
// POST /api/scrape/find-sources
// ---------------------------------------------------------------------------

sourcesRouter.post('/find-sources', async (req: Request, res: Response) => {
  const { seriesId, linkChapters = false } = req.body as {
    seriesId: string
    linkChapters?: boolean
  }

  if (!seriesId) {
    res.status(400).json({ error: 'seriesId is required' })
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
    // 1. Fetch series from DB
    const { data: series, error: seriesErr } = await supabase
      .from('series')
      .select('id, slug, title, alt_titles')
      .eq('id', seriesId)
      .single()

    if (seriesErr || !series) {
      sse(res, 'error', { message: 'Series not found' })
      res.end()
      return
    }

    log(`🔍 Searching all providers for "${series.title}"…`)

    // Build candidate titles to search (primary + alt titles)
    const allTitles: string[] = [
      series.title,
      ...((series.alt_titles as string[]) ?? []),
    ]

    // Reference normalized forms for matching
    const refSlugs = new Set(allTitles.map(t => slugify(t)))
    const refNorm  = allTitles.map(t => normalizeTitle(t))

    const providers = listProviders()
    log(`📡 ${providers.length} providers loaded`)

    const linked: Array<{ providerId: string; providerMangaId: string; title: string }> = []
    const SIMILARITY_THRESHOLD = 0.72

    // 2. Search each provider
    for (const provider of providers) {
      const pid = provider.id

      // Skip providers that don't export getSearchResults
      if (typeof provider.instance.getSearchResults !== 'function') continue

      setContext(`provider:${pid}`)
      setProviderId(pid)

      let sortingOption: any
      if (typeof provider.instance.getSortingOptions === 'function') {
        try {
          const opts = await provider.instance.getSortingOptions()
          if (Array.isArray(opts) && opts.length > 0) sortingOption = opts[0]
        } catch { /* ignore */ }
      }

      // Try each candidate title until we find a match
      let matched: { mangaId: string; title: string } | null = null

      for (const query of allTitles) {
        try {
          const result = await provider.instance.getSearchResults(
            { title: query, filters: [], includedTags: [], excludedTags: [] },
            { page: 1 },
            sortingOption,
          )

          const rawItems = result?.results ?? result?.items ?? result ?? []
          const items: Array<{ mangaId: string; title: string }> = (Array.isArray(rawItems) ? rawItems : [])
            .map((item: any) => ({
              mangaId: item.mangaId ?? item.id,
              title: item.title ?? item.mangaInfo?.primaryTitle ?? item.mangaInfo?.titles?.[0] ?? '',
            }))
            .filter((item: { mangaId: string; title: string }) => item.mangaId && item.title)

          for (const item of items) {
            const itemSlug = slugify(item.title)
            const itemNorm = normalizeTitle(item.title)

            // Exact slug match wins immediately
            if (refSlugs.has(itemSlug)) {
              matched = item
              break
            }

            // Fuzzy bigram similarity
            const score = Math.max(...refNorm.map(r => similarity(r, itemNorm)))
            if (score >= SIMILARITY_THRESHOLD) {
              matched = item
              break
            }
          }

          if (matched) break  // stop trying alt titles for this provider
        } catch { /* provider might be unavailable — skip */ }
      }

      if (matched) {
        log(`✅ Match on ${pid}: "${matched.title}" (id: ${matched.mangaId})`, 'success')
        linked.push({ providerId: pid, providerMangaId: matched.mangaId, title: matched.title })

        // Persist the series source link
        await upsertSeriesSource({
          series_id: series.id,
          provider_id: pid,
          provider_manga_id: matched.mangaId,
        })

        // Optionally sync chapter sources from this provider
        if (linkChapters) {
          try {
            log(`🔗 Syncing chapter sources from ${pid}…`)
            setContext(`provider:${pid}`)
            setProviderId(pid)

            const chapResult = await provider.instance.getChapters({ mangaId: matched.mangaId })
            const providerChaps: Array<{ chapId: string; chapNum: number; pubAt?: string; chapTitle?: string | null }> = (
              Array.isArray(chapResult) ? chapResult : []
            ).map((ch: any, i: number) => ({
              chapId: ch.chapterId ?? ch.id ?? ch.chapId ?? String(i),
              chapNum: parseFloat(ch.chapNum ?? ch.chapterNumber ?? ch.number ?? (i + 1)),
              pubAt: ch.publishDate ?? ch.time ?? ch.langAvailableAt ?? ch.date ?? undefined,
              chapTitle: ch.title ?? ch.name ?? null,
            }))

            // Load existing chapter IDs from DB
            const chapMap = await getChapterMap(series.id)

            // Fetch pages concurrently for ALL provider chapters (existing + new)
            const pageResults = new Map<number, PageEntry[]>()
            if (providerChaps.length > 0) {
              const CHAPTER_CONCURRENCY = 8
              const chapFetchQueue = [...providerChaps]
              const newCount = providerChaps.filter(c => !chapMap.has(c.chapNum)).length
              log(`  📄 Fetching ${providerChaps.length} chapters from ${pid} (${newCount} new, concurrency: ${CHAPTER_CONCURRENCY})…`)

              const chapWorker = async () => {
                while (true) {
                  const item = chapFetchQueue.shift()
                  if (!item) break
                  let pages: PageEntry[] = []
                  try {
                    setContext(`provider:${pid}`)
                    setProviderId(pid)
                    const pageData = await provider.instance.getChapterDetails({
                      chapterId: item.chapId,
                      sourceManga: { mangaId: matched.mangaId },
                    })
                    const urls: any[] = Array.isArray(pageData)
                      ? pageData
                      : pageData?.pages ?? pageData?.imageUrls ?? []
                    pages = urls.map((u: any) =>
                      typeof u === 'string' ? { url: u } : { url: u.url ?? u, referer: u.referer }
                    )
                  } catch { /* page fetch failed */ }
                  pageResults.set(item.chapNum, pages)
                }
              }

              await Promise.all(
                Array.from({ length: Math.min(CHAPTER_CONCURRENCY, providerChaps.length) }, chapWorker)
              )
            }

            // Insert chapters that are new (not yet in DB)
            const newChapItems = providerChaps.filter(c => !chapMap.has(c.chapNum))
            if (newChapItems.length > 0) {
              const newDbChapters: DbChapter[] = newChapItems.map(c => ({
                series_id: series.id,
                chapter_number: c.chapNum,
                title: c.chapTitle ?? undefined,
                pages: pageResults.get(c.chapNum) ?? [],
                published_at: c.pubAt ? new Date(c.pubAt).toISOString() : new Date().toISOString(),
              }))
              await upsertChapters(newDbChapters)
              log(`  ➕ ${newChapItems.length} new chapters added from ${pid}`, 'success')
              // Refresh chapMap so we have IDs for newly inserted chapters
              const freshMap = await getChapterMap(series.id)
              for (const [num, id] of freshMap) {
                if (!chapMap.has(num)) chapMap.set(num, id)
              }
            }

            // Link all chapters as sources (existing + newly inserted)
            const sources: DbChapterSource[] = []
            for (const item of providerChaps) {
              const dbChapterId = chapMap.get(item.chapNum)
              if (!dbChapterId) continue
              sources.push({
                chapter_id: dbChapterId,
                provider_id: pid,
                provider_chapter_id: item.chapId,
                pages: pageResults.get(item.chapNum) ?? [],
              })
            }

            if (sources.length > 0) {
              await upsertChapterSources(sources)
              log(`  ✅ ${sources.length} chapter sources linked from ${pid}`, 'success')
            }
          } catch (e: any) {
            log(`  ⚠ Chapter sync from ${pid} failed: ${e.message}`, 'warn')
          }
        }
      } else {
        log(`— ${pid}: no match found`)
      }
    }

    sse(res, 'done', {
      seriesId: series.id,
      slug: series.slug,
      linked,
      linkedCount: linked.length,
    })
  } catch (err: any) {
    log(`❌ Fatal: ${err.message}`, 'error')
    sse(res, 'error', { message: err.message })
  } finally {
    res.end()
  }
})
