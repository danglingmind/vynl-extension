# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A browser extension that lets users capture any webpage and push it as a new file or revision into a Vynl project — without leaving the browser. The extension is being built from scratch per `EXTENSION_PLAN.md`.

## Tech Stack

- **Framework**: [WXT](https://wxt.dev) — Vite-based extension framework with MV3, HMR, TypeScript support
- **Language**: TypeScript + React + Tailwind
- **State**: Zustand
- **Auth**: Clerk (no separate auth — reuses the main Vynl app's session)
- **Build targets**: Chrome MV3 + Firefox MV3

## Commands

```bash
npm install
npm run dev        # WXT dev server with HMR
npm run build      # Build chrome + firefox zips in dist/
npm run zip        # Package for store submission
```

Load the extension in Chrome: `chrome://extensions → Load unpacked → select dist/chrome-mv3`

For local development, set `appOrigin` in `src/lib/auth.ts` to `http://localhost:3000` and add `http://localhost:3000/*` to `host_permissions` in the dev manifest.

## Architecture

```
src/entrypoints/
  popup/           # React app rendered in the extension popup (380×520px)
  background.ts    # Service worker: all API calls, token refresh, HTML capture
  content.ts       # Content script: Clerk token retrieval only
src/components/
  AuthGate.tsx     # Renders login prompt when token is unavailable
  ProjectPicker.tsx # Workspace → Project → File tree
  CaptureForm.tsx  # Title, viewport selector, submit
src/store/index.ts # Zustand store: auth status, projects, UI state, capture status
src/api/vynl.ts    # Typed wrappers for /api/extension/projects and /api/extension/snapshot
src/lib/auth.ts    # getClerkToken() — injects script into open Vynl tab to get JWT
```

## Critical Architectural Rules

**All API calls must go through the background service worker** — never from content scripts or the popup directly. The background's `host_permissions` bypass CORS; the popup and content scripts do not.

**Message protocol** (popup ↔ background):
- `{ type: 'GET_PROJECTS' }` → `{ type: 'PROJECTS', data }` or `{ type: 'AUTH_REQUIRED' }` or `{ type: 'ERROR', message, status? }`
- `{ type: 'CAPTURE', tabId, payload }` → `{ type: 'CAPTURE_DONE', file }` or error variants

**HTML capture** (`capturePageHtml` injected via `chrome.scripting.executeScript`):
1. Inject a `<base>` tag (if missing) using `location.origin + location.pathname` so relative URLs resolve in the viewer
2. Assign `vynl-id="vynl-N"` to every DOM element (three-pass: TreeWalker + querySelectorAll + explicit root elements) — required by the annotation system
3. Return `document.documentElement.outerHTML`

This must mirror the Cloudflare Puppeteer worker's `snapshot.ts` logic exactly. Do not change the ID assignment scheme.

**Token caching**: Clerk JWTs are cached in `chrome.storage.session` for 45 seconds. On 401 from the API, clear the cache, re-fetch the token, and retry once before surfacing the error.

## API

Base URL: `https://your-app-domain.com` (replace with actual domain; `http://localhost:3000` for local dev)

- `GET /api/extension/projects` — returns workspaces with nested projects and website files
- `POST /api/extension/snapshot` — creates new file (`projectId`) or revision (`parentFileId`); never both

See `EXTENSION_PLAN.md` §7 for full request/response shapes and error codes.

## Key Edge Cases

| Scenario | Behavior |
|---|---|
| No open Vynl tab | Show "Open Vynl in another tab" — cannot get Clerk token |
| `chrome://` pages | `activeTab` unavailable — show "Capture not available on this page" |
| CSP blocks `executeScript` | Catch error, show "This page blocked the capture" |
| HTML > 5MB | Warn the user before submitting |
| Tab is a PDF | `outerHTML` is viewer shell — warn "PDF pages are not supported" |
| `document.title` empty | Leave title blank, require user input |

## "View in Vynl" Deep Link

After a successful capture, link to: `https://your-app-domain.com/project/{file.projectId}/file/{file.id}` — both IDs are returned in the snapshot API response.
