import { APP_ORIGIN, TOKEN_KEY, TOKEN_TTL_MS } from './constants'

/**
 * Retrieves a short-lived Clerk JWT.
 *
 * Called from the background service worker only. Never call this from the
 * popup or content scripts — the scripting API requires service worker context.
 *
 * Flow:
 *  1. Return cached token from chrome.storage.session if present
 *  2. Find an open tab on the Vynl app domain
 *  3. Inject a script into that tab to call window.Clerk.session.getToken()
 *  4. Cache the result for TOKEN_TTL_MS ms
 */
export async function getClerkToken(): Promise<string | null> {
  // 1. Check session cache
  const cached = await chrome.storage.session.get(TOKEN_KEY)
  if (cached[TOKEN_KEY]) return cached[TOKEN_KEY] as string

  // 2. Find an open Vynl tab
  const tabs = await chrome.tabs.query({ url: `${APP_ORIGIN}/*` })
  if (!tabs.length || !tabs[0].id) return null

  // 3. Inject script to retrieve Clerk token from the page context
  let results: chrome.scripting.InjectionResult[]
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: async () => {
        const w = window as any

        // Method 1: window.Clerk.session.getToken()
        let token: string | null = null
        if (w.Clerk?.session?.getToken) {
          token = await w.Clerk.session.getToken()
        }

        // Method 2: window.Clerk.client.activeSessions
        if (!token && w.Clerk?.client?.activeSessions?.length) {
          token = await w.Clerk.client.activeSessions[0].getToken()
        }

        // Method 3: __session cookie (Clerk stores JWT here)
        if (!token) {
          const match = document.cookie.match(/(?:^|;\s*)__session=([^;]+)/)
          token = match?.[1] ?? null
        }

        // Method 4: __clerk_db_jwt cookie (dev mode)
        if (!token) {
          const match = document.cookie.match(/(?:^|;\s*)__clerk_db_jwt[^=]*=([^;]+)/)
          token = match?.[1] ?? null
        }

        return token
      }
    })
  } catch {
    return null
  }

  const token = (results?.[0]?.result as string | null) ?? null
  if (!token) return null

  // 4. Cache briefly
  await chrome.storage.session.set({ [TOKEN_KEY]: token })
  setTimeout(() => chrome.storage.session.remove(TOKEN_KEY), TOKEN_TTL_MS)

  return token
}

/** Force-clears the cached token (e.g. on 401 so we re-fetch next time) */
export async function clearCachedToken(): Promise<void> {
  await chrome.storage.session.remove(TOKEN_KEY)
}
