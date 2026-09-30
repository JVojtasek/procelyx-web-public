import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {validateContent, compareWithBase, sanitizeSvg} from '../tools/validate-content.mjs';
import {loadContent, buildMediaLibrary} from '../tools/lib/site-content.mjs';

const root = resolve(import.meta.dirname, '..');
const fresh = () => {
  const c = structuredClone(loadContent(root));
  c.library = buildMediaLibrary(root);
  return c;
};
const slot = (c, id) => c.manifest.pages.flatMap((p) => p.sections.flatMap((s) => s.slots)).find((s) => s.id === id);

test('the committed content is valid', () => {
  assert.deepEqual(validateContent(root, fresh()), []);
});

test('unknown fields are rejected everywhere', () => {
  const a = fresh(); a.manifest.pages[0].sections[0].slots[0].colour = 'red';
  assert.match(validateContent(root, a).join('\n'), /unknown field/);
  const b = fresh(); b.site.newsletter = true;
  assert.match(validateContent(root, b).join('\n'), /site\.json.*unknown field/);
  // The founder photo lives only in media.json; the old site.json fields would be silently ignored, so they are errors.
  for (const [field, value] of [['founderImage', '/images/jaroslav-vojtasek-procelyx.webp'], ['founderImageWidth', 1120], ['founderImageHeight', 1400]]) {
    const old = fresh(); old.site[field] = value;
    assert.match(validateContent(root, old).join('\n'), new RegExp(`site\\.json.*${field}.*unknown field|site\\.json.*unknown field.*${field}`));
  }
  const c = fresh(); c.media.founderImage.crop = 'square';
  assert.match(validateContent(root, c).join('\n'), /media\.json.*unknown field/);
});

test('HTML in texts and texts outside the slot limits are rejected', () => {
  const a = fresh(); a.i18n.cs.h1 = 'Nadpis <script>alert(1)</script>';
  assert.match(validateContent(root, a).join('\n'), /cs\.json.*does not match/);
  const b = fresh(); b.i18n.cs.h1 = 'x'.repeat(slot(b, 'home.hero.h1').maxLength + 1);
  assert.match(validateContent(root, b).join('\n'), /home\.hero\.h1: cs text has/);
  const c = fresh(); delete c.i18n.en.h1;
  assert.match(validateContent(root, c).join('\n'), /missing key h1/);
});

test('images must come from the media library and have an alt text', () => {
  const a = fresh(); a.media.founderImage.mediaId = 'img-does-not-exist-webp';
  assert.match(validateContent(root, a).join('\n'), /not in the media library/);
  const b = fresh(); b.library['img-extra-webp'] = {path: '/images/extra.webp', width: 1, height: 1};
  assert.match(validateContent(root, b).join('\n'), /does not match public\/images/);
  const c = fresh(); delete c.i18n.cs['founderImage.alt'];
  assert.match(validateContent(root, c).join('\n'), /founderImage\.alt missing in cs\.json|missing key founderImage\.alt/);
});

test('slots with legal impact or derived assets cannot be editable tiers', () => {
  const a = fresh(); slot(a, 'home.identity.email').tier = 'T2';
  assert.match(validateContent(root, a).join('\n'), /require tier DEV or NEVER/);
});

test('SVG sources must stay inside the element/attribute allowlist; the web only serves raster images', () => {
  const clean = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" aria-label="Logo">'
    + '<defs><linearGradient id="g1"><stop offset="0" stop-color="#0ff"/></linearGradient><path id="p" d="M0 0h1"/></defs>'
    + '<rect width="10" height="10" fill="url(#g1)" style="opacity:.5"/><use xlink:href="#p"/><text x="1" y="9">A &amp; B</text></svg>';
  assert.deepEqual(sanitizeSvg(clean), []);
  assert.ok(sanitizeSvg('<svg><script>alert(1)</script></svg>').includes('contains <script> (element not allowed)'));
  assert.ok(sanitizeSvg('<svg onload="x()"></svg>').length);
  assert.ok(sanitizeSvg('<svg><image href="https://evil.example/x.png"/></svg>').length);
  assert.ok(sanitizeSvg('<svg><a href="javascript:alert(1)">x</a></svg>').length);
  assert.ok(sanitizeSvg('<svg><style>@import url(https://evil.example/x.css)</style></svg>').length);
  assert.ok(sanitizeSvg('<svg><foreignObject><div/></foreignObject></svg>').length);
  assert.match(sanitizeSvg('<!DOCTYPE svg [<!ENTITY x "y">]><svg/>').join(), /DTD/);
  assert.match(sanitizeSvg('<?xml-stylesheet href="https://evil.example/x.css"?><svg/>').join(), /processing instruction/);
  assert.match(sanitizeSvg('<html><body/></html>').join(), /not an SVG document/);
});

