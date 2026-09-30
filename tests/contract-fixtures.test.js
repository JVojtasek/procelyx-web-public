// Contract nexus.site.v1: the shared fixtures (tests/fixtures/contract/*.json) are run by this repo AND by
// Nexus One against its vendored copy of tools/inject.mjs. Same input -> byte-identical HTML, same errors.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {injectPage} from '../tools/inject.mjs';
import {validate} from '../tools/lib/json-schema-lite.mjs';

const dir = new URL('./fixtures/contract/', import.meta.url);
const manifestSchema = JSON.parse(readFileSync(new URL('../schemas/manifest.schema.json', import.meta.url), 'utf8'));
const fixtures = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));

test('there are 10–14 contract fixtures including error and image cases', () => {
  assert.ok(fixtures.length >= 10 && fixtures.length <= 14, String(fixtures.length));
  assert.ok(fixtures.some((f) => f.expectedError));
  assert.ok(fixtures.some((f) => f.manifest.pages[0].sections.some((s) => s.slots.some((x) => x.type === 'image'))));
});

for (const f of fixtures) {
  test(`fixture ${f.name}`, () => {
    assert.deepEqual(validate(manifestSchema, f.manifest), [], 'fixture manifest must follow the contract schema');
    const run = (html) => injectPage(html, f.content, f.manifest.pages[0], {lang: f.lang || 'cs'});
    if (f.expectedError) {
      assert.throws(() => run(f.html), (err) => err.message.includes(f.expectedError));
      return;
    }
    const out = run(f.html);
    assert.equal(out, f.expectedHtml);
    assert.equal(run(out), out, 'injection must be idempotent');
  });
}
