// The one UI resource: a compact card list for find_cocktails_by_ingredients.
// Plain HTML and a small script, no bundle. It speaks the MCP Apps bridge
// (ui/initialize, tool-input, tool-result, tool-cancelled, ui/open-link) over
// postMessage, and reads window.openai where only the ChatGPT globals exist.

import { AGE_NOTE, BY_INGREDIENTS_TOOL_URL } from './site'

// Bump the version in the URI on any breaking change: hosts cache by URI.
export const WIDGET_URI = 'ui://ask-garcon/cocktail-list-v1.html'

export const WIDGET_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --bg: var(--color-background-primary, #ffffff);
    --bg-2: var(--color-background-secondary, #f5f4f7);
    --text: var(--color-text-primary, #17151c);
    --muted: var(--color-text-secondary, #5f5a69);
    --border: var(--color-border-primary, #e4e1ea);
    --accent: #5b3fd1;
    --ok: var(--color-text-success, #1f7a46);
    --radius: var(--border-radius-md, 10px);
    color-scheme: light dark;
  }
  :root[data-theme="dark"] {
    --bg: var(--color-background-primary, #1d1b22);
    --bg-2: var(--color-background-secondary, #26232d);
    --text: var(--color-text-primary, #f3f1f7);
    --muted: var(--color-text-secondary, #b4aec0);
    --border: var(--color-border-primary, #37333f);
    --accent: #a993ff;
    --ok: var(--color-text-success, #6fd39b);
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.4 var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif); color: var(--text); background: transparent; }
  main { padding: 12px; display: grid; gap: 12px; }
  h2 { font-size: 13px; font-weight: 600; color: var(--muted); margin: 0 0 6px; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  a.card { display: grid; grid-template-columns: 52px 1fr; gap: 10px; align-items: center; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); color: inherit; text-decoration: none; }
  a.card:hover, a.card:focus-visible { border-color: var(--accent); outline: none; }
  .thumb { width: 52px; height: 52px; border-radius: 8px; background: var(--bg-2); object-fit: cover; }
  .name { font-weight: 600; font-size: 14px; }
  .meta { color: var(--muted); font-size: 12px; }
  .status { font-size: 12px; margin-top: 2px; }
  .status.ok { color: var(--ok); font-weight: 600; }
  .note { color: var(--muted); font-size: 12px; margin: 0; }
  footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px; color: var(--muted); font-size: 12px; }
  footer a { color: var(--accent); }
  .empty { color: var(--muted); }
</style>
</head>
<body>
<main id="root"><p class="empty">Checking your bar…</p></main>
<script>
(function () {
  var AGE_NOTE = ${JSON.stringify(AGE_NOTE)};
  var MORE_URL = ${JSON.stringify(BY_INGREDIENTS_TOOL_URL)};
  var root = document.getElementById('root');
  var nextId = 1;
  var pending = {};
  var bridge = window.parent && window.parent !== window;

  function send(message) { if (bridge) window.parent.postMessage(message, '*'); }
  function request(method, params) {
    var id = nextId++;
    send({ jsonrpc: '2.0', id: id, method: method, params: params || {} });
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      setTimeout(function () { if (pending[id]) { delete pending[id]; reject(new Error('timeout')); } }, 4000);
    });
  }
  function notify(method, params) { send({ jsonrpc: '2.0', method: method, params: params || {} }); }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeUrl(url) {
    return typeof url === 'string' && /^https:\\/\\/(fixmeadrinkapp\\.com|images\\.fixmeadrinkapp\\.com)\\//.test(url) ? url : '';
  }

  function applyTheme(context) {
    if (!context) return;
    if (context.theme) document.documentElement.setAttribute('data-theme', context.theme);
    var vars = context.styles && context.styles.variables;
    if (vars) Object.keys(vars).forEach(function (key) { if (vars[key]) document.documentElement.style.setProperty(key, vars[key]); });
  }

  function card(item, images) {
    var url = safeUrl(item.url);
    var img = safeUrl(images && images[item.url]);
    var status = item.can_make_now
      ? '<div class="status ok">Ready to make</div>'
      : '<div class="status">Missing: ' + esc((item.missing || []).join(', ')) + '</div>';
    var meta = [item.strength, (item.flavors || []).slice(0, 3).join(', ')].filter(Boolean).join(' · ');
    return '<li><a class="card" href="' + esc(url) + '" data-href="' + esc(url) + '" target="_blank" rel="noopener">' +
      (img ? '<img class="thumb" alt="" decoding="async" src="' + esc(img) + '">' : '<div class="thumb" aria-hidden="true"></div>') +
      '<div><div class="name">' + esc(item.name) + '</div><div class="meta">' + esc(meta) + '</div>' + status + '</div></a></li>';
  }

  function section(title, items, images) {
    if (!items || !items.length) return '';
    return '<section><h2>' + esc(title) + '</h2><ul>' + items.map(function (i) { return card(i, images); }).join('') + '</ul></section>';
  }

  function show(html) {
    root.innerHTML = html;
    reportSize();
  }
  function notice(text) {
    show('<p class="empty">' + esc(text) + '</p>');
  }

  function render(data, meta) {
    if (!data || typeof data !== 'object') return notice('Garçon could not answer this time. Try again.');
    var images = (meta && meta.images) || {};
    var html = '';
    if (data.note) html += '<p class="note">' + esc(data.note) + '</p>';
    html += section('Drinks from your bar', data.cocktails, images);
    html += section('Low or zero-proof', data.low_proof_options, images);
    if (!html) html = '<p class="empty">No matches yet. Add a base spirit, a citrus and a sweetener.</p>';
    if (data.unavailable && data.unavailable.length) html += '<p class="note">Low or zero-proof options could not be loaded this time.</p>';
    html += '<footer><span>' + esc(AGE_NOTE) + '</span><a href="' + esc(MORE_URL) + '" data-href="' + esc(MORE_URL) + '" target="_blank" rel="noopener">More ideas on fixmeadrinkapp.com</a></footer>';
    show(html);
  }

  function renderResult(result) {
    if (!result || !result.isError) return render(result && result.structuredContent, result && result._meta);
    var text = (result.content || []).filter(function (c) { return c && c.type === 'text'; }).map(function (c) { return c.text; }).join(' ');
    notice(text || 'Garçon could not answer this time. Try again.');
  }

  function openLink(url) {
    if (!url) return;
    request('ui/open-link', { url: url }).then(function (result) {
      if (result && result.isError) fallbackOpen(url);
    }, function () { fallbackOpen(url); });
  }
  function fallbackOpen(url) {
    if (window.openai && typeof window.openai.openExternal === 'function') window.openai.openExternal({ href: url });
    else window.open(url, '_blank', 'noopener');
  }
  root.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a[data-href]');
    if (!link) return;
    event.preventDefault();
    openLink(link.getAttribute('data-href'));
  });

  function reportSize() {
    var height = Math.ceil(document.documentElement.getBoundingClientRect().height);
    notify('ui/notifications/size-changed', { height: height });
    if (window.openai && typeof window.openai.notifyIntrinsicHeight === 'function') window.openai.notifyIntrinsicHeight(height);
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(reportSize).observe(document.body);

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var message = event.data;
    if (!message || message.jsonrpc !== '2.0') return;
    if (message.id !== undefined && pending[message.id]) {
      var entry = pending[message.id];
      delete pending[message.id];
      if (message.error) entry.reject(message.error); else entry.resolve(message.result);
      return;
    }
    if (message.method === 'ui/notifications/tool-input') {
      notice('Checking your bar…');
    } else if (message.method === 'ui/notifications/tool-result') {
      renderResult(message.params);
    } else if (message.method === 'ui/notifications/tool-cancelled') {
      notice('Search cancelled.');
    } else if (message.method === 'ui/notifications/host-context-changed') {
      applyTheme(message.params);
    }
  });

  // ChatGPT globals, for hosts that set them before or instead of the bridge.
  function fromOpenAiGlobals() {
    var openai = window.openai;
    if (!openai) return;
    if (openai.theme) document.documentElement.setAttribute('data-theme', openai.theme);
    if (openai.toolOutput) render(openai.toolOutput, openai.toolResponseMetadata);
  }
  window.addEventListener('openai:set_globals', fromOpenAiGlobals, { passive: true });
  fromOpenAiGlobals();

  request('ui/initialize', {
    appInfo: { name: 'ask-garcon-cocktail-list', version: '1.0.0' },
    appCapabilities: { availableDisplayModes: ['inline'] },
    protocolVersion: '2026-01-26'
  }).then(function (result) {
    applyTheme(result && result.hostContext);
    notify('ui/notifications/initialized', {});
  }, function () {});
})();
</script>
</body>
</html>`
