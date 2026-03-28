import React, { useState, useRef, useEffect } from 'react'
import { Search, RefreshCw, Trash2, Link2, ExternalLink, ChevronLeft, ChevronRight, ImageOff } from 'lucide-react'
import { SeriesItem, LogEntry, LogType } from '../types'

const DB_LIMIT = 24

let logCounter = 0

function escHtml(s: unknown) {
  return String(s ?? '')
}

export default function DatabaseTab() {
  const [items, setItems] = useState<SeriesItem[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [showLog, setShowLog] = useState(false)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => { loadDatabase(1, '') }, [])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  function addLog(msg: string, type: LogType = 'info') {
    setShowLog(true)
    setLogs(prev => [...prev, { id: logCounter++, msg, type }])
  }

  async function loadDatabase(pg: number, q: string) {
    setLoading(true)
    setItems([])
    const params = new URLSearchParams({ page: String(pg), limit: String(DB_LIMIT) })
    if (q) params.set('search', q)
    try {
      const res = await fetch(`/api/scrape/series?${params}`)
      const data = await res.json() as { items: SeriesItem[]; total: number }
      const series = data.items ?? []
      const tot = data.total ?? 0
      setItems(series)
      setTotal(tot)
      setTotalPages(Math.max(1, Math.ceil(tot / DB_LIMIT)))
      setPage(pg)
    } catch (e: any) {
      addLog(`Error: ${e.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  function onSearchChange(q: string) {
    setSearch(q)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => loadDatabase(1, q), 350)
  }

  async function deleteItem(id: string, title: string) {
    if (!confirm(`Delete "${title}" from database? This will also remove all chapters.`)) return
    try {
      const res = await fetch(`/api/scrape/series/${id}`, { method: 'DELETE' })
      const data = await res.json() as any
      if (data.success) loadDatabase(page, search)
      else alert('Delete failed: ' + data.error)
    } catch (e: any) {
      alert('Delete error: ' + e.message)
    }
  }

  function copyLink(slug: string) {
    navigator.clipboard.writeText(`${location.origin}/manga/${slug}`).then(() => {
      const toast = document.createElement('div')
      toast.className = 'fixed bottom-4 right-4 bg-slate-800 border border-slate-700 text-xs text-slate-200 px-4 py-2 rounded-lg shadow-xl z-50'
      toast.textContent = `Copied: /manga/${slug}`
      document.body.appendChild(toast)
      setTimeout(() => toast.remove(), 2000)
    })
  }

  function findSources(seriesId: string, title: string) {
    addLog(`🔍 Searching all providers for "${title}"…`, 'info')
    fetch('/api/scrape/find-sources', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seriesId, linkChapters: true }),
    }).then(res => {
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      function pump() {
        reader.read().then(({ done, value }) => {
          if (done) return
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
              if (evt === 'log') addLog(parsed.msg, parsed.type ?? 'info')
              else if (evt === 'done') addLog(`✅ ${parsed.linkedCount} provider(s) linked for "${title}"`, 'success')
              else if (evt === 'error') addLog(`❌ ${parsed.message}`, 'error')
            } catch {}
          }
          pump()
        }).catch((e: any) => addLog(`❌ Stream error: ${e.message}`, 'error'))
      }
      pump()
    }).catch((e: any) => addLog(`❌ Find sources error: ${e.message}`, 'error'))
  }

  function rescrapeAll() {
    if (!confirm('Rescrape all series?\n\nThis will add new chapters only — existing chapter data is never overwritten.\nThis may take a long time for large libraries.')) return
    addLog('🔄 Starting rescrape of all series…', 'info')
    fetch('/api/scrape/rescrape-all', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scrapePages: true }),
    }).then(res => {
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      function pump() {
        reader.read().then(({ done, value }) => {
          if (done) return
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
              if (evt === 'log') addLog(parsed.msg, parsed.type ?? 'info')
              else if (evt === 'progress') setProgress({ current: parsed.current, total: parsed.total })
              else if (evt === 'done') {
                addLog(`✅ Done: ${parsed.processed} series processed, ${parsed.newChapters} new chapters added`, 'success')
                setProgress(null)
                loadDatabase(page, search)
              }
              else if (evt === 'error') addLog(`❌ ${parsed.message}`, 'error')
            } catch {}
          }
          pump()
        }).catch((e: any) => addLog(`❌ Stream error: ${e.message}`, 'error'))
      }
      pump()
    }).catch((e: any) => addLog(`❌ Rescrape error: ${e.message}`, 'error'))
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
          <input
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search database…"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-9 pr-3 py-2 text-sm placeholder-zinc-500 focus:outline-none focus:border-violet-500"
          />
        </div>
        <span className="text-xs text-zinc-500 whitespace-nowrap">{total !== null ? `${total} series` : '—'}</span>
        <button onClick={() => loadDatabase(page, search)} className="inline-flex items-center gap-1.5 text-xs px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
        <button onClick={rescrapeAll} className="inline-flex items-center gap-1.5 text-xs px-3 py-2 bg-zinc-800 hover:bg-violet-900/40 border border-zinc-700 hover:border-violet-600 text-zinc-300 hover:text-violet-300 rounded-lg transition">
          <RefreshCw className="w-3.5 h-3.5" /> Rescrape All
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          {Array(6).fill(0).map((_, i) => <div key={i} className="shimmer rounded-xl aspect-[3/4]" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          {items.length === 0 && (
            <p className="text-zinc-500 text-sm col-span-full text-center py-12">
              {search ? `No results for "${search}"` : 'No series in database yet.'}
            </p>
          )}
          {items.map(s => (
            <div key={s.id} className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition flex flex-col">
              <div className="aspect-[3/4] bg-zinc-800 overflow-hidden relative flex items-center justify-center">
                {s.cover_url ? (
                  <img
                    src={s.cover_url}
                    alt={s.title}
                    className="w-full h-full object-cover"
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                  />
                ) : (
                  <ImageOff className="w-8 h-8 text-zinc-600" />
                )}
                <span className="absolute top-1.5 left-1.5 text-[10px] px-1.5 py-0.5 rounded bg-zinc-900/80 text-zinc-300 border border-zinc-700">
                  {s.status ?? ''}
                </span>
              </div>
              <div className="p-2 flex-1 flex flex-col gap-1.5">
                <p className="text-xs font-medium text-zinc-200 line-clamp-2 leading-snug flex-1">{s.title}</p>
                <p className="text-[10px] text-zinc-500 truncate">{s.slug}</p>
                <div className="flex gap-1 mt-0.5">
                  <button onClick={() => copyLink(s.slug)} title="Copy link" className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-[10px] text-zinc-300 transition flex items-center justify-center">
                    <Link2 className="w-3 h-3" />
                  </button>
                  <button onClick={() => findSources(s.id, s.title)} title="Find & link other providers" className="flex-1 py-1.5 bg-zinc-800 hover:bg-violet-900/40 rounded text-[10px] text-violet-400 transition flex items-center justify-center">
                    <ExternalLink className="w-3 h-3" />
                  </button>
                  <button onClick={() => deleteItem(s.id, s.title)} title="Delete" className="flex-1 py-1.5 bg-zinc-800 hover:bg-red-900/40 rounded text-[10px] text-red-400 transition flex items-center justify-center">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && !loading && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            disabled={page <= 1}
            onClick={() => loadDatabase(page - 1, search)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4" /> Prev
          </button>
          <span className="text-sm text-zinc-400">Page {page} / {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => loadDatabase(page + 1, search)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition disabled:opacity-40"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Log / progress */}
      {showLog && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Log</h3>
            <button onClick={() => { setLogs([]); setProgress(null); setShowLog(false) }} className="text-xs text-zinc-600 hover:text-zinc-400">Clear</button>
          </div>
          {progress && (
            <div className="mb-3">
              <div className="flex justify-between text-xs text-zinc-500 mb-1">
                <span>Series ({progress.current} / {progress.total})</span>
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
                  l.type === 'error' ? 'text-red-400' : 'text-zinc-400'
                }
              >
                {l.msg}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
