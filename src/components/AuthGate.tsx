import React from 'react'
import { APP_ORIGIN } from '../lib/constants'

export function AuthGate() {
  const openApp = () => chrome.tabs.create({ url: APP_ORIGIN })

  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 px-8 text-center">
      <img src="/icons/icon-96.png" alt="Vynl" className="w-12 h-12" />

      <div className="space-y-1.5">
        <h2 className="text-sm font-semibold text-gray-900">Open Vynl to continue</h2>
        <p className="text-xs text-gray-500 leading-relaxed">
          The extension needs an active Vynl session. Open Vynl in another tab and come back.
        </p>
      </div>

      <button
        onClick={openApp}
        className="px-4 py-2 bg-vynl-500 hover:bg-vynl-600 text-white text-xs font-medium rounded-lg transition-colors"
      >
        Open Vynl
      </button>
    </div>
  )
}
