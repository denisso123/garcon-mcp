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
  ICONS,
  IMAGE_FILES,
  SYSTEM_FONT,
  TOKENS_CSS,
  fontFaceCss,
  mascotSvg,
} from './brand'
import { AGE_NOTE, BY_INGREDIENTS_TOOL_URL, MCP_ORIGIN } from './site'

// Bump the version in the URI on any breaking change: hosts cache by URI.
export const WIDGET_URI = 'ui://ask-garcon/cocktail-list-v2.html'

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
  placeholderUrl: string
  mascot: string
  star: string
  chevronLeft: string
  chevronRight: string
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
  // components/ui/tag.tsx: the label sits in its own span with 2 px padding.
  function tag(text, tone, icon) {
    return '<span class="tag' + (tone ? ' ' + tone : '') + '">' + (icon || '') + '<span class="tag-label">' + esc(text) + '</span></span>';
  }

  // components/garcon/recipe-card.tsx: one link per card. The photo (3:2,
  // radius 24, elevation e2) carries the Plus badge top left; under it the
  // name in title 2 medium, the tags row (success tag for "Ready to make",
  // then the flavour tags) and one quiet note line.
  function card(item, images) {
    var id = 'g' + (++nextId);
    var url = safeUrl(item && item.url, RECIPE);
    var img = safeUrl(images && images[item.url], IMAGE);
    var name = String((item && item.name) || 'Untitled drink');
    var plus = item.premium === true
      ? '<span class="tag plus" id="' + id + '-p">' + config.star + '<span class="tag-label">Plus</span></span>'
      : '';
    var tags = '';
    if (item.can_make_now) tags += tag('Ready to make', 'ok');
    (item.flavors || []).forEach(function (flavor) { tags += tag(flavor); });
    var notes = [];
    if (!item.can_make_now && item.missing && item.missing.length) notes.push('Missing ' + words(item.missing));
    (item.depends_on || []).forEach(function (d) {
      if (d && d.ingredient && d.you_said) notes.push('Only if your ' + d.you_said + ' is ' + d.ingredient);
    });
    var note = notes.length ? '<span class="note-line">' + esc(notes.join('. ')) + '</span>' : '';
    var photo = img
      ? '<img class="photo" src="' + esc(img) + '" alt="' + esc(name) + '" loading="lazy" decoding="async">'
      : '<span class="placeholder"><img src="' + esc(config.placeholderUrl) + '" alt="" width="32" height="32"></span>';
    var body = '<span class="media">' + photo + plus + '</span>' +
      '<span class="body"><h3 class="name" id="' + id + '-n">' + esc(name) + '</h3>' +
      '<span class="details" id="' + id + '-d">' + (tags ? '<span class="tags">' + tags + '</span>' : '') + note + '</span></span>';
    if (!url) return '<li><div class="card">' + body + '</div></li>';
    return '<li><a class="card" href="' + esc(url) + '" data-href="' + esc(url) + '" target="_blank" rel="noopener noreferrer"' +
      ' aria-labelledby="' + id + '-n' + (plus ? ' ' + id + '-p' : '') + '" aria-describedby="' + id + '-d">' + body + '</a></li>';
  }

  // A shelf of cards: a carousel at inline widths, the site's card grid from
  // 640 px (CSS decides). The arrow pair is the site's stepper (quaternary
  // xs icon buttons on a surface 2 pill); the list itself takes the keys.
  function section(key, title, items, images, quiet) {
    if (!items || !items.length) return '';
    var arrows = '<span class="stepper" role="group" aria-label="Scroll ' + esc(title.toLowerCase()) + '">' +
      '<button type="button" class="step" data-step="-1" aria-controls="' + key + '-list" aria-label="Previous drink">' + config.chevronLeft + '</button>' +
      '<button type="button" class="step" data-step="1" aria-controls="' + key + '-list" aria-label="Next drink">' + config.chevronRight + '</button></span>';
    return '<section class="shelf' + (quiet ? ' quiet' : '') + '" aria-labelledby="' + key + '"><div class="shelf-head"><h2 id="' + key + '">' + esc(title) + '</h2>' + arrows + '</div>' +
      '<ul class="cards" id="' + key + '-list" tabindex="0" aria-labelledby="' + key + '">' +
      items.map(function (item) { return card(item, images); }).join('') + '</ul></section>';
  }

  function footer() {
    return '<footer class="foot"><div class="foot-row"><span class="logo">' + config.mascot +
      '<span class="wordmark">Garçon</span></span>' +
      '<a class="more" href="' + esc(config.moreUrl) + '" data-href="' + esc(config.moreUrl) + '" target="_blank" rel="noopener noreferrer">More on fixmeadrinkapp.com</a></div>' +
      '<p class="age">' + esc(config.ageNote) + '</p></footer>';
  }

  // RecipeCardSkeleton: the photo block, a title bar and two tags.
  function loading() {
    var sk = '<li class="sk-card"><span class="sk sk-photo"></span><span class="body"><span class="sk sk-name"></span>' +
      '<span class="sk-tags"><span class="sk sk-tag"></span><span class="sk sk-tag"></span></span></span></li>';
    return '<div class="skeleton" aria-hidden="true"><span class="sk sk-title"></span><ul class="cards">' + sk + sk + sk + '</ul></div>';
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
      html += section('s-bar', lowOnly ? 'Low or zero-proof from your bar' : 'Drinks from your bar', cocktails, images, false);
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

  function linkHelp(url) {
    return 'Couldn’t open the page. <button type="button" class="retry" data-retry="' + esc(url) + '">Try again</button> or copy the link: ' +
      '<span class="copy-url">' + esc(url) + '</span>';
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
    linkHelp: linkHelp,
    fromToolResult: fromToolResult
  };
}

