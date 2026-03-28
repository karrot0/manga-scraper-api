import { Router } from 'express'
import { withProvider, asyncHandler } from '../middleware.js'
import { cookieStore, type StoredCookie } from '../../runtime/cookies.js'
import { bypassCloudflareWithBrowser } from '../../cloudflare/browser.js'

export const cloudflareRouter = Router()

/**
 * GET /api/providers/:id/cloudflare/request
 * Returns the URL that needs Cloudflare bypass.
 */
cloudflareRouter.get('/:id/cloudflare/request', withProvider, asyncHandler(async (req, res) => {
  const provider = req.provider!
  const instance = provider.instance

  if (!provider.cloudflareEnabled) {
    res.status(400).json({ error: `Provider "${provider.id}" does not require Cloudflare bypass` })
    return
  }

  let bypassUrl: string | null = null

  if (typeof instance.getCloudflareBypassRequest === 'function') {
    const r = await instance.getCloudflareBypassRequest()
    bypassUrl = r?.url ?? null
  }

  if (!bypassUrl) {
    bypassUrl = provider.baseUrl ?? provider.config?.baseUrl ?? null
  }

  res.json({
    providerId: provider.id,
    bypassUrl,
    instructions: [
      '1. POST to /api/providers/:id/cloudflare/bypass to open a browser window automatically.',
      '   OR open the bypassUrl in a browser manually, solve the challenge,',
      '   then POST cookies to /api/providers/:id/cloudflare/cookies.',
    ],
  })
}))

/**
 * POST /api/providers/:id/cloudflare/bypass
 *
 * Opens a headed Chromium browser at the extension's Cloudflare URL.
 * An overlay "Done" button is injected into the page.
 * After the user solves the CF challenge and clicks Done, cookies are
 * captured from the browser and saved — then returned in the response.
 *
 * Query params:
 *   ?timeout=<seconds>  — override the default 5-minute wait (optional)
 */
cloudflareRouter.post('/:id/cloudflare/bypass', withProvider, asyncHandler(async (req, res) => {
  const provider = req.provider!
  const instance = provider.instance

  // Get bypass URL (allowed for any provider — CF errors can occur even on non-flagged providers)
  let bypassUrl: string | null = null
  if (typeof instance.getCloudflareBypassRequest === 'function') {
    const r = await instance.getCloudflareBypassRequest()
    bypassUrl = r?.url ?? null
  }
  if (!bypassUrl) {
    bypassUrl = provider.baseUrl ?? provider.config?.baseUrl ?? req.body?.url ?? null
  }
  if (!bypassUrl) {
    res.status(400).json({ error: 'No bypass URL available for this provider. Pass { url } in body.' })
    return
  }

  const timeoutSecs = Number(req.query.timeout ?? req.body?.timeout ?? 300)
  const timeoutMs = timeoutSecs * 1000

  console.log(`[cloudflare] Opening browser for ${provider.id} → ${bypassUrl}`)

  try {
    const result = await bypassCloudflareWithBrowser(bypassUrl, provider.id, timeoutMs)

    // Also inject into provider if it has saveCloudflareBypassCookies
    if (typeof instance.saveCloudflareBypassCookies === 'function') {
      const pbCookies = result.cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path ?? '/',
        expires: c.expires ? new Date(c.expires) : undefined,
      }))
      await instance.saveCloudflareBypassCookies(pbCookies)
    }

    res.json({
      success: true,
      providerId: provider.id,
      cookieCount: result.cookies.length,
      cookies: result.cookies.map(c => ({ name: c.name, domain: c.domain })),
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}))

/**
 * POST /api/providers/:id/cloudflare/cookies
 * Saves Cloudflare bypass cookies manually.
 *
 * Body: { cookies: [{ name, value, domain, path?, expires? }] }
 */
cloudflareRouter.post('/:id/cloudflare/cookies', withProvider, asyncHandler(async (req, res) => {
  const provider = req.provider!
  const { cookies } = req.body as { cookies: StoredCookie[] }

  if (!Array.isArray(cookies) || cookies.length === 0) {
    res.status(400).json({ error: 'Body must have a non-empty "cookies" array' })
    return
  }

  for (const c of cookies) {
    if (typeof c.name !== 'string' || typeof c.value !== 'string' || typeof c.domain !== 'string') {
      res.status(400).json({ error: 'Each cookie must have name, value, and domain (all strings)' })
      return
    }
  }

  cookieStore.setCookies(provider.id, cookies)

  if (typeof provider.instance.saveCloudflareBypassCookies === 'function') {
    const pbCookies = cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path ?? '/',
      expires: c.expires ? new Date(c.expires) : undefined,
    }))
    await provider.instance.saveCloudflareBypassCookies(pbCookies)
  }

  res.json({
    success: true,
    providerId: provider.id,
    count: cookies.length,
    cookies: cookies.map(c => ({ name: c.name, domain: c.domain })),
  })
}))

