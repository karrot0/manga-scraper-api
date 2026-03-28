import React, { useState, useEffect } from 'react'
import { Search, Database, Shield, RefreshCw, Code2, BookOpen } from 'lucide-react'
import { Provider } from './types'
import ScraperTab from './components/ScraperTab'
import DatabaseTab from './components/DatabaseTab'
import CloudflareTab from './components/CloudflareTab'
import ApiExplorerTab from './components/ApiExplorerTab'

type Tab = 'scraper' | 'database' | 'cloudflare' | 'api'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'scraper',    label: 'Scraper',    icon: <Search size={15} /> },
  { id: 'database',  label: 'Database',   icon: <Database size={15} /> },
  { id: 'cloudflare',label: 'Cloudflare', icon: <Shield size={15} /> },
  { id: 'api',       label: 'API',        icon: <Code2 size={15} /> },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('scraper')
  const [providers, setProviders] = useState<Provider[]>([])
  const [updateLabel, setUpdateLabel] = useState('Update')
  const [updating, setUpdating] = useState(false)

  useEffect(() => { loadProviders() }, [])

  async function loadProviders() {
    try {
      const res = await fetch('/api/providers')
      setProviders(await res.json())
    } catch {}
  }

  async function updateExtensions() {
    setUpdating(true)
    setUpdateLabel('Updating…')
    try {
      const res = await fetch('/api/extensions/update', { method: 'POST' })
      const data = await res.json()
      setUpdateLabel(`✓ ${data.loaded} loaded`)
      setTimeout(() => { setUpdateLabel('Update'); setUpdating(false) }, 3000)
      await loadProviders()
    } catch {
      setUpdateLabel('Error')
      setUpdating(false)
    }
  }

  return (
    <div className="bg-zinc-950 text-zinc-100 min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900 sticky top-0 z-50 h-14 flex items-center px-5 gap-4">
        <div className="flex items-center gap-2.5 mr-4">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center">
            <BookOpen size={14} className="text-white" />
          </div>
          <span className="font-semibold text-sm tracking-tight text-zinc-100">
            Manga <span className="text-brand-400">Scraper</span> API
          </span>
        </div>

        {/* Tabs inside header */}
        <nav className="flex items-center gap-1 flex-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === t.id
                  ? 'bg-brand-600/30 text-brand-300 border border-brand-500/40'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500 tabular-nums">
            {providers.length > 0 ? `${providers.length} providers` : '—'}
          </span>
          <button
            disabled={updating}
            onClick={updateExtensions}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition disabled:opacity-50 border border-zinc-700"
          >
            <RefreshCw size={12} className={updating ? 'animate-spin' : ''} />
            {updateLabel}
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-screen-2xl w-full mx-auto px-5 py-5">
        {tab === 'scraper'    && <ScraperTab providers={providers} />}
        {tab === 'database'  && <DatabaseTab />}
        {tab === 'cloudflare'&& <CloudflareTab providers={providers} />}
        {tab === 'api'       && <ApiExplorerTab providers={providers} />}
      </main>
    </div>
  )
}
