#!/usr/bin/env node
// ONE-OFF migration (W0c): extracts the effective translation dictionary from the old public/app.js
// (`const T={cs,en}` + every later `Object.assign(T.cs/en,{…})`) into content/i18n/{cs,en}.json.
//
//   node tools/extract-i18n.mjs <old-app.js> [old-site.json]   (e.g. git show <base>:public/app.js > /tmp/app.js)
//
// Evaluates only the dictionary part of the file (everything before `function updateAccessibleCopy`)
// in an empty node:vm context. Adds the image alt texts that app.js used to hard-code
// (caseImage1-3.alt) and the founder photo alt (founderImage.alt = founder name, same in both languages).
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(process.argv[2] || resolve(root, 'public/app.js'), 'utf8');
const cut = source.indexOf('function updateAccessibleCopy');
if (cut < 0) throw new Error('app.js has no dictionary part (already migrated?)');
const context = vm.createContext({});
vm.runInContext(source.slice(0, cut) + '\n;globalThis.__T = T;', context);
const T = context.__T;

// Hard-coded alt texts of the three case images (app.js updateAccessibleCopy) become slots.
const altArray = (name) => {
  const m = source.match(new RegExp(`const ${name}=(\\[[^\\]]*\\])`));
  if (!m) throw new Error(`${name} not found`);
  return vm.runInNewContext(m[1]);
};
const altCs = altArray('altCs'), altEn = altArray('altEn');
const site = JSON.parse(readFileSync(resolve(root, process.argv[3] || 'config/site.json'), 'utf8'));
const out = {cs: {...T.cs}, en: {...T.en}};
altCs.forEach((v, i) => { out.cs[`caseImage${i + 1}.alt`] = v; });
altEn.forEach((v, i) => { out.en[`caseImage${i + 1}.alt`] = v; });
out.cs['founderImage.alt'] = site.founderName;
out.en['founderImage.alt'] = site.founderName;
// app.js overwrote cta2 with site.json `cta` at runtime; the dictionary is now the only source (site.json drops `cta`).
if (site.cta && (out.cs.cta2 !== site.cta.cs || out.en.cta2 !== site.cta.en)) { out.cs.cta2 = site.cta.cs; out.en.cta2 = site.cta.en; }

mkdirSync(resolve(root, 'content/i18n'), {recursive: true});
for (const lang of ['cs', 'en']) {
  writeFileSync(resolve(root, `content/i18n/${lang}.json`), JSON.stringify(out[lang], null, 2) + '\n');
  console.log(`content/i18n/${lang}.json: ${Object.keys(out[lang]).length} keys`);
}
