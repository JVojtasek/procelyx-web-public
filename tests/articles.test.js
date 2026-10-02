// Articles published from Nexus One (contract nexus.article.v1): schema + allowlist validation, page rendering, list/sitemap updates,
// the build in a temporary workspace (idempotent, removal), check-site on the generated pages and the machine PR path rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {load} from 'cheerio';
import {validate} from '../tools/lib/json-schema-lite.mjs';
import {applyArticlesToIndex, applyArticlesToSitemap, bodyHtmlErrors, renderArticlePage, safeUrl, validateArticles} from '../tools/lib/articles.mjs';
import {loadContent} from '../tools/lib/site-content.mjs';
import {checkMachinePaths} from '../tools/content-guard.mjs';

const root = resolve(import.meta.dirname, '..');
const schema = JSON.parse(readFileSync(resolve(root, 'schemas/article.schema.json'), 'utf8'));
const content = loadContent(root);
const BODY = '<p>Úvod s konkrétní situací z provozu, která je dost dlouhá na to, aby tělo článku prošlo minimální délkou. '.repeat(3) + '</p><h2>Sekce</h2><p>Text sekce s <a href="/clanky/jak-najit-uzka-hrdla-ve-firme/">odkazem na vlastní článek</a> a <a href="https://example.com/zdroj" rel="noopener">zdrojem</a>.</p><div class="painbox"><b>Malý test na tento týden</b><p>Zeptejte se, kdo má další krok.</p></div>';

const article = (over = {}) => ({
  schema: 'nexus.article.v1', slug: 'jak-vybrat-prvni-proces', version: 1, nexusId: 'cmart1', title: 'Jak vybrat první proces k automatizaci & nespálit se',
  seoTitle: 'Jak vybrat první proces k automatizaci | PROCELYX', description: 'Praktický návod, jak vybrat první proces k automatizaci podle skutečných ztrát, četnosti a vlastníka.',
  category: 'PROCESY · ROZHODOVÁNÍ', typeLabel: 'Praktický návod', lead: 'Který proces automatizovat jako první? Podívejte se na ztráty, ne na pocity.',
  teaser: 'Jak vybrat první krok podle skutečných ztrát a ne podle toho, kdo mluví nejhlasitěji.', bodyHtml: BODY,
  faq: [{q: 'Kolik procesů začít?', a: 'Začněte jedním, abyste dokázali změřit výsledek.'}], related: [['jak-najit-uzka-hrdla-ve-firme', 'Jak najít úzká hrdla']],
  image: {mediaId: 'img-articles--jak-najit-uzka-hrdla-ve-firme-webp', alt: 'Tým plánuje zakázky u tabule.'},
  cta: {key: 'kontakt', title: 'Chcete to probrat?', text: 'Popište nám svůj proces a navrhneme první krok.', label: 'Napsat nám', href: '/#contact'},
  keywords: ['automatizace'], aiNote: 'Připraveno s pomocí AI, zkontrolováno a schváleno člověkem.', datePublished: '2026-10-06', dateModified: '2026-10-06', ...over,
});

const errorsFor = (data, file = 'jak-vybrat-prvni-proces.json') => validateArticles(root, [{slug: file.replace(/\.json$/, ''), file, data, error: null}], content.library, schema);

test('the shared library has the image used by the fixture (the test must not rot silently)', () => {
  assert.ok(Object.hasOwn(content.library, 'img-articles--jak-najit-uzka-hrdla-ve-firme-webp'));
});

test('a valid article passes; unknown fields, missing fields and HTML in plain texts are errors', () => {
  assert.deepEqual(errorsFor(article()), []);
  assert.ok(errorsFor({...article(), extra: 1}).some((e) => /unknown field/.test(e)));
  const {lead, ...noLead} = article();
  assert.ok(errorsFor(noLead).some((e) => /missing lead/.test(e)));
  assert.ok(errorsFor(article({title: 'Titulek <b>tučně</b> a víc textu'})).length > 0);
  assert.ok(errorsFor(article({schema: 'nexus.article.v2'})).length > 0);
  assert.ok(errorsFor(article({slug: 'Špatný slug'}), 'Spatny-slug.json').length > 0);
});

