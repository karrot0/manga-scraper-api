import React, { useState, useRef } from 'react'
import { Send, ChevronRight, Loader2, Copy, CheckCheck, ChevronDown, ChevronUp } from 'lucide-react'
import { Provider } from '../types'

// ── Types ─────────────────────────────────────────────────────────────────────
type HttpMethod = 'GET' | 'POST' | 'DELETE'

interface ApiParam {
  name: string
  description?: string
  required?: boolean
  default?: string
  type?: 'string' | 'number' | 'boolean' | 'json'
}

interface ApiEndpoint {
  id: string
  method: HttpMethod
  path: string
  description: string
  pathParams?: string[]          // names of :param segments
  queryParams?: ApiParam[]
  body?: ApiParam[]
  streaming?: boolean
}

interface EndpointGroup {
  label: string
  endpoints: ApiEndpoint[]
}

// ── Endpoint catalogue ────────────────────────────────────────────────────────
const GROUPS: EndpointGroup[] = [
  {
    label: 'Providers',
    endpoints: [
      {
        id: 'list-providers',
        method: 'GET',
        path: '/api/providers',
        description: 'List all loaded providers',
      },
      {
        id: 'update-extensions',
        method: 'POST',
        path: '/api/extensions/update',
        description: 'Pull & reload all extensions',
      },
    ],
  },
  {
    label: 'Search',
    endpoints: [
      {
        id: 'search',
        method: 'GET',
        path: '/api/providers/:id/search',
        description: 'Search manga on a provider',
        pathParams: ['id'],
        queryParams: [
          { name: 'query', description: 'Search term', required: true },
          { name: 'page', description: 'Page number', default: '1', type: 'number' },
        ],
      },
      {
        id: 'search-filters',
        method: 'GET',
        path: '/api/providers/:id/search/filters',
        description: 'Available search filters',
        pathParams: ['id'],
      },
      {
        id: 'search-sorting',
        method: 'GET',
        path: '/api/providers/:id/search/sorting',
        description: 'Available sorting options',
        pathParams: ['id'],
      },
    ],
  },
  {
    label: 'Manga',
    endpoints: [
      {
        id: 'manga-details',
        method: 'GET',
        path: '/api/providers/:id/manga/*',
        description: 'Manga metadata (pass full manga path after /manga/)',
        pathParams: ['id'],
      },
      {
        id: 'chapters',
        method: 'GET',
        path: '/api/providers/:id/chapters',
        description: 'Chapter list for a manga',
        pathParams: ['id'],
        queryParams: [
          { name: 'mangaId', description: 'Manga ID from provider', required: true },
        ],
      },
      {
        id: 'chapter-details',
        method: 'GET',
        path: '/api/providers/:id/chapter-details',
        description: 'Page URLs for a chapter',
        pathParams: ['id'],
        queryParams: [
          { name: 'chapterId', description: 'Chapter ID from provider', required: true },
        ],
      },
    ],
  },
  {
    label: 'Discover',
    endpoints: [
      {
        id: 'discover',
        method: 'GET',
        path: '/api/providers/:id/discover',
        description: 'Homepage discovery sections',
        pathParams: ['id'],
      },
      {
        id: 'discover-section',
        method: 'GET',
        path: '/api/providers/:id/discover/:sectionId/items',
        description: 'Items for a discover section',
        pathParams: ['id', 'sectionId'],
      },
    ],
  },
  {
    label: 'Cloudflare',
    endpoints: [
      {
        id: 'cf-request',
        method: 'GET',
        path: '/api/providers/:id/cloudflare/request',
        description: 'Test a request through CF cookies',
        pathParams: ['id'],
        queryParams: [{ name: 'url', description: 'URL to fetch', required: true }],
      },
      {
        id: 'cf-bypass',
        method: 'POST',
        path: '/api/providers/:id/cloudflare/bypass',
        description: 'Open browser to bypass CF (SSE)',
        pathParams: ['id'],
        body: [{ name: 'timeout', description: 'Seconds to wait', default: '300', type: 'number' }],
      },
      {
        id: 'cf-cookies-post',
        method: 'POST',
        path: '/api/providers/:id/cloudflare/cookies',
        description: 'Save cookies manually',
        pathParams: ['id'],
        body: [{ name: 'cookies', description: 'Cookie array (JSON)', required: true, type: 'json' }],
      },
      {
        id: 'cf-cookies-get',
        method: 'GET',
        path: '/api/providers/:id/cloudflare/cookies',
        description: 'Get saved cookies',
        pathParams: ['id'],
      },
      {
        id: 'cf-cookies-delete',
        method: 'DELETE',
        path: '/api/providers/:id/cloudflare/cookies',
        description: 'Clear saved cookies',
        pathParams: ['id'],
      },
    ],
  },
  {
    label: 'Scrape',
    endpoints: [
      {
        id: 'scrape-preview',
        method: 'POST',
        path: '/api/scrape/preview',
        description: 'Preview search results',
        body: [
          { name: 'providerId', required: true },
          { name: 'query', default: '' },
          { name: 'page', default: '1', type: 'number' },
        ],
      },
      {
        id: 'scrape-series',
        method: 'POST',
        path: '/api/scrape/series',
        description: 'Scrape & add a series (SSE)',
        streaming: true,
        body: [
          { name: 'providerId', required: true },
          { name: 'mangaId', required: true },
          { name: 'scrapePages', default: 'true', type: 'boolean' },
          { name: 'maxChapters', description: 'Limit chapters', type: 'number' },
        ],
      },
      {
        id: 'scrape-exists',
        method: 'GET',
        path: '/api/scrape/exists/:slug',
        description: 'Check if a slug exists in DB',
        pathParams: ['slug'],
      },
      {
        id: 'batch-exists',
        method: 'POST',
        path: '/api/scrape/batch-exists',
        description: 'Batch slug existence check',
        body: [{ name: 'slugs', description: 'Array of slugs (JSON)', required: true, type: 'json' }],
      },
      {
        id: 'list-series',
        method: 'GET',
        path: '/api/scrape/series',
        description: 'Paginated list of series in DB',
        queryParams: [
          { name: 'page', default: '1', type: 'number' },
          { name: 'limit', default: '24', type: 'number' },
          { name: 'search' },
        ],
      },
      {
        id: 'rescrape-all',
        method: 'POST',
        path: '/api/scrape/rescrape-all',
        description: 'Rescrape all series for new chapters (SSE)',
        streaming: true,
        body: [{ name: 'scrapePages', default: 'true', type: 'boolean' }],
      },
      {
        id: 'delete-series',
        method: 'DELETE',
        path: '/api/scrape/series/:id',
        description: 'Delete a series from DB',
        pathParams: ['id'],
      },
      {
        id: 'find-sources',
        method: 'POST',
        path: '/api/scrape/find-sources',
        description: 'Find & link provider sources (SSE)',
        streaming: true,
        body: [
          { name: 'seriesId', required: true },
          { name: 'linkChapters', default: 'true', type: 'boolean' },
        ],
      },
    ],
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
const METHOD_CLASSES: Record<HttpMethod, string> = {
  GET: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  POST: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  DELETE: 'bg-red-500/20 text-red-300 border border-red-500/30',
}

function MethodBadge({ method }: { method: HttpMethod }) {
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${METHOD_CLASSES[method]}`}>
      {method}
    </span>
  )
}

function buildUrl(endpoint: ApiEndpoint, pathValues: Record<string, string>, queryValues: Record<string, string>): string {
  let path = endpoint.path
  for (const [k, v] of Object.entries(pathValues)) {
    path = path.replace(`:${k}`, encodeURIComponent(v))
  }
  if (endpoint.queryParams?.length) {
    const qs = new URLSearchParams()
    for (const p of endpoint.queryParams) {
      const v = queryValues[p.name]
      if (v) qs.set(p.name, v)
    }
    const s = qs.toString()
    if (s) path += '?' + s
  }
  return path
}

function buildBody(endpoint: ApiEndpoint, bodyValues: Record<string, string>): string | null {
  if (!endpoint.body?.length) return null
  const obj: Record<string, unknown> = {}
  for (const p of endpoint.body) {
    const v = bodyValues[p.name] ?? p.default ?? ''
    if (!v && !p.required) continue
    if (p.type === 'number') obj[p.name] = Number(v)
    else if (p.type === 'boolean') obj[p.name] = v === 'true' || v === '1'
    else if (p.type === 'json') {
      try { obj[p.name] = JSON.parse(v) } catch { obj[p.name] = v }
    } else obj[p.name] = v
  }
  return JSON.stringify(obj)
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  providers: Provider[]
}

export default function ApiExplorerTab({ providers }: Props) {
  const [selectedId, setSelectedId] = useState<string>(GROUPS[0].endpoints[0].id)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(GROUPS.map(g => g.label)))
  const [pathValues, setPathValues] = useState<Record<string, string>>({})
  const [queryValues, setQueryValues] = useState<Record<string, string>>({})
  const [bodyValues, setBodyValues] = useState<Record<string, string>>({})
  const [providerId, setProviderId] = useState('')
  const [response, setResponse] = useState<string | null>(null)
  const [status, setStatus] = useState<number | null>(null)
  const [latency, setLatency] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const endpoint = GROUPS.flatMap(g => g.endpoints).find(e => e.id === selectedId)!

  function selectEndpoint(id: string) {
    setSelectedId(id)
    setPathValues({})
    setQueryValues({})
    setBodyValues({})
    setResponse(null)
    setStatus(null)
    setLatency(null)
  }

  function toggleGroup(label: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label); else next.add(label)
      return next
    })
  }

  function effectivePath(ep: ApiEndpoint): string {
    const effective = { ...pathValues }
    if (ep.pathParams?.includes('id') && !effective['id'] && providerId) {
      effective['id'] = providerId
    }
    return buildUrl(ep, effective, queryValues)
  }

  async function sendRequest() {
    if (!endpoint) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    const path = effectivePath(endpoint)
    const body = buildBody(endpoint, bodyValues)

    setLoading(true)
    setResponse(null)
    setStatus(null)
    setLatency(null)

    const t0 = performance.now()
    try {
      const res = await fetch(path, {
        method: endpoint.method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ?? undefined,
        signal: ctrl.signal,
      })
      const ms = Math.round(performance.now() - t0)
      setStatus(res.status)
      setLatency(ms)

      if (endpoint.streaming) {
        const reader = res.body!.getReader()
        const dec = new TextDecoder()
        let out = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          out += dec.decode(value, { stream: true })
          setResponse(out)
        }
      } else {
        const text = await res.text()
        try {
          setResponse(JSON.stringify(JSON.parse(text), null, 2))
        } catch {
          setResponse(text)
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setResponse(`Error: ${e.message}`)
        setStatus(0)
        setLatency(Math.round(performance.now() - t0))
      }
    } finally {
      setLoading(false)
    }
  }

  function copyResponse() {
    if (!response) return
    navigator.clipboard.writeText(response).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const needsProviderId = endpoint?.pathParams?.includes('id') || endpoint?.pathParams?.includes('sectionId')

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-0 min-h-[calc(100vh-120px)] border border-zinc-800 rounded-xl overflow-hidden">
      {/* Sidebar */}
      <div className="border-r border-zinc-800 bg-zinc-950 overflow-y-auto">
        {GROUPS.map(group => (
          <div key={group.label}>
            <button
              onClick={() => toggleGroup(group.label)}
              className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-widest hover:bg-zinc-900 transition"
            >
              {group.label}
              {expandedGroups.has(group.label)
                ? <ChevronUp className="w-3 h-3" />
                : <ChevronDown className="w-3 h-3" />
              }
            </button>
            {expandedGroups.has(group.label) && group.endpoints.map(ep => (
              <button
                key={ep.id}
                onClick={() => selectEndpoint(ep.id)}
                className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition ${
                  ep.id === selectedId
                    ? 'bg-violet-600/15 border-r-2 border-violet-500'
                    : 'hover:bg-zinc-900'
                }`}
              >
                <MethodBadge method={ep.method} />
                <span className="text-xs text-zinc-300 truncate font-mono">
                  {ep.path.replace('/api/providers/:id', '').replace('/api/scrape', '/scrape').replace('/api/', '/') || '/'}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Detail panel */}
      <div className="flex flex-col bg-zinc-950 overflow-y-auto">
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-800">
          <div className="flex items-start gap-3 flex-wrap">
            <MethodBadge method={endpoint.method} />
            <code className="text-sm text-zinc-100 font-mono break-all">{effectivePath(endpoint)}</code>
            {endpoint.streaming && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30 font-medium">SSE</span>
            )}
          </div>
          <p className="text-xs text-zinc-500 mt-1">{endpoint.description}</p>
        </div>

        {/* Params form */}
        <div className="px-5 py-4 space-y-5 flex-1">
          {/* Provider selector (when :id path param present) */}
          {needsProviderId && (
            <div>
              <label className="text-xs font-semibold text-zinc-500 uppercase tracking-widest block mb-2">Provider</label>
              <select
                value={providerId}
                onChange={e => setProviderId(e.target.value)}
                className="w-full max-w-sm bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-violet-500"
              >
                <option value="">— select provider —</option>
                {providers.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                ))}
              </select>
            </div>
          )}

          {/* Other path params */}
          {endpoint.pathParams?.filter(p => p !== 'id').map(p => (
            <div key={p}>
              <label className="text-xs font-semibold text-zinc-500 uppercase tracking-widest block mb-2">
                :{p} <span className="text-red-400">*</span>
              </label>
              <input
                value={pathValues[p] ?? ''}
                onChange={e => setPathValues(prev => ({ ...prev, [p]: e.target.value }))}
                placeholder={p}
                className="w-full max-w-sm bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-violet-500"
              />
            </div>
          ))}

          {/* Query params */}
          {endpoint.queryParams && endpoint.queryParams.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-zinc-500 uppercase tracking-widest block mb-2">Query Parameters</label>
              <div className="space-y-2">
                {endpoint.queryParams.map(p => (
                  <div key={p.name} className="flex items-center gap-3">
                    <span className="text-xs font-mono text-zinc-400 w-32 flex-shrink-0">
                      {p.name}{p.required && <span className="text-red-400"> *</span>}
                    </span>
                    <input
                      value={queryValues[p.name] ?? p.default ?? ''}
                      onChange={e => setQueryValues(prev => ({ ...prev, [p.name]: e.target.value }))}
                      placeholder={p.description ?? p.name}
                      className="flex-1 max-w-sm bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-violet-500"
                    />
                    {p.description && <span className="text-xs text-zinc-600 hidden sm:block">{p.description}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Body params */}
          {endpoint.body && endpoint.body.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-zinc-500 uppercase tracking-widest block mb-2">Body</label>
              <div className="space-y-2">
                {endpoint.body.map(p => (
                  <div key={p.name} className="flex items-center gap-3">
                    <span className="text-xs font-mono text-zinc-400 w-32 flex-shrink-0">
                      {p.name}{p.required && <span className="text-red-400"> *</span>}
                    </span>
                    {p.type === 'json' ? (
                      <textarea
                        value={bodyValues[p.name] ?? p.default ?? ''}
                        onChange={e => setBodyValues(prev => ({ ...prev, [p.name]: e.target.value }))}
                        placeholder={p.description ?? `JSON value for ${p.name}`}
                        rows={3}
                        className="flex-1 max-w-sm bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-violet-500 resize-y"
                      />
                    ) : (
                      <input
                        value={bodyValues[p.name] ?? p.default ?? ''}
                        onChange={e => setBodyValues(prev => ({ ...prev, [p.name]: e.target.value }))}
                        placeholder={p.description ?? p.default ?? p.name}
                        className="flex-1 max-w-sm bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-violet-500"
                      />
                    )}
                    {p.description && <span className="text-xs text-zinc-600 hidden sm:block">{p.description}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Send button */}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={sendRequest}
              disabled={loading}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-60 rounded-lg text-sm font-medium transition"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {loading ? 'Sending…' : 'Send Request'}
            </button>
            {loading && (
              <button
                onClick={() => abortRef.current?.abort()}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition"
              >
                Cancel
              </button>
            )}
            {status !== null && (
              <span className={`inline-flex items-center gap-2 text-xs font-mono px-2.5 py-1 rounded-lg ${
                status >= 200 && status < 300 ? 'bg-green-500/15 text-green-300' :
                status >= 400 ? 'bg-red-500/15 text-red-300' :
                'bg-zinc-700 text-zinc-300'
              }`}>
                {status} {latency !== null && `· ${latency}ms`}
              </span>
            )}
          </div>

          {/* Response */}
          {response !== null && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Response</span>
                <button
                  onClick={copyResponse}
                  className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition"
                >
                  {copied ? <CheckCheck className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-xs font-mono text-zinc-300 overflow-auto max-h-96 whitespace-pre-wrap break-all">
                {response}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
