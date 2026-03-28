import { Router } from 'express'
import { withProvider, asyncHandler } from '../middleware.js'

export const chapterDetailsRouter = Router()

/**
 * GET /api/providers/:id/chapter-details?mangaId=xxx&chapterId=yyy
 * Returns page image URLs for a chapter.
 */
chapterDetailsRouter.get('/:id/chapter-details', withProvider, asyncHandler(async (req, res) => {
  const provider = req.provider!
  const mangaId = req.query.mangaId as string
  const chapterId = req.query.chapterId as string

  if (!mangaId || !chapterId) {
    res.status(400).json({ error: 'mangaId and chapterId query parameters are required' })
    return
  }

  const instance = provider.instance
  if (typeof instance.getChapterDetails !== 'function') {
    res.status(400).json({ error: `Provider "${provider.id}" does not support getChapterDetails` })
    return
  }

  const chapter = {
    chapterId,
    sourceManga: { mangaId },
  }

  const details = await instance.getChapterDetails(chapter)
  res.json(details)
}))