test('body HTML: the allowlist holds, everything else is rejected', () => {
  assert.deepEqual(bodyHtmlErrors(BODY), []);
  for (const bad of [
    '<p>x</p><script>alert(1)</script>', '<p onclick="x()">x</p>', '<a href="javascript:alert(1)">x</a>', '<a href="http://example.com" rel="noopener">x</a>', '<a href="https://example.com">bez rel</a>',
    '<p><img src="/x.png"></p>', '<div class="cizi">x</div>', '<b>mimo painbox</b>', '<iframe src="https://example.com"></iframe>', '<p>x</p><!-- komentář -->', '<a href="//evil.example/x">x</a>',
  ]) assert.ok(bodyHtmlErrors(bad).length > 0, bad);
  assert.equal(safeUrl('/#contact').external, false);
  assert.equal(safeUrl('https://user:pw@example.com/'), null);
});

test('cross checks: slug must match the file, must not collide with a hand-written article, image in the library, a related link to a missing article is tolerated, repeated or self links are not', () => {
  assert.ok(errorsFor(article({slug: 'jiny-slug-clanku'})).some((e) => /differs from the file name/.test(e)));
  assert.ok(errorsFor(article({slug: 'jak-najit-uzka-hrdla-ve-firme', related: []}), 'jak-najit-uzka-hrdla-ve-firme.json').some((e) => /collides with a hand-written article/.test(e)));
  assert.ok(errorsFor(article({image: {mediaId: 'img-neexistuje-webp', alt: 'Alt text obrázku'}})).some((e) => /media library/.test(e)));
  assert.deepEqual(errorsFor(article({related: [['neexistuje-clanek', 'Neexistuje']]})), [], 'deleting article B must not break article A');
  assert.ok(errorsFor(article({related: [['jak-najit-uzka-hrdla-ve-firme', 'Úzká hrdla'], ['jak-najit-uzka-hrdla-ve-firme', 'Úzká hrdla znovu']]})).some((e) => /repeated/.test(e)));
  assert.ok(errorsFor(article({related: [['jak-vybrat-prvni-proces', 'Sám sebe']]})).some((e) => /itself/.test(e)));
  assert.ok(errorsFor(article({datePublished: '2026-10-08', dateModified: '2026-10-06'})).some((e) => /before datePublished/.test(e)));
  assert.ok(errorsFor(article({cta: {key: 'x', title: 'Titulek výzvy', text: 'Text výzvy který je dost dlouhý.', label: 'Klik', href: 'http://evil.example'}})).length > 0);
  assert.deepEqual(validate(schema, article()), []);
});

test('rendering: marker, canonical, JSON-LD with the founder as author, escaping, hero image, FAQ, CTA and related articles', () => {
  const image = {path: '/images/articles/jak-najit-uzka-hrdla-ve-firme.webp', width: 1200, height: 675, alt: 'Tým plánuje zakázky u tabule.', ogPath: '/images/articles/jak-najit-uzka-hrdla-ve-firme.jpg'};
  const html = renderArticlePage(article(), {site: content.site, image});
  const $ = load(html);
  assert.equal($('meta[name="nexus-article"]').attr('content'), 'cmart1:1');
  assert.equal($('link[rel="canonical"]').attr('href'), 'https://procelyx.cz/clanky/jak-vybrat-prvni-proces/');
  assert.equal($('h1').text(), 'Jak vybrat první proces k automatizaci & nespálit se');
  assert.equal($('title').text(), 'Jak vybrat první proces k automatizaci | PROCELYX');
  const ld = $('script[type="application/ld+json"]').toArray().map((e) => JSON.parse($(e).text()));
  assert.equal(ld[0]['@type'], 'Article');
  assert.equal(ld[0].author.name, content.site.founderName);
  assert.equal(ld[1]['@type'], 'FAQPage');
  assert.equal($('.articleVisual img').attr('src'), image.path);
  assert.equal($('meta[property="og:image"]').attr('content'), 'https://procelyx.cz/images/articles/jak-najit-uzka-hrdla-ve-firme.jpg');
  assert.equal($('.ctaBox a.btn').attr('href'), '/#contact');
  assert.equal($('.related a').attr('href'), '/clanky/jak-najit-uzka-hrdla-ve-firme/');
  assert.equal($('.articleBody .painbox b').text(), 'Malý test na tento týden');
  assert.equal($('h1').length, 1);
  const bare = load(renderArticlePage(article({image: null, cta: null, faq: [], related: [], aiNote: null}), {site: content.site, image: null}));
  assert.equal(bare('.articleVisual').length, 0);
  assert.equal(bare('meta[property="og:image"]').attr('content'), `https://procelyx.cz${content.site.ogImage}`, 'bez obrázku se sdílí obrázek webu');
  const evil = load(renderArticlePage(article({title: 'Titulek "s uvozovkami" a <>', lead: 'Perex s &amp; entitou a delším textem.'}), {site: content.site, image: null}));
  assert.equal(evil('script').filter((_, e) => !evil(e).attr('type')).length, 0);
});

