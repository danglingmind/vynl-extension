import React from 'react'
import { useStore } from '../store'
import type { Viewport } from '../api/vynl'
import { APP_ORIGIN } from '../lib/constants'

const VIEWPORTS: { value: Viewport; label: string; icon: React.ReactNode }[] = [
  {
    value: 'DESKTOP',
    label: 'Desktop',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    )
  },
  {
    value: 'TABLET',
    label: 'Tablet',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    )
  },
  {
    value: 'MOBILE',
    label: 'Mobile',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    )
  }
]

interface CaptureFormProps {
  tabId: number
  tabUrl: string
  onCapture: () => void
}

export function CaptureForm({ tabId, tabUrl, onCapture }: CaptureFormProps) {
  const title = useStore((s) => s.title)
  const viewport = useStore((s) => s.viewport)
  const setTitle = useStore((s) => s.setTitle)
  const setViewport = useStore((s) => s.setViewport)
  const captureStatus = useStore((s) => s.captureStatus)
  const captureError = useStore((s) => s.captureError)
  const lastCapturedFile = useStore((s) => s.lastCapturedFile)
  const resetCapture = useStore((s) => s.resetCapture)
  const selectedParentFileId = useStore((s) => s.selectedParentFileId)

  const isLocal = isLocalUrl(tabUrl)
  const isCapturing = captureStatus === 'loading'
  const isSuccess = captureStatus === 'success'

  if (isSuccess && lastCapturedFile) {
    const fileUrl = `${APP_ORIGIN}/project/${lastCapturedFile.projectId}/file/${lastCapturedFile.id}`
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-6 px-6 text-center">
        <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
          <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-gray-900">Saved!</p>
          <p className="text-xs text-gray-500">{lastCapturedFile.fileName}</p>
        </div>
        <div className="flex gap-2">
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 bg-vynl-500 hover:bg-vynl-600 text-white text-xs font-medium rounded-lg transition-colors"
          >
            View in Vynl →
          </a>
          <button
            onClick={resetCapture}
            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-lg transition-colors"
          >
            Capture again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-3 space-y-3 border-t border-gray-100">
      {/* Destination label */}
      <DestinationLabel />

      {/* Local capture banner */}
      {isLocal && (
        <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg">
          <svg className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-[11px] text-amber-700">Local page — will be captured as-is</p>
        </div>
      )}

      {/* Title */}
      <div className="space-y-1">
        <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide">
          Title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter a title…"
          className="w-full px-3 py-2 text-sm text-gray-900 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-vynl-500 focus:border-transparent placeholder-gray-400"
        />
      </div>

      {/* Viewport */}
      <div className="space-y-1">
        <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide">
          Viewport
        </label>
        <div className="flex gap-1.5">
          {VIEWPORTS.map(({ value, label, icon }) => (
            <button
              key={value}
              onClick={() => setViewport(value)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors border ${
                viewport === value
                  ? 'bg-vynl-50 border-vynl-300 text-vynl-700'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-50 hover:border-gray-300'
              }`}
            >
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {captureStatus === 'error' && captureError && (
        <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-100 rounded-lg">
          <svg className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-[11px] text-red-700">{captureError}</p>
        </div>
      )}

      {/* Submit */}
      <button
        onClick={onCapture}
        disabled={isCapturing || !title.trim()}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-vynl-500 hover:bg-vynl-600 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-medium rounded-lg transition-colors"
      >
        {isCapturing ? (
          <>
            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Capturing…
          </>
        ) : (
          selectedParentFileId ? 'Capture as Revision' : 'Capture'
        )}
      </button>
    </div>
  )
}

function DestinationLabel() {
  const workspaces = useStore((s) => s.workspaces)
  const selectedProjectId = useStore((s) => s.selectedProjectId)
  const selectedParentFileId = useStore((s) => s.selectedParentFileId)

  if (!selectedProjectId) return null

  const project = workspaces.flatMap((ws) => ws.projects).find((p) => p.id === selectedProjectId)
  if (!project) return null

  const parentFile = selectedParentFileId
    ? project.websiteFiles.find((f) => f.id === selectedParentFileId)
    : null

  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-500">
      <svg className="w-3.5 h-3.5 text-vynl-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      {parentFile ? (
        <span>Adding revision to <strong className="text-gray-700">{parentFile.fileName}</strong></span>
      ) : (
        <span>New file in <strong className="text-gray-700">{project.name}</strong></span>
      )}
    </div>
  )
}

function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      url.startsWith('file://')
    )
  } catch {
    return false
  }
}
