import React, { useState, useRef, useEffect } from 'react'
import {
  Search, ChevronLeft, ChevronRight, X, Zap, Square,
  CheckCircle2, AlertCircle, Loader2, Clock, ImageOff,
  SlidersHorizontal, BookOpen,
} from 'lucide-react'
import { Provider, MangaItem, CardStatus, LogEntry, LogType } from '../types'

interface Props {
  providers: Provider[]
}

const CARD_STATUS_PREFIX = 'mangaice_cstat_'

function slugifyTitle(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// ── Card overlay ──────────────────────────────────────────────────────────────
function CardOverlay({ status }: { status: CardStatus | undefined }) {
  if (!status) return null
  if (status === 'pending') return (
    <div className="absolute inset-0 bg-black/50 pointer-events-none flex items-end justify-center pb-2">
      <span className="inline-flex items-center gap-1 bg-amber-500/90 text-white text-[10px] px-2 py-0.5 rounded-full font-medium">
        <Clock className="w-3 h-3" /> Queued
      </span>
    </div>
  )
  if (status === 'scraping') return (
    <div className="absolute inset-0 bg-black/60 pointer-events-none flex flex-col items-center justify-center gap-2">
      <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
      <span className="inline-flex items-center gap-1 bg-violet-600/90 text-white text-[10px] px-2 py-0.5 rounded-full font-medium">Scraping…</span>
    </div>
  )
  if (status === 'done') return (
    <div className="absolute inset-0 bg-black/40 pointer-events-none flex items-center justify-center">
      <div className="w-11 h-11 rounded-full bg-green-500/90 flex items-center justify-center">
        <CheckCircle2 className="w-6 h-6 text-white" />
      </div>
    </div>
  )
  if (status === 'error') return (
    <div className="absolute inset-0 bg-black/60 pointer-events-none flex flex-col items-center justify-center gap-2">
      <div className="w-11 h-11 rounded-full bg-red-500/90 flex items-center justify-center">
        <AlertCircle className="w-6 h-6 text-white" />
      </div>
      <span className="inline-block bg-red-600/90 text-white text-[10px] px-2 py-0.5 rounded-full font-medium">Error</span>
    </div>
  )
  return null
}

// ── Manga Card ────────────────────────────────────────────────────────────────
const MangaCard = React.memo(function MangaCard({
  item, status, onClick,
}: { item: MangaItem; status: CardStatus | undefined; onClick: () => void }) {
  const clickable = !status || (status !== 'done' && status !== 'scraping' && status !== 'pending')
  return (
    <div
      onClick={clickable ? onClick : undefined}
      className={`group relative rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 transition ${clickable ? 'cursor-pointer hover:border-violet-600' : 'cursor-default'}`}
    >
      <div className="aspect-[3/4] overflow-hidden bg-zinc-800 flex items-center justify-center">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <ImageOff className="w-8 h-8 text-zinc-600" />
        )}
      </div>
      <div className="p-2">
        <p className="text-xs font-medium text-zinc-200 line-clamp-2 leading-snug">{item.title}</p>
      </div>
      {clickable && (
        <div className="absolute inset-0 bg-violet-600/0 group-hover:bg-violet-600/10 transition-colors flex items-end justify-center pb-4 opacity-0 group-hover:opacity-100 pointer-events-none">
          <span className="bg-violet-600 text-white text-xs px-3 py-1.5 rounded-full font-medium shadow-lg">+ Add to DB</span>
        </div>
      )}
      <CardOverlay status={status} />
    </div>
  )
})