test('list page and sitemap: idempotent, newest first, cards removed together with the article', () => {
  const items = [
    {slug: 'prvni-clanek-redakce', data: article({slug: 'prvni-clanek-redakce', datePublished: '2026-10-01', dateModified: '2026-10-01'}), image: null},
    {slug: 'druhy-clanek-redakce', data: article({slug: 'druhy-clanek-redakce', datePublished: '2026-10-05', dateModified: '2026-10-05'}), image: {path: '/images/a.webp', width: 10, height: 10, alt: 'x', ogPath: '/images/a.webp'}},
  ];
  // The real files may already carry generated cards / URLs (a build ran before the tests, or real articles exist): compare against the stripped base.
  const index = applyArticlesToIndex(readFileSync(resolve(root, 'public/clanky/index.html'), 'utf8'), []);
  const once = applyArticlesToIndex(index, items);
  assert.equal(applyArticlesToIndex(once, items), once, 'idempotent');
  const slugs = load(once)('article.articleCard').toArray().map((e) => load(once)(e).find('a').last().attr('href'));
  assert.deepEqual(slugs.slice(0, 2), ['/clanky/druhy-clanek-redakce/', '/clanky/prvni-clanek-redakce/']);
  assert.equal(applyArticlesToIndex(once, []).includes('data-nexus-article'), false);
  const sitemap = applyArticlesToSitemap(readFileSync(resolve(root, 'public/sitemap.xml'), 'utf8'), []);
  assert.doesNotMatch(sitemap, /<!-- nexus -->/);
  const s1 = applyArticlesToSitemap(sitemap, items);
  assert.equal(applyArticlesToSitemap(s1, items), s1);
  assert.ok(s1.includes('<loc>https://procelyx.cz/clanky/druhy-clanek-redakce/</loc>'));
  assert.equal(applyArticlesToSitemap(s1, []).trim(), sitemap.trim());
});

// ---- build in a temporary workspace ----------------------------------------------------------------------
function workspace() {
  const parent = join(root, 'node_modules', '.cache');
  mkdirSync(parent, {recursive: true});
  const ws = mkdtempSync(join(parent, 'articles-test-'));
  for (const dir of ['tools', 'schemas', 'content', 'public']) cpSync(join(root, dir), join(ws, dir), {recursive: true});
  isolate(ws);
  return ws;
}

// The tests must not depend on whether real articles exist in the repository (content/articles/*.json) or on a build having
// run before them (tools/wrangler-build.mjs runs build, then npm test): a copied workspace starts WITHOUT any Nexus article.
function isolate(ws) {
  rmSync(join(ws, 'content/articles'), {recursive: true, force: true});
  const clanky = join(ws, 'public/clanky');
  for (const entry of readdirSync(clanky, {withFileTypes: true})) {
    const page = join(clanky, entry.name, 'index.html');
    if (entry.isDirectory() && existsSync(page) && readFileSync(page, 'utf8').includes('name="nexus-article"')) rmSync(join(clanky, entry.name), {recursive: true, force: true});
  }
  const index = join(clanky, 'index.html');
  writeFileSync(index, applyArticlesToIndex(readFileSync(index, 'utf8'), []));
  const sitemap = join(ws, 'public/sitemap.xml');
  writeFileSync(sitemap, applyArticlesToSitemap(readFileSync(sitemap, 'utf8'), []));
}
const run = (ws, script) => spawnSync(process.execPath, [script], {cwd: ws, encoding: 'utf8', env: {...process.env, CI: 'true'}});
const write = (ws, slug, data) => {
  mkdirSync(join(ws, 'content/articles'), {recursive: true});
  writeFileSync(join(ws, 'content/articles', `${slug}.json`), JSON.stringify(data, null, 2) + '\n');
};

