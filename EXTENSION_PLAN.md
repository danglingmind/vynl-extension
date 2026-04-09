# Browser Extension — Full Implementation Plan

This document is a complete spec for building the Vynl browser extension as a standalone package. The extension lets users capture any webpage (including locally running ones) and push it directly into a Vynl project or as a revision of an existing file — without leaving the browser.

---

## 1. What the Extension Does

1. User clicks the extension icon on any tab
2. Extension popup opens, user is either prompted to log in or sees their projects
3. User picks a destination: **a project** (new file) or **an existing webpage in a project** (new revision)
4. User gives the capture a title, optionally picks a viewport, then hits "Capture"
5. Extension reads the current tab's full HTML and sends it to the Vynl API
6. Done — file appears in the project immediately

---

## 2. Recommended Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | [WXT](https://wxt.dev) | Modern Vite-based extension framework; supports MV3, HMR, TypeScript out of the box |
| Language | TypeScript | |
| UI | React + Tailwind | Match the main app's stack |
| State | Zustand | Lightweight, works well in popup context |
| HTTP | Native `fetch` | From background service worker; no library needed |
| Build target | Chrome MV3 + Firefox MV3 | WXT handles the differences |

---

## 3. Project Structure

```
extension/
├── wxt.config.ts
├── package.json
├── tsconfig.json
├── public/
│   └── icons/          # 16, 32, 48, 128px PNGs
├── src/
│   ├── entrypoints/
│   │   ├── popup/
│   │   │   ├── index.html
│   │   │   ├── App.tsx         # Root popup component
│   │   │   └── main.tsx
│   │   ├── background.ts       # Service worker: API calls, token refresh
│   │   └── content.ts          # Content script: HTML capture + Clerk token retrieval
│   ├── components/
│   │   ├── AuthGate.tsx        # Shows login prompt if not authenticated
│   │   ├── ProjectPicker.tsx   # Workspace → Project → (optional) File tree
│   │   └── CaptureForm.tsx     # Title, viewport selector, submit button
│   ├── store/
│   │   └── index.ts            # Zustand store: auth token, projects data, UI state
│   ├── api/
│   │   └── vynl.ts             # Typed wrappers around both extension API endpoints
│   └── lib/
│       └── auth.ts             # Token retrieval logic
```

---

## 4. Manifest Permissions

```json
{
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": [
    "https://your-app-domain.com/*"
  ]
}
```

- **`activeTab`** — read the current tab's URL and inject scripts on demand
- **`scripting`** — inject content script to capture HTML and retrieve Clerk token
- **`storage`** — persist the auth token and cached projects across popup sessions
- **`host_permissions`** — allows background service worker to make cross-origin fetch calls to the API without CORS issues; **no CORS headers need to be added to the server**

> **Note on CORS**: Fetch calls from the background service worker bypass CORS as long as `host_permissions` covers the target domain. Do NOT make API calls from content scripts or the popup itself — always proxy through the background.

---

## 5. Authentication

The extension reuses Clerk — no separate auth system is needed. The app stores the active Clerk session in the page's JavaScript context. The extension retrieves a short-lived JWT by injecting a script into an open tab on the app's domain.

### Flow

```
Popup opened
  └─► background: "get token"
        └─► Find tab with app domain open
              ├─ Found → inject script → call window.Clerk.session.getToken()
              │          → return JWT to background → store in chrome.storage.session
              └─ Not found → return null → popup shows "Open Vynl to log in"
```

### Token Retrieval (`src/lib/auth.ts`)

