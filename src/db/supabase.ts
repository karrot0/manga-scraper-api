/**
 * supabase.ts — Supabase service-role client (bypasses RLS).
 * Used only server-side from the scrape routes.
 */

import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables')
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
})

// ---------------------------------------------------------------------------
// Types mirroring the DB schema
// ---------------------------------------------------------------------------

export interface DbSeries {
  id?: string
  slug: string
  title: string
  alt_titles?: string[]
  description?: string
  cover_url?: string
  status?: string      // 'ongoing' | 'completed' | 'hiatus' | 'cancelled'
  type?: string        // 'manga' | 'manhwa' | 'manhua' | 'novel'
  genres?: string[]
  author?: string
  artist?: string
  year?: number
}

export interface DbChapter {
  series_id: string
  chapter_number: number
  volume_number?: number
  title?: string
  pages: PageEntry[]
  published_at?: string   // ISO string
  translated?: boolean
}

export interface DbSeriesSource {
  series_id: string
  provider_id: string
  provider_manga_id: string
}

export interface DbChapterSource {
  chapter_id: string
  provider_id: string
  provider_chapter_id: string
  pages: PageEntry[]
}

export interface PageEntry {
  url: string
  /** Some providers require a Referer header to load images */
  referer?: string
}

/**
 * Slugify a title into a URL-safe lowercase string.
 * e.g. "One Piece!" → "one-piece"
 */
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Upsert a series by slug and return the persisted row (with id).
 */
export async function upsertSeries(data: DbSeries): Promise<{ id: string; slug: string }> {
  const { data: row, error } = await supabase
    .from('series')
    .upsert(data, { onConflict: 'slug' })
    .select('id, slug')
    .single()

  if (error) throw new Error(`upsertSeries failed: ${error.message}`)
  return row as { id: string; slug: string }
}

/**
 * Upsert a batch of chapters for a series.
 * Uses (series_id, chapter_number) as the conflict key.
 *
 * PostgreSQL raises "ON CONFLICT DO UPDATE command cannot affect row a second time"
 * when the same conflict key appears more than once in a single upsert batch.
 * We deduplicate before sending (last entry for a given key wins).
 */
export async function upsertChapters(chapters: DbChapter[]): Promise<number> {
  if (chapters.length === 0) return 0

  // Deduplicate by (series_id, chapter_number) — last occurrence wins
  const seen = new Map<string, DbChapter>()
  for (const ch of chapters) {
    seen.set(`${ch.series_id}:${ch.chapter_number}`, ch)
  }
  const deduped = [...seen.values()]

  const { error, count } = await supabase
    .from('chapters')
    .upsert(deduped, { onConflict: 'series_id,chapter_number' })
    .select('id')

  if (error) throw new Error(`upsertChapters failed: ${error.message}`)
  return count ?? deduped.length
}

/**
 * Record (or update) that a provider supplies a given series.
 * Conflict key: (series_id, provider_id).
 */
export async function upsertSeriesSource(source: DbSeriesSource): Promise<void> {
  const { error } = await supabase
    .from('series_sources')
    .upsert(source, { onConflict: 'series_id,provider_id' })
  if (error) throw new Error(`upsertSeriesSource failed: ${error.message}`)
}

/**
 * Record (or update) that a provider supplies pages for a given chapter.
 * Conflict key: (chapter_id, provider_id).
 */
export async function upsertChapterSource(source: DbChapterSource): Promise<void> {
  const { error } = await supabase
    .from('chapter_sources')
    .upsert(source, { onConflict: 'chapter_id,provider_id' })
  if (error) throw new Error(`upsertChapterSource failed: ${error.message}`)
}

/**
 * Batch-upsert chapter sources.
 * Deduplicates by (chapter_id, provider_id) before sending.
 */
export async function upsertChapterSources(sources: DbChapterSource[]): Promise<void> {
  if (sources.length === 0) return
  const seen = new Map<string, DbChapterSource>()
  for (const s of sources) seen.set(`${s.chapter_id}:${s.provider_id}`, s)
  const deduped = [...seen.values()]
  const { error } = await supabase
    .from('chapter_sources')
    .upsert(deduped, { onConflict: 'chapter_id,provider_id' })
  if (error) throw new Error(`upsertChapterSources failed: ${error.message}`)
}

/**
 * Return all chapter rows (id + chapter_number) for a series.
 * Used by find-sources to map provider chapters onto existing DB chapters.
 */
export async function getChapterMap(seriesId: string): Promise<Map<number, string>> {
  const { data, error } = await supabase
    .from('chapters')
    .select('id, chapter_number')
    .eq('series_id', seriesId)
  if (error) throw new Error(`getChapterMap failed: ${error.message}`)
  const map = new Map<number, string>()
  for (const row of data ?? []) map.set(Number(row.chapter_number), row.id)
  return map
}
