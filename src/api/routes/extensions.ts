/**
 * extensions.ts
 *
 * POST /api/extensions/update        — re-download all extensions and reload
 * POST /api/extensions/update/force  — force re-download even if versions match
 */

import { Router } from 'express'
import { downloadAll } from '../../downloader/downloader.js'
import { loadAllExtensions } from '../../loader/loader.js'

export const extensionsRouter = Router()

extensionsRouter.post('/update', async (req, res) => {
  const force = req.query.force === 'true' || req.body?.force === true
  try {
    const downloadResults = await downloadAll(force)
    const loadResults = await loadAllExtensions(/* skipDownload */ true)

    const updated = downloadResults.filter(r => r.status === 'updated')
    const loaded = loadResults.filter(r => r.success)
    const failed = loadResults.filter(r => !r.success)

    res.json({
      updated: updated.map(r => `${r.repoId}/${r.name}`),
      loaded: loaded.length,
      failed: failed.map(r => ({ name: r.name, error: r.error })),
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})
