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
 *  2. Serialize CSSOM rules back into <style> tags
 *  3. Assign vynl-id to every element
 *  4. Inject <base> tag (always prepend, matching Cloudflare worker)
 *  5. Inject vynl-id re-applicator script
 *  6. Serialize and return outerHTML
 *
 * Why we NO LONGER neutralize scripts:
 *   The Cloudflare Puppeteer worker never neutralized scripts — and it produces
 *   correct output. Neutralizing all scripts broke Showit's JS-driven parallax,
 *   scroll animations, and other effects. Instead, we inject a re-applicator
 *   script (Step 5) that re-traverses and re-assigns vynl-ids after frameworks
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
  // Showit and similar frameworks use IntersectionObserver to set background
  // images and trigger animations only when elements enter the viewport.
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

  // ── Step 2: Serialize CSSOM rules into <style> textContent ────────────────
  // JS frameworks call sheet.insertRule() without touching textContent.
  // outerHTML only captures textContent — insertRule additions are lost.
  // Overwrite textContent with full CSSOM serialization before capturing.
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      const owner = sheet.ownerNode as Element | null
      if (!owner || owner.tagName !== 'STYLE') continue
      const rules = Array.from(sheet.cssRules)
      if (rules.length === 0) continue
      ;(owner as HTMLStyleElement).textContent = rules.map(r => r.cssText).join('\n')
    } catch {
      // Cross-origin stylesheet — cannot read cssRules, skip
    }
  }

  // Handle document.adoptedStyleSheets (CSS Houdini / Web Components)
  const adoptedSheets = (doc as Document & { adoptedStyleSheets?: CSSStyleSheet[] })
    .adoptedStyleSheets ?? []
  const adoptedCSS: string[] = []
  for (const sheet of adoptedSheets) {
    try {
      const rules = Array.from(sheet.cssRules)
      if (rules.length > 0) adoptedCSS.push(rules.map(r => r.cssText).join('\n'))
    } catch {}
  }
  if (adoptedCSS.length > 0) {
    const style = doc.createElement('style')
    style.setAttribute('data-vynl', 'adopted-cssom')
    style.textContent = adoptedCSS.join('\n')
    doc.head?.appendChild(style)
  }

  // ── Step 3: Assign vynl-id to every element ──────────────────────────────
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

  // ── Step 4: Base tag — always prepend (matches Cloudflare worker behavior) ─
  const base = doc.createElement('base')
  base.href = location.origin + location.pathname + location.search
  doc.head?.prepend(base)

  // ── Step 5: Inject vynl-id re-applicator ─────────────────────────────────
  // Instead of neutralizing scripts (which breaks JS effects like parallax),
  // we inject a script that re-assigns vynl-ids AFTER frameworks finish
  // rendering in the viewer. MutationObserver catches framework DOM rewrites
  // (Showit re-renders from blockData, React hydrates, etc.) and re-applies
  // IDs once mutations settle. The same deterministic DOM-order algorithm
  // guarantees the same numbering → annotations remain valid.
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
  // Re-apply after mutations settle (catches SPA re-renders like Showit, React)
  // Observes childList only — attribute changes (our own setAttribute) won't
  // re-trigger, preventing an infinite loop.
  var obs=new MutationObserver(function(ms){
    for(var i=0;i<ms.length;i++){if(ms[i].addedNodes.length){schedule();return;}}
  });
  obs.observe(document.documentElement,{childList:true,subtree:true});
  // Belt-and-suspenders passes at key timing points
  window.addEventListener('load',function(){apply();setTimeout(apply,600);});
})();`
  // Prepend so it sets up the observer before any other script runs
  doc.head?.prepend(reapplicator)

  // ── Step 6: Serialize ─────────────────────────────────────────────────────
  return doc.documentElement.outerHTML
}
