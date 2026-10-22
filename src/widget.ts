// The one UI resource: a compact card list for find_cocktails_by_ingredients,
// styled after the fixmeadrinkapp.com recipe cards (components/garcon/
// recipe-card.tsx), tags (components/ui/tag.tsx), notes (tools/tool-note.tsx)
// and footer (site-footer.tsx). Plain HTML and two small scripts, no bundle.
//
// VIEW_JS turns tool results into HTML strings and never touches the DOM, so
// the tests can run it as is. The boot script speaks the MCP Apps bridge
// (ui/initialize, tool-input, tool-result, tool-cancelled, host-context-changed,
// ui/open-link) over postMessage, and reads window.openai where only the
// ChatGPT globals exist.
//
// Fonts: hosts that allow them get DM Sans and Inter from the Worker's own
// origin (declared in the resource CSP). ChatGPT asks apps not to use custom
// fonts, so its profile uses the host's font or the system stack.

import {
  BRAND_FONTS,
  FONT_FILES,
  IMAGE_FILES,
  SYSTEM_FONT,
  TOKENS_CSS,
  fontFaceCss,
  mascotSvg,
} from './brand'
import { AGE_NOTE, BY_INGREDIENTS_TOOL_URL, MCP_ORIGIN } from './site'

// Bump the version in the URI on any breaking change: hosts cache by URI.
export const WIDGET_URI = 'ui://ask-garcon/cocktail-list-v1.html'

export interface WidgetOptions {
  /** Load DM Sans and Inter from `assetOrigin`. Off for ChatGPT, whose guidelines ask for system fonts. */
  brandFonts: boolean
  /** Where /fonts and /images are served. */
  assetOrigin?: string
}

export interface ViewConfig {
  ageNote: string
  moreUrl: string
  peaceUrl: string
  mascot: string
}

/**
 * The view, as plain ES5 so it runs unchanged in any host's WebView:
 * `garconView(config)` returns functions from tool results to HTML, and
 * `garconLinks(deps)` returns the link opener.
 */