test('build: article page, list card and sitemap URL appear; a second build changes nothing; removing the file removes all three; check-site passes', () => {
  const ws = workspace();
  try {
    write(ws, 'jak-vybrat-prvni-proces', article());
    let r = run(ws, 'tools/build.mjs');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const page = join(ws, 'public/clanky/jak-vybrat-prvni-proces/index.html');
    assert.ok(existsSync(page));
    const html1 = readFileSync(page, 'utf8');
    assert.match(html1, /name="nexus-article" content="cmart1:1"/);
    assert.match(html1, new RegExp(`mailto:${content.site.email.replace('.', '\\.')}`), 'contact details come from content/site.json');
    assert.match(readFileSync(join(ws, 'public/clanky/index.html'), 'utf8'), /data-nexus-article="jak-vybrat-prvni-proces"/);
    assert.match(readFileSync(join(ws, 'public/sitemap.xml'), 'utf8'), /clanky\/jak-vybrat-prvni-proces\//);
    assert.match(html1, /\/styles\.css\?v=[0-9a-f]{12}/, 'asset versions are applied to generated pages too');
    r = run(ws, 'tools/check-site.mjs');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    // idempotent
    const before = [page, join(ws, 'public/clanky/index.html'), join(ws, 'public/sitemap.xml')].map((f) => readFileSync(f, 'utf8'));
    r = run(ws, 'tools/build.mjs');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual([page, join(ws, 'public/clanky/index.html'), join(ws, 'public/sitemap.xml')].map((f) => readFileSync(f, 'utf8')), before);
    // unpublish = remove the file
    rmSync(join(ws, 'content/articles/jak-vybrat-prvni-proces.json'));
    r = run(ws, 'tools/build.mjs');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(page), false);
    assert.doesNotMatch(readFileSync(join(ws, 'public/clanky/index.html'), 'utf8'), /data-nexus-article/);
    assert.doesNotMatch(readFileSync(join(ws, 'public/sitemap.xml'), 'utf8'), /jak-vybrat-prvni-proces/);
    assert.equal(run(ws, 'tools/check-site.mjs').status, 0);
  } finally {
    rmSync(ws, {recursive: true, force: true});
  }
});

test('deleting article B drops the related link in article A (build passes, warning, no dead link in the page)', () => {
  const ws = workspace();
  try {
    write(ws, 'clanek-b-redakce', article({slug: 'clanek-b-redakce', nexusId: 'cmartb', related: []}));
    write(ws, 'clanek-a-redakce', article({slug: 'clanek-a-redakce', nexusId: 'cmarta', related: [['clanek-b-redakce', 'Článek B'], ['jak-najit-uzka-hrdla-ve-firme', 'Ručně psaný']]}));
    let r = run(ws, 'tools/build.mjs');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(readFileSync(join(ws, 'public/clanky/clanek-a-redakce/index.html'), 'utf8').includes('href="/clanky/clanek-b-redakce/"'));
    rmSync(join(ws, 'content/articles/clanek-b-redakce.json'));
    r = run(ws, 'tools/build.mjs');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stderr + r.stdout, /dropped 1 related link/);
    const html = readFileSync(join(ws, 'public/clanky/clanek-a-redakce/index.html'), 'utf8');
    assert.doesNotMatch(html, /clanek-b-redakce/);
    assert.ok(html.includes('href="/clanky/jak-najit-uzka-hrdla-ve-firme/"'), 'the hand-written related article stays');
    assert.equal(run(ws, 'tools/check-site.mjs').status, 0);
    assert.equal(run(ws, 'tools/validate-content.mjs').status, 0);
  } finally {
    rmSync(ws, {recursive: true, force: true});
  }
});

