// Invariant (not a frozen snapshot): whatever content/** says, the built homepage shows exactly that,
// before and after JavaScript, in both languages. A change of a slot value therefore passes without any
// test update. Requires `npm run build` first (CI and Workers Builds run build before tests).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {load} from 'cheerio';
import {renderAfterJs} from './helpers/dom-harness.mjs';
import {loadContent, allSlots} from '../tools/lib/site-content.mjs';
import {injectPage} from '../tools/inject.mjs';

const root = resolve(import.meta.dirname, '..');
const publicDir = join(root, 'public');
const content = loadContent(root);
const home = content.manifest.pages.find((p) => p.id === 'home');
const i18nJs = (i18n) => 'window.PROCELYX_I18N = ' + JSON.stringify(i18n).replaceAll('<', '\\u003c') + ';\n';

test('homepage loads a current, versioned i18n.js right before app.js', () => {
  const js = readFileSync(join(publicDir, 'i18n.js'), 'utf8');
  assert.equal(js, i18nJs(content.i18n), 'public/i18n.js is stale: run npm run build');
  const $ = load(readFileSync(join(publicDir, 'index.html'), 'utf8'));
  const srcs = $('script[src]').toArray().map((el) => $(el).attr('src'));
  const sha = createHash('sha256').update(js).digest('hex').slice(0, 12);
  const i = srcs.indexOf(`/i18n.js?v=${sha}`);
  assert.ok(i >= 0, `index.html must reference /i18n.js?v=${sha}`);
  assert.match(srcs[i + 1], /^\/app\.js\?v=/);
  assert.match(srcs[i - 1], /^\/site-config\.js\?v=/);
});

function assertSlots($, lang, c = content, page = home) {
  for (const {slot} of allSlots({pages: [page]})) {
    const els = $(slot.selector);
    assert.ok(els.length, `${slot.id}: selector ${slot.selector} matches nothing`);
    if (slot.type === 'image') {
      const item = c.library[c.media[slot.mediaKey].mediaId];
      els.each((_, el) => {
        assert.equal($(el).attr('src'), item.path, `${slot.id} src`);
        assert.equal(Number($(el).attr('width')), item.width, `${slot.id} width`);
        assert.equal(Number($(el).attr('height')), item.height, `${slot.id} height`);
        assert.equal($(el).attr('alt'), c.i18n[lang][slot.altKey], `${slot.id} alt (${lang})`);
      });
    } else if (slot.key) {
      els.each((_, el) => assert.equal($(el).text(), c.i18n[lang][slot.key], `${slot.id} (${lang})`));
    } else if (slot.siteKey === 'seoTitle') {
      assert.equal($('title').text(), c.site.seoTitle[lang]);
    } else if (slot.siteKey === 'seoDescription') {
      assert.equal($('meta[name="description"]').attr('content'), c.site.seoDescription[lang]);
    } else {
      const v = c.site[slot.siteKey];
      const expected = v && typeof v === 'object' ? v[lang] : v;
      els.each((_, el) => assert.ok($(el).text().includes(expected), `${slot.id} (${lang})`));
    }
  }
}

for (const lang of ['cs', 'en']) {
  test(`every manifest slot shows its content value after JS (${lang})`, () => {
    assertSlots(renderAfterJs(publicDir, {lang}), lang);
  });
}

test('Czech slot values are already in the HTML before JS (search engines, no-JS visitors)', () => {
  const $ = load(readFileSync(join(publicDir, 'index.html'), 'utf8'));
  for (const {slot} of allSlots({pages: [home]})) {
    if (slot.key) $(slot.selector).each((_, el) => assert.equal($(el).text(), content.i18n.cs[slot.key], slot.id));
  }
});

test('a changed h1 and a swapped founder photo reach the HTML and the page after JS', () => {
  const dir = mkdtempSync(join(tmpdir(), 'procelyx-invariant-'));
  try {
    const c = structuredClone(content);
    c.i18n.cs.h1 = 'Každá minuta se počítá.';
    c.i18n.en.h1 = 'Every minute counts.';
    const other = Object.keys(c.library).find((id) => id !== c.media.founderImage.mediaId && c.library[id].path.endsWith('.jpg'));
    c.media.founderImage.mediaId = other;
    const html = injectPage(readFileSync(join(publicDir, 'index.html'), 'utf8'), c, home, {lang: 'cs'});
    writeFileSync(join(dir, 'index.html'), html);
    writeFileSync(join(dir, 'i18n.js'), i18nJs(c.i18n));
    for (const f of ['site-config.js', 'app.js']) writeFileSync(join(dir, f), readFileSync(join(publicDir, f)));
    const before = load(html);
    assert.equal(before('h1').text(), 'Každá minuta se počítá.');
    assert.equal(before('[data-slot="home.founder.image"]').attr('src'), c.library[other].path);
    for (const lang of ['cs', 'en']) {
      const $ = renderAfterJs(dir, {lang});
      assert.equal($('h1').text(), lang === 'cs' ? 'Každá minuta se počítá.' : 'Every minute counts.');
      assertSlots($, lang, c);
    }
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
