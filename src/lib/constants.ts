/** Base URL of the Vynl web app. Update for local dev. */
export const APP_ORIGIN = 'https://vynl.in'

/** chrome.storage.session key for the cached Clerk JWT */
export const TOKEN_KEY = 'vynl_token'

/** How long (ms) to cache a Clerk JWT before expiring it */
export const TOKEN_TTL_MS = 45_000