export const VIEW_JS = String.raw`
function garconView(config) {
  var RECIPE = /^https:\/\/fixmeadrinkapp\.com\/[^\s"'<>\\]*$/;
  var IMAGE = /^https:\/\/images\.fixmeadrinkapp\.com\/[^\s"'<>\\]*$/;
  var nextId = 0;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeUrl(url, pattern) {
    return typeof url === 'string' && pattern.test(url) ? url : '';
  }
  function words(list) {
    var items = (list || []).filter(function (item) { return typeof item === 'string' && item; });
    if (items.length < 2) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }
  function tag(text, tone) {
    return '<span class="tag' + (tone ? ' ' + tone : '') + '">' + esc(text) + '</span>';
  }
  function strengthLabel(strength) {
    if (strength === 'Non Alcoholic') return 'Zero-proof';
    if (strength === 'Low') return 'Low-proof';
    return strength;
  }

  function card(item, images, lowProof) {
    var id = 'g' + (++nextId);
    var url = safeUrl(item && item.url, RECIPE);
    var img = safeUrl(images && images[item.url], IMAGE);
    var name = String((item && item.name) || 'Untitled drink');
    var tags = '';
    if (item.can_make_now) tags += tag('Ready to make', 'ok');
    if (lowProof && item.strength) tags += tag(strengthLabel(item.strength));
    (item.flavors || []).slice(0, lowProof ? 2 : 3).forEach(function (flavor) { tags += tag(flavor); });
    var notes = [];
    if (!item.can_make_now && item.missing && item.missing.length) notes.push('Missing ' + words(item.missing));
    (item.depends_on || []).forEach(function (d) {
      if (d && d.ingredient && d.you_said) notes.push('Only if your ' + d.you_said + ' is ' + d.ingredient);
    });
    var need = notes.length ? '<span class="need">' + esc(notes.join('. ')) + '</span>' : '';
    var thumb = img
      ? '<span class="thumb"><img src="' + esc(img) + '" alt="" width="64" height="64" loading="lazy" decoding="async"></span>'
      : '<span class="thumb empty-thumb">' + config.mascot + '</span>';
    var body = thumb +
      '<span class="card-body"><h3 class="name" id="' + id + '-n">' + esc(name) + '</h3>' +
      '<span class="details" id="' + id + '-d">' + (tags ? '<span class="tags">' + tags + '</span>' : '') + need + '</span></span>';
    if (!url) return '<li><div class="card">' + body + '</div></li>';
    return '<li><a class="card" href="' + esc(url) + '" data-href="' + esc(url) + '" target="_blank" rel="noopener noreferrer"' +
      ' title="' + esc(name) + '" aria-labelledby="' + id + '-n" aria-describedby="' + id + '-d">' + body + '</a></li>';
  }

  function section(key, title, items, images, lowProof) {
    if (!items || !items.length) return '';
    return '<section aria-labelledby="' + key + '"><h2 id="' + key + '">' + esc(title) + '</h2><ul class="cards">' +
      items.map(function (item) { return card(item, images, lowProof); }).join('') + '</ul></section>';
  }

  function footer() {
    return '<footer class="foot"><div class="foot-row"><span class="logo">' + config.mascot +
      '<span class="wordmark">Garçon</span></span>' +
      '<a class="more" href="' + esc(config.moreUrl) + '" data-href="' + esc(config.moreUrl) + '" target="_blank" rel="noopener noreferrer">More on fixmeadrinkapp.com</a></div>' +
      '<p class="age">' + esc(config.ageNote) + '</p></footer>';
  }

  function loading() {
    var row = '<div class="sk-row"><span class="sk sk-thumb"></span><span class="sk-lines"><span class="sk sk-name"></span><span class="sk-tags"><span class="sk sk-tag"></span><span class="sk sk-tag"></span></span></span></div>';
    return '<div class="skeleton" aria-hidden="true"><span class="sk sk-title"></span>' + row + row + row + '</div>';
  }

  // args: the tool input, when the host sent it. A zero_or_low search lists
  // only low or zero-proof drinks, so the main section says so.
  function results(data, meta, args) {
    if (!data || typeof data !== 'object') return error('');
    var images = (meta && meta.images) || {};
    var cocktails = Array.isArray(data.cocktails) ? data.cocktails : [];
    var lowProof = Array.isArray(data.low_proof_options) ? data.low_proof_options : [];
    var bar = data.bar || {};
    var notRecognised = Array.isArray(bar.not_recognised) ? bar.not_recognised : [];
    var html = '';
    if (!cocktails.length && !lowProof.length) {
      var none = !bar.recognised || !bar.recognised.length;
      html += '<div class="empty"><img class="empty-art" src="' + esc(config.peaceUrl) + '" alt="" width="64" height="64">' +
        '<div class="empty-text"><p class="empty-title">' + (none ? 'Garçon didn’t recognise those' : 'No drinks from this bar yet') + '</p>' +
        '<p class="lead">' + esc(data.note || 'Add a base spirit, a citrus and a sweetener to open up the most drinks.') + '</p></div></div>';
    } else {
      if (data.note) html += '<p class="lead">' + esc(data.note) + '</p>';
      var lowOnly = Boolean(args && args.strength === 'zero_or_low');
      html += section('s-bar', lowOnly ? 'Low or zero-proof from your bar' : 'Drinks from your bar', cocktails, images, lowOnly);
      html += section('s-low', 'Low or zero-proof', lowProof, images, true);
      if (notRecognised.length) html += '<p class="aside">Not recognised: ' + esc(words(notRecognised)) + '</p>';
    }
    if (data.unavailable && data.unavailable.length) html += '<p class="aside">Low or zero-proof options could not load this time.</p>';
    if (data.partial) html += '<p class="aside">Garçon checked the closest recipes first; more may match on fixmeadrinkapp.com.</p>';
    return html + footer();
  }

  function error(text) {
    return '<div class="note warn" role="alert"><p class="note-title">Garçon couldn’t check your bar</p><p>' +
      esc(text || 'Something went wrong. Try again in a moment.') + '</p></div>' + footer();
  }

  function cancelled() {
    return '<p class="lead">Search cancelled.</p>';
  }

  // One line for the persistent status region, so screen readers hear the
  // outcome without the whole list being read out.
  function summary(result) {
    if (!result || result.isError || !result.structuredContent) return 'Garçon couldn’t check your bar.';
    var data = result.structuredContent;
    var count = (data.cocktails || []).length + (data.low_proof_options || []).length;
    return count ? count + (count === 1 ? ' drink' : ' drinks') + ' found.' : 'No drinks found.';
  }

  function fromToolResult(result, args) {
    if (!result || !result.isError) return results(result && result.structuredContent, result && result._meta, args);
    var text = (result.content || []).filter(function (c) { return c && c.type === 'text'; })
      .map(function (c) { return c.text; }).join(' ');
    return error(text);
  }

  return {
    esc: esc,
    isRecipeUrl: function (url) { return Boolean(safeUrl(url, RECIPE)); },
    loading: loading,
    results: results,
    error: error,
    cancelled: cancelled,
    summary: summary,
    fromToolResult: fromToolResult
  };
}

function garconLinks(deps) {
  function fallback(url) {
    if (deps.openai && typeof deps.openai.openExternal === 'function') deps.openai.openExternal({ href: url });
    else deps.open(url);
  }
  return function openLink(url) {
    if (!url) return Promise.resolve();
    return deps.request('ui/open-link', { url: url }).then(function (result) {
      if (result && result.isError) fallback(url);
    }, function () { fallback(url); });
  };
}
`

