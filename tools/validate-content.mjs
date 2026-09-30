#!/usr/bin/env node
// Strict validation of content/** against the contract nexus.site.v1 (schemas/*.json + cross checks).
//
//   node tools/validate-content.mjs                    validate the working tree (the build does the same)
//   node tools/validate-content.mjs --base <dir>       also compare with the base content in <dir>/content
//                                                      (content-guard, machine PRs: only editable slots may change)
//
// Unknown fields, unknown files, HTML in texts, lengths outside the slot limits, images outside the media
// library and SVG outside the element/attribute allowlist are errors. Exit code 1 on any error.
import {readFileSync, readdirSync, existsSync, statSync} from 'node:fs';
import {resolve, join, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {load} from 'cheerio';
import {validate} from './lib/json-schema-lite.mjs';
import {buildMediaLibrary, loadContent, allSlots} from './lib/site-content.mjs';

const toolsRoot = resolve(import.meta.dirname, '..');
const schema = (name) => JSON.parse(readFileSync(resolve(toolsRoot, 'schemas', name), 'utf8'));
const EDITABLE_TIERS = new Set(['T2', 'T3']);
const ALLOWED_FILES = [/^site\.json$/, /^manifest\.json$/, /^media\.json$/, /^media-library\.json$/, /^i18n\/(cs|en)\.json$/, /^media-src\/[a-z0-9-]+\.svg$/];

// SVG allowlist (spec §3.4): only these elements and attributes, links only to fragments inside the same file.
// No <script>, <style>, <a>, <image>, <foreignObject>, animation (<set>, <animate…>), event handlers or external URLs.
const SVG_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'marker',
]);
const SVG_ATTRIBUTES = new Set([
  'id', 'class', 'style', 'role', 'focusable', 'version', 'xmlns', 'xmlns:xlink', 'xml:space', 'href', 'xlink:href',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'dx', 'dy', 'd', 'points', 'width', 'height',
  'viewBox', 'preserveAspectRatio', 'transform', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'color',
  'display', 'visibility', 'vector-effect', 'shape-rendering', 'clip-path', 'clip-rule', 'clipPathUnits', 'mask', 'maskUnits',
  'maskContentUnits', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'spreadMethod',
  'patternUnits', 'patternContentUnits', 'patternTransform', 'markerWidth', 'markerHeight', 'markerUnits', 'refX', 'refY',
  'orient', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing',
]);
const LOCAL_REF = /^#[A-Za-z_][A-Za-z0-9_.-]*$/;
const LOCAL_URL = /^url\(\s*(["']?)#[A-Za-z_][A-Za-z0-9_.-]*\1\s*\)$/i;
const NAMED_ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', tab: '\t', newline: '\n', sol: '/', lpar: '(', rpar: ')'};

/** Decodes numeric and common named character references until stable (the XML parser already did one pass). */
function decodeEntities(value) {
  let prev;
  let out = String(value);
  do {
    prev = out;
    out = out
      .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
      .replace(/&#([0-9]+);?/g, (_, d) => String.fromCodePoint(Math.min(Number(d), 0x10ffff)))
      .replace(/&([a-z]+);/gi, (m, n) => NAMED_ENTITIES[n.toLowerCase()] ?? m);
  } while (out !== prev);
  return out;
}

/** Errors for an SVG source outside the allowlist. The website itself only ever serves raster images. */
export function sanitizeSvg(text) {
  const errors = [];
  const add = (msg) => { if (!errors.includes(msg)) errors.push(msg); };
  if (/<!ENTITY|<!DOCTYPE/i.test(text)) add('contains a DTD/entity declaration');
  const $ = load(String(text), {xml: true});
  const roots = $.root().children().toArray();
  if (roots.length !== 1 || roots[0].name !== 'svg') add('is not an SVG document');
  const walk = (node) => {
    for (const child of node.children || []) {
      if (child.type === 'directive' && !/^\?xml\s/i.test(child.data || '')) add(`contains a processing instruction <${String(child.data).split(/\s/)[0]}>`);
      if (child.type === 'cdata') add('contains CDATA');
      if (child.type !== 'tag' && child.type !== 'script' && child.type !== 'style') continue;
      if (!SVG_ELEMENTS.has(child.name)) add(`contains <${child.name}> (element not allowed)`);
      for (const [name, raw] of Object.entries(child.attribs || {})) {
        const value = decodeEntities(raw);
        const compact = value.replace(/[\s\u0000-\u001f]+/g, '');
        if (/^on/i.test(name)) { add(`contains an event handler attribute (${name})`); continue; }
        if (!SVG_ATTRIBUTES.has(name) && !/^aria-[a-z]+$/.test(name)) { add(`attribute ${name} on <${child.name}> is not allowed`); continue; }
        if ((name === 'href' || name === 'xlink:href') && !LOCAL_REF.test(value.trim())) add(`${name} on <${child.name}> is not a link inside the file (#id)`);
        if (/(javascript|vbscript|data):/i.test(compact)) add(`attribute ${name} contains a script or data: URL`);
        if (/url\(/i.test(compact) && !(compact.match(/url\([^)]*\)?/gi) || []).every((u) => LOCAL_URL.test(u))) add(`attribute ${name} references an external resource`);
        if (name === 'style' && /@import|expression\s*\(|\\/i.test(value)) add('style attribute contains @import, expression() or CSS escapes');
      }
      walk(child);
    }
  };
  walk($.root().get(0));
  return errors;
}

function listContentFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, {recursive: true}).map(String).filter((p) => statSync(join(dir, p)).isFile()).map((p) => p.split(sep).join('/'));
}

const lengthOf = (s) => [...s].length;

export function validateContent(root, content = loadContent(root), {base} = {}) {
  const errors = [];
  const push = (file, list) => list.forEach((e) => errors.push(`${file}: ${e}`));
  const {site, i18n, media, library, manifest} = content;

  push('content/site.json', validate(schema('site.schema.json'), site));
  push('content/i18n/cs.json', validate(schema('i18n.schema.json'), i18n.cs));
  push('content/i18n/en.json', validate(schema('i18n.schema.json'), i18n.en));
  push('content/media.json', validate(schema('media.schema.json'), media));
  push('content/media-library.json', validate(schema('media-library.schema.json'), library));
  push('content/manifest.json', validate(schema('manifest.schema.json'), manifest));
  if (errors.length) return errors; // cross checks assume the shapes are right

  // Files: only known content files; SVG sources must be inert.
  const contentDir = resolve(root, 'content');
  for (const file of listContentFiles(contentDir)) {
    if (!ALLOWED_FILES.some((re) => re.test(file))) errors.push(`content/${file}: unknown file (content/** holds only the contract files)`);
    if (file.endsWith('.svg')) sanitizeSvg(readFileSync(join(contentDir, file), 'utf8')).forEach((e) => errors.push(`content/${file}: SVG ${e}`));
  }

  // Dictionaries: the same keys in both languages.
  const csKeys = Object.keys(i18n.cs), enKeys = new Set(Object.keys(i18n.en));
  for (const k of csKeys) if (!enKeys.has(k)) errors.push(`content/i18n/en.json: missing key ${k}`);
  for (const k of enKeys) if (!Object.hasOwn(i18n.cs, k)) errors.push(`content/i18n/en.json: key ${k} is not in cs.json`);

  // Media library must be exactly what public/images holds (it is generated; nobody edits it by hand).
  const generated = buildMediaLibrary(root);
  if (!isDeepStrictEqual(library, generated)) errors.push('content/media-library.json: does not match public/images (run npm run build)');
  for (const [key, {mediaId}] of Object.entries(media)) if (!Object.hasOwn(library, mediaId)) errors.push(`content/media.json: ${key}.mediaId ${mediaId} is not in the media library`);

  // Manifest cross checks.
  const slots = allSlots(manifest);
  const ids = new Set();
  const sectionIds = new Set();
  for (const page of manifest.pages) {
    if (!existsSync(resolve(root, page.file))) errors.push(`manifest: page ${page.id} file ${page.file} does not exist`);
    for (const section of page.sections) {
      if (sectionIds.has(section.id)) errors.push(`manifest: duplicate section id ${section.id}`);
      sectionIds.add(section.id);
    }
  }
  for (const {slot} of slots) {
    const where = `manifest: slot ${slot.id}`;
    if (ids.has(slot.id)) errors.push(`${where}: duplicate id`);
    ids.add(slot.id);
    const bindings = ['key', 'siteKey', 'mediaKey'].filter((b) => slot[b] !== undefined);
    if (bindings.length !== 1) errors.push(`${where}: needs exactly one of key, siteKey, mediaKey`);
    if ((slot.derivedAssets.length || slot.affectsLegal) && EDITABLE_TIERS.has(slot.tier)) errors.push(`${where}: derived assets or legal impact require tier DEV or NEVER`);
    if (slot.type === 'image') {
      if (!slot.mediaKey || !slot.altKey) errors.push(`${where}: image slots need mediaKey and altKey`);
      if (slot.minLength !== undefined || slot.maxLength !== undefined) errors.push(`${where}: image slots have no length limits`);
      if (slot.selector !== `[data-slot="${slot.id}"]`) errors.push(`${where}: selector must be [data-slot="${slot.id}"]`);
      if (slot.mediaKey && !Object.hasOwn(media, slot.mediaKey)) errors.push(`${where}: media.${slot.mediaKey} missing`);
      for (const lang of slot.i18n ? ['cs', 'en'] : ['cs']) if (!Object.hasOwn(i18n[lang], slot.altKey) || !i18n[lang][slot.altKey]) errors.push(`${where}: alt text ${slot.altKey} missing in ${lang}.json`);
      continue;
    }
    if (slot.altKey !== undefined || slot.mediaKey !== undefined) errors.push(`${where}: only image slots have mediaKey/altKey`);
    if (slot.minLength === undefined || slot.maxLength === undefined || slot.minLength > slot.maxLength) errors.push(`${where}: needs minLength <= maxLength`);
    if (slot.type.startsWith('seo.') && slot.siteKey !== (slot.type === 'seo.title' ? 'seoTitle' : 'seoDescription')) errors.push(`${where}: ${slot.type} must bind siteKey ${slot.type === 'seo.title' ? 'seoTitle' : 'seoDescription'}`);
    if (slot.key !== undefined && slot.selector !== `[data-slot="${slot.id}"]`) errors.push(`${where}: selector must be [data-slot="${slot.id}"]`);
    const values = [];
    if (slot.key !== undefined) {
      for (const lang of slot.i18n ? ['cs', 'en'] : ['cs']) {
        if (!Object.hasOwn(i18n[lang], slot.key) || typeof i18n[lang][slot.key] !== 'string') errors.push(`${where}: key ${slot.key} missing in ${lang}.json`);
        else values.push([lang, i18n[lang][slot.key]]);
      }
    } else if (slot.siteKey !== undefined) {
      const v = Object.hasOwn(site, slot.siteKey) ? site[slot.siteKey] : undefined;
      if (v && typeof v === 'object') for (const lang of ['cs', 'en']) values.push([lang, v[lang]]);
      else if (typeof v === 'string') values.push(['site', v]);
      else errors.push(`${where}: site.${slot.siteKey} missing`);
    }
    for (const [lang, v] of values) {
      const len = lengthOf(v);
      if (len < slot.minLength || len > slot.maxLength) errors.push(`${where}: ${lang} text has ${len} characters, allowed ${slot.minLength}–${slot.maxLength}`);
    }
  }
  for (const {slot} of slots) for (const r of slot.related || []) if (!ids.has(r)) errors.push(`manifest: slot ${slot.id}: related ${r} does not exist`);
  // One value, one tier: a key bound by a T2 slot and by a DEV/legal slot would let machine PRs change the legal text.
  for (const [binding, tiers] of bindingTiers(manifest)) {
    if (tiers.size > 1) errors.push(`manifest: ${binding} is bound by slots of different tiers (${[...tiers].join(', ')})`);
  }

  if (base) errors.push(...compareWithBase(content, base));
  return errors;
}

/** Map "i18n:<key>" / "site:<siteKey>" / "media:<mediaKey>" -> set of tiers of the slots that bind it. */
export function bindingTiers(manifest) {
  const map = new Map();
  const add = (binding, tier) => { if (!map.has(binding)) map.set(binding, new Set()); map.get(binding).add(tier); };
  for (const {slot} of allSlots(manifest)) {
    for (const k of [slot.key, slot.altKey]) if (k !== undefined) add(`i18n:${k}`, slot.tier);
    if (slot.siteKey !== undefined) add(`site:${slot.siteKey}`, slot.tier);
    if (slot.mediaKey !== undefined) add(`media:${slot.mediaKey}`, slot.tier);
  }
  return map;
}

/**
 * Machine PRs (content-guard): only values of editable slots (tier T2/T3) may differ from the base.
 * The manifest, the key sets and everything else must stay exactly as in the base branch.
 */
export function compareWithBase(content, base) {
  const errors = [];
  if (!isDeepStrictEqual(content.manifest, base.manifest)) errors.push('content/manifest.json: may not change in a machine PR');
  // A value is editable only when EVERY slot that binds it is T2/T3 (never when a DEV/NEVER slot binds it too).
  const editableBindings = new Set([...bindingTiers(base.manifest)].filter(([, tiers]) => [...tiers].every((t) => EDITABLE_TIERS.has(t))).map(([b]) => b));
  const editableKeys = {has: (k) => editableBindings.has(`i18n:${k}`)};
  const editableSite = {has: (k) => editableBindings.has(`site:${k}`)};
  const editableMedia = {has: (k) => editableBindings.has(`media:${k}`)};
  for (const lang of ['cs', 'en']) {
    const a = content.i18n[lang], b = base.i18n[lang];
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!Object.hasOwn(a, k) || !Object.hasOwn(b, k)) errors.push(`content/i18n/${lang}.json: key ${k} ${Object.hasOwn(a, k) ? 'added' : 'removed'} (not allowed)`);
      else if (a[k] !== b[k] && !editableKeys.has(k)) errors.push(`content/i18n/${lang}.json: ${k} is not an editable slot`);
    }
  }
  for (const k of new Set([...Object.keys(content.site), ...Object.keys(base.site)])) {
    if (!isDeepStrictEqual(content.site[k], base.site[k]) && !editableSite.has(k)) errors.push(`content/site.json: ${k} is not an editable slot`);
  }
  for (const k of new Set([...Object.keys(content.media), ...Object.keys(base.media)])) {
    if (!Object.hasOwn(content.media, k) || !Object.hasOwn(base.media, k)) errors.push(`content/media.json: ${k} added or removed (not allowed)`);
    else if (!isDeepStrictEqual(content.media[k], base.media[k]) && !editableMedia.has(k)) errors.push(`content/media.json: ${k} is not an editable slot`);
  }
  if (!isDeepStrictEqual(content.library, base.library)) errors.push('content/media-library.json: may not change in a machine PR');
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const root = resolve(toolsRoot);
  const baseDir = args.includes('--base') ? resolve(args[args.indexOf('--base') + 1]) : null;
  let errors;
  try {
    const base = baseDir ? loadContent(baseDir) : undefined;
    errors = validateContent(root, loadContent(root), {base});
  } catch (err) {
    errors = [`cannot read content: ${err.message}`];
  }
  if (errors.length) {
    console.error(`validate-content: ${errors.length} error(s)`);
    for (const e of errors) console.error(`- ${e}`);
    process.exit(1);
  }
  console.log(`validate-content: OK${baseDir ? ` (compared with ${relative(process.cwd(), baseDir) || '.'})` : ''}`);
}
