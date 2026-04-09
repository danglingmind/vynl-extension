import React, { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { AuthGate } from '../../components/AuthGate'
import { ProjectPicker } from '../../components/ProjectPicker'
import { CaptureForm } from '../../components/CaptureForm'
import type { ExtensionMessage, ExtensionResponse } from '../../lib/messages'

// Typed message sender
function sendMessage(msg: ExtensionMessage): Promise<ExtensionResponse> {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve))
}

export function App() {
  const authStatus = useStore((s) => s.authStatus)
  const setAuthStatus = useStore((s) => s.setAuthStatus)
  const setWorkspaces = useStore((s) => s.setWorkspaces)
  const setProjectsStatus = useStore((s) => s.setProjectsStatus)
  const setTitle = useStore((s) => s.setTitle)
  const setCaptureStatus = useStore((s) => s.setCaptureStatus)
  const setLastCapturedFile = useStore((s) => s.setLastCapturedFile)

  const selectedProjectId = useStore((s) => s.selectedProjectId)
  const selectedParentFileId = useStore((s) => s.selectedParentFileId)
  const title = useStore((s) => s.title)
  const viewport = useStore((s) => s.viewport)

  const [tabId, setTabId] = useState<number | null>(null)
  const [tabUrl, setTabUrl] = useState<string>('')
  const [unavailablePage, setUnavailablePage] = useState<string | null>(null)

  // Load active tab info and projects on mount
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0]
      if (!tab?.id) return

      const url = tab.url ?? ''

      // Detect pages where capture is unavailable
      if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
        setUnavailablePage('Capture is not available on this page.')
        setAuthStatus('authenticated') // avoid showing auth gate
        return
      }

      if (isPdfUrl(url, tab)) {
        setUnavailablePage('PDF pages are not supported for capture.')
        setAuthStatus('authenticated')
        return
      }

      setTabId(tab.id)
      setTabUrl(url)

      // Pre-fill title from tab
      if (tab.title) setTitle(tab.title)

      // Fetch projects — this also validates auth
      setProjectsStatus('loading')
      const response = await sendMessage({ type: 'GET_PROJECTS' })

      if (response?.type === 'AUTH_REQUIRED') {
        setAuthStatus('unauthenticated')
        return
      }

      setAuthStatus('authenticated')

      if (response?.type === 'PROJECTS') {
        setWorkspaces(response.data.workspaces)
        setProjectsStatus('loaded')
      } else if (response?.type === 'ERROR') {
        setProjectsStatus('error', response.message)
      }
    })
  }, [])

  const handleCapture = async () => {
    if (!tabId || !title.trim()) return
    if (!selectedProjectId && !selectedParentFileId) return

    setCaptureStatus('loading')

    const payload = selectedParentFileId
      ? { parentFileId: selectedParentFileId, title, url: tabUrl, viewport }
      : { projectId: selectedProjectId!, title, url: tabUrl, viewport }

    const response = await sendMessage({ type: 'CAPTURE', tabId, payload })

    if (response?.type === 'CAPTURE_DONE') {
      setCaptureStatus('success')
      setLastCapturedFile(response.file)
    } else if (response?.type === 'AUTH_REQUIRED') {
      setCaptureStatus('idle')
      setAuthStatus('unauthenticated')
    } else if (response?.type === 'ERROR') {
      setCaptureStatus('error', response.message)
    } else {
      setCaptureStatus('error', 'Unexpected error. Please try again.')
    }
  }

  // Loading state
  if (authStatus === 'loading') {
    return (
      <div className="flex items-center justify-center h-full">
        <svg className="animate-spin h-5 w-5 text-gray-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  // Not logged in
  if (authStatus === 'unauthenticated') {
    return <AuthGate />
  }

  // Page is unavailable for capture
  if (unavailablePage) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-8 text-center">
        <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
        <p className="text-xs text-gray-500">{unavailablePage}</p>
      </div>
    )
  }

  const showCaptureForm = selectedProjectId !== null

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-100 shrink-0">
        <img src="/icons/icon-32.png" alt="Vynl" className="w-6 h-6" />
        <span className="text-sm font-semibold text-gray-900">Vynl</span>
      </header>

      {/* Section label */}
      <div className="px-4 py-2 shrink-0">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
          Select destination
        </p>
      </div>

      {/* Project picker — scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <ProjectPicker />
      </div>

      {/* Capture form — slides in when project is selected */}
      {showCaptureForm && tabId !== null && (
        <div className="shrink-0">
          <CaptureForm tabId={tabId} tabUrl={tabUrl} onCapture={handleCapture} />
        </div>
      )}
    </div>
  )
}

function isPdfUrl(url: string, tab: chrome.tabs.Tab): boolean {
  if (url.toLowerCase().endsWith('.pdf')) return true
  if (tab.title?.toLowerCase().includes('.pdf')) return true
  return false
}