const BOOT_JS = /* js */ `
(function () {
  var view = garconView(CONFIG);
  var root = document.getElementById('root');
  var nextId = 1;
  var pending = {};
  var toolArgs = null;
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

  var openLink = garconLinks({
    request: request,
    openai: window.openai,
    open: function (url) { window.open(url, '_blank', 'noopener'); }
  });

  var live = document.getElementById('live');
  function show(html, busy, status) {
    root.innerHTML = html;
    root.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (status) live.textContent = status;
    reportSize();
  }

  function applyHostContext(context) {
    if (!context) return;
    var doc = document.documentElement;
    if (context.theme === 'light' || context.theme === 'dark') doc.setAttribute('data-theme', context.theme);
    var vars = context.styles && context.styles.variables;
    // Only the host font is used, and only where the brand fonts are off.
    if (vars && typeof vars['--font-sans'] === 'string') doc.style.setProperty('--font-sans', vars['--font-sans']);
    var insets = context.safeAreaInsets;
    if (insets) ['top', 'right', 'bottom', 'left'].forEach(function (side) {
      if (typeof insets[side] === 'number') doc.style.setProperty('--safe-' + side, insets[side] + 'px');
    });
  }

  root.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a[data-href]');
    if (!link) return;
    event.preventDefault();
    var url = link.getAttribute('data-href');
    if (view.isRecipeUrl(url)) openLink(url);
  });
  // A recipe photo that fails to load falls back to the mascot placeholder.
  root.addEventListener('error', function (event) {
    var img = event.target;
    if (!img || img.tagName !== 'IMG') return;
    var thumb = img.parentNode;
    if (thumb && thumb.classList && thumb.classList.contains('thumb')) {
      thumb.classList.add('empty-thumb');
      thumb.innerHTML = CONFIG.mascot;
    } else {
      img.remove();
    }
  }, true);

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
      toolArgs = (message.params && message.params.arguments) || null;
      show(view.loading(), true, 'Checking your bar…');
    } else if (message.method === 'ui/notifications/tool-result') {
      show(view.fromToolResult(message.params, toolArgs), false, view.summary(message.params));
    } else if (message.method === 'ui/notifications/tool-cancelled') show(view.cancelled(), false, 'Search cancelled.');
    else if (message.method === 'ui/notifications/host-context-changed') applyHostContext(message.params);
  });

  // ChatGPT globals, for hosts that set them before or instead of the bridge.
  function fromOpenAiGlobals() {
    var openai = window.openai;
    if (!openai) return;
    if (openai.theme) applyHostContext({ theme: openai.theme });
    if (openai.toolOutput) {
      show(view.results(openai.toolOutput, openai.toolResponseMetadata, openai.toolInput), false,
        view.summary({ structuredContent: openai.toolOutput }));
    }
  }
  window.addEventListener('openai:set_globals', fromOpenAiGlobals, { passive: true });
  show(view.loading(), true);
  fromOpenAiGlobals();

  request('ui/initialize', {
    appInfo: { name: 'ask-garcon-cocktail-list', version: '1.1.0' },
    appCapabilities: { availableDisplayModes: ['inline'] },
    protocolVersion: '2026-01-26'
  }).then(function (result) {
    applyHostContext(result && result.hostContext);
    notify('ui/notifications/initialized', {});
  }, function () {});
})();
`

