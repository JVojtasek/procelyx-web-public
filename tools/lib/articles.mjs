// Articles published from Nexus One: content/articles/<slug>.json (contract nexus.article.v1, see contract/nexus.article.v1.md).
//
// Pure helpers (no network): load + validate the files, render one article page, update the list page and the sitemap.
// tools/build.mjs calls renderArticles() before it post-processes public/**; tools/validate-content.mjs calls
// validateArticles(). Generated pages carry <meta name="nexus-article" content="<nexusId>:<version>"> and are NOT
// committed (they are produced by every build, Workers Builds included); the 21 hand-written articles are untouched.
import {readFileSync, readdirSync, existsSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {load} from 'cheerio';
import {validate} from './json-schema-lite.mjs';

export const ARTICLE_SCHEMA = 'nexus.article.v1';
export const ARTICLE_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/;
export const NEXUS_MARKER = 'nexus-article';
const BASE = 'https://procelyx.cz';

const HTML_TAGS = new Set(['p', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'b', 'br']);
const REL_URL = /^\/(?!\/)[A-Za-z0-9/_\-.#?=&%:~+]*$/;

export const escapeHtml = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Own page (/…) or https link without credentials. */
export function safeUrl(raw) {
  const url = String(raw ?? '').trim();
  if (!url || url.length > 500 || /[\s"'<>\\]/.test(url)) return null;
  if (REL_URL.test(url)) return {href: url, external: false};
  if (/^https:\/\//i.test(url)) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' || !u.hostname.includes('.') || u.username || u.password) return null;
      return {href: u.toString(), external: true};
    } catch { return null; }
  }
  return null;
}

/** Errors for a body outside the allowlist (p h2 h3 ul ol li strong em a blockquote table… div.painbox b). Empty = OK. */
export function bodyHtmlErrors(html) {
  const errors = [];
  const add = (m) => { if (!errors.includes(m)) errors.push(m); };
  const $ = load(String(html), null, false);
  const walk = (node, inPainbox) => {
    for (const child of node.children || []) {
      if (child.type === 'text') continue;
      if (child.type !== 'tag') { add(`contains a forbidden node (${child.type})`); continue; }
      const name = child.name, attrs = child.attribs || {}, keys = Object.keys(attrs);
      if (!HTML_TAGS.has(name)) { add(`<${name}> is not allowed`); continue; }
      if (name === 'a') {
        for (const k of keys) if (k !== 'href' && k !== 'rel') add(`attribute ${k} on <a> is not allowed`);
        const safe = safeUrl(attrs.href);
        if (!safe) add('link must be an own page (/…) or https');
        else if (safe.external && attrs.rel !== 'noopener') add('external link needs rel="noopener"');
        else if (!safe.external && attrs.rel !== undefined) add('own link must not have rel');
      } else if (name === 'div') {
        if (keys.length !== 1 || attrs.class !== 'painbox') add('<div> may only have class="painbox"');
        if (inPainbox) add('painbox cannot be nested');
      } else if (keys.length) add(`attribute ${keys[0]} on <${name}> is not allowed`);
      if (name === 'b' && !inPainbox) add('<b> is only allowed inside a painbox');
      if (name === 'br') continue;
      walk(child, inPainbox || (name === 'div' && attrs.class === 'painbox'));
    }
  };
  walk($.root().get(0), false);
  return errors;
}

/** Reads content/articles/*.json: [{slug, file, data, error}]. A file that is not valid JSON has `error`. */
export function loadArticleFiles(root) {
  const dir = resolve(root, 'content/articles');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((file) => {
    try { return {slug: file.replace(/\.json$/, ''), file, data: JSON.parse(readFileSync(join(dir, file), 'utf8')), error: null}; }
    catch { return {slug: file.replace(/\.json$/, ''), file, data: null, error: 'invalid JSON'}; }
  });
}

/** Slugs of hand-written articles: public/clanky/<slug>/index.html without the Nexus marker. */
export function staticArticleSlugs(root) {
  const dir = resolve(root, 'public/clanky');
  if (!existsSync(dir)) return new Set();
  const out = new Set();
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    const page = join(dir, entry.name, 'index.html');
    if (existsSync(page) && !readFileSync(page, 'utf8').includes(`name="${NEXUS_MARKER}"`)) out.add(entry.name);
  }
  return out;
}

/** `related` of an article without the entries that point to a missing article (hand-written or from Nexus). */
export function relatedFor(data, existingSlugs) {
  return data.related.filter(([slug]) => existingSlugs.has(slug));
}

/** Cross checks and schema validation of all article files. Returns error strings (empty = OK). */
export function validateArticles(root, articles, library, schema) {
  const errors = [];
  const slugs = new Set(articles.map((a) => a.slug));
  const staticSlugs = staticArticleSlugs(root);
  for (const a of articles) {
    const where = `content/articles/${a.file}`;
    if (!ARTICLE_FILE.test(a.file) || a.slug.length < 3 || a.slug.length > 90) { errors.push(`${where}: file name must be <slug>.json with slug [a-z0-9-]{3,90}`); continue; }
    if (a.error) { errors.push(`${where}: ${a.error}`); continue; }
    const schemaErrors = validate(schema, a.data);
    if (schemaErrors.length) { errors.push(...schemaErrors.slice(0, 8).map((e) => `${where}: ${e}`)); continue; }
    const d = a.data;
    if (d.slug !== a.slug) errors.push(`${where}: slug in the file (${d.slug}) differs from the file name`);
    if (staticSlugs.has(a.slug)) errors.push(`${where}: slug collides with a hand-written article (public/clanky/${a.slug}/)`);
    for (const e of bodyHtmlErrors(d.bodyHtml)) errors.push(`${where}: bodyHtml: ${e}`);
    if (d.dateModified < d.datePublished) errors.push(`${where}: dateModified is before datePublished`);
    if (d.image && !Object.hasOwn(library, d.image.mediaId)) errors.push(`${where}: image ${d.image.mediaId} is not in the media library`);
    if (d.cta && !safeUrl(d.cta.href)) errors.push(`${where}: cta.href must be an own page or https`);
    const seen = new Set();
    for (const [slug] of d.related) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) errors.push(`${where}: related slug ${slug} is invalid`);
      else if (slug === a.slug) errors.push(`${where}: related points to the article itself`);
      // A related article that does not exist (any more) is NOT an error: deleting article B must not break the build of article A.
      // The link is dropped when the page is rendered (renderArticles, warning), see relatedFor().
      if (seen.has(slug)) errors.push(`${where}: related slug ${slug} is repeated`);
      seen.add(slug);
    }
  }
  return errors;
}

