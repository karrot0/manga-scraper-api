import { Router } from 'express'
import { listProviders } from '../../loader/registry.js'

export const providersRouter = Router()

/**
 * GET /api/providers
 * Lists all loaded providers with their capabilities.
 */
providersRouter.get('/', (_req, res) => {
  const providers = listProviders().map(p => ({
    id: p.id,
    name: p.name,
    version: p.version,
    language: p.language,
    contentRating: p.config?.contentRating,
    capabilities: p.capabilities,
    cloudflareEnabled: p.cloudflareEnabled,
    badges: p.config?.badges ?? [],
    repoId: p.repoId,
    baseUrl: p.baseUrl ?? null,
  }))
  res.json(providers)
})
