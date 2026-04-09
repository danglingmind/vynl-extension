import { create } from 'zustand'
import type { VynlFile, Viewport, Workspace } from '../api/vynl'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'
export type ProjectsStatus = 'idle' | 'loading' | 'loaded' | 'error'
export type CaptureStatus = 'idle' | 'loading' | 'success' | 'error'

interface ExtensionStore {
  // Auth
  authStatus: AuthStatus

  // Data
  workspaces: Workspace[]
  projectsStatus: ProjectsStatus
  projectsError: string | null

  // Selection
  selectedProjectId: string | null
  /** null = new file, string = revision of this fileId */
  selectedParentFileId: string | null

  // Capture form
  title: string
  viewport: Viewport

  // Capture result
  captureStatus: CaptureStatus
  captureError: string | null
  lastCapturedFile: VynlFile | null

  // Actions
  setAuthStatus: (s: AuthStatus) => void
  setWorkspaces: (ws: Workspace[]) => void
  setProjectsStatus: (s: ProjectsStatus, error?: string) => void
  selectProject: (id: string | null) => void
  selectParentFile: (id: string | null) => void
  setTitle: (t: string) => void
  setViewport: (v: Viewport) => void
  setCaptureStatus: (s: CaptureStatus, error?: string) => void
  setLastCapturedFile: (f: VynlFile | null) => void
  resetCapture: () => void
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useStore = create<ExtensionStore>((set) => ({
  authStatus: 'loading',

  workspaces: [],
  projectsStatus: 'idle',
  projectsError: null,

  selectedProjectId: null,
  selectedParentFileId: null,

  title: '',
  viewport: 'DESKTOP',

  captureStatus: 'idle',
  captureError: null,
  lastCapturedFile: null,

  setAuthStatus: (authStatus) => set({ authStatus }),

  setWorkspaces: (workspaces) => set({ workspaces }),

  setProjectsStatus: (projectsStatus, error) =>
    set({ projectsStatus, projectsError: error ?? null }),

  selectProject: (selectedProjectId) =>
    set({ selectedProjectId, selectedParentFileId: null }),

  selectParentFile: (selectedParentFileId) =>
    set({ selectedParentFileId }),

  setTitle: (title) => set({ title }),

  setViewport: (viewport) => set({ viewport }),

  setCaptureStatus: (captureStatus, error) =>
    set({ captureStatus, captureError: error ?? null }),

  setLastCapturedFile: (lastCapturedFile) => set({ lastCapturedFile }),

  resetCapture: () =>
    set({ captureStatus: 'idle', captureError: null, lastCapturedFile: null })
}))
