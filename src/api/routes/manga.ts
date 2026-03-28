import { Router } from 'express'
import { withProvider, asyncHandler } from '../middleware.js'

export const mangaRouter = Router()

/**
 * GET /api/providers/:id/manga/:mangaId
 * Returns manga details (title, description, cover, tags, status, etc.)
 *
 * Note: mangaId may contain slashes (e.g. "some-manga/sub") — use wildcard param.
 */
mangaRouter.get('/:id/manga/*', withProvider, asyncHandler(async (req, res) => {
  const provider = req.provider!
  const mangaId = (req.params as any)[0] as string

  const instance = provider.instance
  if (typeof instance.getMangaDetails !== 'function') {
    res.status(400).json({ error: `Provider "${provider.id}" does not support getMangaDetails` })
    return
  }

  const result = await instance.getMangaDetails(mangaId)
  res.json(result)
}))