const cs = new Intl.DateTimeFormat('cs-CZ', {timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: 'numeric'});
const czDate = (iso) => cs.format(new Date(`${iso}T12:00:00Z`));

const HEADER = '<header><div class="wrap nav"><a class="brand" href="/"><img class="brand-logo" src="/images/procelyx-wordmark.png" alt="PROCELYX" width="2172" height="724" decoding="async"></a><nav><a href="/#solutions">Řešení</a><a href="/#usecases">Use cases</a><a href="/clanky/">Články</a><a href="/#contact">Kontakt</a></nav><div class="actions"><a class="qrLink" href="/qr/" aria-label="QR kód a vizitka">QR</a><a class="articleBack" href="/clanky/">Články</a><a class="btn sm" href="/#contact">Probrat proces</a></div></div></header>';
const footer = (site) => `<footer><div class="wrap footer"><div class="brand"><img class="brand-logo" src="/images/procelyx-wordmark.png" alt="PROCELYX" width="2172" height="724" decoding="async"></div><div><b>Kontakt</b><a href="mailto:${escapeHtml(site.email)}">${escapeHtml(site.email)}</a><a href="tel:${escapeHtml(site.phone.replaceAll(' ', ''))}">${escapeHtml(site.phone)}</a></div><div class="legalLinks"><b>Právní informace</b><a href="/pravni-informace.html">Provozovatel webu</a><a href="/obchodni-podminky.html">Obchodní podmínky</a><a href="/privacy.html">Ochrana údajů a cookies</a></div></div><div class="wrap copy">© 2026 PROCELYX</div></footer>`;

