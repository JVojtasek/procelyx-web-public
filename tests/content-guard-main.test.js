// content-guard main() end to end for a machine PR, with a fake GitHub API and a temporary workspace that holds
// the real tools, schemas, content and public/. Proves that validate-content runs with --base and that the base
// copy is taken BEFORE the PR's content/** is materialized: a T2 change (h1) passes, a DEV/legal change
// (formPrivacy) fails. build/check are stubbed (they have their own checks); validate-content runs for real.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync} from 'node:fs';
import {join, resolve, sep} from 'node:path';
import {main, runBaseTool} from '../tools/content-guard.mjs';

const root = resolve(import.meta.dirname, '..');
const HEAD = 'e'.repeat(40);
const MERGE = 'm'.repeat(40);

// Inside node_modules so the copied tools resolve their dependencies (cheerio) from the repository; never committed.
function makeWorkspace() {
  const parent = join(root, 'node_modules', '.cache');
  mkdirSync(parent, {recursive: true});
  const ws = mkdtempSync(join(parent, 'content-guard-test-'));
  for (const dir of ['tools', 'schemas', 'content', 'public']) cpSync(join(root, dir), join(ws, dir), {recursive: true});
  return ws;
}

/** content/** of the PR merge commit as {path: Buffer}: the base content with `edit` applied to the i18n dictionaries. */
function prContent(edit) {
  const files = {};
  const dir = join(root, 'content');
  for (const rel of readdirSync(dir, {recursive: true}).map(String)) {
    if (statSync(join(dir, rel)).isFile()) files['content/' + rel.split(sep).join('/')] = readFileSync(join(dir, rel));
  }
  const i18n = {cs: JSON.parse(files['content/i18n/cs.json']), en: JSON.parse(files['content/i18n/en.json'])};
  edit(i18n);
  for (const lang of ['cs', 'en']) files[`content/i18n/${lang}.json`] = Buffer.from(JSON.stringify(i18n[lang], null, 2) + '\n');
  return files;
}

/** Fake read-only GitHub API for a bot PR that changes content/i18n/cs.json. */
function fakeApi(files) {
  const paths = Object.keys(files);
  const tree = paths.map((path, i) => ({path, mode: '100644', type: 'blob', sha: `blob${i}`, size: files[path].length}));
  const ok = (data) => ({status: 200, data, link: ''});
  return async (path, {allow404 = false} = {}) => {
    if (/\/pulls\/7$/.test(path)) return ok({user: {login: 'nexus-one-publisher[bot]', type: 'Bot'}, head: {sha: HEAD}, mergeable: true, merge_commit_sha: MERGE, commits: 1});
    if (path.includes('/collaborators/')) { if (allow404) return {status: 404, data: null, link: ''}; throw new Error('GitHub API 404'); }
    if (path.includes('/pulls/7/commits')) return ok([{sha: HEAD, committer: {login: 'nexus-one-publisher[bot]'}, commit: {verification: {verified: true, reason: 'valid', signature: null}}}]);
    if (path.includes('/ssh_signing_keys')) return ok([]);
    if (path.includes('/git/commits/')) return ok({parents: [{sha: 'f'.repeat(40)}, {sha: HEAD}], tree: {sha: 't'.repeat(40)}});
    if (path.includes('/pulls/7/files')) return ok([{filename: 'content/i18n/cs.json', status: 'modified'}]);
    if (path.includes('/git/trees/')) return ok({truncated: false, tree});
    const blob = /\/git\/blobs\/blob(\d+)$/.exec(path);
    if (blob) return ok({encoding: 'base64', content: files[paths[Number(blob[1])]].toString('base64')});
    throw new Error(`unexpected API call ${path}`);
  };
}

async function runGuard(edit) {
  const ws = makeWorkspace();
  const calls = [];
  const out = [];
  try {
    const env = {GITHUB_REPOSITORY: 'JVojtasek/procelyx-web', PR_NUMBER: '7', HEAD_SHA: HEAD, GITHUB_WORKSPACE: ws};
    const code = await main(env, {
      api: fakeApi(prContent(edit)),
      log: (t) => out.push(t),
      runTool: (workspace, args) => {
        calls.push(args);
        return args[0] === 'tools/validate-content.mjs' ? runBaseTool(workspace, args) : {ok: true, output: ''};
      },
    });
    return {code, calls, output: out.join('\n')};
  } finally {
    rmSync(ws, {recursive: true, force: true});
  }
}

test('main: machine PR changing a T2 text (h1) passes, validate-content runs with --base', async () => {
  const r = await runGuard((i18n) => { i18n.cs.h1 = 'Každá minuta se počítá.'; });
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /strojový/);
  const validate = r.calls.find((args) => args[0] === 'tools/validate-content.mjs');
  assert.ok(validate, 'validate-content was not run');
  assert.equal(validate[1], '--base');
  assert.deepEqual(r.calls.map((args) => args[0]), ['tools/validate-content.mjs', 'tools/build.mjs', 'tools/check-site.mjs']);
});

test('main: machine PR changing a DEV/legal text (formPrivacy) fails although it is schema-valid', async () => {
  const r = await runGuard((i18n) => { i18n.cs.formPrivacy = 'Údaje použiji jen k vyřízení poptávky a nikomu je nepředám.'; });
  assert.equal(r.code, 1, r.output);
  assert.match(r.output, /formPrivacy is not an editable slot/);
  assert.deepEqual(r.calls.map((args) => args[0]), ['tools/validate-content.mjs'], 'build must not run after a failed validation');
});
