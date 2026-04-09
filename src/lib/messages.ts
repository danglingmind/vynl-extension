import type { VynlFile, Workspace, SnapshotPayload } from '../api/vynl'

// ---------------------------------------------------------------------------
// Messages sent FROM the popup TO the background
// ---------------------------------------------------------------------------

export type ExtensionMessage =
  | { type: 'GET_PROJECTS' }
  | { type: 'CAPTURE'; tabId: number; payload: Omit<SnapshotPayload, 'htmlContent'> }

// ---------------------------------------------------------------------------
// Responses sent FROM the background TO the popup
// ---------------------------------------------------------------------------

export type ExtensionResponse =
  | { type: 'PROJECTS'; data: { workspaces: Workspace[] } }
  | { type: 'CAPTURE_DONE'; file: VynlFile }
  | { type: 'AUTH_REQUIRED' }
  | { type: 'ERROR'; message: string; status?: number }