// ── Log Panel ─────────────────────────────────────────────────────────────────
function LogPanel({
  logs, progress, onClear,
}: {
  logs: LogEntry[]
  progress: { current: number; total: number } | null
  onClear: () => void
}) {
  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Progress</h3>
        <button onClick={onClear} className="text-xs text-zinc-600 hover:text-zinc-400">Clear</button>
      </div>
      {progress && (
        <div className="mb-3">
          <div className="flex justify-between text-xs text-zinc-500 mb-1">
            <span>Chapters ({progress.current} / {progress.total})</span>
            <span>{Math.round(progress.current / progress.total * 100)}%</span>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-2">
            <div
              className="bg-violet-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${Math.round(progress.current / progress.total * 100)}%` }}
            />
          </div>
        </div>
      )}
      <div
        ref={logRef}
        className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 font-mono text-xs space-y-0.5 max-h-56 overflow-y-auto"
      >
        {logs.map(l => (
          <div
            key={l.id}
            className={
              l.type === 'success' ? 'text-green-400' :
              l.type === 'warn' ? 'text-amber-400' :
              l.type === 'error' ? 'text-red-400' :
              'text-zinc-400'
            }
          >
            {l.msg}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Scrape Modal ──────────────────────────────────────────────────────────────
function ScrapeModal({
  item, providerName, onConfirm, onClose,
}: {
  item: MangaItem & { providerId: string }
  providerName: string
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-md">
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="font-semibold">Add to Database</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex gap-3">
            <img
              src={item.imageUrl || ''}
              alt={item.title}
              className="w-20 h-28 object-cover rounded-lg bg-zinc-800 flex-shrink-0"
            />
            <div className="min-w-0">
              <p className="font-medium text-sm leading-snug mb-1">{item.title}</p>
              <p className="text-xs text-zinc-500">ID: {item.mangaId}</p>
              <p className="text-xs text-zinc-500 mt-1">Provider: {providerName}</p>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={onConfirm}
              className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium transition flex items-center justify-center gap-2"
            >
              <Zap className="w-4 h-4" /> Scrape &amp; Add
            </button>
            <button onClick={onClose} className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main ScraperTab ───────────────────────────────────────────────────────────
let logCounter = 0

export default function ScraperTab({ providers }: Props) {
  const [filter, setFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchText, setSearchText] = useState('')
  const [items, setItems] = useState<MangaItem[]>([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [currentQuery, setCurrentQuery] = useState('')
  const [cardStatuses, setCardStatuses] = useState<Map<string, CardStatus>>(new Map())
  const [modal, setModal] = useState<(MangaItem & { providerId: string }) | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [showLog, setShowLog] = useState(false)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const [queueCount, setQueueCount] = useState(0)
  const [bulkActive, setBulkActive] = useState(false)
  const [scrapePages, setScrapePages] = useState(true)
  const [maxChapters, setMaxChapters] = useState('')

  const queueRef = useRef<(MangaItem & { providerId: string })[]>([])
  const workerActiveRef = useRef(false)
  const bulkRef = useRef(false)
  const bulkStopRef = useRef(false)
  const hasMoreRef = useRef(false)
  const currentPageRef = useRef(1)
  const currentQueryRef = useRef('')
  const selectedIdRef = useRef<string | null>(null)
  const scrapePagesRef = useRef(true)
  const maxChaptersRef = useRef('')

  useEffect(() => { hasMoreRef.current = hasMore }, [hasMore])
  useEffect(() => { currentPageRef.current = currentPage }, [currentPage])
  useEffect(() => { currentQueryRef.current = currentQuery }, [currentQuery])
  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])
  useEffect(() => { scrapePagesRef.current = scrapePages }, [scrapePages])
  useEffect(() => { maxChaptersRef.current = maxChapters }, [maxChapters])

  function addLog(msg: string, type: LogType = 'info') {
    setShowLog(true)
    setLogs(prev => [...prev, { id: logCounter++, msg, type }])
  }

  function setStatus(id: string, status: CardStatus) {
    setCardStatuses(prev => new Map(prev).set(id, status))
  }

  function saveCardStatus(providerId: string, statuses: Map<string, CardStatus>) {
    try {
      const o: Record<string, CardStatus> = {}
      for (const [k, v] of statuses) { if (v === 'done' || v === 'error') o[k] = v }
      sessionStorage.setItem(CARD_STATUS_PREFIX + providerId, JSON.stringify(o))
    } catch {}
  }

  function loadCardStatusFor(providerId: string): Map<string, CardStatus> {
    try {
      const r = sessionStorage.getItem(CARD_STATUS_PREFIX + providerId)
      if (r) {
        const o = JSON.parse(r) as Record<string, CardStatus>
        return new Map(Object.entries(o))
      }
    } catch {}
    return new Map()
  }

  async function checkExistingInDB(provId: string, newItems: MangaItem[]) {
    if (!newItems.length) return
    try {
      const slugs = newItems.map(i => slugifyTitle(i.title))
      const r = await fetch('/api/scrape/batch-exists', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slugs }),
      })
      const { found } = await r.json() as { found: string[] }
      const foundSet = new Set(found)
      setCardStatuses(prev => {
        const next = new Map(prev)
        newItems.forEach((item, i) => {
          if (foundSet.has(slugs[i]) && !next.has(item.mangaId)) {
            next.set(item.mangaId, 'done')
          }
        })
        saveCardStatus(provId, next)
        return next
      })
    } catch {}
  }

  async function fetchResults(query: string, page: number) {
    if (!selectedIdRef.current) return
    setLoading(true)
    try {
      const res = await fetch('/api/scrape/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: selectedIdRef.current, query, page }),
      })
      const data = await res.json() as any

      if (data.cloudflare || (data.error && String(data.error).toLowerCase().includes('cloudflare'))) {
        setItems([{ mangaId: '__cf__', title: 'Cloudflare bypass required — opening browser…', imageUrl: '' }])
        setHasMore(false)
        await triggerCFBypass(selectedIdRef.current!, query, page)
        return
      }
      if (data.error) {
        setItems([{ mangaId: '__err__', title: data.error, imageUrl: '' }])
        setHasMore(false)
        return
      }

      const newItems: MangaItem[] = data.items ?? []
      setItems(newItems)
      const more = !!(data.hasMore ?? (newItems.length >= 20))
      setHasMore(more)
      setCurrentPage(page)
      if (selectedIdRef.current) checkExistingInDB(selectedIdRef.current, newItems)
    } catch (e: any) {
      setItems([{ mangaId: '__err__', title: `Error: ${e.message}`, imageUrl: '' }])
    } finally {
      setLoading(false)
    }
  }

  async function triggerCFBypass(providerId: string, query: string, page: number) {
    try {
      const res = await fetch(`/api/providers/${providerId}/cloudflare/bypass`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeout: 300 }),
      })
      const data = await res.json() as any
      if (data.success) await fetchResults(query, page)
    } catch {}
  }

  function selectProvider(id: string) {
    setSelectedId(id)
    selectedIdRef.current = id
    setCardStatuses(loadCardStatusFor(id))
    setCurrentPage(1)
    setCurrentQuery('')
    setSearchText('')
    setItems([])
    setHasMore(false)
    currentPageRef.current = 1
    currentQueryRef.current = ''
    setLoading(true)
    fetchResults('', 1)
  }

  async function doSearch() {
    if (!selectedId) return
    const q = searchText.trim()
    setCurrentQuery(q)
    currentQueryRef.current = q
    setCurrentPage(1)
    currentPageRef.current = 1
    setLoading(true)
    await fetchResults(q, 1)
  }

  async function runScrapeItem(item: MangaItem & { providerId: string }) {
    addLog(`Scraping "${item.title}" (${item.providerId})`, 'info')
    const maxChap = parseInt(maxChaptersRef.current) || null
    const body = {
      providerId: item.providerId,
      mangaId: item.mangaId,
      scrapePages: scrapePagesRef.current,
      maxChapters: maxChap,
    }
    return new Promise<void>((resolve, reject) => {
      fetch('/api/scrape/series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(res => {
        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        function pump() {
          reader.read().then(({ done, value }) => {
            if (done) { resolve(); return }
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
                const parsed = JSON.parse(data) as any
                if (evt === 'done') { handleSSEDone(parsed); resolve() }
                else if (evt === 'error') reject(new Error(parsed.message))
                else handleSSEEvent(evt, parsed)
              } catch {}
            }
            pump()
          }).catch(reject)
        }
        pump()
      }).catch(reject)
    })
  }

  function handleSSEEvent(event: string, data: any) {
    if (event === 'log') addLog(data.msg, data.type)
    else if (event === 'chapters_count') setProgress({ current: 0, total: data.count })
    else if (event === 'progress') setProgress({ current: data.current, total: data.total })
  }

  function handleSSEDone(data: any) {
    setProgress({ current: data.chaptersCount ?? 1, total: data.chaptersCount ?? 1 })
    addLog(`Done! ${data.chaptersCount} chapters, ${data.pagesTotal} pages`, 'success')
    addLog(`Slug: ${data.slug} | ID: ${data.seriesId}`, 'success')
  }

  async function processQueue() {
    workerActiveRef.current = true
    while (queueRef.current.length > 0) {
      const item = queueRef.current.shift()!
      setQueueCount(queueRef.current.length)
      setStatus(item.mangaId, 'scraping')
      try {
        await runScrapeItem(item)
        setStatus(item.mangaId, 'done')
        if (selectedIdRef.current) {
          setCardStatuses(prev => {
            const next = new Map(prev).set(item.mangaId, 'done')
            saveCardStatus(selectedIdRef.current!, next)
            return next
          })
        }
      } catch (e: any) {
        setStatus(item.mangaId, 'error')
        if (selectedIdRef.current) {
          setCardStatuses(prev => {
            const next = new Map(prev).set(item.mangaId, 'error')
            saveCardStatus(selectedIdRef.current!, next)
            return next
          })
        }
        addLog(`"${item.title}": ${e.message}`, 'error')
      }
      setQueueCount(queueRef.current.length)

      if (bulkRef.current && !bulkStopRef.current && queueRef.current.length === 0 && hasMoreRef.current) {
        await loadNextBulkPage()
      }
    }
    workerActiveRef.current = false
    setQueueCount(0)
    if (bulkRef.current) {
      bulkRef.current = false
      bulkStopRef.current = false
      setBulkActive(false)
      addLog('Scrape All complete!', 'success')
    }
  }

  function enqueue(item: MangaItem & { providerId: string }) {
    const st = cardStatuses.get(item.mangaId)
    if (st === 'done' || st === 'scraping' || st === 'pending') return
    setStatus(item.mangaId, 'pending')
    queueRef.current.push(item)
    setQueueCount(queueRef.current.length)
    if (!workerActiveRef.current) processQueue()
  }

  async function loadNextBulkPage() {
    if (bulkStopRef.current || !hasMoreRef.current) return
    const nextPage = currentPageRef.current + 1
    addLog(`Bulk: loading page ${nextPage}…`, 'info')
    setLoading(true)
    await fetchResults(currentQueryRef.current, nextPage)
  }

  function startScrapeAll() {
    if (!selectedId) return
    bulkRef.current = true
    bulkStopRef.current = false
    setBulkActive(true)
    setCardStatuses(prev => {
      let queued = 0
      items.forEach(item => {
        if (item.mangaId.startsWith('__')) return
        const st = prev.get(item.mangaId)
        if (st !== 'done' && st !== 'scraping' && st !== 'pending') {
          queueRef.current.push({ ...item, providerId: selectedId })
          queued++
        }
      })
      addLog(`Scrape All: queued ${queued} items (page ${currentPage})`, 'info')
      setQueueCount(queueRef.current.length)
      if (!workerActiveRef.current) processQueue()
      return prev
    })
  }

  function stopScrapeAll() {
    bulkStopRef.current = true
    bulkRef.current = false
    setBulkActive(false)
    addLog('Scrape All stopped by user.', 'warn')
  }

  const filteredProviders = filter
    ? providers.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()) || p.repoId.toLowerCase().includes(filter.toLowerCase()))
    : providers

  const selectedProvider = providers.find(p => p.id === selectedId)

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr] gap-6">
      {/* Provider Sidebar */}
      <aside>
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">Providers</h2>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter providers…"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-8 pr-3 py-2 text-sm placeholder-zinc-500 focus:outline-none focus:border-violet-500"
          />
        </div>
        <div className="space-y-1.5 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
          {filteredProviders.length === 0 && providers.length === 0 && (
            <>
              <div className="shimmer rounded-lg h-12 mb-1" />
              <div className="shimmer rounded-lg h-12 mb-1" />
              <div className="shimmer rounded-lg h-12" />
            </>
          )}
          {filteredProviders.map(p => (
            <button
              key={p.id}
              onClick={() => selectProvider(p.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg border transition flex items-center gap-2.5 ${
                p.id === selectedId
                  ? 'bg-zinc-800 border-violet-500/60'
                  : 'bg-zinc-900 border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/70'
              }`}
            >
              <div className="w-8 h-8 rounded-md bg-gradient-to-br from-violet-900/60 to-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-300 flex-shrink-0">
                {p.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-200 truncate">{p.name}</p>
                <p className="text-xs text-zinc-500">{p.repoId} · v{p.version}</p>
              </div>
              {p.cloudflareEnabled && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 bg-amber-500/20 text-amber-300 border border-amber-500/40">CF</span>
              )}
            </button>
          ))}
        </div>
      </aside>

      {/* Main Content */}
      <main className="space-y-5 min-w-0">
        {selectedId ? (
          <>
            {/* Search bar */}
            <div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                  <input
                    value={searchText}
                    onChange={e => setSearchText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') doSearch() }}
                    placeholder="Browse or search manga title…"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-9 pr-4 py-2.5 text-sm placeholder-zinc-500 focus:outline-none focus:border-violet-500"
                  />
                </div>
                <button
                  onClick={doSearch}
                  className="px-5 py-2.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium transition"
                >
                  Search
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span className="text-zinc-300 font-medium">{selectedProvider?.name}</span>
                <div className="ml-auto flex items-center gap-2 flex-wrap">
                  {(queueCount > 0 || workerActiveRef.current) && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-medium">
                      <Clock className="w-3 h-3" /> {queueCount + (workerActiveRef.current ? 1 : 0)} queued
                    </span>
                  )}
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={scrapePages}
                      onChange={e => setScrapePages(e.target.checked)}
                      className="rounded accent-violet-500"
                    />
                    Scrape pages
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    Max chapters:
                    <input
                      type="number"
                      value={maxChapters}
                      onChange={e => setMaxChapters(e.target.value)}
                      placeholder="all"
                      min="1"
                      className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs focus:outline-none focus:border-violet-500"
                    />
                  </label>
                  {!bulkActive ? (
                    <button
                      onClick={startScrapeAll}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600/20 hover:bg-green-600/30 border border-green-600/40 text-green-300 rounded-lg text-xs font-medium transition"
                    >
                      <Zap className="w-3.5 h-3.5" /> Scrape All
                    </button>
                  ) : (
                    <button
                      onClick={stopScrapeAll}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 border border-red-600/40 text-red-300 rounded-lg text-xs font-medium transition"
                    >
                      <Square className="w-3.5 h-3.5" /> Stop
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Results grid */}
            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {Array(10).fill(0).map((_, i) => (
                  <div key={i} className="shimmer rounded-xl aspect-[3/4]" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {items.length === 0 && (
                  <div className="col-span-full flex flex-col items-center justify-center py-16 gap-3 text-zinc-600">
                    <BookOpen className="w-10 h-10" />
                    <p className="text-sm">No results found.</p>
                  </div>
                )}
                {items.map(item => (
                  item.mangaId.startsWith('__')
                    ? <p key={item.mangaId} className="text-amber-400 text-sm col-span-full text-center py-8">{item.title}</p>
                    : <MangaCard
                        key={item.mangaId}
                        item={item}
                        status={cardStatuses.get(item.mangaId)}
                        onClick={() => setModal({ ...item, providerId: selectedId })}
                      />
                ))}
              </div>
            )}

            {/* Pagination */}
            {(currentPage > 1 || hasMore) && !loading && (
              <div className="flex items-center justify-center gap-3">
                <button
                  disabled={currentPage <= 1}
                  onClick={() => fetchResults(currentQuery, currentPage - 1)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4" /> Prev
                </button>
                <span className="text-sm text-zinc-400">Page {currentPage}</span>
                <button
                  disabled={!hasMore}
                  onClick={() => fetchResults(currentQuery, currentPage + 1)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition disabled:opacity-40"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Log panel */}
            {showLog && (
              <LogPanel
                logs={logs}
                progress={progress}
                onClear={() => { setLogs([]); setProgress(null); setShowLog(false) }}
              />
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-zinc-600">
            <SlidersHorizontal className="w-10 h-10" />
            <p className="text-sm">Select a provider to get started</p>
          </div>
        )}
      </main>

      {/* Modal */}
      {modal && (
        <ScrapeModal
          item={modal}
          providerName={providers.find(p => p.id === modal.providerId)?.name ?? modal.providerId}
          onConfirm={() => { enqueue(modal); setModal(null) }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
