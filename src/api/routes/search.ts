import { Router } from 'express'
import { withProvider, asyncHandler } from '../middleware.js'

export const searchRouter = Router()

/**
 * GET /api/providers/:id/search
 * Query params:
 *   q        - search title (optional)
 *   page     - page number (default: 1)
 *   filters  - JSON encoded array of SearchFilter values (optional)
 *   sort     - sorting option id (optional)
 */
searchRouter.get('/:id/search', withProvider, asyncHandler(async (req, res) => {
  const provider = req.provider!
  const q = (req.query.q as string) ?? ''
  const page = parseInt((req.query.page as string) ?? '1', 10)
  const filtersRaw = (req.query.filters as string) ?? '[]'
  const sortId = (req.query.sort as string) ?? undefined

  let filters: any[]
  try {
    filters = JSON.parse(filtersRaw)
  } catch {
    res.status(400).json({ error: 'Invalid filters JSON' })
    return
  }

  const instance = provider.instance

  if (typeof instance.getSearchResults !== 'function') {
    res.status(400).json({ error: `Provider "${provider.id}" does not support search` })
    return
  }

  // Resolve sorting option — if none specified, default to the provider's first option
  let sortingOption: any = sortId ? { id: sortId, value: sortId, label: sortId } : undefined
  if (!sortingOption && typeof instance.getSortingOptions === 'function') {
    try {
      const opts = await instance.getSortingOptions()
      if (Array.isArray(opts) && opts.length > 0) sortingOption = opts[0]
    } catch { /* ignore */ }
  }

  let result
  try {
    result = await instance.getSearchResults(
      { title: q, filters },
      { page },
      sortingOption,
    )
  } catch (e: any) {
    console.error('[search] error stack:', e.stack ?? e.message)
    throw e
  }

  res.json(result)
}))

/**
 * GET /api/providers/:id/search/filters
 * Returns available search filters for the provider.
 */
searchRouter.get('/:id/search/filters', withProvider, asyncHandler(async (req, res) => {
  const provider = req.provider!
  const instance = provider.instance

  if (typeof instance.getSearchFilters !== 'function') {
    res.json([])
    return
  }

  const filters = await instance.getSearchFilters()
  res.json(filters)
}))

/**
 * GET /api/providers/:id/search/sorting
 * Returns available sorting options.
 */
searchRouter.get('/:id/search/sorting', withProvider, asyncHandler(async (req, res) => {
  const provider = req.provider!
  const instance = provider.instance

  if (typeof instance.getSortingOptions !== 'function') {
    res.json([])
    return
  }

  const options = await instance.getSortingOptions()
  res.json(options)
}))