// Keyboard and arrow-button movement for one shelf. scroller is the list;
// each card's li gives its position. Left and Right move one card (and move
// focus with it when a card has focus), Home and End go to the ends. Does
// nothing while the shelf is a grid that does not scroll.
function garconCarousel(scroller, smooth) {
  function cards() {
    return Array.prototype.slice.call(scroller.querySelectorAll('.card'));
  }
  function positions(items) {
    var first = items.length ? items[0].parentNode.offsetLeft : 0;
    return items.map(function (item) { return item.parentNode.offsetLeft - first; });
  }
  function scrollable() {
    return scroller.scrollWidth - scroller.clientWidth > 1;
  }
  function current(lefts) {
    var best = 0;
    lefts.forEach(function (left, index) {
      if (Math.abs(left - scroller.scrollLeft) < Math.abs(lefts[best] - scroller.scrollLeft)) best = index;
    });
    return best;
  }
  function go(index, items) {
    var lefts = positions(items || cards());
    var target = Math.max(0, Math.min(lefts.length - 1, index));
    scroller.scrollTo({ left: lefts[target], behavior: smooth ? 'smooth' : 'auto' });
    return target;
  }
  function step(direction) {
    if (!scrollable()) return -1;
    var items = cards();
    return go(current(positions(items)) + direction, items);
  }
  function onKey(event) {
    if (!scrollable()) return false;
    var items = cards();
    var focused = items.indexOf(event.target);
    var from = focused >= 0 ? focused : current(positions(items));
    var target;
    if (event.key === 'ArrowRight') target = from + 1;
    else if (event.key === 'ArrowLeft') target = from - 1;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = items.length - 1;
    else return false;
    event.preventDefault();
    target = go(target, items);
    if (focused >= 0 && items[target] && typeof items[target].focus === 'function') items[target].focus({ preventScroll: true });
    return true;
  }
  function state() {
    return {
      scrollable: scrollable(),
      atStart: scroller.scrollLeft <= 1,
      atEnd: scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1
    };
  }
  return { step: step, onKey: onKey, state: state };
}

