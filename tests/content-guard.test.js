import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {classifyPr, checkMachinePaths, sshSignatureKey, publicKeyBlob, checkPinnedHead, toolEnv, main, materializeContent, MAX_PR_COMMITS} from '../tools/content-guard.mjs';

const sig = JSON.parse(readFileSync(new URL('./fixtures/content-guard/signatures.json', import.meta.url), 'utf8'));
const OWNER = 'JVojtasek';
const ownerSigningKeys = [sig.ownerSigningKey];

const commit = ({sha = 'a1b2c3d4e5f6', verified = true, signature = sig.ownerSignature, committer = OWNER, authorName = 'JVojtasek', reason} = {}) => ({
  sha,
  committer: committer ? {login: committer} : null,
  commit: {author: {name: authorName, email: '1+JVojtasek@users.noreply.github.com'}, verification: {verified, reason: reason || (verified ? 'valid' : 'unsigned'), signature: verified ? signature : null}},
});
const humanPr = {user: {login: OWNER, type: 'User'}};
const appPr = {user: {login: 'nexus-one-publisher[bot]', type: 'Bot'}};
const classify = (over = {}) => classifyPr({pr: humanPr, authorPermission: 'admin', commits: [commit()], ownerLogin: OWNER, ownerSigningKeys, ...over});

test('SSH signature key is extracted and matches the owner key', () => {
  assert.equal(sshSignatureKey(sig.ownerSignature), publicKeyBlob(sig.ownerSigningKey));
  assert.equal(sshSignatureKey(sig.otherSignature), publicKeyBlob(sig.otherSigningKey));
  assert.notEqual(sshSignatureKey(sig.ownerSignature), sshSignatureKey(sig.otherSignature));
  assert.equal(sshSignatureKey(sig.pgpSignature), null);
  assert.equal(sshSignatureKey('-----BEGIN SSH SIGNATURE-----\nbm90IGEgc2lnbmF0dXJl\n-----END SSH SIGNATURE-----'), null);
  assert.equal(sshSignatureKey(null), null);
});

test('admin author with every commit signed by the owner key is human', () => {
  const r = classify({commits: [commit(), commit({sha: 'b2c3d4e5f6a7'})]});
  assert.equal(r.kind, 'human', r.reasons.join('; '));
});

test('GitHub App / bot PRs are machine even with verified commits', () => {
  assert.equal(classify({pr: appPr, authorPermission: 'write'}).kind, 'machine');
  assert.equal(classify({pr: {user: {login: 'github-actions[bot]', type: 'Bot'}}, authorPermission: 'admin'}).kind, 'machine');
});

test('non-admin author is machine', () => {
  const r = classify({authorPermission: 'write'});
  assert.equal(r.kind, 'machine');
  assert.match(r.reasons.join(), /not a repository admin/);
});

test('forged author name "JVojtasek" on an unsigned commit inside a human PR makes it machine', () => {
  const r = classify({commits: [commit(), commit({sha: 'deadbeef0000', verified: false, committer: null, authorName: 'JVojtasek'})]});
  assert.equal(r.kind, 'machine');
  assert.match(r.reasons.join(), /deadbeef.*not signed/);
});

