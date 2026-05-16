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
 *  0. Wait for page load + network idle (mirrors Cloudflare Puppeteer worker)
 *  1. Scroll through page to trigger IntersectionObserver-based lazy loads
 *  2. Serialize CSSOM rules into inline <style> tags (replaces <link> sheets too)
 *     For local pages: also inline CSS url() references as base64 data URIs
 *  3. For local pages: inline <img> and <source> src attributes as base64
 *  4. Assign vynl-id to every element
 *  5. Inject <base> tag (always prepend, matching Cloudflare worker)
 *     For local pages: base href is set to empty to avoid localhost references
 *  6. Inject vynl-id re-applicator script
 *  7. Serialize and return outerHTML
 *
 * Why we inline assets for local pages:
 *   When capturing localhost or file:// pages, the Vynl viewer cannot fetch
 *   resources from those origins. We must embed CSS and images directly into
 *   the HTML as inline <style> tags and base64 data URIs so the capture is
 *   fully self-contained. For remote (https) pages the viewer can reach the
 *   assets directly, so inlining is skipped to keep payload size small.
 *
 * Why we NO LONGER neutralize scripts:
 *   The Cloudflare Puppeteer worker never neutralized scripts — and it produces
 *   correct output. Neutralizing all scripts broke Showit's JS-driven parallax,
 *   scroll animations, and other effects. Instead, we inject a re-applicator
 *   script (Step 6) that re-traverses and re-assigns vynl-ids after frameworks
 *   finish rendering in the viewer (using MutationObserver + post-load passes).
 *   Since Showit/React render the same DOM structure deterministically from the
 *   same data, the re-applicator produces identical vynl-id numbering, keeping
 *   annotations stable.
 *
 * Why CSSOM serialization is critical:
 *   Frameworks like Showit call CSSStyleSheet.insertRule() to inject CSS rules
 *   without touching <style> tag textContent. outerHTML silently misses those
 *   rules. We serialize the CSSOM back to textContent before capture so all
 *   CSS is present in the static HTML, even before scripts re-run in the viewer.
 */
async function capturePageHtml(): Promise<string> {
  const doc = document
  const isLocal =
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/.test(location.hostname) ||
    location.protocol === 'file:'

  // ── Helpers (only used for local pages) ──────────────────────────────────

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

  async function inlineCssUrls(css: string): Promise<string> {
    type UrlMatch = { start: number; end: number; rawUrl: string }
    const urlRegex = /url\(\s*(['"]?)(?!data:)(?!#)([^'")]+)\1\s*\)/g
    const matches: UrlMatch[] = []
    let m: RegExpExecArray | null
    while ((m = urlRegex.exec(css)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, rawUrl: m[2].trim() })
    }
    if (matches.length === 0) return css

    const dataUris = await Promise.all(
      matches.map(({ rawUrl }) => {
        try {
          return toDataUri(new URL(rawUrl, location.href).href)
        } catch {
          return Promise.resolve(null)
        }
      })
    )

    let result = css
    for (let i = matches.length - 1; i >= 0; i--) {
      const dataUri = dataUris[i]
      if (dataUri) {
        const { start, end } = matches[i]
        result = result.slice(0, start) + `url(${dataUri})` + result.slice(end)
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
  // For <link> stylesheets: replace the <link> with an inline <style> so the
  // viewer never needs to fetch external CSS (critical for local pages; also
  // picks up insertRule() additions on remote pages).
  await Promise.all(
    Array.from(doc.styleSheets).map(async sheet => {
      try {
        const owner = sheet.ownerNode as Element | null
        if (!owner) return
        const rules = Array.from(sheet.cssRules)
        if (rules.length === 0) return

        let cssText = rules.map(r => r.cssText).join('\n')
        if (isLocal) cssText = await inlineCssUrls(cssText)

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
    if (isLocal) adoptedCSS = await inlineCssUrls(adoptedCSS)
    const style = doc.createElement('style')
    style.setAttribute('data-vynl', 'adopted-cssom')
    style.textContent = adoptedCSS
    doc.head?.appendChild(style)
  }

  // ── Step 3: Inline images for local pages ────────────────────────────────
  // The Vynl viewer cannot reach localhost or file:// origins, so any <img>
  // or <source> src that points there must be embedded as a base64 data URI.
  if (isLocal) {
    await Promise.all(
      Array.from(doc.querySelectorAll<HTMLElement>('img[src], source[src], input[type="image"][src]')).map(
        async el => {
          const src = el.getAttribute('src')
          if (!src || src.startsWith('data:') || src.startsWith('#')) return
          try {
            const dataUri = await toDataUri(new URL(src, location.href).href)
            if (dataUri) el.setAttribute('src', dataUri)
          } catch {}
        }
      )
    )
  }

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
  // For remote pages: prepend with the full origin+pathname so relative asset
  // URLs resolve correctly in the viewer (matches Cloudflare worker behavior).
  // For local pages: omit href — assets are already inlined as data URIs above,
  // and a localhost base href would cause broken-resource noise in the viewer.
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