// Opens a link with the opener the host negotiated (deps.mode): the MCP Apps
// ui/open-link request, ChatGPT's openExternal, or window.open outside a
// host. A refusal or a cancelled confirmation is final. A request that gets
// no answer is not retried behind the person's back: the caller offers a
// retry button and the URL to copy. Resolves 'opened', 'refused' or 'failed'.
function garconLinks(deps) {
  return function openLink(url) {
    if (!url) return Promise.resolve('failed');
    var mode = deps.mode();
    if (mode === 'bridge') {
      return deps.request('ui/open-link', { url: url }, 15000).then(function (result) {
        return result && result.isError ? 'refused' : 'opened';
      }, function () { return 'failed'; });
    }
    try {
      if (mode === 'openai') {
        deps.openai.openExternal({ href: url });
        return Promise.resolve('opened');
      }
      if (mode === 'window') return Promise.resolve(deps.open(url) ? 'opened' : 'failed');
    } catch (error) {
      return Promise.resolve('failed');
    }
    return Promise.resolve('failed');
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
  function request(method, params, timeoutMs) {
    var id = nextId++;
    send({ jsonrpc: '2.0', id: id, method: method, params: params || {} });
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      setTimeout(function () { if (pending[id]) { delete pending[id]; reject(new Error('timeout')); } }, timeoutMs || 4000);
    });
  }
  function notify(method, params) { send({ jsonrpc: '2.0', method: method, params: params || {} }); }

  // The opener is chosen from what the host negotiated, never by trial:
  // until ui/initialize answers, only ChatGPT's own API (or a plain page) is known.
  function hasOpenExternal() { return Boolean(window.openai && typeof window.openai.openExternal === 'function'); }
  var linkMode = hasOpenExternal() ? 'openai' : bridge ? 'none' : 'window';
  var openLink = garconLinks({
    mode: function () { return linkMode; },
    request: request,
    openai: window.openai,
    open: function (url) { return window.open(url, '_blank', 'noopener'); }
  });
  var linkHelp = document.getElementById('link-help');
  function follow(url) {
    linkHelp.hidden = true;
    openLink(url).then(function (outcome) {
      if (outcome === 'failed') {
        linkHelp.innerHTML = view.linkHelp(url);
        linkHelp.hidden = false;
      }
      reportSize();
    });
  }
  linkHelp.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('button[data-retry]');
    if (button && view.isRecipeUrl(button.getAttribute('data-retry'))) follow(button.getAttribute('data-retry'));
  });

  var live = document.getElementById('live');
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var shelves = {};

  // Arrow buttons follow the list: disabled at either end, hidden while the
  // shelf is a grid or everything fits.
  function syncShelf(list) {
    var shelf = shelves[list.id];
    var stepper = list.parentNode.querySelector('.stepper');
    if (!shelf || !stepper) return;
    var state = shelf.state();
    stepper.hidden = !state.scrollable;
    stepper.querySelector('[data-step="-1"]').disabled = state.atStart;
    stepper.querySelector('[data-step="1"]').disabled = state.atEnd;
  }
  function setupShelves() {
    shelves = {};
    Array.prototype.forEach.call(root.querySelectorAll('ul.cards[id]'), function (list) {
      shelves[list.id] = garconCarousel(list, !reduceMotion);
      list.addEventListener('keydown', shelves[list.id].onKey);
      list.addEventListener('scroll', function () { syncShelf(list); }, { passive: true });
      syncShelf(list);
    });
  }

  function show(html, busy, status) {
    root.innerHTML = html;
    root.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (status) live.textContent = status;
    setupShelves();
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
    var button = event.target.closest && event.target.closest('button[data-step]');
    if (button) {
      var id = button.getAttribute('aria-controls');
      if (shelves[id]) shelves[id].step(Number(button.getAttribute('data-step')));
      return;
    }
    var link = event.target.closest && event.target.closest('a[data-href]');
    if (!link) return;
    event.preventDefault();
    var url = link.getAttribute('data-href');
    if (view.isRecipeUrl(url)) follow(url);
  });
  // A recipe photo that fails to load falls back to the card's placeholder.
  root.addEventListener('error', function (event) {
    var img = event.target;
    if (!img || img.tagName !== 'IMG') return;
    if (img.classList.contains('photo')) {
      var holder = document.createElement('span');
      holder.className = 'placeholder';
      holder.innerHTML = '<img alt="" width="32" height="32">';
      holder.firstChild.src = CONFIG.placeholderUrl;
      img.replaceWith(holder);
    } else {
      img.remove();
    }
  }, true);

  function reportSize() {
    Array.prototype.forEach.call(root.querySelectorAll('ul.cards[id]'), syncShelf);
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
    var caps = result && result.hostCapabilities;
    linkMode = caps && caps.openLinks ? 'bridge' : hasOpenExternal() ? 'openai' : 'none';
    applyHostContext(result && result.hostContext);
    notify('ui/notifications/initialized', {});
  }, function () {
    linkMode = hasOpenExternal() ? 'openai' : 'none';
  });
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
    --c-fill-strong: light-dark(var(--surface-3), color-mix(in srgb, var(--surface-0) 13%, transparent)); /* photo placeholder, skeleton: surface_3 */
    --c-hover: light-dark(var(--surface-3), color-mix(in srgb, var(--surface-0) 14%, transparent)); /* icon button quaternary hover: surface_3 on the surface_2 pill */
    --c-rule: light-dark(var(--outline-low-em), var(--outline-white-16)); /* divider: outline/low_em */
    --c-mark: light-dark(var(--fg-med-em), var(--fg-base-em)); /* logo mark and wordmark: text/med_em */
    --c-disabled: light-dark(var(--fg-base-em), color-mix(in srgb, var(--surface-0) 30%, transparent)); /* disabled icon: text/base_em */
    --c-link: light-dark(var(--fg-primary-high-em), var(--outline-primary-med-em)); /* link inline: text/primary_high_em */
    --c-link-line: light-dark(var(--outline-primary-med-em), color-mix(in srgb, var(--outline-primary-med-em) 50%, transparent)); /* link inline underline: outline/primary_med_em */
    --c-ok: light-dark(var(--fg-success-high-em), color-mix(in srgb, var(--fg-success-high-em) 45%, var(--surface-0))); /* tag success text */
    --c-ok-fill: light-dark(var(--surface-success-base-em-alpha), color-mix(in srgb, var(--fg-success-high-em) 28%, transparent)); /* tag success fill */
    --c-warn: light-dark(var(--fg-warning-high-em), color-mix(in srgb, var(--fg-warning-high-em) 45%, var(--surface-0))); /* tool note warning text */
    --c-warn-fill: light-dark(var(--surface-warning-base-em-alpha), color-mix(in srgb, var(--surface-warning-high-em) 12%, transparent)); /* tool note warning fill */
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
    display: grid; gap: var(--space-4xl);
    padding: calc(var(--space-lg) + var(--safe-top, 0px)) calc(var(--space-xxl) + var(--safe-right, 0px))
      calc(var(--space-lg) + var(--safe-bottom, 0px)) calc(var(--space-xxl) + var(--safe-left, 0px));
  }
  p { margin: 0; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

  /* a shelf: heading row, then the cards */
  .shelf { display: grid; gap: var(--space-lg); min-width: 0; }
  .shelf-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-lg); }
  h2 {
    margin: 0; font-family: var(--font-heading); font-weight: 600;
    font-size: var(--text-title-2); line-height: var(--leading-title-2); letter-spacing: var(--tracking-title-2);
    text-wrap: balance;
  }
  .quiet h2 { font-family: var(--font-body); font-weight: 500; color: var(--c-muted);
    font-size: var(--text-body-1); line-height: var(--leading-body-1); letter-spacing: var(--tracking-body-1); }

  /* recipe page servings stepper: two quaternary xs icon buttons on a surface 2 pill */
  .stepper { display: flex; align-items: center; gap: var(--space-xs); padding: var(--space-xs);
    border-radius: var(--radius-8); background: var(--c-fill); box-shadow: var(--shadow-special-drop); }
  .stepper[hidden] { display: none; }
  .step {
    position: relative; display: inline-flex; align-items: center; justify-content: center;
    width: var(--size-control-xs); height: var(--size-control-xs); padding: 0;
    border: 1px solid transparent; border-radius: var(--radius-6); background: transparent; color: var(--c-muted);
    cursor: pointer; transition: color 150ms ease-out, background-color 150ms ease-out, transform 150ms ease-out;
  }
  .step::after { content: ""; position: absolute; inset: calc(-1 * var(--space-md)); } /* 40 px hit area, as the site's xs icon button */
  .step svg { width: var(--size-icon-sm); height: var(--size-icon-sm); }
  @media (hover: hover) { .step:hover:not(:disabled) { background: var(--c-hover); color: var(--c-text); } }
  @media (prefers-reduced-motion: no-preference) { .step:active:not(:disabled) { transform: scale(0.96); } }
  .step:disabled { color: var(--c-disabled); cursor: default; }
  .step:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 0; }

  /* the list: a carousel below 640 px, the site's CardGrid (columns 3) from there */
  .cards {
    list-style: none; margin: 0; padding: 0;
    display: grid; grid-auto-flow: column; grid-auto-columns: 72%; gap: var(--space-xxl);
    overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x mandatory; scrollbar-width: none;
    /* bleed to the frame edge so the next card is cut by it, and leave room for the lift and shadow */
    margin-inline: calc(-1 * var(--space-xxl)); padding: var(--space-xs) var(--space-xxl) var(--space-md);
    scroll-padding-inline: var(--space-xxl);
    position: relative;
  }
  .cards::-webkit-scrollbar { display: none; }
  .cards > li { display: flex; min-width: 0; scroll-snap-align: start; }
  .cards > li > * { flex: 1; }
  .cards:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: calc(-1 * var(--focus-ring-width)); border-radius: var(--radius-24); }
  @media (min-width: 640px) {
    .cards { grid-auto-flow: row; grid-auto-columns: auto; grid-template-columns: repeat(2, minmax(0, 1fr));
      overflow: visible; scroll-snap-type: none; margin-inline: 0; padding: 0; }
    .stepper { display: none; }
  }
  @media (min-width: 1024px) { .cards { grid-template-columns: repeat(3, minmax(0, 1fr)); } }

  /* recipe_card (components/garcon/recipe-card.tsx) */
  .card { display: flex; flex-direction: column; min-width: 0; border-radius: var(--radius-24); color: inherit; text-decoration: none; }
  a.card:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 0; }
  .media {
    position: relative; display: block; width: 100%; aspect-ratio: 3 / 2; overflow: hidden; /* aspect-recipe */
    border-radius: var(--radius-24); background: var(--c-fill-strong); box-shadow: var(--shadow-e2);
    transition: box-shadow 150ms ease-out, transform 150ms ease-out;
  }
  .photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .placeholder { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .placeholder img { width: var(--space-6xl); height: var(--space-6xl); border-radius: 50%; }
  @media (hover: hover) { a.card:hover .media { box-shadow: var(--shadow-e3); } }
  @media (hover: hover) and (prefers-reduced-motion: no-preference) { a.card:hover .media { transform: translateY(calc(-1 * var(--space-xs))); } }
  @media (prefers-reduced-motion: no-preference) { a.card:active .media { transform: scale(0.98); } }
  .body { display: flex; flex-direction: column; gap: var(--space-md); padding: var(--space-lg); }
  .name {
    margin: 0; font-weight: 500; color: var(--c-text); overflow-wrap: break-word;
    font-size: var(--text-title-2); line-height: var(--leading-title-2); letter-spacing: var(--tracking-title-2);
  }
  .details { display: flex; flex-direction: column; gap: var(--space-md); }
  .details:empty { display: none; }
  .tags { display: flex; flex-wrap: wrap; gap: var(--space-sm); }

  /* tags, size xs (components/ui/tag.tsx): secondary, success, and the Plus badge */
  .tag {
    position: relative; display: inline-flex; align-items: center; justify-content: center; max-width: 100%;
    min-height: var(--size-control-xs); padding: var(--space-xxs) var(--space-sm);
    border: 1px solid transparent; border-radius: var(--radius-6); box-shadow: var(--shadow-special-drop);
    font-size: var(--text-caption-1); line-height: var(--leading-caption-1); letter-spacing: var(--tracking-caption-1); font-weight: 500;
    background: var(--c-fill); color: var(--c-muted);
  }
  .tag-label { padding-inline: var(--space-xxs); }
  .tag.ok { background: var(--c-ok-fill); color: var(--c-ok); }
  /* plus-badge.tsx, onImage: warning tag made opaque over the photo, amber star */
  .tag.plus { position: absolute; left: var(--space-lg); top: var(--space-lg);
    background: var(--surface-warning-overlay); color: var(--fg-warning-overlay); box-shadow: var(--shadow-e2); }
  .tag.plus .star { flex: none; width: var(--size-icon-xs); height: var(--size-icon-xs); color: var(--surface-warning-high-em); }

  .note-line, .aside, .age {
    font-size: var(--text-caption-2); line-height: var(--leading-caption-2); letter-spacing: var(--tracking-caption-2);
    color: var(--c-muted); overflow-wrap: anywhere;
  }
  .lead { color: var(--c-muted); }

  .empty { display: flex; align-items: center; gap: var(--space-lg); }
  .empty-art { flex: none; width: var(--size-thumb); height: var(--size-thumb); object-fit: contain; }
  .empty-text { display: grid; gap: var(--space-xxs); }
  .empty-title, .note-title { font-weight: 500; color: var(--c-text); }
  .empty-title { font-size: var(--text-title-1); line-height: var(--leading-title-1); letter-spacing: var(--tracking-title-1); }

  /* tool note, tone warning */
  .note { display: grid; gap: var(--space-xs); padding: var(--space-xxl); border-radius: var(--radius-12); box-shadow: var(--shadow-special-drop); }
  .note.warn { background: var(--c-warn-fill); color: var(--c-warn); }
  .note.warn .note-title { color: inherit; }

  /* site footer bottom bar: logo sm, then the link */
  .foot { display: grid; gap: var(--space-xxs); padding-top: var(--space-md); border-top: 1px solid var(--c-rule); }
  .foot-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; column-gap: var(--space-lg); }
  .logo { display: inline-flex; align-items: center; gap: var(--space-xs); color: var(--c-mark); }
  .logo svg { width: 26px; height: 24px; } /* logo.tsx size sm: mark 26 x 24 */
  .wordmark {
    font-family: var(--font-heading); font-weight: 600;
    font-size: var(--text-wordmark-sm); line-height: var(--leading-wordmark-sm); letter-spacing: var(--tracking-wordmark-sm);
  }
  /* link, variant inline (components/ui/link.tsx) */
  .more {
    display: inline-flex; align-items: center; min-height: var(--size-control-lg); /* 44 pt tap target (Claude guidelines) */
    margin-inline: calc(-1 * var(--space-xs)); padding-inline: var(--space-xs); border-radius: var(--radius-6);
    font-size: var(--text-caption-2); line-height: var(--leading-caption-2); letter-spacing: var(--tracking-caption-2);
    color: var(--c-link); text-decoration: underline; text-decoration-color: var(--c-link-line);
    text-decoration-thickness: 1px; text-underline-offset: 4px;
  }
  @media (hover: hover) { .more:hover { text-decoration-color: currentColor; } }
  .more:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 0; }
  .age { color: var(--c-faint); }

  /* the page could not be opened: a retry and the URL to copy */
  .link-help {
    margin: 0 calc(var(--space-xxl) + var(--safe-right, 0px)) calc(var(--space-lg) + var(--safe-bottom, 0px)) calc(var(--space-xxl) + var(--safe-left, 0px));
    font-size: var(--text-caption-2); line-height: var(--leading-caption-2); letter-spacing: var(--tracking-caption-2); color: var(--c-muted);
  }
  .link-help[hidden] { display: none; }
  .retry { padding: 0; border: 0; background: none; font: inherit; font-weight: 500; color: var(--c-link); cursor: pointer;
    text-decoration: underline; text-decoration-color: var(--c-link-line); text-underline-offset: 4px; }
  .retry:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 2px; border-radius: var(--radius-4); }
  .copy-url { color: var(--c-text); overflow-wrap: anywhere; user-select: all; -webkit-user-select: all; }

  /* RecipeCardSkeleton: surface 3 blocks, radius 4, pulse only with motion allowed */
  .skeleton { display: grid; gap: var(--space-lg); }
  .skeleton .cards { overflow: hidden; }
  .sk { display: block; border-radius: var(--radius-4); background: var(--c-fill-strong); }
  @media (prefers-reduced-motion: no-preference) { .sk { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; } }
  @keyframes pulse { 50% { opacity: 0.5; } }
  .sk-card { display: flex; flex-direction: column; }
  .sk-title { width: 45%; height: var(--leading-title-2); }
  .sk-photo { width: 100%; aspect-ratio: 3 / 2; border-radius: var(--radius-24); box-shadow: var(--shadow-e2); }
  .sk-name { width: 50%; height: var(--space-4xl); }
  .sk-tags { display: flex; gap: var(--space-sm); }
  .sk-tag { width: var(--space-8xl); height: var(--space-4xl); }
`

export function widgetHtml({ brandFonts, assetOrigin = MCP_ORIGIN }: WidgetOptions) {
  const config: ViewConfig = {
    ageNote: AGE_NOTE,
    moreUrl: BY_INGREDIENTS_TOOL_URL,
    peaceUrl: `${assetOrigin}${IMAGE_FILES.peace}`,
    placeholderUrl: `${assetOrigin}${IMAGE_FILES.placeholder}`,
    mascot: mascotSvg('mark'),
    star: ICONS.star,
    chevronLeft: ICONS.chevronLeft,
    chevronRight: ICONS.chevronRight,
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
<p id="link-help" class="link-help" role="status" hidden></p>
<script>
var CONFIG = ${JSON.stringify(config).replace(/</g, '\\u003c')};
${VIEW_JS}
${BOOT_JS}
</script>
</body>
</html>`
}