test('commit signed with a key that is not the owner key is machine', () => {
  const r = classify({commits: [commit({signature: sig.otherSignature})]});
  assert.equal(r.kind, 'machine');
  assert.match(r.reasons.join(), /not one of the owner's signing keys/);
});

test('web-flow (GitHub UI / API) signatures and other signers are machine', () => {
  assert.equal(classify({commits: [commit({committer: 'web-flow', signature: sig.pgpSignature})]}).kind, 'machine');
  assert.equal(classify({commits: [commit({committer: 'someone-else'})]}).kind, 'machine');
});

test('owner without registered signing keys cannot produce a human PR with SSH signatures', () => {
  assert.equal(classify({ownerSigningKeys: []}).kind, 'machine');
});

test('verified PGP-signed commit with committer = owner is machine (only the owner SSH key counts)', () => {
  const r = classify({commits: [commit({signature: sig.pgpSignature})]});
  assert.equal(r.kind, 'machine');
  assert.match(r.reasons.join(), /not SSH-signed/);
  assert.equal(classify({commits: [commit({signature: null})]}).kind, 'machine');
});

test('PR without commits is machine', () => {
  assert.equal(classify({commits: []}).kind, 'machine');
});

test('PR with more commits than the API returned is machine (fail closed)', () => {
  const many = Array.from({length: MAX_PR_COMMITS}, (_, i) => commit({sha: `c${String(i).padStart(11, '0')}`}));
  const r = classify({pr: {...humanPr, commits: 251}, commits: many});
  assert.equal(r.kind, 'machine');
  assert.match(r.reasons.join(), /API may not return all/);
  const r2 = classify({pr: {...humanPr, commits: 3}, commits: [commit(), commit({sha: 'b2c3d4e5f6a7'})]});
  assert.equal(r2.kind, 'machine');
  assert.match(r2.reasons.join(), /more commits \(3\) than the API returned \(2\)/);
  assert.equal(classify({pr: {...humanPr, commits: 1}}).kind, 'human');
});

test('guard is pinned to the triggering head SHA and a fresh merge ref', () => {
  const head = 'h'.repeat(40);
  const pr = {head: {sha: head}, mergeable: true};
  const commits = [{sha: 'a'.repeat(40)}, {sha: head}];
  const merge = {parents: [{sha: 'b'.repeat(40)}, {sha: head}]};
  assert.deepEqual(checkPinnedHead({headSha: head, pr, commits}), []);
  assert.deepEqual(checkPinnedHead({headSha: head, pr, mergeCommit: merge}), []);
  assert.match(checkPinnedHead({headSha: head, pr: {head: {sha: 'n'.repeat(40)}}, commits}).join(), /newer push/);
  assert.match(checkPinnedHead({headSha: head, pr, commits: [{sha: 'a'.repeat(40)}]}).join(), /does not end with/);
  assert.match(checkPinnedHead({headSha: head, pr, mergeCommit: {parents: [{sha: 'b'.repeat(40)}, {sha: 'o'.repeat(40)}]}}).join(), /stale merge ref/);
  assert.match(checkPinnedHead({headSha: head, pr: {head: {sha: head}, mergeable: null}, mergeCommit: merge}).join(), /not finished computing mergeability/);
  assert.equal(checkPinnedHead({headSha: '', pr}).length, 1);
});

test('base tools run without the workflow token or Actions variables', () => {
  const env = toolEnv({PATH: '/usr/bin', HOME: '/home/runner', GITHUB_TOKEN: 'x', ACTIONS_RUNTIME_TOKEN: 'y', GITHUB_REPOSITORY: 'a/b'});
  assert.deepEqual(env, {CI: 'true', PATH: '/usr/bin', HOME: '/home/runner'});
});

const f = (filename, status = 'modified', previous_filename) => ({filename, status, ...(previous_filename ? {previous_filename} : {})});

test('machine PR limited to content/** passes the path check', () => {
  assert.deepEqual(checkMachinePaths([f('content/i18n/cs.json'), f('content/media.json', 'added')], [{path: 'content/i18n/cs.json', mode: '100644', type: 'blob'}]), []);
});

test('machine PR changing code or config is rejected', () => {
  for (const path of ['src/index.js', 'wrangler.jsonc', '.github/workflows/web-checks.yml', 'tools/build.mjs', 'tests/content-invariant.test.js', 'package.json', 'contentx/a.json', 'Content/i18n/cs.json']) {
    const v = checkMachinePaths([f('content/i18n/cs.json'), f(path)]);
    assert.equal(v.length, 1, path);
    assert.equal(v[0].path, path);
    if (path.startsWith('.github/')) assert.match(v[0].reason, /workflow\/CI configuration/);
  }
});

test('rename from outside content/** into content/** (and out of it) is rejected', () => {
  assert.equal(checkMachinePaths([f('content/x.js', 'renamed', 'src/index.js')]).length, 1);
  assert.equal(checkMachinePaths([f('public/app.js', 'renamed', 'content/app.js')]).length, 1);
  assert.deepEqual(checkMachinePaths([f('content/b.json', 'renamed', 'content/a.json')]), []);
});

test('symlinks and submodules in content/** are rejected', () => {
  const tree = [{path: 'content/link.json', mode: '120000', type: 'blob'}, {path: 'content/sub', mode: '160000', type: 'commit'}, {path: 'content/ok.json', mode: '100644', type: 'blob'}];
  const v = checkMachinePaths([f('content/link.json')], tree);
  assert.deepEqual(v.map((x) => x.reason).sort(), ['submodule in content/**', 'symlink in content/**']);
});

test('content/media-src/** and unsafe paths are rejected for machine PRs', () => {
  assert.equal(checkMachinePaths([f('content/media-src/logo.svg', 'added')]).length, 1);
  assert.equal(checkMachinePaths([f('content/../src/index.js')]).length, 1);
  assert.equal(checkMachinePaths([f('content\\i18n\\cs.json')]).length, 1);
});

test('empty or truncated file lists are rejected', () => {
  assert.equal(checkMachinePaths([]).length, 1);
  assert.ok(checkMachinePaths(Array.from({length: 3000}, (_, i) => f(`content/${i}.json`))).some((v) => /truncated/.test(v.reason)));
});

// ---- main(): the decisions that depend on API responses, with a fake GitHub API ------------------
const HEAD = 'e'.repeat(40);
const BASE = 'f'.repeat(40);
const MERGE = 'm'.repeat(40);
const botPr = (over = {}) => ({user: {login: 'nexus-one-publisher[bot]', type: 'Bot'}, head: {sha: HEAD}, mergeable: true, merge_commit_sha: MERGE, commits: 1, ...over});
const botCommit = {sha: HEAD, committer: {login: 'nexus-one-publisher[bot]'}, commit: {verification: {verified: true, reason: 'valid', signature: null}}};
const blob = (path, extra = {}) => ({path, mode: '100644', type: 'blob', sha: `blob-${path}`, size: 2, ...extra});

/** Fake read-only GitHub API. The default state is a machine PR that only adds content/manifest.json. */
function fakeApi(state = {}) {
  const s = {
    pr: botPr(),
    prAfter: null, // PR returned by every read after the first one (a push while the guard runs)
    permission: null,
    commits: [botCommit],
    keys: [],
    files: [f('content/manifest.json', 'added')],
    mergeCommit: {parents: [{sha: BASE}, {sha: HEAD}], tree: {sha: 't'.repeat(40)}},
    tree: {truncated: false, tree: [{path: 'content', mode: '040000', type: 'tree'}, blob('content/manifest.json')]},
    ...state,
  };
  let prReads = 0;
  const calls = [];
  const ok = (data) => ({status: 200, data, link: ''});
  const api = async (path, {allow404 = false} = {}) => {
    calls.push(path);
    if (/\/pulls\/\d+$/.test(path)) return ok(prReads++ > 0 && s.prAfter ? s.prAfter : s.pr);
    if (path.includes('/collaborators/')) {
      if (s.permission) return ok({permission: s.permission});
      if (allow404) return {status: 404, data: null, link: ''};
      throw new Error('GitHub API 404');
    }
    if (path.includes('/pulls/7/commits')) return ok(s.commits);
    if (path.includes('/ssh_signing_keys')) return ok(s.keys);
    if (path.includes('/git/commits/')) return ok(s.mergeCommit);
    if (path.includes('/pulls/7/files')) return ok(s.files);
    if (path.includes('/git/trees/')) return ok(s.tree);
    if (path.includes('/git/blobs/')) return ok({content: Buffer.from('{}').toString('base64'), encoding: 'base64'});
    throw new Error(`unexpected API call ${path}`);
  };
  return {api, calls};
}

async function runMain(state) {
  const workspace = mkdtempSync(join(tmpdir(), 'content-guard-'));
  const out = [];
  const {api, calls} = fakeApi(state);
  try {
    const env = {GITHUB_REPOSITORY: `${OWNER}/procelyx-web`, PR_NUMBER: '7', HEAD_SHA: HEAD, GITHUB_WORKSPACE: workspace};
    const code = await main(env, {api, log: (t) => out.push(t)});
    return {code, output: out.join('\n'), calls};
  } finally {
    rmSync(workspace, {recursive: true, force: true});
  }
}

test('main: machine PR adding content/manifest.json without a base validator fails closed', async () => {
  const r = await runMain();
  assert.equal(r.code, 1);
  assert.match(r.output, /strojový/);
  assert.match(r.output, /nemá `tools\/validate-content\.mjs`/);
});

test('main: machine PR that cannot be merged (or has no merge ref) fails', async () => {
  const conflict = await runMain({pr: botPr({mergeable: false})});
  assert.equal(conflict.code, 1);
  assert.match(conflict.output, /nejde sloučit/);
  const noRef = await runMain({pr: botPr({merge_commit_sha: null})});
  assert.equal(noRef.code, 1);
  assert.match(noRef.output, /chybí merge ref/);
  assert.ok(!noRef.calls.some((c) => c.includes('/git/commits/')), 'no merge commit is read without a merge ref');
});

test('main: a head that differs from HEAD_SHA before classification is a pin failure', async () => {
  const r = await runMain({pr: botPr({head: {sha: 'n'.repeat(40)}})});
  assert.equal(r.code, 1);
  assert.match(r.output, /spusťte znovu/);
  assert.match(r.output, /newer push/);
});

test('main: a push while the file list is read (prAfter) is a pin failure', async () => {
  const r = await runMain({prAfter: botPr({head: {sha: 'n'.repeat(40)}})});
  assert.equal(r.code, 1);
  assert.match(r.output, /spusťte znovu/);
  assert.match(r.output, /newer push/);
  assert.ok(r.calls.some((c) => c.includes('/pulls/7/files')), 'the file list was read');
  assert.ok(!r.calls.some((c) => c.includes('/git/trees/')), 'the tree is not read after a head change');
});

test('main: a truncated merge tree fails', async () => {
  const r = await runMain({tree: {truncated: true, tree: []}});
  assert.equal(r.code, 1);
  assert.match(r.output, /truncated/);
});

test('main: machine PR touching .github/** is rejected before any content is read', async () => {
  const r = await runMain({files: [f('content/manifest.json', 'added'), f('.github/workflows/x.yml', 'added')]});
  assert.equal(r.code, 1);
  assert.match(r.output, /\.github\/workflows\/x\.yml`: workflow\/CI configuration/);
  assert.ok(!r.calls.some((c) => c.includes('/git/blobs/')));
});

test('main: admin PR with every commit SSH-signed by the owner key is human (exit 0)', async () => {
  const r = await runMain({
    pr: botPr({user: {login: OWNER, type: 'User'}}),
    permission: 'admin',
    commits: [commit({sha: HEAD})],
    keys: [{key: sig.ownerSigningKey}],
  });
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /lidský/);
});

test('materializeContent enforces the path, file-count and size limits', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'content-guard-'));
  const {api} = fakeApi();
  try {
    await assert.rejects(materializeContent(api, [blob('content/../src/index.js')], workspace), /unsafe path/);
    await assert.rejects(materializeContent(api, [blob('content/big.json', {size: 21 * 1024 * 1024})], workspace), /larger than 20 MB/);
    await assert.rejects(materializeContent(api, Array.from({length: 2001}, (_, i) => blob(`content/${i}.json`)), workspace), /limit 2000/);
    assert.equal(await materializeContent(api, [blob('content/ok.json'), blob('src/not-content.js')], workspace), 1);
    assert.equal(readFileSync(join(workspace, 'content', 'ok.json'), 'utf8'), '{}');
  } finally {
    rmSync(workspace, {recursive: true, force: true});
  }
});
