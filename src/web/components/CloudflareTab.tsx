import React, { useState } from 'react'
import { Globe, Shield, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { Provider } from '../types'

interface Props {
  providers: Provider[]
}

export default function CloudflareTab({ providers }: Props) {
  const [logs, setLogs] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})

  const cfProviders = providers.filter(p => p.cloudflareEnabled)

  async function openBypass(providerId: string) {
    setLoading(prev => ({ ...prev, [providerId]: true }))
    setLogs(prev => ({ ...prev, [providerId]: '' }))
    try {
      const res = await fetch(`/api/providers/${providerId}/cloudflare/bypass`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeout: 300 }),
      })
      const data = await res.json() as any
      if (data.success) {
        setLogs(prev => ({ ...prev, [providerId]: `ok:${data.cookieCount} cookies saved` }))
      } else {
        setLogs(prev => ({ ...prev, [providerId]: `err:${data.error}` }))
      }
    } catch (e: any) {
      setLogs(prev => ({ ...prev, [providerId]: `err:${e.message}` }))
    } finally {
      setLoading(prev => ({ ...prev, [providerId]: false }))
    }
  }

  return (
    <div>
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">Cloudflare Bypass</h2>
      {cfProviders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-600">
          <Shield className="w-10 h-10" />
          <p className="text-sm">No CF-protected providers loaded.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {cfProviders.map(p => {
            const log = logs[p.id] ?? ''
            const isOk = log.startsWith('ok:')
            const isErr = log.startsWith('err:')
            const logMsg = log.slice(3)
            return (
              <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="font-medium text-sm">{p.name}</p>
                    <p className="text-xs text-zinc-500">
                      {p.repoId} · v{p.version}{p.baseUrl ? ` · ${p.baseUrl}` : ''}
                    </p>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30">CF</span>
                </div>
                <button
                  disabled={loading[p.id]}
                  onClick={() => openBypass(p.id)}
                  className="w-full py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-300 rounded-lg text-xs font-medium transition disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {loading[p.id]
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Opening browser…</>
                    : <><Globe className="w-3.5 h-3.5" /> Open Browser Bypass</>
                  }
                </button>
                {log && (
                  <p className={`mt-2 text-xs flex items-center gap-1.5 ${isOk ? 'text-green-400' : 'text-red-400'}`}>
                    {isOk
                      ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                      : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    }
                    {logMsg}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
