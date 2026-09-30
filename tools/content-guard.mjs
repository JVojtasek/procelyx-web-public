#!/usr/bin/env node
// content-guard: the path boundary for machine pull requests (GitHub App of Nexus One, bots, anyone else).
//
// Runs from the BASE branch on `pull_request_target` (see .github/workflows/content-guard.yml). It never
// executes code from the pull request: the PR is read through the REST API as data.
//
// A pull request is "human" only when BOTH hold:
//   1. the PR author has the admin role in this repository, and
//   2. every commit is signed, GitHub reports the signature as verified, the committer is the repository
//      owner (never `web-flow` or a bot) and the signature is an SSH signature made with one of the owner's
//      registered SSH signing keys (PGP/GPG signatures, including GitHub's web-flow key, never count), and
//   3. the API returned every commit of the PR (more than 250 commits = machine, fail closed).
// Everything else is "machine". Author/committer names are never trusted on their own (they can be forged).
// The guard is pinned to the head SHA it was triggered for (HEAD_SHA): a newer push, an unfinished
// mergeability computation or a merge ref that does not contain that head fails the check (re-run later).
//
// Machine PRs may change only `content/**` (no renames out of it, no symlinks or submodules, nothing under
// `content/media-src/**` until a sanitizer exists). Their `content/**` from `refs/pull/<n>/merge` is then
// written as data into the base checkout and validated with the BASE version of the tools
// (validate-content, build, check) in a child process without the workflow token or Actions variables.
// validate-content is mandatory once content/manifest.json exists (W0c); before that it runs when present.
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, cpSync, rmSync, writeFileSync, appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export const CONTENT_PREFIX = 'content/';
export const FORBIDDEN_CONTENT_PREFIXES = ['content/media-src/'];
const BOT_LOGINS = new Set(['web-flow', 'github-actions[bot]', 'dependabot[bot]']);
const MAX_FILES = 3000; // GitHub's list-files API stops at 3000 entries
const MAX_CONTENT_BYTES = 20 * 1024 * 1024;
const MAX_CONTENT_FILES = 2000;
export const MAX_PR_COMMITS = 250; // GitHub's list-commits-of-a-PR API stops at 250 entries

/** Public key blob (base64, SSH wire format) of an armored SSH signature, or null. */
export function sshSignatureKey(signature) {
  if (typeof signature !== 'string' || !signature.includes('-----BEGIN SSH SIGNATURE-----')) return null;
  const b64 = signature.replace(/-----(BEGIN|END) SSH SIGNATURE-----/g, '').replace(/\s+/g, '');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 14 || buf.subarray(0, 6).toString('latin1') !== 'SSHSIG') return null;
  const len = buf.readUInt32BE(10);
  if (len <= 0 || 14 + len > buf.length) return null;
  return buf.subarray(14, 14 + len).toString('base64');
}

/** Base64 key blob of an "ssh-ed25519 AAAA… comment" line. */
export function publicKeyBlob(line) {
  const parts = String(line || '').trim().split(/\s+/);
  return parts.length >= 2 ? parts[1] : null;
}

/**
 * @param {{pr: {user: {login: string, type?: string}, commits?: number}, authorPermission: string, commits: any[], ownerLogin: string, ownerSigningKeys: string[]}} input
 *   `pr.commits` is the PR's total commit count reported by GitHub (compared with the commits received).
 * @returns {{kind: 'human'|'machine', reasons: string[]}}
 */
