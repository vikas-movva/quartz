/**
 * p2excali — Obsidian Excalidraw rescue + render
 *
 * Problem: Obsidian stores an Excalidraw drawing inside a `%% ... %%`
 * comment block (`## Drawing` + a ```compressed-json fenced LZ-string). The
 * `@quartz-community/obsidian-flavored-markdown` transformer strips `%%`
 * comments during remark parsing, so the scene never reaches the DOM.
 *
 * Two halves, two exports (category ["transformer","component"] in package.json):
 *   - default export  -> transformer factory. textTransform runs on raw markdown
 *     BEFORE parsing: it extracts the LZ-string from the `%%` comment and
 *     replaces the comment with a raw-HTML
 *     `<div class="excalidraw-block" data-excalidraw="<LZ>">` placeholder that
 *     survives parsing.
 *   - Excali export   -> Quartz component. afterDOMLoaded decodes the LZ-string
 *     via lz-string (CDN) and renders to SVG via @excalidraw/excalidraw (CDN).
 */
import type { QuartzComponent, QuartzComponentConstructor } from "../quartz/components/types"

export interface ExcaliOptions {
  lzStringCdn?: string
  excalidrawCdn?: string
}

const DEFAULT_LZ_CDN = "https://unpkg.com/lz-string@1.5.0/libs/lz-string.min.js"
const DEFAULT_EX_CDN =
  "https://unpkg.com/@excalidraw/excalidraw@0.17.6/dist/excalidraw.production.min.js"

// ---------------------------------------------------------------------------
// Transformer half (default export): rescue the scene from the %% comment.
// Runs in the text phase, BEFORE remark parsing strips %% comments.
// ---------------------------------------------------------------------------
export default function ExcaliTransformer(_opts?: Partial<ExcaliOptions>) {
  return {
    textTransform(_ctx: unknown, src: string): string {
      // Only touch files that are Excalidraw exports.
      if (!/excalidraw-plugin:\s*parsed/i.test(src)) return src

      // Scene lives inside the first `%% ... %%` block, in a
      // ```compressed-json fenced code block. Capture the fence body.
      const fence = src.match(/%%[\s\S]*?```compressed-json\s+([\s\S]*?)```/)
      if (!fence) return src
      const lz = fence[1].replace(/\s+/g, "") // LZ-string is whitespace-insensitive
      if (!lz) return src

      // Replace the entire `%% ... %%` region with a raw-HTML placeholder.
      // Raw HTML (<div>) is passed through by remark-rehype, so it survives.
      const placeholder = '<div class="excalidraw-block" data-excalidraw="' + lz + '"></div>'
      const start = src.indexOf("%%", src.indexOf("excalidraw-plugin"))
      const end = src.indexOf("%%", start + 2)
      if (start < 0 || end < 0) return src
      const span = src.slice(start, end + 2)
      return src.replace(span, placeholder)
    },
  }
}

// ---------------------------------------------------------------------------
// Component half (named export): render the rescued scene client-side.
// ---------------------------------------------------------------------------
export const Excali: QuartzComponentConstructor = (opts?: Partial<ExcaliOptions>) => {
  const lzStringCdn = opts?.lzStringCdn ?? DEFAULT_LZ_CDN
  const excalidrawCdn = opts?.excalidrawCdn ?? DEFAULT_EX_CDN

  const afterDOMLoaded = `
(function(){
  function getLZCdn(){ return ${JSON.stringify(lzStringCdn)}; }
  function getExCdn(){ return ${JSON.stringify(excalidrawCdn)}; }

  function loadScript(src){
    return new Promise(function(res, rej){
      if (document.querySelector('script[src="' + src + '"]')) { res(); return; }
      var s = document.createElement('script');
      s.src = src;
      s.onload = function(){ res(); };
      s.onerror = function(){ rej(new Error('load failed: ' + src)); };
      document.head.appendChild(s);
    });
  }

  function ensureLibs(cb){
    var pending = 0;
    var done = function(){ if (--pending === 0) cb(); };
    if (!window.LZString) { pending++; loadScript(getLZCdn()).then(done).catch(function(e){ console.error('[Excali]', e.message); }); }
    if (!window.ExcalidrawLib) { pending++; loadScript(getExCdn()).then(done).catch(function(e){ console.error('[Excali]', e.message); }); }
    if (pending === 0) cb();
  }

  function render(block){
    var lz = block.getAttribute('data-excalidraw');
    if (!lz) return;
    ensureLibs(function(){
      var json;
      try { json = window.LZString.decompressFromBase64(lz); } catch (e) { json = null; }
      if (!json) { block.textContent = 'Excalidraw: could not decode scene'; return; }
      var scene;
      try { scene = JSON.parse(json); } catch (e) { block.textContent = 'Excalidraw: invalid scene JSON'; return; }
      window.ExcalidrawLib.exportToSvg({
        elements: scene.elements || [],
        appState: Object.assign({}, scene.appState || {}, { exportBackground: true }),
        files: scene.files || {}
      }).then(function(svg){
        svg.setAttribute('width', '100%');
        svg.removeAttribute('height');
        svg.style.maxWidth = '100%';
        svg.style.height = 'auto';
        block.appendChild(svg);
      }).catch(function(e){ block.textContent = 'Excalidraw render error: ' + e.message; });
    });
  }

  function init(){
    var blocks = document.querySelectorAll('.excalidraw-block');
    for (var i = 0; i < blocks.length; i++) render(blocks[i]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
`

  const Component = (() => null) as unknown as QuartzComponent
  Component.afterDOMLoaded = afterDOMLoaded
  Component.css = `
  .excalidraw-block {
    width: 100%;
    margin: 1rem 0;
    border: 1px solid var(--lightgray);
    border-radius: 8px;
    padding: 0.75rem;
    overflow-x: auto;
    background: var(--light);
  }
  .excalidraw-block svg { max-width: 100%; height: auto; display: block; }
  `
  return Component
}