test('build refuses an invalid article and a slug of a hand-written article; hand-written pages stay untouched', () => {
  const ws = workspace();
  try {
    const handWritten = join(ws, 'public/clanky/jak-najit-uzka-hrdla-ve-firme/index.html');
    const original = readFileSync(handWritten, 'utf8');
    write(ws, 'jak-najit-uzka-hrdla-ve-firme', article({slug: 'jak-najit-uzka-hrdla-ve-firme', related: []}));
    let r = run(ws, 'tools/build.mjs');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /collides with a hand-written article/);
    assert.equal(readFileSync(handWritten, 'utf8'), original);
    rmSync(join(ws, 'content/articles'), {recursive: true, force: true});
    write(ws, 'zly-clanek', article({slug: 'zly-clanek', bodyHtml: `${BODY}<script>alert(1)</script>`}));
    r = run(ws, 'tools/build.mjs');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /bodyHtml: .*script/);
    assert.equal(existsSync(join(ws, 'public/clanky/zly-clanek')), false, 'nothing is generated from an invalid article');
  } finally {
    rmSync(ws, {recursive: true, force: true});
  }
});

test('machine PRs (Nexus) may add, change and delete content/articles/*.json and nothing else outside content/', () => {
  assert.deepEqual(checkMachinePaths([{filename: 'content/articles/jak-vybrat-prvni-proces.json', status: 'added'}, {filename: 'content/articles/stary.json', status: 'removed'}]), []);
  assert.equal(checkMachinePaths([{filename: 'public/clanky/x/index.html', status: 'added'}]).length, 1);
  assert.equal(checkMachinePaths([{filename: 'tools/lib/articles.mjs', status: 'modified'}]).length, 1);
  assert.equal(checkMachinePaths([{filename: '.github/workflows/web-checks.yml', status: 'modified'}]).length, 1);
});

// Regression: after the FIRST real article (content/articles/x.json) the whole release gate (build, npm test, check) must stay green.
// tools/wrangler-build.mjs runs exactly this sequence; a failing test there freezes the publication in Nexus.
test('release gate with a real article in the repository: build, the whole test suite and check pass', {skip: process.env.ARTICLES_NESTED === '1' && 'nested run'}, () => {
  const parent = join(root, 'node_modules', '.cache');
  mkdirSync(parent, {recursive: true});
  const ws = mkdtempSync(join(parent, 'articles-gate-'));
  try {
    for (const entry of ['tools', 'schemas', 'content', 'public', 'tests', 'scripts', 'contract', 'src', 'integrations', 'package.json']) {
      if (existsSync(join(root, entry))) cpSync(join(root, entry), join(ws, entry), {recursive: true});
    }
    isolate(ws);
    write(ws, 'jak-vybrat-prvni-proces', article());
    const env = {...process.env, CI: 'true', ARTICLES_NESTED: '1'};
    const sh = (args) => spawnSync(process.execPath, args, {cwd: ws, encoding: 'utf8', env});
    let r = sh(['tools/build.mjs']);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(existsSync(join(ws, 'public/clanky/jak-vybrat-prvni-proces/index.html')));
    r = sh(['--test', ...readdirSync(join(ws, 'tests')).filter((f) => f.endsWith('.test.js')).map((f) => `tests/${f}`)]);
    assert.equal(r.status, 0, (r.stdout + r.stderr).split(String.fromCharCode(10)).filter((l) => /not ok|# fail|Error/.test(l)).slice(0, 12).join(String.fromCharCode(10)));
    r = sh(['tools/check-site.mjs']);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  } finally {
    rmSync(ws, {recursive: true, force: true});
  }
});

test('generated Nexus article pages are never tracked in git (build output); hand-written pages are; the tracked list page and sitemap carry no generated entries', () => {
  const r = spawnSync('git', ['ls-files', 'public/clanky'], {cwd: root, encoding: 'utf8'});
  if (r.status !== 0) return; // not a git checkout (e.g. a source archive)
  for (const f of r.stdout.split(String.fromCharCode(10)).filter((x) => x.endsWith('/index.html'))) {
    assert.doesNotMatch(readFileSync(join(root, f), 'utf8'), /name="nexus-article"/, `${f} is generated build output and must not be committed`);
  }
  assert.doesNotMatch(readFileSync(join(root, 'public/clanky/index.html'), 'utf8'), /data-nexus-article/, 'committed list page must not contain generated cards (git restore after a local build)');
  assert.doesNotMatch(readFileSync(join(root, 'public/sitemap.xml'), 'utf8'), /<!-- nexus -->/, 'committed sitemap must not contain generated URLs (git restore after a local build)');
});