export function classifyPr({pr, authorPermission, commits, ownerLogin, ownerSigningKeys}) {
  const reasons = [];
  const author = pr?.user?.login || '';
  if (pr?.user?.type && pr.user.type !== 'User') reasons.push(`PR author ${author} is a ${pr.user.type}, not a person`);
  if (BOT_LOGINS.has(author) || author.endsWith('[bot]')) reasons.push(`PR author ${author} is a bot`);
  if (authorPermission !== 'admin') reasons.push(`PR author ${author} is not a repository admin (permission: ${authorPermission || 'none'})`);
  if (!Array.isArray(commits) || commits.length === 0) reasons.push('PR has no commits to verify');
  const received = Array.isArray(commits) ? commits.length : 0;
  if (received >= MAX_PR_COMMITS) reasons.push(`PR has ${received} or more commits; the API may not return all of them`);
  else if (typeof pr?.commits === 'number' && pr.commits > received) reasons.push(`PR has more commits (${pr.commits}) than the API returned (${received})`);
  const ownerKeys = new Set((ownerSigningKeys || []).map(publicKeyBlob).filter(Boolean));
  for (const c of commits || []) {
    const sha = String(c?.sha || '').slice(0, 8);
    const v = c?.commit?.verification || {};
    const committer = c?.committer?.login || '';
    if (v.verified !== true) { reasons.push(`commit ${sha} is not signed with a verified signature (${v.reason || 'unsigned'})`); continue; }
    if (!committer || BOT_LOGINS.has(committer) || committer.endsWith('[bot]')) { reasons.push(`commit ${sha} is signed by ${committer || 'an unknown account'}, not by the owner`); continue; }
    if (committer !== ownerLogin) { reasons.push(`commit ${sha} is signed by ${committer}, not by the owner ${ownerLogin}`); continue; }
    const sshKey = sshSignatureKey(v.signature);
    if (!sshKey) reasons.push(`commit ${sha} is not SSH-signed (PGP/GPG or GitHub web-flow signatures do not count)`);
    else if (!ownerKeys.has(sshKey)) reasons.push(`commit ${sha} is signed with an SSH key that is not one of the owner's signing keys`);
  }
  return {kind: reasons.length ? 'machine' : 'human', reasons};
}

/**
 * The PR state the guard reads must belong to the head it was triggered for.
 * @param {{headSha: string, pr: {head?: {sha?: string}, mergeable?: boolean|null}, commits?: {sha: string}[], mergeCommit?: {parents?: {sha: string}[]}|null}} input
 *   `mergeCommit` is checked only when given (machine PRs, which use the test-merge tree).
 * @returns {string[]} problems (empty = consistent)
 */
export function checkPinnedHead({headSha, pr, commits, mergeCommit}) {
  const problems = [];
  if (!headSha) return ['HEAD_SHA of the triggering event is missing'];
  if (pr?.head?.sha !== headSha) problems.push(`PR head is ${String(pr?.head?.sha || '?').slice(0, 8)}, not the triggering head ${headSha.slice(0, 8)} (a newer push; its own run decides)`);
  if (commits && commits.at(-1)?.sha !== headSha) problems.push(`the commit list does not end with the triggering head ${headSha.slice(0, 8)}`);
  if (mergeCommit !== undefined) {
    if (pr?.mergeable === null || pr?.mergeable === undefined) problems.push('GitHub has not finished computing mergeability; the merge ref may be stale (re-run later)');
    if (!mergeCommit?.parents?.some((p) => p.sha === headSha)) problems.push(`the merge commit does not contain the triggering head ${headSha.slice(0, 8)} (stale merge ref)`);
  }
  return problems;
}

function isContentPath(path) {
  if (typeof path !== 'string' || !path.startsWith(CONTENT_PREFIX)) return false;
  if (path.includes('\\') || path.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) return false;
  return !FORBIDDEN_CONTENT_PREFIXES.some((p) => path.startsWith(p));
}

/**
 * Path rules for machine PRs.
 * @param {{filename: string, status: string, previous_filename?: string}[]} files changed files of the PR
 * @param {{path: string, mode: string, type: string}[]} tree recursive tree of the merge commit
 * @returns {{path: string, reason: string}[]} violations (empty = allowed)
 */
export function checkMachinePaths(files, tree = []) {
  const violations = [];
  if (!Array.isArray(files) || files.length === 0) violations.push({path: '(none)', reason: 'PR changes no files'});
  if ((files || []).length >= MAX_FILES) violations.push({path: '(many)', reason: `PR changes ${files.length} files or more; the list may be truncated`});
  for (const f of files || []) {
    if (String(f.filename).startsWith('.github/')) violations.push({path: f.filename, reason: 'workflow/CI configuration (.github/**) is never allowed in a machine PR'});
    else if (!isContentPath(f.filename)) violations.push({path: f.filename, reason: 'outside content/** (or in a forbidden content folder)'});
    if (f.previous_filename && !isContentPath(f.previous_filename)) violations.push({path: f.previous_filename, reason: `renamed from outside content/** to ${f.filename}`});
  }
  const changed = new Set((files || []).map((f) => f.filename));
  for (const e of tree || []) {
    if (!e.path?.startsWith(CONTENT_PREFIX)) continue;
    if (e.mode === '120000') violations.push({path: e.path, reason: 'symlink in content/**'});
    else if (e.mode === '160000' || e.type === 'commit') violations.push({path: e.path, reason: 'submodule in content/**'});
    else if (changed.has(e.path) && e.type !== 'blob') violations.push({path: e.path, reason: `unexpected ${e.type} in content/**`});
  }
  return violations;
}

