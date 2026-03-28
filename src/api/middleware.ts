/**
 * middleware.ts
 * Shared middleware: resolves the provider and sets Application context.
 */

import type { Request, Response, NextFunction } from 'express'
import { getProvider } from '../loader/registry.js'
import { setContext, setProviderId } from '../runtime/Application.js'

declare global {
  namespace Express {
    interface Request {
      provider?: ReturnType<typeof getProvider>
    }
  }
}

export function withProvider(req: Request, res: Response, next: NextFunction) {
  const id = req.params.id as string
  const provider = getProvider(id)
  if (!provider) {
    res.status(404).json({ error: `Provider "${id}" not found. Call GET /api/providers to list available providers.` })
    return
  }
  // Set Application context so interceptors and state resolve to the right provider
  setContext(`provider:${id}`)
  setProviderId(id)
  req.provider = provider
  next()
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next)
  }
}
