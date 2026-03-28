/**
 * browser.ts
 *
 * Opens a headed Chromium browser window for manual Cloudflare bypass.
 * The user solves the CF challenge, then clicks the injected "Done" button.
 * All cookies are read from the browser context and returned/saved.
 */

let chromium: typeof import('playwright').chromium
let playwrightImportError: any = null
async function getChromium() {
  if (chromium) return chromium
  try {
    const mod = await import('playwright')
    chromium = mod.chromium
    return chromium
  } catch (e) {
    playwrightImportError = e
    console.error('[cloudflare] Playwright is not installed or failed to load. Please run: npm install playwright')
    process.exit(1)
  }
}
import { cookieStore, type StoredCookie } from '../runtime/cookies.js'

const DONE_BTN_SCRIPT = `
  (function injectDoneBtn() {
    if (document.getElementById('__cf_bypass_done')) return;
    if (!document.body) return;

    var btn = document.createElement('div');
    btn.id = '__cf_bypass_done';
    btn.textContent = '✅  Done — Save Cookies';
    btn.style.cssText = [
      'position:fixed',
      'top:12px',
      'right:12px',
      'z-index:2147483647',
      'background:#22c55e',
      'color:#fff',
      'padding:10px 18px',
      'border-radius:8px',
      'cursor:pointer',
      'font:bold 15px/1 sans-serif',
      'box-shadow:0 2px 12px rgba(0,0,0,.35)',
      'user-select:none',
      'transition:background .15s',
    ].join(';');
    btn.onmouseenter = function() { btn.style.background = '#16a34a'; };
    btn.onmouseleave = function() { btn.style.background = '#22c55e'; };
    btn.onclick = function() {
      btn.textContent = '⏳ Saving…';
      btn.style.background = '#3b82f6';
      if (window.__cfBypassDone) window.__cfBypassDone();
    };
    document.body.appendChild(btn);
  })();
`

export interface BypassResult {
  cookies: StoredCookie[]
  domain: string
}

/**
 * Opens a browser window at `url`, injects a "Done" button overlay,
 * waits for the user to click it, then collects all cookies and saves
 * them to the store for `providerId`.
 *
 * @param url        The Cloudflare-protected URL to open
 * @param providerId Provider ID to store the cookies under
 * @param timeoutMs  How long to wait before giving up (default: 5 min)
 */
export async function bypassCloudflareWithBrowser(
  url: string,
  providerId: string,
  timeoutMs = 5 * 60 * 1000,
): Promise<BypassResult> {
  const chromium = await getChromium()
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled', // help hide automation
    ],
  })

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  })

  const page = await context.newPage()

  // Expose the "Done" callback BEFORE navigation (Playwright requires this)
  let resolveDone!: () => void
  let rejectDone!: (err: Error) => void

  const donePromise = new Promise<void>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })

  await page.exposeFunction('__cfBypassDone', () => {
    resolveDone()
  })

  // Re-inject the Done button after every page load/navigation
  const injectBtn = async () => {
    try {
      await page.evaluate(DONE_BTN_SCRIPT)
    } catch {
      // Page might be navigating — ignore
    }
  }

  page.on('load', injectBtn)
  page.on('domcontentloaded', injectBtn)

  // Handle browser being closed manually
  browser.on('disconnected', () => {
    rejectDone(new Error('Browser was closed before the bypass was completed'))
  })

  // Navigate to the bypass URL
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {
    // CF challenge pages often don't load "normally" — ignore navigation errors
  })

  // Inject immediately in case load events already fired
  await injectBtn()

  // Wait for the user to click Done (or timeout)
  const timeout = setTimeout(() => {
    rejectDone(new Error(`Cloudflare bypass timed out after ${Math.round(timeoutMs / 1000)}s`))
  }, timeoutMs)

  try {
    await donePromise
  } finally {
    clearTimeout(timeout)
  }

  // Read all cookies from the browser context
  const pwCookies = await context.cookies()
  await browser.close()

  const parsed = new URL(url)
  const domain = parsed.hostname

  const stored: StoredCookie[] = pwCookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path ?? '/',
    // Playwright stores expiry as Unix seconds; -1 means session cookie
    expires: c.expires && c.expires > 0 ? c.expires * 1000 : undefined,
  }))

  // Persist to our cookie store
  cookieStore.setCookies(providerId, stored)

  return { cookies: stored, domain }
}