// ---- GitHub REST (only reads) ---------------------------------------------------------------------
function makeApi(token, repo) {
  const base = 'https://api.github.com';
  return async function api(path, {allow404 = false} = {}) {
    const url = path.startsWith('http') ? path : `${base}${path.replace('{repo}', repo)}`;
    const r = await fetch(url, {headers: {accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(token ? {authorization: `Bearer ${token}`} : {})}});
    if (allow404 && r.status === 404) return {status: 404, data: null, link: ''};
    if (!r.ok) throw new Error(`GitHub API ${r.status} for ${url.replace(base, '')}`);
    return {status: r.status, data: await r.json(), link: r.headers.get('link') || ''};
  };
}

async function paginate(api, path, max) {
  const out = [];
  let next = `${path}${path.includes('?') ? '&' : '?'}per_page=100`;
  while (next && out.length < max) {
    const {data, link} = await api(next);
    out.push(...data);
    next = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1] || null;
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function materializeContent(api, tree, workspace) {
  const target = resolve(workspace, 'content');
  rmSync(target, {recursive: true, force: true});
  const blobs = tree.filter((e) => e.type === 'blob' && e.path.startsWith(CONTENT_PREFIX));
  if (blobs.length > MAX_CONTENT_FILES) throw new Error(`content/** has ${blobs.length} files (limit ${MAX_CONTENT_FILES})`);
  let total = 0;
  for (const e of blobs) {
    if (!isContentPath(e.path) && !FORBIDDEN_CONTENT_PREFIXES.some((p) => e.path.startsWith(p))) throw new Error(`unsafe path ${e.path}`);
    const abs = resolve(workspace, ...e.path.split('/'));
    if (!abs.startsWith(target + sep)) throw new Error(`path escapes content/: ${e.path}`);
    total += e.size || 0;
    if (total > MAX_CONTENT_BYTES) throw new Error('content/** is larger than 20 MB');
    const {data} = await api(`/repos/{repo}/git/blobs/${e.sha}`);
    mkdirSync(dirname(abs), {recursive: true});
    writeFileSync(abs, Buffer.from(data.content, data.encoding === 'base64' ? 'base64' : 'utf8'));
  }
  return blobs.length;
}

/** Environment for base tools that process untrusted PR content: no GITHUB_TOKEN, no ACTIONS_* / GITHUB_* variables. */
export function toolEnv(env = process.env) {
  const out = {CI: 'true'};
  for (const k of ['PATH', 'HOME', 'LANG', 'TMPDIR', 'SystemRoot', 'TEMP', 'TMP']) if (env[k]) out[k] = env[k];
  return out;
}

export function runBaseTool(workspace, args) {
  const r = spawnSync(process.execPath, args, {cwd: workspace, env: toolEnv(), encoding: 'utf8', timeout: 5 * 60 * 1000});
  return {ok: r.status === 0, output: `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-15).join('\n')};
}

/**
 * @param {Record<string, string|undefined>} env
 * @param {{api?: (path: string, opts?: {allow404?: boolean}) => Promise<{status: number, data: any, link: string}>, log?: (text: string) => void, runTool?: typeof runBaseTool}} [deps]
 *   injectable for tests (a fake GitHub API, a silent log, a tool runner); production uses the REST API, console.log and runBaseTool.
 * @returns {Promise<0|1>} exit code
 */
export async function main(env = process.env, {api: injectedApi, log = console.log, runTool = runBaseTool} = {}) {
  const repo = env.GITHUB_REPOSITORY;
  const number = Number(env.PR_NUMBER);
  const workspace = resolve(env.GITHUB_WORKSPACE || process.cwd());
  if (!repo || !number) throw new Error('GITHUB_REPOSITORY and PR_NUMBER are required');
  const api = injectedApi || makeApi(env.GITHUB_TOKEN, repo);
  const ownerLogin = repo.split('/')[0];
  const lines = [`## content-guard — PR #${number}`];
  const done = (ok, text) => {
    lines.push('', text);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
    log(lines.join('\n'));
    return ok ? 0 : 1;
  };

  const headSha = env.HEAD_SHA || '';
  const pinFailure = (problems) => done(false, ['Stav PR neodpovídá commitu, pro který se check spustil (spusťte znovu):', ...problems.map((p) => `- ${p}`)].join('\n'));
  // Wait until GitHub reports the triggering head and has recomputed mergeability (test merge) for it.
  let pr = (await api(`/repos/{repo}/pulls/${number}`)).data;
  for (let i = 0; i < 20 && pr.head?.sha === headSha && pr.mergeable === null; i++) { await sleep(3000); pr = (await api(`/repos/{repo}/pulls/${number}`)).data; }
  const perm = await api(`/repos/{repo}/collaborators/${encodeURIComponent(pr.user.login)}/permission`, {allow404: true});
  const commits = await paginate(api, `/repos/{repo}/pulls/${number}/commits`, MAX_PR_COMMITS);
  const headProblems = checkPinnedHead({headSha, pr, commits});
  if (headProblems.length) return pinFailure(headProblems);
  const keys = (await api(`/users/${ownerLogin}/ssh_signing_keys?per_page=100`, {allow404: true})).data || [];
  const verdict = classifyPr({pr, authorPermission: perm.data?.permission || 'none', commits, ownerLogin, ownerSigningKeys: keys.map((k) => k.key)});
  lines.push(`- Klasifikace: **${verdict.kind === 'human' ? 'lidský' : 'strojový'}** (${verdict.kind})`);
  for (const r of verdict.reasons) lines.push(`  - ${r}`);

  if (verdict.kind === 'human') return done(true, 'Lidský PR: hranice cest se neuplatní, build a testy hlídá `web-checks`.');

  if (pr.mergeable === false || !pr.merge_commit_sha) return done(false, 'Strojový PR nejde sloučit s aktuální `procelyx-live` (konflikt nebo chybí merge ref).');
  const mergeCommit = (await api(`/repos/{repo}/git/commits/${pr.merge_commit_sha}`)).data;
  const mergeProblems = checkPinnedHead({headSha, pr, mergeCommit});
  if (mergeProblems.length) return pinFailure(mergeProblems);
  const files = await paginate(api, `/repos/{repo}/pulls/${number}/files`, MAX_FILES);
  // The file list is read live: make sure no push happened while the merge commit was being checked.
  const prAfter = (await api(`/repos/{repo}/pulls/${number}`)).data;
  if (prAfter.head?.sha !== headSha) return pinFailure(checkPinnedHead({headSha, pr: prAfter}));
  const treeResp = (await api(`/repos/{repo}/git/trees/${mergeCommit.tree.sha}?recursive=1`)).data;
  if (treeResp.truncated) return done(false, 'Strom merge commitu je příliš velký (truncated), nelze ověřit.');
  const violations = checkMachinePaths(files, treeResp.tree);
  if (violations.length) return done(false, ['Strojový PR smí měnit jen `content/**`. Porušení:', ...violations.map((v) => `- \`${v.path}\`: ${v.reason}`)].join('\n'));

  const manifest = join(workspace, 'content/manifest.json');
  const baseHasManifest = existsSync(manifest);
  // Keep the base branch content: validate-content --base allows only editable slots (T2/T3) to differ.
  // The copy MUST be taken before materializeContent overwrites content/ with the PR's version.
  const baseCopy = mkdtempSync(join(tmpdir(), 'content-guard-base-'));
  try {
    if (existsSync(join(workspace, 'content'))) cpSync(join(workspace, 'content'), join(baseCopy, 'content'), {recursive: true});
    const count = await materializeContent(api, treeResp.tree, workspace);
    lines.push(`- \`content/**\` z \`refs/pull/${number}/merge\` načten jako data (${count} souborů).`);
    const steps = [];
    const hasValidator = existsSync(join(workspace, 'tools/validate-content.mjs'));
    // Once content is data (content/manifest.json, W0c), strict validation is mandatory: never fail open.
    if (!hasValidator && (baseHasManifest || existsSync(manifest))) return done(false, 'Obsah má `content/manifest.json`, ale základní větev nemá `tools/validate-content.mjs`; bez validace se strojový obsah nepustí.');
    if (hasValidator) steps.push(['validate-content', ['tools/validate-content.mjs', ...(existsSync(join(baseCopy, 'content')) ? ['--base', baseCopy] : [])]]);
    steps.push(['build', ['tools/build.mjs']], ['check', ['tools/check-site.mjs']]);
    for (const [name, args] of steps) {
      const r = runTool(workspace, args);
      lines.push(`- ${name} (nástroje ze základní větve): ${r.ok ? 'OK' : 'CHYBA'}`);
      if (!r.ok) return done(false, '```\n' + r.output + '\n```');
    }
    return done(true, 'Strojový PR mění jen `content/**` a obsah prošel validací, buildem i kontrolou.');
  } finally {
    rmSync(baseCopy, {recursive: true, force: true});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (err) => { console.error(`content-guard: ${err.message}`); process.exit(1); });
}
