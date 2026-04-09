import { getClerkToken, clearCachedToken } from '../lib/auth'
import { captureHtml } from '../lib/capture'
import { fetchProjects, pushSnapshot, ApiError } from '../api/vynl'
import type { ExtensionMessage, ExtensionResponse } from '../lib/messages'

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener(
    (msg: ExtensionMessage, _sender, sendResponse: (r: ExtensionResponse) => void) => {
      handleMessage(msg).then(sendResponse).catch((err) => {
        void err
        sendResponse({ type: 'ERROR', message: 'Unexpected error. Please try again.' })
      })
      return true // keep message channel open for async response
    }
  )
})

async function handleMessage(msg: ExtensionMessage): Promise<ExtensionResponse> {
  const token = await getClerkToken()
  if (!token) return { type: 'AUTH_REQUIRED' }

  if (msg.type === 'GET_PROJECTS') {
    return handleGetProjects(token)
  }

  if (msg.type === 'CAPTURE') {
    return handleCapture(token, msg)
  }

  return { type: 'ERROR', message: 'Unknown message type' }
}

async function handleGetProjects(token: string): Promise<ExtensionResponse> {
  try {
    const data = await fetchProjects(token)
    return { type: 'PROJECTS', data }
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        await clearCachedToken()
        return { type: 'AUTH_REQUIRED' }
      }
      return { type: 'ERROR', message: err.message, status: err.status }
    }
    return { type: 'ERROR', message: 'Failed to load projects' }
  }
}

async function handleCapture(
  token: string,
  msg: Extract<ExtensionMessage, { type: 'CAPTURE' }>
): Promise<ExtensionResponse> {
  // Capture the HTML from the target tab
  let htmlContent: string
  try {
    htmlContent = await captureHtml(msg.tabId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // CSP or scripting permission errors
    if (message.includes('Cannot access') || message.includes('blocked')) {
      return { type: 'ERROR', message: 'This page blocked the capture. Try saving the page manually.' }
    }
    return { type: 'ERROR', message: 'Failed to capture page HTML.' }
  }

  // Push to API — with one automatic retry on 401
  const doUpload = (t: string) =>
    pushSnapshot(t, { ...msg.payload, htmlContent } as Parameters<typeof pushSnapshot>[1])

  try {
    const result = await doUpload(token)
    return { type: 'CAPTURE_DONE', file: result.file }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      // Token expired mid-session — clear and retry once
      await clearCachedToken()
      const freshToken = await getClerkToken()
      if (!freshToken) return { type: 'AUTH_REQUIRED' }
      try {
        const result = await doUpload(freshToken)
        return { type: 'CAPTURE_DONE', file: result.file }
      } catch (retryErr) {
        if (retryErr instanceof ApiError) {
          return { type: 'ERROR', message: retryErr.message, status: retryErr.status }
        }
      }
    }
    if (err instanceof ApiError) {
      return { type: 'ERROR', message: err.message, status: err.status }
    }
    return { type: 'ERROR', message: 'Upload failed. Please try again.' }
  }
}
