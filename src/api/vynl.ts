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
// Compression helper
// ---------------------------------------------------------------------------

async function gzipString(data: string): Promise<Uint8Array> {
  const stream = new CompressionStream('gzip')
  const writer = stream.writable.getWriter()
  writer.write(new TextEncoder().encode(data))
  writer.close()
  const chunks: Uint8Array[] = []
  const reader = stream.readable.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length }
  return out
}

// ---------------------------------------------------------------------------
// Core fetch helper
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  let body = options?.body
  const extraHeaders: Record<string, string> = {}

  if (options?.method === 'POST' && typeof body === 'string') {
    body = await gzipString(body)
    extraHeaders['Content-Encoding'] = 'gzip'
  }

  const res = await fetch(`${APP_ORIGIN}${path}`, {
    ...options,
    body,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
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
