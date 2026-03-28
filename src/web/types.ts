export interface Provider {
  id: string
  name: string
  repoId: string
  version: string
  cloudflareEnabled: boolean
  baseUrl?: string
}

export interface MangaItem {
  mangaId: string
  title: string
  imageUrl: string
}

export interface SeriesItem {
  id: string
  title: string
  slug: string
  cover_url?: string
  status?: string
}

export type CardStatus = 'pending' | 'scraping' | 'done' | 'error'
export type LogType = 'info' | 'success' | 'warn' | 'error'

export interface LogEntry {
  id: number
  msg: string
  type: LogType
}

// API Explorer
export type HttpMethod = 'GET' | 'POST' | 'DELETE' | 'PUT'

export interface ApiParam {
  name: string
  in: 'path' | 'query' | 'body'
  type: 'string' | 'number' | 'boolean' | 'json'
  required?: boolean
  description?: string
  example?: string
}

export interface ApiEndpoint {
  method: HttpMethod
  path: string
  description: string
  group: string
  params?: ApiParam[]
  bodySchema?: string
}
