import { Router } from 'express'
import { withProvider, asyncHandler } from '../middleware.js'

export const discoverRouter = Router()

/**
 * GET /api/providers/:id/discover
 * Returns the list of discover sections for the provider.
 */
discoverRouter.get('/:id/discover', withProvider, asyncHandler(async (req, res) => {
  const provider = req.provider!
  const instance = provider.instance

  if (typeof instance.getDiscoverSections !== 'function') {
    res.status(400).json({ error: `Provider "${provider.id}" does not support discover sections` })
    return
  }

  const sections = await instance.getDiscoverSections()
  res.json(sections)
}))

/**
 * GET /api/providers/:id/discover/:sectionId/items?page=<n>
 * Returns paginated items for a specific discover section.
 */
discoverRouter.get('/:id/discover/:sectionId/items', withProvider, asyncHandler(async (req, res) => {
  const provider = req.provider!
  const { sectionId } = req.params
  const page = parseInt((req.query.page as string) ?? '1', 10)

  const instance = provider.instance

  if (typeof instance.getDiscoverSectionItems !== 'function') {
    res.status(400).json({ error: `Provider "${provider.id}" does not support getDiscoverSectionItems` })
    return
  }

  // Build a minimal DiscoverSection object with the given ID
  const section = { id: sectionId, title: sectionId, type: 'simpleCarousel' }
  const metadata = page > 1 ? { page } : undefined

  const result = await instance.getDiscoverSectionItems(section, metadata)
  res.json(result)
}))