// Roles the widget styles with. Light values are the site tokens; the dark
// theme (the site has none) mixes the same tokens with surface 0 or with
// transparency, so no new colour enters. light-dark() follows color-scheme,
// which the host's theme sets through data-theme.
const WIDGET_CSS = /* css */ `
  :root { color-scheme: light dark; }
  :root[data-theme="light"] { color-scheme: light; }
  :root[data-theme="dark"] { color-scheme: dark; }
  :root {
    --c-text: light-dark(var(--fg-high-em), var(--surface-1)); /* text/high_em; dark: surface_1 */
    --c-muted: light-dark(var(--fg-med-em), var(--fg-base-em)); /* text/med_em; dark: text/base_em */
    --c-faint: light-dark(var(--fg-low-em), var(--fg-base-em)); /* text/low_em; dark: text/base_em */
    --c-fill: light-dark(var(--surface-2), color-mix(in srgb, var(--surface-0) 9%, transparent)); /* tag secondary fill: surface_2 */
    --c-fill-strong: light-dark(var(--surface-3), color-mix(in srgb, var(--surface-0) 13%, transparent)); /* image placeholder, skeleton: surface_3 */
    --c-hover: light-dark(var(--surface-1), color-mix(in srgb, var(--surface-0) 5%, transparent)); /* text-only row hover: surface_1 */
    --c-rule: light-dark(var(--outline-low-em), var(--outline-white-16)); /* divider: outline/low_em */
    --c-mark: light-dark(var(--fg-med-em), var(--fg-base-em)); /* logo mark and wordmark: text/med_em */
    --c-placeholder: light-dark(var(--fg-base-em), color-mix(in srgb, var(--surface-0) 32%, transparent)); /* text/base_em */
    --c-link: light-dark(var(--fg-secondary-med-em), color-mix(in srgb, var(--fg-secondary-med-em) 55%, var(--surface-0))); /* link primary: text/secondary_med_em */
    --c-ok: light-dark(var(--fg-success-high-em), color-mix(in srgb, var(--fg-success-high-em) 45%, var(--surface-0))); /* success tag text */
    --c-ok-fill: light-dark(var(--surface-success-base-em-alpha), color-mix(in srgb, var(--fg-success-high-em) 28%, transparent)); /* success tag fill */
    --c-warn: light-dark(var(--fg-warning-high-em), color-mix(in srgb, var(--fg-warning-high-em) 45%, var(--surface-0))); /* warning note text */
    --c-warn-fill: light-dark(var(--surface-warning-base-em-alpha), color-mix(in srgb, var(--surface-warning-high-em) 12%, transparent)); /* warning note fill */
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: transparent; }
  body {
    font-family: var(--font-body);
    font-size: var(--text-body-1); line-height: var(--leading-body-1); letter-spacing: var(--tracking-body-1);
    color: var(--c-text);
    font-synthesis-weight: none;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
  }
  main {
    container-type: inline-size;
    display: grid; gap: var(--space-xxxl);
    padding: calc(var(--space-lg) + var(--safe-top, 0px)) calc(var(--space-md) + var(--safe-right, 0px))
      calc(var(--space-lg) + var(--safe-bottom, 0px)) calc(var(--space-md) + var(--safe-left, 0px));
  }
  p { margin: 0; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

  section { display: grid; gap: var(--space-xs); }
  h2 {
    margin: 0; padding-inline: var(--space-md);
    font-family: var(--font-heading); font-weight: 600;
    font-size: var(--text-title-2); line-height: var(--leading-title-2); letter-spacing: var(--tracking-title-2);
    text-wrap: balance;
  }
  .cards { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-xxs); }
  @container (min-width: 560px) { .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: var(--space-md); } }

  /* recipe_card, horizontal: the photo as the ingredient card's thumb */
  .card {
    display: grid; grid-template-columns: var(--size-thumb) minmax(0, 1fr); align-items: start; gap: var(--space-lg);
    padding: var(--space-md); border-radius: var(--radius-20);
    color: inherit; text-decoration: none;
    transition: background-color 150ms ease-out;
  }
  a.card:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 0; }
  @media (hover: hover) { a.card:hover { background: var(--c-hover); } }
  .thumb {
    position: relative; display: grid; place-items: center;
    width: var(--size-thumb); height: var(--size-thumb); overflow: hidden;
    border-radius: var(--radius-12); background: var(--c-fill-strong); box-shadow: var(--shadow-e2);
    transition: box-shadow 150ms ease-out, transform 150ms ease-out;
  }
  .thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .empty-thumb { color: var(--c-placeholder); }
  .empty-thumb svg { width: var(--size-icon-xxl); height: auto; }
  @media (hover: hover) { a.card:hover .thumb { box-shadow: var(--shadow-e3); } }
  @media (hover: hover) and (prefers-reduced-motion: no-preference) { a.card:hover .thumb { transform: translateY(calc(-1 * var(--space-xxs))); } }
  @media (prefers-reduced-motion: no-preference) { a.card:active .thumb { transform: scale(0.98); } }
  .card-body { display: grid; gap: var(--space-xs); min-width: 0; }
  .name {
    margin: 0; font-weight: 500;
    font-size: var(--text-title-1); line-height: var(--leading-title-1); letter-spacing: var(--tracking-title-1);
    overflow-wrap: anywhere;
    display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden;
  }
  .details { display: grid; gap: var(--space-xs); }
  .details:empty { display: none; }
  /* tags, size xs: secondary, and success for "Ready to make" */
  .tags { display: flex; flex-wrap: wrap; gap: var(--space-sm); }
  .tag {
    display: inline-flex; align-items: center; min-height: var(--size-control-xs); max-width: 100%;
    padding: var(--space-xxs) var(--space-md); border-radius: var(--radius-6);
    font-size: var(--text-caption-1); line-height: var(--leading-caption-1); letter-spacing: var(--tracking-caption-1); font-weight: 500;
    background: var(--c-fill); color: var(--c-muted); box-shadow: var(--shadow-special-drop);
  }
  .tag.ok { background: var(--c-ok-fill); color: var(--c-ok); }
  .need, .aside, .age {
    font-size: var(--text-caption-2); line-height: var(--leading-caption-2); letter-spacing: var(--tracking-caption-2);
    color: var(--c-muted); overflow-wrap: anywhere;
  }
  .aside, .lead { padding-inline: var(--space-md); }
  .lead { color: var(--c-muted); }

  .empty { display: flex; align-items: center; gap: var(--space-lg); padding-inline: var(--space-md); }
  .empty-art { flex: none; width: var(--size-thumb); height: var(--size-thumb); object-fit: contain; }
  .empty-text { display: grid; gap: var(--space-xxs); }
  .empty-text .lead { padding: 0; }
  .empty-title, .note-title { font-weight: 500; color: var(--c-text); }
  .empty-title { font-size: var(--text-title-1); line-height: var(--leading-title-1); letter-spacing: var(--tracking-title-1); }

  /* tool note, tone warning */
  .note { display: grid; gap: var(--space-xs); margin-inline: var(--space-md); padding: var(--space-xxl); border-radius: var(--radius-12); box-shadow: var(--shadow-special-drop); }
  .note.warn { background: var(--c-warn-fill); color: var(--c-warn); }
  .note.warn .note-title { color: inherit; }

  /* site footer bottom bar: logo sm, then the links */
  .foot { display: grid; gap: var(--space-xxs); margin-inline: var(--space-md); padding-top: var(--space-md); border-top: 1px solid var(--c-rule); }
  .foot-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; column-gap: var(--space-lg); }
  .logo { display: inline-flex; align-items: center; gap: var(--space-xs); color: var(--c-mark); }
  .logo svg { width: 26px; height: 24px; } /* logo.tsx size sm: mark 26 x 24 */
  .wordmark {
    font-family: var(--font-heading); font-weight: 600;
    font-size: var(--text-wordmark-sm); line-height: var(--leading-wordmark-sm); letter-spacing: var(--tracking-wordmark-sm);
  }
  .more {
    display: inline-flex; align-items: center; min-height: var(--size-control-lg); /* 44 pt tap target (Claude guidelines) */
    margin-inline: calc(-1 * var(--space-xs)); padding-inline: var(--space-xs); border-radius: var(--radius-6);
    font-size: var(--text-caption-2); line-height: var(--leading-caption-2); letter-spacing: var(--tracking-caption-2); font-weight: 500;
    color: var(--c-link); text-decoration: none; text-underline-offset: 4px;
  }
  @media (hover: hover) { .more:hover { text-decoration: underline; } }
  .more:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 0; }
  .age { color: var(--c-faint); }

  /* skeleton: surface 3 blocks, radius 4, pulse only with motion allowed */
  .skeleton { display: grid; gap: var(--space-xxs); }
  .sk { display: block; border-radius: var(--radius-4); background: var(--c-fill-strong); }
  @media (prefers-reduced-motion: no-preference) { .sk { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; } }
  @keyframes pulse { 50% { opacity: 0.5; } }
  .sk-title { width: 45%; height: var(--leading-title-2); margin: 0 var(--space-md) var(--space-xs); }
  .sk-row { display: grid; grid-template-columns: var(--size-thumb) minmax(0, 1fr); align-items: center; gap: var(--space-lg); padding: var(--space-md); }
  .sk-thumb { width: var(--size-thumb); height: var(--size-thumb); border-radius: var(--radius-12); }
  .sk-lines { display: grid; gap: var(--space-md); }
  .sk-name { width: 55%; height: var(--text-title-1); }
  .sk-tags { display: flex; gap: var(--space-sm); }
  .sk-tag { width: var(--space-8xl); height: var(--size-control-xs); border-radius: var(--radius-6); }
`

