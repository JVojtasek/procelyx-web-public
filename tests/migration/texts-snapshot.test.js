// One-off migration check for W0c (content as data). NOT part of `npm test`; run with
// `npm run test:migration` after `npm run build`. CI runs it only when tools/extract-i18n.mjs changes.
//
// The snapshot in __snapshots__/ was taken from the site BEFORE the texts moved to content/**:
// title, meta description, every [data-t] text, placeholders, alt texts, aria-labels, the whole visible
// body text and a hash of the normalised DOM — all AFTER app.js ran, in Czech and English.
// After the migration everything must be identical.
//
// UPDATE_SNAPSHOT=1 npm run test:migration   (only on the pre-migration commit)
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {renderAfterJs, textSnapshot, normalizedDom} from '../helpers/dom-harness.mjs';

const publicDir = fileURLToPath(new URL('../../public/', import.meta.url));
const snapDir = new URL('./__snapshots__/', import.meta.url);
const snapFile = new URL('texts.json', snapDir);

for (const lang of ['cs', 'en']) {
  test(`homepage after JS is unchanged (${lang})`, () => {
    const $ = renderAfterJs(publicDir, {lang});
    const now = textSnapshot($);
    const domFile = new URL(`dom-${lang}.html`, snapDir);
    if (process.env.UPDATE_SNAPSHOT === '1') {
      const all = existsSync(snapFile) ? JSON.parse(readFileSync(snapFile, 'utf8')) : {};
      all[lang] = now;
      writeFileSync(snapFile, JSON.stringify(all, null, 2) + '\n');
      writeFileSync(domFile, normalizedDom($));
      return;
    }
    const before = JSON.parse(readFileSync(snapFile, 'utf8'))[lang];
    for (const field of ['lang', 'title', 'description', 'dataT', 'placeholders', 'alts', 'ariaLabels', 'bodyText']) {
      assert.deepEqual(now[field], before[field], `${lang}: ${field} changed`);
    }
    assert.equal(normalizedDom($), readFileSync(domFile, 'utf8'), `${lang}: DOM after JS changed`);
    assert.equal(now.domSha256, before.domSha256);
  });
}
