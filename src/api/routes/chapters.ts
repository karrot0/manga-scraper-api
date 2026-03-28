import { Router } from 'express'
import { withProvider, asyncHandler } from '../middleware.js'

export const chaptersRouter = Router()

/**
 * GET /api/providers/:id/chapters/:mangaId
 * Returns the chapter list for a manga.
 *
 * Note: mangaId is passed as a query param to avoid routing conflicts with chapterDetails.
 */

/**
 * GET /api/providers/:id/chapters?mangaId=xxx
 */
chaptersRouter.get('/:id/chapters', withProvider, asyncHandler(async (req, res) => {
  const provider = req.provider!
  const mangaId = req.query.mangaId as string

  if (!mangaId) {
    res.status(400).json({ error: 'mangaId query parameter is required' })
    return
  }

  const instance = provider.instance
  if (typeof instance.getChapters !== 'function') {
    res.status(400).json({ error: `Provider "${provider.id}" does not support getChapters` })
    return
  }

  const sourceManga = { mangaId }
  const chapters = await instance.getChapters(sourceManga)
  res.json(chapters)
}))
