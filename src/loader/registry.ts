export interface ProviderEntry {
  id: string
  name: string
  version: string
  instance: any
  config: any
  /** Numeric capability flags (from info.json capabilities[]) */
  capabilities: number[]
  cloudflareEnabled: boolean
  repoId: string
  language: string
  /** Base URL extracted from the bundle (used for CF bypass) */
  baseUrl?: string
}

const registry = new Map<string, ProviderEntry>()

export function registerProvider(entry: ProviderEntry) {
  registry.set(entry.id, entry)
}

export function getProvider(id: string): ProviderEntry | undefined {
  return registry.get(id)
}

export function listProviders(): ProviderEntry[] {
  return [...registry.values()]
}

export function clearRegistry() {
  registry.clear()
}
