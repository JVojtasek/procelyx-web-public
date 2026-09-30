// Injection module of the contract nexus.site.v1 (see contract/nexus.site.v1.md).
//
//   injectPage(html, {i18n, site, media, library}, pageManifest, {lang}) -> html
//
// Pure and idempotent: no file system, no network, no clock. Nexus One keeps a byte-identical vendored
// copy (src/lib/site/vendor/inject.mjs with a `// source-sha256:` header) for its fast preview and runs
// the same fixtures (tests/fixtures/contract/*.json). Keep it dependent on cheerio only.
//
// What it does, in this order:
//   1. every [data-t=key] gets the text of i18n[lang][key] (when present and non-empty) — the same rule
//      as setLang() in public/app.js, so the HTML before JS equals the page after JS;
//   2. every [data-ph=key] gets the placeholder i18n[lang][key];
//   3. slots of the page manifest: text slots mark their elements with data-slot; image slots set
//      src/width/height from the media library and alt from i18n (data-alt keeps the key for app.js);
//      site slots set identity/SEO values from site.json;
//   4. every slot selector must then match at least one element, otherwise it throws.
import {load} from 'cheerio';

const siteText = (site, siteKey, lang) => {
  const v = site?.[siteKey];
  return v && typeof v === 'object' ? v[lang] : v;
};

function fail(msg) { throw new Error(`inject: ${msg}`); }

function applySiteSlot($, slot, site, lang) {
  const value = siteText(site, slot.siteKey, lang);
  if (typeof value !== 'string' || !value) fail(`slot ${slot.id}: site.${slot.siteKey} is empty`);
  switch (slot.siteKey) {
    case 'seoTitle':
      $('title').text(value);
      $('meta[property="og:title"]').attr('content', value);
      break;
    case 'seoDescription':
      $('meta[name="description"],meta[property="og:description"]').attr('content', value);
      break;
    case 'email':
      $('a[href^="mailto:"]').each((_, el) => { const a = $(el); a.attr('href', 'mailto:' + value); (a.find('b').length ? a.find('b') : a).text(value); });
      break;
    case 'phone':
      $('a[href^="tel:"]').each((_, el) => { const a = $(el); a.attr('href', 'tel:' + value.replaceAll(' ', '')); (a.find('b').length ? a.find('b') : a).text(value); });
      break;
    case 'businessId':
      $('[data-site="businessId"]').text('IČO: ' + value);
      break;
    default:
      $(`[data-site="${slot.siteKey}"]`).text(value);
  }
}

export function applyContent($, {i18n, site, media, library}, pageManifest, {lang = 'cs'} = {}) {
  const dict = i18n?.[lang];
  if (!dict || typeof dict !== 'object') fail(`missing dictionary for ${lang}`);
  $('[data-t]').each((_, el) => {
    const v = dict[$(el).attr('data-t')];
    if (typeof v === 'string' && v) $(el).text(v);
  });
  $('[data-ph]').each((_, el) => {
    const v = dict[$(el).attr('data-ph')];
    if (typeof v === 'string' && v) $(el).attr('placeholder', v);
  });
  const slots = (pageManifest?.sections || []).flatMap((s) => s.slots);
  for (const slot of slots) {
    if (slot.type === 'image') {
      const entry = media?.[slot.mediaKey];
      if (!entry) fail(`slot ${slot.id}: media.${slot.mediaKey} missing`);
      const item = library?.[entry.mediaId];
      if (!item) fail(`slot ${slot.id}: mediaId ${entry.mediaId} is not in the media library`);
      const alt = dict[slot.altKey];
      if (typeof alt !== 'string' || !alt) fail(`slot ${slot.id}: alt text ${slot.altKey} missing for ${lang}`);
      const imgs = $(`img[data-slot="${slot.id}"]`);
      if (!imgs.length) fail(`slot ${slot.id}: no <img data-slot="${slot.id}"> in the page`);
      imgs.attr({src: item.path, width: String(item.width), height: String(item.height), alt, 'data-alt': slot.altKey});
    } else if (slot.key) {
      const els = $(`[data-t="${slot.key}"]`);
      if (!els.length) fail(`slot ${slot.id}: no [data-t="${slot.key}"] in the page`);
      els.attr('data-slot', slot.id);
    } else if (slot.siteKey) {
      applySiteSlot($, slot, site, lang);
    } else {
      fail(`slot ${slot.id}: needs key, siteKey or mediaKey`);
    }
  }
  for (const slot of slots) {
    let found = 0;
    try { found = $(slot.selector).length; } catch { fail(`slot ${slot.id}: invalid selector ${slot.selector}`); }
    if (!found) fail(`slot ${slot.id}: selector ${slot.selector} matches nothing`);
  }
  return $;
}

export function injectPage(html, content, pageManifest, options = {}) {
  const $ = load(html);
  applyContent($, content, pageManifest, options);
  return $.html();
}
