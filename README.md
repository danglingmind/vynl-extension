# Vynl — Webpage Capture Extension

A browser extension that lets you capture any live webpage and push it as a new file or revision into a Vynl project — without leaving the browser.

Works on live sites, localhost builds, and staging environments. Captures the fully-rendered DOM including JS-generated content, CSS-in-JS styles, and lazy-loaded assets.

---

## How It Works

1. Click the Vynl extension icon on any tab
2. Pick a destination — a project (new file) or an existing page in a project (new revision)
3. Set a title and optional viewport
4. Hit **Capture**
5. The page appears in your Vynl project immediately

---

## Tech Stack

| Concern | Choice |
|---|---|
| Extension framework | [WXT](https://wxt.dev) — Vite-based, MV3, HMR, TypeScript |
| UI | React + Tailwind CSS |
| State | Zustand |
| Auth | Clerk (reuses the main Vynl app's session — no separate login) |
| Build targets | Chrome MV3 + Firefox MV3 |

---

## Project Structure

```
src/
├── entrypoints/
│   ├── popup/          # React app rendered in the 380×520px popup
│   │   ├── App.tsx
│   │   ├── index.html
│   │   └── main.tsx
│   └── background.ts   # Service worker: all API calls, token refresh, HTML capture
├── components/
│   ├── AuthGate.tsx     # Login prompt when no Vynl tab is open
│   ├── ProjectPicker.tsx # Workspace → Project → File tree
│   └── CaptureForm.tsx  # Title, viewport selector, submit
├── api/
│   └── vynl.ts          # Typed wrappers for /api/extension/* endpoints
├── lib/
│   ├── auth.ts          # getClerkToken() — retrieves JWT from open Vynl tab
│   ├── capture.ts       # captureHtml() — injected into target tab
│   ├── messages.ts      # Popup ↔ background message types
│   └── constants.ts
└── store/
    └── index.ts         # Zustand store: auth, projects, UI, capture status
```

---

## Local Development

### Prerequisites

- Node.js 18+
- The main Vynl app running locally (for auth)

### Setup

```bash
npm install
npm run dev
```

WXT starts a dev server with HMR. Load the extension in Chrome:

```
chrome://extensions → Enable "Developer mode" → Load unpacked → select .output/chrome-mv3
```

### Pointing at localhost

In [src/lib/auth.ts](src/lib/auth.ts), change `appOrigin` to `http://localhost:3000`.

In [wxt.config.ts](wxt.config.ts), add `http://localhost:3000/*` to `host_permissions`.

---

## Building

```bash
# Chrome zip (for Web Store)
npm run zip

# Firefox zip + sources zip (for Add-ons Hub)
npm run build:firefox && npx wxt zip -b firefox
```

Output files appear in `.output/`:

| File | Purpose |
|---|---|
| `vynl-extension-{version}-chrome.zip` | Chrome Web Store upload |
| `vynl-extension-{version}-firefox.zip` | Firefox Add-ons upload |
| `vynl-extension-{version}-sources.zip` | Firefox review requirement (source code) |

---

## Publishing

### Bump the version

Update `version` in both [package.json](package.json) and [wxt.config.ts](wxt.config.ts) before building.

### Chrome Web Store

1. Go to the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Select the extension → **Package** → **Upload new package**
3. Upload `vynl-extension-{version}-chrome.zip`
4. Fill in release notes and submit for review

### Firefox Add-ons

1. Go to the [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/)
2. Select the extension → **Upload New Version**
3. Upload `vynl-extension-{version}-firefox.zip`
4. When prompted for source code, upload `vynl-extension-{version}-sources.zip`
5. Submit for review

---

## Architecture Notes

### All API calls go through the background service worker

The background's `host_permissions` bypass CORS. Never make API calls from content scripts or the popup directly.

### Authentication

The extension reuses the main Vynl app's Clerk session. When the popup opens, the background looks for an open tab on the Vynl domain and injects a script to call `window.Clerk.session.getToken()`. The resulting JWT is cached in `chrome.storage.session` for 45 seconds.

If no Vynl tab is open, the popup shows a prompt to open the app first.

### HTML capture (`src/lib/capture.ts`)

The capture function is injected into the active tab via `chrome.scripting.executeScript`. It:

1. **Waits for network idle** — waits 1200ms after the last resource load (mirrors the Cloudflare Puppeteer worker's `waitForNetworkIdle`)
2. **Scrolls through the page** — triggers IntersectionObserver-based lazy loads for background images and off-screen content
3. **Serializes CSSOM rules** — JS frameworks like Showit call `sheet.insertRule()` without touching `<style>` tag textContent; `outerHTML` silently misses those rules, so we sync the CSSOM back to textContent first
4. **Captures `document.adoptedStyleSheets`** — handles CSS Houdini / Web Components styles that have no DOM owner
5. **Assigns `vynl-id`** to every element (three-pass: TreeWalker + querySelectorAll + explicit root elements)
6. **Prepends a `<base>` tag** so relative asset URLs resolve in the viewer
7. **Injects a re-applicator script** instead of neutralizing scripts — preserves JS effects (parallax, animations, SPAs) while keeping vynl-ids stable by re-assigning them after frameworks re-render

### Message protocol

```
Popup → background:
  { type: 'GET_PROJECTS' }
  { type: 'CAPTURE', tabId, payload }

Background → popup:
  { type: 'PROJECTS', data }
  { type: 'CAPTURE_DONE', file }
  { type: 'AUTH_REQUIRED' }
  { type: 'ERROR', message, status? }
```

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| No open Vynl tab | "Open Vynl in another tab" prompt |
| `chrome://` pages | "Capture not available on this page" |
| CSP blocks `executeScript` | "This page blocked the capture" |
| HTML > 5MB | Warning shown before submitting |
| PDF tab | "PDF pages are not supported" |
| Empty `document.title` | Title field left blank, user must fill it |
| 401 mid-session | Clear cached token, re-fetch, retry once automatically |