/** Image of the article from the media library: {path, width, height, alt, ogPath} or null. */
export function articleImage(root, d, library) {
  if (!d.image) return null;
  const item = library[d.image.mediaId];
  if (!item) return null;
  // Prefer the JPEG twin for sharing (og:image); the page itself uses the library file.
  const jpg = item.path.replace(/\.(webp|png)$/i, '.jpg');
  const ogPath = jpg !== item.path && existsSync(resolve(root, 'public', jpg.replace(/^\//, ''))) ? jpg : item.path;
  return {path: item.path, width: item.width, height: item.height, alt: d.image.alt, ogPath};
}

/** One complete article page (string). `site` = content/site.json, `image` = articleImage(). */
export function renderArticlePage(d, {site, image}) {
  const url = `${BASE}/clanky/${d.slug}/`;
  const ogImage = BASE + (image ? image.ogPath : site.ogImage);
  const ld = {
    '@context': 'https://schema.org', '@type': 'Article', headline: d.title, description: d.description, datePublished: d.datePublished, dateModified: d.dateModified,
    author: {'@type': 'Person', name: site.founderName}, publisher: {'@type': 'Organization', name: 'PROCELYX', url: `${BASE}/`}, mainEntityOfPage: url, image: ogImage,
  };
  const faqLd = d.faq.length ? {'@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: d.faq.map((f) => ({'@type': 'Question', name: f.q, acceptedAnswer: {'@type': 'Answer', text: f.a}}))} : null;
  const json = (o) => JSON.stringify(o).replaceAll('<', '\\u003c');
  const cta = d.cta ? (() => { const s = safeUrl(d.cta.href); return `<div class="ctaBox"><h3>${escapeHtml(d.cta.title)}</h3><p>${escapeHtml(d.cta.text)}</p><a class="btn" href="${escapeHtml(s.href)}"${s.external ? ' rel="noopener"' : ''}>${escapeHtml(d.cta.label)}</a></div>`; })() : '';
  const faq = d.faq.length ? `<h2>Časté otázky</h2><div class="faq">${d.faq.map((f) => `<h3>${escapeHtml(f.q)}</h3><p>${escapeHtml(f.a)}</p>`).join('')}</div>` : '';
  const related = d.related.length ? `<h2>Související články</h2><div class="related">${d.related.map(([slug, label]) => `<a href="/clanky/${slug}/">${escapeHtml(label)} →</a>`).join('')}</div>` : '';
  const note = d.aiNote ? `<p class="articleNote">${escapeHtml(d.aiNote)}</p>` : '';
  const hero = image ? `<figure class="articleVisual"><img src="${escapeHtml(image.path)}" width="${image.width}" height="${image.height}" alt="${escapeHtml(image.alt)}" decoding="async" fetchpriority="high"></figure>` : '';
  const head = [
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(d.seoTitle)}</title><meta name="description" content="${escapeHtml(d.description)}"><link rel="canonical" href="${url}">`,
    '<meta name="robots" content="index,follow,max-image-preview:large"><meta property="og:type" content="article">',
    `<meta property="og:title" content="${escapeHtml(d.title)}"><meta property="og:description" content="${escapeHtml(d.description)}"><meta property="og:url" content="${url}">`,
    '<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/clanky/article.css">',
    `<script type="application/ld+json">${json(ld)}</script>`,
    faqLd ? `<script type="application/ld+json">${json(faqLd)}</script>` : '',
    '<link rel="stylesheet" href="/polish.css"><meta name="twitter:card" content="summary_large_image">',
    `<meta property="og:image:width" content="1200"><meta property="og:image:height" content="675"><meta property="og:image" content="${escapeHtml(ogImage)}">`,
    `<meta name="${NEXUS_MARKER}" content="${escapeHtml(`${d.nexusId}:${d.version}`)}">`,
  ].join('');
  return `<!DOCTYPE html><html lang="cs"><head>${head}</head><body>${HEADER}<main><section class="articleHero"><div class="wrap"><div class="breadcrumbs"><a href="/">PROCELYX</a> / <a href="/clanky/">Články</a> / ${escapeHtml(d.category)}</div><div class="eyebrow">${escapeHtml(d.category)}</div><h1>${escapeHtml(d.title)}</h1><p class="lead">${escapeHtml(d.lead)}</p><div class="meta"><span>${escapeHtml(d.typeLabel)}</span><span>${czDate(d.dateModified === d.datePublished ? d.datePublished : d.dateModified)}</span><span>Redakce PROCELYX</span></div>${hero}</div></section><article class="articleBody"><div class="wrap">${d.bodyHtml}${faq}${cta}${related}${note}</div></article></main>${footer(site)}</body></html>`;
}

function card(d, image) {
  const thumb = image ? `<a class="articleThumb" href="/clanky/${d.slug}/" tabindex="-1" aria-hidden="true"><img src="${escapeHtml(image.path)}" alt="" width="${image.width}" height="${image.height}" loading="lazy" decoding="async"></a>` : '';
  return `<article class="articleCard" data-nexus-article="${d.slug}">${thumb}<span>${escapeHtml(d.category)}</span><h2>${escapeHtml(d.title)}</h2><p>${escapeHtml(d.teaser)}</p><a href="/clanky/${d.slug}/">Číst článek →</a></article>`;
}

/** List page: replaces all cards that were generated from Nexus (data-nexus-article) with the current set (newest first, before the hand-written ones). */
export function applyArticlesToIndex(html, items) {
  const $ = load(html);
  $('article.articleCard[data-nexus-article]').remove();
  const holder = $('.articleCards').first();
  if (holder.length) {
    const sorted = [...items].sort((a, b) => (a.data.datePublished < b.data.datePublished ? 1 : a.data.datePublished > b.data.datePublished ? -1 : a.slug < b.slug ? -1 : 1));
    for (const {data, image} of sorted.reverse()) holder.prepend(card(data, image));
  }
  return $.html();
}

/** Sitemap: removes the entries of Nexus articles and appends the current ones. Idempotent. */
export function applyArticlesToSitemap(xml, items) {
  const slugs = items.map((i) => i.slug);
  let out = xml;
  // entries tagged by a previous run
  out = out.replace(/<url><loc>https:\/\/procelyx\.cz\/clanky\/([a-z0-9-]+)\/<\/loc>[^\n]*?<!-- nexus --><\/url>\r?\n?/g, '');
  for (const slug of slugs) out = out.replace(new RegExp(`<url><loc>https://procelyx\\.cz/clanky/${slug}/</loc>[^\\n]*</url>\\r?\\n?`, 'g'), '');
  const lines = items.map(({slug, data}) => `<url><loc>${BASE}/clanky/${slug}/</loc><lastmod>${data.dateModified}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority><!-- nexus --></url>`).join('\n');
  return lines ? out.replace('</urlset>', `${lines}\n</urlset>`) : out;
}

/**
 * Build step: writes public/clanky/<slug>/index.html for every article file, removes pages of articles that are
 * gone (only pages with the Nexus marker), updates public/clanky/index.html and public/sitemap.xml.
 * Returns the rendered items. Run AFTER validateContent (it assumes valid files).
 */
export function renderArticles(root, {site, library}) {
  const articles = loadArticleFiles(root).filter((a) => a.data);
  const existing = new Set([...articles.map((a) => a.slug), ...staticArticleSlugs(root)]);
  const items = articles.map((a) => {
    const related = relatedFor(a.data, existing);
    if (related.length !== a.data.related.length) console.warn(`articles: ${a.file}: dropped ${a.data.related.length - related.length} related link(s) to a missing article`);
    return {slug: a.slug, data: {...a.data, related}, image: articleImage(root, a.data, library)};
  });
  const keep = new Set(items.map((i) => i.slug));
  const clanky = resolve(root, 'public/clanky');
  if (existsSync(clanky)) {
    for (const entry of readdirSync(clanky, {withFileTypes: true})) {
      if (!entry.isDirectory() || keep.has(entry.name)) continue;
      const page = join(clanky, entry.name, 'index.html');
      if (existsSync(page) && readFileSync(page, 'utf8').includes(`name="${NEXUS_MARKER}"`)) rmSync(join(clanky, entry.name), {recursive: true, force: true});
    }
  }
  for (const {slug, data, image} of items) {
    mkdirSync(resolve(clanky, slug), {recursive: true});
    writeFileSync(resolve(clanky, slug, 'index.html'), renderArticlePage(data, {site, image}));
  }
  const index = resolve(clanky, 'index.html');
  if (existsSync(index)) writeFileSync(index, applyArticlesToIndex(readFileSync(index, 'utf8'), items));
  const sitemap = resolve(root, 'public/sitemap.xml');
  if (existsSync(sitemap)) writeFileSync(sitemap, applyArticlesToSitemap(readFileSync(sitemap, 'utf8'), items));
  return items;
}
