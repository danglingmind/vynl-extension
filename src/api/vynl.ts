import { APP_ORIGIN } from '../lib/constants'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Workspace {
  id: string
  name: string
  role: string
  projects: Project[]
}

export interface Project {
  id: string
  name: string
  websiteFiles: WebsiteFile[]
}

export interface WebsiteFile {
  id: string
  fileName: string
  metadata: { originalUrl: string; isLocalCapture: boolean }
  createdAt: string
}

export interface VynlFile {
  id: string
  fileName: string
  fileType: string
  status: string
  revisionNumber: number
  isRevision: boolean
  projectId: string
}

export type Viewport = 'DESKTOP' | 'TABLET' | 'MOBILE'

export type SnapshotPayload =
  | { projectId: string; parentFileId?: never; title: string; url: string; htmlContent: string; viewport?: Viewport }
  | { parentFileId: string; projectId?: never; title: string; url: string; htmlContent: string; viewport?: Viewport }

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

// ---------------------------------------------------------------------------
// Core fetch helper
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${APP_ORIGIN}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options?.headers
    }
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`)
  }

  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

export async function fetchProjects(token: string): Promise<{ workspaces: Workspace[] }> {
  return apiFetch('/api/extension/projects', token)
}

export async function pushSnapshot(
  token: string,
  payload: SnapshotPayload
): Promise<{ success: true; file: VynlFile }> {
  return apiFetch('/api/extension/snapshot', token, {
    method: 'POST',
    body: JSON.stringify(payload)
  })
}
