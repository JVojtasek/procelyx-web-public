// Minimal DOM for running public/app.js in node:vm on top of cheerio, so the page text and
// attributes can be compared AFTER JavaScript (language switch, accessible labels) without a browser.
// Only what app.js touches while loading is modelled; event handlers are stored but never run.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {load} from 'cheerio';

const BOOLEAN_ATTRS = new Set(['hidden', 'disabled', 'open', 'checked', 'required']);
const ATTR_PROPS = new Set(['placeholder', 'alt', 'lang', 'id', 'href', 'src', 'content', 'type', 'name', 'title']);

function camel(name) { return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

function makeDocument($, win) {
  const cache = new Map();
  const wrap = (el) => {
    if (!el) return null;
    if (cache.has(el)) return cache.get(el);
    const store = {};
    const node = $(el);
    const api = {
      get textContent() { return node.text(); },
      set textContent(v) { node.text(String(v)); },
      get innerHTML() { return node.html(); },
      get tagName() { return String(el.tagName || '').toUpperCase(); },
      get dataset() { return Object.fromEntries(Object.entries(el.attribs || {}).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [camel(k.slice(5)), v])); },
      get classList() {
        const list = () => (node.attr('class') || '').split(/\s+/).filter(Boolean);
        return {
          add: (...c) => node.addClass(c.join(' ')), remove: (...c) => node.removeClass(c.join(' ')),
          contains: (c) => list().includes(c),
          toggle: (c, force) => { const on = force ?? !list().includes(c); on ? node.addClass(c) : node.removeClass(c); return on; },
        };
      },
      setAttribute: (k, v) => { node.attr(k, String(v)); },
      getAttribute: (k) => node.attr(k) ?? null,
      removeAttribute: (k) => { node.removeAttr(k); },
      hasAttribute: (k) => node.attr(k) !== undefined,
      addEventListener: () => {}, removeEventListener: () => {}, focus: () => {}, blur: () => {}, click: () => {},
      scrollIntoView: () => {}, reportValidity: () => true, reset: () => {},
      appendChild: (child) => child, remove: () => {},
      querySelector: (sel) => wrap(node.find(sel).get(0)),
      querySelectorAll: (sel) => node.find(sel).toArray().map(wrap),
      closest: (sel) => wrap(node.closest(sel).get(0)),
    };
    const proxy = new Proxy(api, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop === 'string' && BOOLEAN_ATTRS.has(prop)) return node.attr(prop) !== undefined;
        if (typeof prop === 'string' && ATTR_PROPS.has(prop)) return node.attr(prop) ?? '';
        return store[prop];
      },
      set(target, prop, value) {
        if (prop === 'textContent') { target.textContent = value; return true; }
        if (typeof prop === 'string' && BOOLEAN_ATTRS.has(prop)) { value ? node.attr(prop, '') : node.removeAttr(prop); return true; }
        if (typeof prop === 'string' && ATTR_PROPS.has(prop)) { node.attr(prop, String(value)); return true; }
        store[prop] = value;
        return true;
      },
    });
    cache.set(el, proxy);
    return proxy;
  };
  const detached = () => new Proxy({style: {}, appendChild: (c) => c, remove: () => {}, click: () => {}, setAttribute: () => {}}, {get: (t, p) => (p in t ? t[p] : undefined), set: (t, p, v) => { t[p] = v; return true; }});
  return {
    querySelector: (sel) => wrap($(sel).get(0)),
    querySelectorAll: (sel) => $(sel).toArray().map(wrap),
    getElementById: (id) => wrap($(`[id="${id}"]`).get(0)),
    createElement: detached,
    addEventListener: () => {},
    get documentElement() { return wrap($('html').get(0)); },
    get body() { return wrap($('body').get(0)); },
    get title() { return $('title').text(); },
    set title(v) { $('title').text(String(v)); },
    referrer: '',
  };
}

/**
 * Loads public/index.html, runs its local scripts (site-config.js, i18n.js, app.js…) in order and
 * returns the resulting cheerio document.
 */
export function renderAfterJs(publicDir, {lang = 'cs', page = 'index.html'} = {}) {
  const $ = load(readFileSync(join(publicDir, page), 'utf8'));
  const memory = new Map();
  const win = {
    location: {search: lang === 'en' ? '?lang=en' : '', hash: '', pathname: '/', href: 'https://procelyx.cz/'},
    sessionStorage: {getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k)},
    URLSearchParams, URL, console, Date, JSON, Math, Blob: class {}, AbortSignal: {timeout: () => undefined},
    crypto: {randomUUID: () => '00000000-0000-4000-8000-000000000000'},
    setTimeout: () => 0, clearTimeout: () => {}, requestAnimationFrame: () => 0, addEventListener: () => {},
    fetch: async () => { throw new Error('network disabled in harness'); },
  };
  win.window = win;
  win.document = makeDocument($, win);
  const context = vm.createContext(win);
  for (const el of $('script[src]').toArray()) {
    const src = $(el).attr('src').split('?')[0];
    if (!src.startsWith('/')) continue;
    vm.runInContext(readFileSync(join(publicDir, src.slice(1)), 'utf8'), context, {filename: src});
  }
  return $;
}

/** Normalised DOM after JS: attributes that only carry slot metadata and asset versions are ignored. */
export function normalizedDom($) {
  const c = load($.html());
  c('[data-slot]').removeAttr('data-slot');
  c('[data-alt]').removeAttr('data-alt');
  c('script[src^="/i18n.js"]').remove();
  return c.html().replace(/\?v=[0-9a-f]{12}/g, '?v=X');
}

/** Text snapshot of a page after JS: everything a visitor or a search engine can read. */
export function textSnapshot($) {
  const attrs = (name) => $(`[${name}]`).toArray().map((el) => `${el.tagName}${$(el).attr('id') ? '#' + $(el).attr('id') : ''}: ${$(el).attr(name)}`);
  const dataT = {};
  for (const el of $('[data-t]').toArray()) (dataT[$(el).attr('data-t')] ||= []).push($(el).text());
  return {
    lang: $('html').attr('lang'),
    title: $('title').text(),
    description: $('meta[name="description"]').attr('content'),
    dataT,
    placeholders: attrs('placeholder'),
    alts: attrs('alt'),
    ariaLabels: attrs('aria-label'),
    bodyText: $('body').text().replace(/\s+/g, ' ').trim(),
    domSha256: createHash('sha256').update(normalizedDom($)).digest('hex'),
  };
}