test('SVG: entity-encoded URLs and SMIL animation are rejected', () => {
  // &#106; = "j", &#104; = "h": decoded before the scheme is checked
  assert.match(sanitizeSvg('<svg><use href="&#106;avascript:alert(1)"/></svg>').join(), /not a link inside the file|script or data: URL/);
  assert.match(sanitizeSvg('<svg><use xlink:href="&#104;ttps://evil.example/x.svg#a"/></svg>').join(), /not a link inside the file/);
  assert.match(sanitizeSvg('<svg><use href="&amp;#106;avascript:x"/></svg>').join(), /not a link inside the file|script or data: URL/);
  assert.match(sanitizeSvg('<svg><rect fill="url(&#104;ttps://evil.example/p.svg#x)"/></svg>').join(), /external resource/);
  assert.match(sanitizeSvg('<svg><rect style="fill:u\\72l(https://evil.example)"/></svg>').join(), /CSS escapes/);
  assert.match(sanitizeSvg('<svg><set attributeName="onload" to="alert(1)"/></svg>').join(), /<set> \(element not allowed\)/);
  assert.match(sanitizeSvg('<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>').join(), /<animate> \(element not allowed\)/);
  assert.match(sanitizeSvg('<svg><rect><animateTransform attributeName="transform"/></rect></svg>').join(), /<animateTransform>/);
  assert.match(sanitizeSvg('<svg><rect onclick="x()"/></svg>').join(), /event handler attribute \(onclick\)/);
  assert.match(sanitizeSvg('<svg><rect formaction="x"/></svg>').join(), /attribute formaction on <rect> is not allowed/);
  const c = fresh();
  assert.ok(Object.values(c.library).every((e) => !e.path.endsWith('.svg')));
});

test('machine PR base comparison: only editable slots may change', () => {
  const base = fresh();
  const ok = fresh(); ok.i18n.cs.h1 = 'Každá minuta se počítá.'; ok.media.founderImage.mediaId = 'img-procelyx-process-jpg'; ok.site.seoTitle.cs = 'PROCELYX — automatizace procesů pro firmy';
  assert.deepEqual(compareWithBase(ok, base), []);
  const legal = fresh(); legal.i18n.cs.formPrivacy = 'Jiný právní text.';
  assert.match(compareWithBase(legal, base).join('\n'), /formPrivacy is not an editable slot/);
  // a dictionary key used only by JavaScript (no slot in the manifest)
  const bound = new Set(base.manifest.pages.flatMap((p) => p.sections.flatMap((s) => s.slots.flatMap((x) => [x.key, x.altKey]))));
  const unbound = Object.keys(base.i18n.cs).find((k) => !bound.has(k));
  const hidden = fresh(); hidden.i18n.cs[unbound] = 'Jiný text';
  assert.ok(compareWithBase(hidden, base).includes(`content/i18n/cs.json: ${unbound} is not an editable slot`));
  const identity = fresh(); identity.site.email = 'novy@example.com';
  assert.match(compareWithBase(identity, base).join('\n'), /email is not an editable slot/);
  const added = fresh(); added.i18n.cs.newKey = 'x'; added.i18n.en.newKey = 'x';
  assert.match(compareWithBase(added, base).join('\n'), /newKey added/);
  const manifest = fresh(); slot(manifest, 'home.hero.h1').maxLength = 2000;
  assert.match(compareWithBase(manifest, base).join('\n'), /manifest\.json: may not change/);
});

test('cs/en key sets are compared as own keys (prototype names are not special)', () => {
  const a = fresh(); a.i18n.en.constructor = 'Constructor';
  assert.match(validateContent(root, a).join('\n'), /en\.json: key constructor is not in cs\.json/);
  const b = fresh(); b.i18n.cs.toString = 'Text';
  assert.match(validateContent(root, b).join('\n'), /en\.json: missing key toString/);
  const base = fresh();
  const c = fresh(); c.i18n.cs.toString = 'Text'; c.i18n.en.toString = 'Text';
  assert.match(compareWithBase(c, base).join('\n'), /cs\.json: key toString added/);
});

test('a key bound by an editable slot and a DEV slot is rejected and never editable', () => {
  const a = fresh(); slot(a, 'home.hero.h1').key = 'formPrivacy';
  assert.match(validateContent(root, a).join('\n'), /i18n:formPrivacy is bound by slots of different tiers \(DEV, T2\)|i18n:formPrivacy is bound by slots of different tiers \(T2, DEV\)/);
  // Even if such a manifest reached the base branch, a machine PR still may not change the legal text.
  const base = fresh(); slot(base, 'home.hero.h1').key = 'formPrivacy';
  const legal = structuredClone(base); legal.i18n.cs.formPrivacy = 'Jiný právní text, který by jinak prošel.';
  assert.match(compareWithBase(legal, base).join('\n'), /formPrivacy is not an editable slot/);
});
