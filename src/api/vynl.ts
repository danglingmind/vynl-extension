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

export interface PreparePayload {
  projectId?: string
  parentFileId?: string
  title: string
  url: string
  viewport?: Viewport
}

export interface PrepareResponse {
  fileId: string
  uploadUrl: string
}

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

// Step 1 — validate access and get a signed Supabase upload URL
export async function prepareSnapshot(token: string, payload: PreparePayload): Promise<PrepareResponse> {
  return apiFetch<PrepareResponse>('/api/extension/snapshot/prepare', token, {
    method: 'POST',
    body: JSON.stringify(payload)
  })
}

// Step 2 — PUT HTML directly to Supabase (no Vercel size limit)
export async function uploadHtmlToSupabase(uploadUrl: string, html: string): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/html' },
    body: html
  })
  if (!res.ok) {
    throw new ApiError(res.status, `Supabase upload failed (${res.status})`)
  }
}

// Step 3 — mark the file READY and get the final file record
export async function commitSnapshot(
  token: string,
  fileId: string,
  fileSize: number
): Promise<{ success: true; file: VynlFile }> {
  return apiFetch<{ success: true; file: VynlFile }>('/api/extension/snapshot/commit', token, {
    method: 'POST',
    body: JSON.stringify({ fileId, fileSize })
  })
}