```ts
// Called from background service worker
export async function getClerkToken(): Promise<string | null> {
  const appOrigin = 'https://your-app-domain.com'

  // Check storage cache first (tokens are valid for ~60s, Clerk refreshes them)
  const cached = await chrome.storage.session.get('vynl_token')
  if (cached.vynl_token) return cached.vynl_token

  // Find an open tab on the app domain
  const tabs = await chrome.tabs.query({ url: `${appOrigin}/*` })
  if (!tabs.length || !tabs[0].id) return null

  // Inject script to retrieve Clerk token from the page context
  const results = await chrome.scripting.executeScript({
    target: { tabId: tabs[0].id },
    func: () => {
      // @ts-ignore — Clerk is attached to window by the app
      return window.Clerk?.session?.getToken?.() ?? null
    }
  })

  const token = results?.[0]?.result ?? null
  if (token) {
    // Cache briefly — Clerk tokens expire, but 45s is safe
    await chrome.storage.session.set({ vynl_token: token })
    setTimeout(() => chrome.storage.session.remove('vynl_token'), 45_000)
  }

  return token
}
```

### What the popup shows

| State | UI |
|---|---|
| Token found, user exists | Project picker |
| Token null (no app tab open) | "Open Vynl in another tab to use the extension" + link to app |
| API returns 401 | "Session expired — please reload the Vynl tab" |

---

## 6. HTML Capture

The extension captures the **current tab's fully-rendered HTML** (post-JS execution, not the raw source). This is done by injecting a script into the active tab via `chrome.scripting.executeScript`.

The capture logic mirrors exactly what the Cloudflare Puppeteer worker does, adapted for the extension context. Since the extension runs inside an already-loaded live page, the "wait for network idle" step is skipped — the DOM is already there. The two remaining steps that **must** be replicated are:

1. **Inject a `<base>` tag** — ensures all relative asset URLs (images, CSS, JS) in the snapshot resolve correctly when the HTML is replayed in the viewer
2. **Assign `vynl-id` to every element** — sequential IDs used by the annotation system to anchor annotations to specific DOM nodes; must be assigned before serialization

```ts
// Injected into the active tab via chrome.scripting.executeScript
// Mirrors the Cloudflare worker's snapshot.ts logic
function capturePageHtml(): string {
  const doc = document

  // Step 1: Inject <base> tag so relative URLs resolve when the snapshot is replayed
  // Use origin + pathname (no query/hash) — same as the worker
  const existingBase = doc.querySelector('base')
  if (!existingBase) {
    const base = doc.createElement('base')
    base.href = location.origin + location.pathname
    const head = doc.querySelector('head')
    if (head) head.prepend(base)
  }

  // Step 2: Assign vynl-id to every element in the DOM
  // Uses the same three-method approach as the worker for guaranteed coverage
  let counter = 1
  const processedElements = new WeakSet<Element>()

  const processElement = (element: Element) => {
    if (processedElements.has(element)) return
    processedElements.add(element)
    element.setAttribute('vynl-id', `vynl-${counter++}`)

    // Recurse into shadow DOM if present
    if ((element as any).shadowRoot) {
      (element as any).shadowRoot.querySelectorAll('*').forEach(processElement)
    }
  }

  // Method 1: TreeWalker — traverses all elements in document order
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_ELEMENT, null)
  let node: Element | null
  while ((node = walker.nextNode() as Element | null)) {
    processElement(node)
  }

  // Method 2: querySelectorAll — comprehensive backup pass
  doc.querySelectorAll('*').forEach(processElement)

  // Method 3: Explicitly cover root elements as final safety measure
  if (doc.documentElement && !processedElements.has(doc.documentElement)) processElement(doc.documentElement)
  if (doc.head && !processedElements.has(doc.head)) processElement(doc.head)
  if (doc.body && !processedElements.has(doc.body)) processElement(doc.body)

  // Serialize the fully prepared DOM
  return doc.documentElement.outerHTML
}

// Called from background service worker when user hits "Capture"
async function captureHtml(tabId: number): Promise<string> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: capturePageHtml   // injected as a function, not an eval string
  })
  return results[0].result as string
}
```

> **Important:** `capturePageHtml` mutates the live DOM (adds `<base>` tag and `vynl-id` attributes) before reading `outerHTML`. This is intentional and matches the worker's behavior. The mutation is benign and doesn't visually affect the page.

> The popup sends a message to the background: `{ type: 'CAPTURE', tabId, payload }`. The background captures HTML and calls the API, then sends back `{ type: 'CAPTURE_DONE', file }` or `{ type: 'CAPTURE_ERROR', message }`.

---

## 7. API Reference

Both endpoints require:
```
Authorization: Bearer <clerk-jwt>
Content-Type: application/json
```

### 7.1 `GET /api/extension/projects`

Returns all workspaces + projects the user belongs to, with WEBSITE files nested inside each project (for revision picking).

**Response**
```json
{
  "workspaces": [
    {
      "id": "ws_xxx",
      "name": "My Workspace",
      "role": "OWNER",
      "projects": [
        {
          "id": "proj_xxx",
          "name": "Landing Page Redesign",
          "websiteFiles": [
            {
              "id": "file_xxx",
              "fileName": "Homepage v1",
              "metadata": { "originalUrl": "https://example.com", "isLocalCapture": false },
              "createdAt": "2026-04-04T10:00:00.000Z"
            }
          ]
        }
      ]
    }
  ]
}
```

**Error cases**
| Status | Meaning |
|---|---|
| 401 | Token missing or invalid |
| 404 | User not found in DB (account not set up) |
| 500 | Server error |

---

### 7.2 `POST /api/extension/snapshot`

Uploads an HTML snapshot as a new file **or** a new revision. Provide `projectId` for new files, `parentFileId` for revisions — never both.

**Request body**
```json
{
  "projectId": "proj_xxx",           // required for new file — omit when adding revision
  "parentFileId": "file_xxx",        // required for revision — omit when creating new file
  "title": "Homepage — April 2026",  // required always
  "url": "https://example.com",      // required — can be localhost/file:// URL
  "htmlContent": "<html>...</html>", // required — full serialized DOM
  "viewport": "DESKTOP"              // optional: DESKTOP (default) | TABLET | MOBILE
}
```

**Success response (200)**
```json
{
  "success": true,
  "file": {
    "id": "file_yyy",
    "fileName": "Homepage — April 2026",
    "fileType": "WEBSITE",
    "status": "READY",
    "revisionNumber": 2,
    "isRevision": true,
    "projectId": "proj_xxx",
    "fileUrl": "snapshots/file_yyy/abc123.html",
    "metadata": {
      "originalUrl": "http://localhost:3000",
      "canonicalUrl": "https://local.capture/homepage-april-2026",
      "isLocalCapture": true,
      "viewport": "DESKTOP",
      "snapshotId": "abc123",
      "capture": { "timestamp": "...", "method": "extension", "document": { "scrollWidth": 1440, "scrollHeight": 900 } },
      "processing": { "method": "extension", "service": "browser-extension", "version": "1.0" }
    }
  }
}
```

**Error cases**
| Status | Body | Meaning |
|---|---|---|
| 400 | `Missing required fields` | `title`, `url`, or `htmlContent` absent |
| 400 | `Either projectId or parentFileId is required` | Neither provided |
| 400 | `Provide either projectId or parentFileId, not both` | Both provided |
| 400 | `Invalid URL provided` | Malformed URL |
| 400 | `Parent file not found or is not a WEBSITE file` | `parentFileId` points to a non-WEBSITE file |
| 400 | `Invalid viewport` | Not DESKTOP/TABLET/MOBILE |
| 401 | `Unauthorized` | No/invalid token |
| 403 | `Project not found or access denied` | User lacks EDITOR+ role |
| 403 | `File limit exceeded for this project` | Subscription limit hit |
| 404 | `User not found` | |
| 500 | `Failed to upload snapshot to storage` | Supabase error |

---

### Typed API client (`src/api/vynl.ts`)

```ts
const BASE_URL = 'https://your-app-domain.com'

async function apiFetch<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options?.headers
    }
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, body.error ?? 'Unknown error')
  }
  return res.json()
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function fetchProjects(token: string) {
  return apiFetch<{ workspaces: Workspace[] }>('/api/extension/projects', token)
}

export async function pushSnapshot(token: string, payload: SnapshotPayload) {
  return apiFetch<{ success: true; file: VynlFile }>('/api/extension/snapshot', token, {
    method: 'POST',
    body: JSON.stringify(payload)
  })
}

// Types
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

export type SnapshotPayload =
  | { projectId: string; parentFileId?: never; title: string; url: string; htmlContent: string; viewport?: 'DESKTOP' | 'TABLET' | 'MOBILE' }
  | { parentFileId: string; projectId?: never; title: string; url: string; htmlContent: string; viewport?: 'DESKTOP' | 'TABLET' | 'MOBILE' }
```

---

## 8. Message Protocol (Popup ↔ Background)

All API calls and HTML capture happen in the background service worker. The popup only sends messages and renders responses.

```ts
// Message types
type ExtensionMessage =
  | { type: 'GET_PROJECTS' }
  | { type: 'CAPTURE'; tabId: number; payload: SnapshotPayload }

type ExtensionResponse =
  | { type: 'PROJECTS'; data: { workspaces: Workspace[] } }
  | { type: 'CAPTURE_DONE'; file: VynlFile }
  | { type: 'AUTH_REQUIRED' }
  | { type: 'ERROR'; message: string; status?: number }
```

**Popup sends:**
```ts
chrome.runtime.sendMessage({ type: 'GET_PROJECTS' }, (response) => { ... })
chrome.runtime.sendMessage({ type: 'CAPTURE', tabId, payload }, (response) => { ... })
```

**Background handles (background.ts):**
```ts
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg).then(sendResponse)
  return true // keep channel open for async response
})

async function handleMessage(msg: ExtensionMessage): Promise<ExtensionResponse> {
  const token = await getClerkToken()
  if (!token) return { type: 'AUTH_REQUIRED' }

  if (msg.type === 'GET_PROJECTS') {
    const data = await fetchProjects(token)
    return { type: 'PROJECTS', data }
  }

  if (msg.type === 'CAPTURE') {
    const htmlContent = await captureHtml(msg.tabId)
    const file = await pushSnapshot(token, { ...msg.payload, htmlContent })
    return { type: 'CAPTURE_DONE', file: file.file }
  }
}
```

---

## 9. UI Flows

### 9.1 Normal flow (new file)
```
Popup opens
  → background fetches projects
  → show workspace/project tree
  User selects a project
  → "Add to [Project Name]" section appears
  → Title field (pre-filled with document.title), Viewport dropdown
  → "Capture" button
  → loading spinner
  → success: "Saved! View in Vynl →" (links to the file in the app)
```

### 9.2 Revision flow
```
User selects a project that has existing website files
  → project row expands showing existing pages
  → user clicks one of the existing pages ("Add revision")
  → title field (pre-filled with existing file's name), viewport dropdown
  → "Capture as Revision" button
  → same loading → success flow
```

### 9.3 Not logged in
```
Popup opens
  → background finds no app tab
  → show: "Open Vynl in another tab to continue"
  → "Open Vynl" button → chrome.tabs.create({ url: appUrl })
```

### 9.4 Local URL (informational label only)
```
Tab URL is localhost / 192.168.x.x / file://
  → show info banner: "Local page — will be captured as-is"
  → title field is required and focused
  → everything else same as normal flow
```

---

## 10. Popup UX Details

- **Popup size**: fixed 380×520px
- **Project picker**: collapsible workspace sections, scrollable list
  - Each workspace shows its name + role badge (OWNER / ADMIN / EDITOR)
  - Each project shows file count or "No website files yet"
  - Click project → expand to show "New file here" option + list of existing website files
- **Viewport selector**: segmented control — Desktop / Tablet / Mobile (icons)
- **Title field**: pre-filled with `document.title` of the active tab; user can edit
- **Capture button states**: idle → loading (spinner) → success (check icon) → error (retry)
- **"View in Vynl" link** after success: deep link to the file — `https://your-app-domain.com/project/{file.projectId}/file/{file.id}` (both `projectId` and `id` are in the snapshot API response)

---

## 11. State Management (`src/store/index.ts`)

```ts
interface ExtensionStore {
  // Auth
  token: string | null
  authStatus: 'loading' | 'authenticated' | 'unauthenticated'

  // Data
  workspaces: Workspace[]
  projectsStatus: 'idle' | 'loading' | 'loaded' | 'error'

  // UI state
  selectedProjectId: string | null
  selectedParentFileId: string | null   // null = new file, string = revision target
  title: string
  viewport: 'DESKTOP' | 'TABLET' | 'MOBILE'

  // Capture
  captureStatus: 'idle' | 'loading' | 'success' | 'error'
  captureError: string | null
  lastCapturedFile: VynlFile | null
}
```

---

## 12. Key Edge Cases

| Case | Handling |
|---|---|
| Page is still loading | Capture anyway — `outerHTML` reflects current DOM state |
| Very large page (>10MB HTML) | Show warning; API accepts it but uploads may be slow — consider a size check client-side (warn at 5MB) |
| `document.title` is empty | Leave title field blank, require user to fill it |
| User is on a PDF in the browser | `outerHTML` will just be a viewer shell — warn: "PDF pages are not supported for capture" |
| `chrome.scripting.executeScript` fails (CSP blocking) | Catch error, show: "This page blocked the capture. Try saving the page manually." |
| Token expired mid-session | 401 from API → clear cached token → re-fetch → retry once automatically |
| User selects a revision as parent | API handles this (`getOriginalFileId` traverses up) — no special handling needed in extension |
| Extension opened on `chrome://` page | `activeTab` doesn't work on internal pages — show: "Capture is not available on this page" |

---

## 13. Local Development Setup

```bash
# In the main app repo
npm run dev          # Start Vynl on localhost:3000

# In the extension repo
npm install
npm run dev          # WXT starts with HMR

# Load unpacked in Chrome
# chrome://extensions → Load unpacked → select extension/dist/chrome-mv3
```

For local auth to work during development, update `appOrigin` in `src/lib/auth.ts` to `http://localhost:3000` and add `http://localhost:3000/*` to `host_permissions` in the dev manifest.

---

## 14. Build & Release

```bash
npm run build           # Builds chrome + firefox zips in dist/
npm run zip             # Packages for store submission
```

WXT outputs:
- `dist/chrome-mv3.zip` — Chrome Web Store
- `dist/firefox-mv3.zip` — Firefox Add-ons (if targeted)

---

## 15. Implementation Order

1. **Scaffold** with WXT + React + TypeScript + Tailwind
2. **Auth** — `getClerkToken()` in background, store result, show auth gate in popup
3. **Project fetch** — `GET /api/extension/projects`, render workspace/project/file tree
4. **Capture form** — title field, viewport picker, submit button wired to background
5. **HTML capture** — `executeScript` → `outerHTML`, send to background
6. **New file flow** — background calls `POST /api/extension/snapshot` with `projectId`
7. **Revision flow** — user selects existing file → `parentFileId` sent instead
8. **Success/error states** — link to file in app, error messages, retry
9. **Edge cases** — CSP failures, large pages, PDF detection, `chrome://` pages
10. **Icons + polish** — match Vynl brand, test on common sites (localhost, GitHub, Figma, etc.)
