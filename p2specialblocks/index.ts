import type { QuartzComponent, QuartzComponentConstructor } from "../quartz/components/types"

/**
 * SpecialBlocks — a global Quartz component that upgrades Obsidian's special
 * fenced code blocks into interactive widgets after the page loads:
 *
 *   ```mapview        → Leaflet map with markers scraped from the page's geo: links
 *   ```functionplot   → function-plot graph
 *
 * The component renders nothing server-side; it only contributes an
 * `afterDOMLoaded` client script that post-processes the rendered DOM.
 */
export const SpecialBlocks: QuartzComponentConstructor = (opts?: unknown) => {
  const o = (opts ?? {}) as {
    leafletCdn?: string
    functionPlotCdn?: string
    osmTiles?: string
  }
  const leafletCdn = o.leafletCdn ?? "https://unpkg.com/leaflet@1.9.4/dist"
  const functionPlotCdn = o.functionPlotCdn ?? "https://unpkg.com/function-plot@1.22.12/dist/function-plot.js"
  const osmTiles = o.osmTiles ?? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"

  const afterDOMLoaded = `
(function(){
  function getLeafletCdn(){ return ${JSON.stringify(leafletCdn)}; }
  function getFunctionPlotCdn(){ return ${JSON.stringify(functionPlotCdn)}; }
  function getOsmTiles(){ return ${JSON.stringify(osmTiles)}; }

  function ensureLeaflet(cb){
    if (window.L) return cb();
    if (!document.querySelector('link[href*="leaflet"]')) {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = getLeafletCdn() + '/leaflet.css';
      document.head.appendChild(l);
    }
    var s = document.createElement('script');
    s.src = getLeafletCdn() + '/leaflet.js';
    s.onload = cb;
    s.onerror = function(){ console.error('[SpecialBlocks] Leaflet failed to load'); };
    document.head.appendChild(s);
  }

  function ensureFunctionPlot(cb){
    if (window.functionPlot) return cb();
    var s = document.createElement('script');
    s.src = getFunctionPlotCdn();
    s.onload = cb;
    s.onerror = function(){ console.error('[SpecialBlocks] function-plot failed to load'); };
    document.head.appendChild(s);
  }

  function parseGeo(text){
    var re = /geo:\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)/g, m, out = [];
    while ((m = re.exec(text)) !== null) { out.push({ lat: +m[1], lng: +m[2] }); }
    return out;
  }

  function collectMarkers(root){
    var markers = [];
    // 1) Proper geo: anchors
    root.querySelectorAll('a[href^="geo:"]').forEach(function(a){
      var coords = parseGeo(a.getAttribute('href') || '');
      if (coords.length) {
        markers.push({ lat: coords[0].lat, lng: coords[0].lng, label: (a.textContent || '').trim() });
      }
    });
    // 2) Bare geo: text (Obsidian-flavored markdown sometimes drops the scheme)
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walker.nextNode())) {
      var t = n.nodeValue || '';
      if (t.indexOf('geo:') !== -1) {
        var re = /geo:\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)/g, m;
        while ((m = re.exec(t)) !== null) {
          var label = '';
          var prev = n.previousSibling;
          if (prev && prev.nodeType === 3) label = (prev.nodeValue || '').trim();
          var par = n.parentNode;
          if ((!label) && par && par.textContent) {
            label = (par.textContent.replace(/geo:.*/, '')).trim().slice(-40);
          }
          markers.push({ lat: +m[1], lng: +m[2], label: label });
        }
      }
    }
    return markers;
  }

  function renderMap(block, settings){
    var root = block.closest('article') || document.body;
    var markers = collectMarkers(root);
    if (!markers.length) return;
    var pre = block.closest('pre') || block;
    var container = document.createElement('div');
    container.className = 'mapview-block';
    pre.parentNode.replaceChild(container, pre);
    ensureLeaflet(function(){
      var center = markers[0];
      var zoom = 5;
      if (settings) {
        if (settings.centerLat != null && settings.centerLng != null) {
          center = { lat: settings.centerLat, lng: settings.centerLng };
        } else if (settings.lat != null && settings.lng != null) {
          center = { lat: settings.lat, lng: settings.lng };
        }
        if (settings.mapZoom != null) zoom = settings.mapZoom;
        else if (settings.zoom != null) zoom = settings.zoom;
      }
      var map = window.L.map(container).setView([center.lat, center.lng], zoom);
      window.L.tileLayer(getOsmTiles(), {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);
      markers.forEach(function(mk){
        var mrk = window.L.marker([mk.lat, mk.lng]);
        if (mk.label) mrk.bindPopup(mk.label);
        mrk.addTo(map);
      });
      setTimeout(function(){ map.invalidateSize(); }, 200);
    });
  }

  function renderFunctionPlot(block, code){
    var pre = block.closest('pre') || block;
    var container = document.createElement('div');
    container.className = 'functionplot-block';
    pre.parentNode.replaceChild(container, pre);
    var fn = 'x => x', xmin = -10, xmax = 10;
    var m;
    if ((m = code.match(/xmin\s*[:=]\s*(-?[\d.]+)/i))) xmin = parseFloat(m[1]);
    if ((m = code.match(/xmax\s*[:=]\s*(-?[\d.]+)/i))) xmax = parseFloat(m[1]);
    if ((m = code.match(/y\s*[:=]\s*(.+)/i))) fn = m[1].trim();
    ensureFunctionPlot(function(){
      try {
        window.functionPlot({
          target: container,
          width: container.clientWidth || 600,
          height: 400,
          xAxis: { domain: [xmin, xmax] },
          yAxis: { domain: [-20, 20] },
          data: [{ fn: fn }]
        });
      } catch (e) {
        container.textContent = 'function-plot error: ' + e.message;
      }
    });
  }

  function init(){
    document.querySelectorAll('pre > code').forEach(function(code){
      var lang = (code.getAttribute('data-language') || '').toLowerCase();
      if (lang === 'mapview') {
        var settings = {};
        try { var j = JSON.parse(code.textContent); if (j && typeof j === 'object') settings = j; } catch (e) {}
        renderMap(code, settings);
      } else if (lang === 'functionplot') {
        renderFunctionPlot(code, code.textContent);
      }
    });
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
`

  // The component itself renders nothing server-side; we attach the client
  // script via afterDOMLoaded so it runs on every page.
  const Component: QuartzComponent = (() => null) as QuartzComponent
  Component.afterDOMLoaded = afterDOMLoaded
  Component.displayName = "SpecialBlocks"
  Component.css = `
  .mapview-block {
    width: 100%;
    height: 420px;
    border-radius: 8px;
    overflow: hidden;
    margin: 1rem 0;
    border: 1px solid var(--lightgray);
  }
  .functionplot-block { width: 100%; margin: 1rem 0; }
  .functionplot-block svg { width: 100%; height: auto; }
  `
  return Component
}