/**
 * GET /api/providers/:id/cloudflare/cookies
 * Returns currently stored cookies for a provider.
 */
cloudflareRouter.get('/:id/cloudflare/cookies', withProvider, (req, res) => {
  const provider = req.provider!
  const cookies = cookieStore.getAll(provider.id)
  res.json({ providerId: provider.id, cookies })
})

/**
 * DELETE /api/providers/:id/cloudflare/cookies
 * Clears all stored cookies for the provider.
 */
cloudflareRouter.delete('/:id/cloudflare/cookies', withProvider, (req, res) => {
  const provider = req.provider!
  cookieStore.clearForProvider(provider.id)
  res.json({ success: true, providerId: provider.id })
})

/**
 * GET /api/providers/:id/cloudflare/request
 * Returns the URL that needs Cloudflare bypass (open in browser, solve challenge, then POST cookies).
 */
cloudflareRouter.get('/:id/cloudflare/request', withProvider, asyncHandler(async (req, res) => {
  const provider = req.provider!
  const instance = provider.instance

  if (!provider.cloudflareEnabled) {
    res.status(400).json({ error: `Provider "${provider.id}" does not require Cloudflare bypass` })
    return
  }

  let bypassUrl: string | null = null

  // Try getCloudflareBypassRequest (new API)
  if (typeof instance.getCloudflareBypassRequest === 'function') {
    const r = await instance.getCloudflareBypassRequest()
    bypassUrl = r?.url ?? null
  }

  if (!bypassUrl) {
    // Fall back to extracted baseUrl from bundle, then config baseUrl
    bypassUrl = provider.baseUrl ?? provider.config?.baseUrl ?? null
  }

  res.json({
    providerId: provider.id,
    bypassUrl,
    instructions: [
      '1. Open the bypassUrl in a browser (Chrome/Firefox).',
      '2. Solve the Cloudflare challenge.',
      '3. Open DevTools → Application → Cookies and copy cf_clearance (and __cf_bm if present).',
      `4. POST the cookies to: POST /api/providers/${provider.id}/cloudflare/cookies`,
      '   Body: { "cookies": [{ "name": "cf_clearance", "value": "<value>", "domain": ".<domain>" }] }',
    ],
  })
}))

/**
 * POST /api/providers/:id/cloudflare/cookies
 * Saves Cloudflare bypass cookies for the provider.
 *
 * Body: {
 *   cookies: Array<{
 *     name: string,
 *     value: string,
 *     domain: string,
 *     path?: string,
 *     expires?: number  // unix ms timestamp
 *   }>
 * }
 */
cloudflareRouter.post('/:id/cloudflare/cookies', withProvider, asyncHandler(async (req, res) => {
  const provider = req.provider!
  const { cookies } = req.body as { cookies: StoredCookie[] }

  if (!Array.isArray(cookies) || cookies.length === 0) {
    res.status(400).json({ error: 'Body must have a non-empty "cookies" array' })
    return
  }

  // Validate cookie objects
  for (const c of cookies) {
    if (typeof c.name !== 'string' || typeof c.value !== 'string' || typeof c.domain !== 'string') {
      res.status(400).json({ error: 'Each cookie must have name, value, and domain (all strings)' })
      return
    }
  }

  // Persist cookies to our store
  cookieStore.setCookies(provider.id, cookies)

  // Also inject into the provider's CookieStorageInterceptor if it has saveCloudflareBypassCookies
  if (typeof provider.instance.saveCloudflareBypassCookies === 'function') {
    const pbCookies = cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path ?? '/',
      expires: c.expires ? new Date(c.expires) : undefined,
    }))
    await provider.instance.saveCloudflareBypassCookies(pbCookies)
  }

  res.json({
    success: true,
    providerId: provider.id,
    count: cookies.length,
    cookies: cookies.map(c => ({ name: c.name, domain: c.domain })),
  })
}))

/**
 * GET /api/providers/:id/cloudflare/cookies
 * Returns currently stored Cloudflare cookies for a provider.
 */
cloudflareRouter.get('/:id/cloudflare/cookies', withProvider, (req, res) => {
  const provider = req.provider!
  const cookies = cookieStore.getAll(provider.id)
  res.json({ providerId: provider.id, cookies })
})

/**
 * DELETE /api/providers/:id/cloudflare/cookies
 * Clears all stored cookies for the provider.
 */
cloudflareRouter.delete('/:id/cloudflare/cookies', withProvider, (req, res) => {
  const provider = req.provider!
  cookieStore.clearForProvider(provider.id)
  res.json({ success: true, providerId: provider.id })
})