export function widgetHtml({ brandFonts, assetOrigin = MCP_ORIGIN }: WidgetOptions) {
  const config: ViewConfig = {
    ageNote: AGE_NOTE,
    moreUrl: BY_INGREDIENTS_TOOL_URL,
    peaceUrl: `${assetOrigin}${IMAGE_FILES.peace}`,
    mascot: mascotSvg('mark'),
  }
  const fonts = brandFonts
    ? `<link rel="preload" href="${assetOrigin}${FONT_FILES.text}" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${assetOrigin}${FONT_FILES.display}" as="font" type="font/woff2" crossorigin>`
    : ''
  const families = brandFonts
    ? `--font-heading: ${BRAND_FONTS.display}; /* --font-display: DM Sans */
    --font-body: ${BRAND_FONTS.text}; /* --font-sans: Inter */`
    : `--font-heading: ${SYSTEM_FONT}; /* host or system font (ChatGPT) */
    --font-body: ${SYSTEM_FONT}; /* host or system font (ChatGPT) */`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
${fonts}
<style>${brandFonts ? fontFaceCss(assetOrigin) : ''}${TOKENS_CSS}
  :root {
    ${families}
  }
${WIDGET_CSS}</style>
</head>
<body>
<p id="live" class="sr" role="status"></p>
<main id="root" aria-busy="true"></main>
<script>
var CONFIG = ${JSON.stringify(config).replace(/</g, '\\u003c')};
${VIEW_JS}
${BOOT_JS}
</script>
</body>
</html>`
}

/** The widget with brand fonts, as Claude and other MCP Apps hosts receive it. */
export const WIDGET_HTML = widgetHtml({ brandFonts: true })
