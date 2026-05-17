/**
 * Injects capturePageHtml into the active tab and returns the serialized HTML.
 *
 * Must be called from the background service worker — requires scripting API.
 */
export async function captureHtml(tabId: number): Promise<string> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: capturePageHtml
  })
  return results[0].result as string
}

/**
 * Injected into the target tab. Must be self-contained — no imports, no closures.
 *
 * Steps:
 *  0. Wait for page load + network idle
 *  1. Scroll through page to trigger IntersectionObserver-based lazy loads
 *  2. Serialize CSSOM rules into inline <style> tags; absolutize url() references
 *     using each stylesheet's own href as the base (fixes relative paths in external
 *     sheets). For local pages, additionally inline as base64 data URIs.
 *  3. Inline ALL <img>, <picture><source>, and <input type="image"> as base64
 *     data URIs. Uses canvas for already-loaded images (avoids re-fetch and works
 *     around CORS for same-origin images); falls back to fetch; falls back to
 *     absolutized URL. Also clears srcset/sizes so the viewer uses the inlined src.
 *  4. Assign vynl-id to every element
 *  5. Inject <base> tag
 *  6. Inject vynl-id re-applicator script
 *  7. Serialize and return outerHTML
 */
async function capturePageHtml(): Promise<string> {
  const doc = document
  const isLocal =
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/.test(location.hostname) ||
    location.protocol === 'file:'

  // ── Helpers ──────────────────────────────────────────────────────────────

  async function toDataUri(url: string): Promise<string | null> {
    try {
      const resp = await fetch(url, { cache: 'force-cache' })
      if (!resp.ok) return null
      const blob = await resp.blob()
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
    } catch {
      return null
    }
  }

  // Canvas approach works for same-origin images that are already loaded,
  // without requiring a re-fetch or CORS headers.
  function imgElementToDataUri(img: HTMLImageElement): string | null {
    if (!img.complete || img.naturalWidth === 0) return null
    try {
      const canvas = doc.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(img, 0, 0)
      return canvas.toDataURL()
    } catch {
      return null // Tainted canvas for cross-origin images without CORS headers
    }
  }

  // Resolve url() references in CSS text against the stylesheet's own URL.
  // inline=true: convert to base64 data URIs (local pages).
  // inline=false: just absolutize so relative refs survive stylesheet inlining.
  async function processCssUrls(css: string, baseUrl: string, inline: boolean): Promise<string> {
    const urlRegex = /url\(\s*(['"]?)(?!data:)(?!#)([^'")]+)\1\s*\)/g
    const matches: { start: number; end: number; rawUrl: string; quote: string }[] = []
    let m: RegExpExecArray | null
    while ((m = urlRegex.exec(css)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, rawUrl: m[2].trim(), quote: m[1] })
    }
    if (matches.length === 0) return css

    const replacements = await Promise.all(
      matches.map(async ({ rawUrl, quote }) => {
        let absUrl: string
        try { absUrl = new URL(rawUrl, baseUrl).href } catch { return null }
        if (inline) {
          const dataUri = await toDataUri(absUrl)
          // If inlining fails, fall back to absolutized URL so it's not broken
          return dataUri ? `url(${dataUri})` : `url(${quote}${absUrl}${quote})`
        }
        return `url(${quote}${absUrl}${quote})`
      })
    )

    let result = css
    for (let i = matches.length - 1; i >= 0; i--) {
      const r = replacements[i]
      if (r) {
        const { start, end } = matches[i]
        result = result.slice(0, start) + r + result.slice(end)
      }
    }
    return result
  }

  // ── Step 0: Wait for full page load + network idle ───────────────────────
  if (doc.readyState !== 'complete') {
    await new Promise<void>(resolve =>
      window.addEventListener('load', () => resolve(), { once: true })
    )
  }

  const waitForIdle = (idleMs: number, maxMs: number) =>
    new Promise<void>(resolve => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        try { observer.disconnect() } catch {}
        resolve()
      }
      let idleTimer = setTimeout(done, idleMs)
      setTimeout(done, maxMs)
      const observer = new PerformanceObserver(() => {
        clearTimeout(idleTimer)
        idleTimer = setTimeout(done, idleMs)
      })
      try { observer.observe({ entryTypes: ['resource'] }) } catch {}
    })

  await waitForIdle(1200, 10000)

  // ── Step 1: Scroll through page to trigger lazy-loaded content ────────────
  const origScrollX = window.scrollX
  const origScrollY = window.scrollY
  const docHeight = Math.max(doc.body?.scrollHeight ?? 0, doc.documentElement.scrollHeight)
  const viewportH = window.innerHeight || 800

  for (let y = 0; y < docHeight; y += viewportH) {
    window.scrollTo({ top: y, left: 0, behavior: 'instant' as ScrollBehavior })
    await new Promise(r => setTimeout(r, 80))
  }
  window.scrollTo({ top: origScrollY, left: origScrollX, behavior: 'instant' as ScrollBehavior })

  await waitForIdle(800, 5000)

  // ── Step 2: Serialize CSSOM rules into inline <style> tags ────────────────
  // For <link> stylesheets: replace the <link> with an inline <style>.
  // url() references are absolutized using the sheet's own href so that
  // relative paths (e.g. url('../fonts/icon.woff') in an external sheet)
  // continue to resolve correctly after inlining. For local pages, they are
  // additionally converted to base64 data URIs for full self-containment.
  await Promise.all(
    Array.from(doc.styleSheets).map(async sheet => {
      try {
        const owner = sheet.ownerNode as Element | null
        if (!owner) return
        const rules = Array.from(sheet.cssRules)
        if (rules.length === 0) return

        const sheetBase = (sheet as CSSStyleSheet).href || location.href
        let cssText = rules.map(r => r.cssText).join('\n')
        cssText = await processCssUrls(cssText, sheetBase, isLocal)

        if (owner.tagName === 'STYLE') {
          ;(owner as HTMLStyleElement).textContent = cssText
        } else if (owner.tagName === 'LINK') {
          const style = doc.createElement('style')
          style.textContent = cssText
          const media = (owner as HTMLLinkElement).media
          if (media) style.setAttribute('media', media)
          owner.parentNode?.replaceChild(style, owner)
        }
      } catch {
        // Cross-origin stylesheet — cannot read cssRules, skip
      }
    })
  )

  // Handle document.adoptedStyleSheets (CSS Houdini / Web Components)
  const adoptedSheets = (doc as Document & { adoptedStyleSheets?: CSSStyleSheet[] })
    .adoptedStyleSheets ?? []
  const adoptedCSSParts: string[] = []
  for (const sheet of adoptedSheets) {
    try {
      const rules = Array.from(sheet.cssRules)
      if (rules.length > 0) adoptedCSSParts.push(rules.map(r => r.cssText).join('\n'))
    } catch {}
  }
  if (adoptedCSSParts.length > 0) {
    let adoptedCSS = adoptedCSSParts.join('\n')
    adoptedCSS = await processCssUrls(adoptedCSS, location.href, isLocal)
    const style = doc.createElement('style')
    style.setAttribute('data-vynl', 'adopted-cssom')
    style.textContent = adoptedCSS
    doc.head?.appendChild(style)
  }

  // ── Step 3: Inline all images as base64 data URIs ────────────────────────
  // Done for ALL pages (not just local). The viewer cannot reliably load images
  // from their original origins due to CSP, CORS, CDN restrictions, or auth.
  // Strategy for <img>:
  //   1. Use currentSrc (browser's actual chosen URL — handles srcset selection)
  //   2. Try canvas on the already-loaded element (same-origin, no re-fetch)
  //   3. Fall back to fetch (cross-origin with CORS headers)
  //   4. Fall back to absolutized URL so at least relative paths don't break
  // srcset/sizes are cleared so the viewer uses the single inlined src.
  await Promise.all([
    ...Array.from(doc.querySelectorAll<HTMLImageElement>('img')).map(async img => {
      // currentSrc is the browser's resolved URL (picks from srcset if applicable)
      const url = img.currentSrc || img.src
      if (!url || url.startsWith('data:') || url.startsWith('#')) return

      let dataUri: string | null = imgElementToDataUri(img)
      if (!dataUri) dataUri = await toDataUri(url)

      if (dataUri) {
        img.setAttribute('src', dataUri)
      } else {
        // Absolutize so relative src values don't break in viewer
        try { img.setAttribute('src', new URL(url, location.href).href) } catch {}
      }
      img.removeAttribute('srcset')
      img.removeAttribute('sizes')
    }),

    // <picture><source srcset="..."> — pick highest-resolution entry and inline
    ...Array.from(doc.querySelectorAll<HTMLSourceElement>('picture source')).map(async el => {
      const srcset = el.getAttribute('srcset')
      const src = el.getAttribute('src')
      // Last entry in srcset is typically the highest resolution
      const rawUrl = srcset
        ? srcset.split(',').map((s: string) => s.trim().split(/\s+/)[0]).filter(Boolean).pop() || ''
        : src || ''
      if (!rawUrl || rawUrl.startsWith('data:')) return
      try {
        const abs = new URL(rawUrl, location.href).href
        const dataUri = await toDataUri(abs)
        if (dataUri) {
          el.setAttribute('src', dataUri)
        } else {
          el.setAttribute('src', abs)
        }
        el.removeAttribute('srcset')
        el.removeAttribute('sizes')
        el.removeAttribute('type')
      } catch {}
    }),

    // <input type="image">
    ...Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="image"][src]')).map(async el => {
      const src = el.getAttribute('src')
      if (!src || src.startsWith('data:') || src.startsWith('#')) return
      try {
        const abs = new URL(src, location.href).href
        const dataUri = await toDataUri(abs)
        if (dataUri) el.setAttribute('src', dataUri)
        else el.setAttribute('src', abs)
      } catch {}
    }),
  ])

  // ── Step 4: Assign vynl-id to every element ──────────────────────────────
  let counter = 1
  const processed = new WeakSet<Element>()

  const processElement = (el: Element) => {
    if (processed.has(el)) return
    processed.add(el)
    el.setAttribute('vynl-id', `vynl-${counter++}`)
    const shadow = (el as HTMLElement & { shadowRoot?: ShadowRoot }).shadowRoot
    if (shadow) shadow.querySelectorAll('*').forEach(processElement)
  }

  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_ELEMENT, null)
  let node: Element | null
  while ((node = walker.nextNode() as Element | null)) processElement(node)
  doc.querySelectorAll('*').forEach(processElement)
  ;[doc.documentElement, doc.head, doc.body].forEach(el => {
    if (el && !processed.has(el)) processElement(el)
  })

  // ── Step 5: Base tag ──────────────────────────────────────────────────────
  // For remote pages: prepend with the full origin+pathname so any remaining
  // relative asset URLs resolve correctly in the viewer.
  // For local pages: omit href — assets are already inlined as data URIs above.
  const base = doc.createElement('base')
  if (!isLocal) {
    base.href = location.origin + location.pathname + location.search
  }
  doc.head?.prepend(base)

  // ── Step 6: Inject vynl-id re-applicator ─────────────────────────────────
  const reapplicator = doc.createElement('script')
  reapplicator.setAttribute('data-vynl', 'id-reapplicator')
  reapplicator.textContent = `(function(){
  var t=null;
  function apply(){
    var n=1,p=new WeakSet();
    function proc(el){
      if(p.has(el))return;p.add(el);
      el.setAttribute('vynl-id','vynl-'+n++);
      if(el.shadowRoot)el.shadowRoot.querySelectorAll('*').forEach(proc);
    }
    var w=document.createTreeWalker(document,NodeFilter.SHOW_ELEMENT,null);
    var nd;while((nd=w.nextNode()))proc(nd);
    document.querySelectorAll('*').forEach(proc);
    [document.documentElement,document.head,document.body].forEach(function(e){
      if(e&&!p.has(e))proc(e);
    });
  }
  function schedule(){clearTimeout(t);t=setTimeout(apply,150);}
  var obs=new MutationObserver(function(ms){
    for(var i=0;i<ms.length;i++){if(ms[i].addedNodes.length){schedule();return;}}
  });
  obs.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('load',function(){apply();setTimeout(apply,600);});
})();`
  doc.head?.prepend(reapplicator)

  // ── Step 7: Serialize ─────────────────────────────────────────────────────
  return doc.documentElement.outerHTML
}
