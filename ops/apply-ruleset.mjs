#!/usr/bin/env node
// Creates or updates the `procelyx-live` branch ruleset from ops/rulesets/procelyx-live.json (idempotent).
// Uses the local GitHub CLI login (repository admin). Rulesets need a PUBLIC repository on GitHub Free
// (or GitHub Pro for a private one).
//
//   node ops/apply-ruleset.mjs [--repo owner/name] [--dry-run]
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const args = process.argv.slice(2);
const repo = args.includes('--repo') ? args[args.indexOf('--repo') + 1] : 'JVojtasek/procelyx-web-public';
const dryRun = args.includes('--dry-run');
const file = resolve(import.meta.dirname, 'rulesets/procelyx-live.json');
const wanted = JSON.parse(readFileSync(file, 'utf8'));

function gh(apiArgs, input) {
  const r = spawnSync('gh', ['api', ...apiArgs], {encoding: 'utf8', input});
  if (r.status !== 0) throw new Error(`gh api ${apiArgs.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout ? JSON.parse(r.stdout) : null;
}

// Preconditions (order of W0-S): once the ruleset is active, content-guard is a required check and it calls
// every PR "machine" unless all commits are SSH-signed with the owner's registered signing key. Applying the
// ruleset before signing works would turn every non-content PR (including the owner's) red with no allowed
// way through (CLAUDE.md forbids a bypass merge while content-guard is red). So refuse until signing is set up.
const owner = repo.split('/')[0];
const git = (key) => spawnSync('git', ['config', '--get', key], {encoding: 'utf8'}).stdout.trim();
const pre = [];
const signingKeys = gh([`users/${owner}/ssh_signing_keys`]);
if (!Array.isArray(signingKeys) || signingKeys.length === 0) pre.push(`${owner} has no SSH signing key on GitHub (gh auth refresh -s admin:ssh_signing_key; gh ssh-key add <key>.pub --type signing)`);
if (git('gpg.format') !== 'ssh') pre.push('this clone does not sign with SSH (git config gpg.format ssh)');
if (!git('user.signingkey')) pre.push('this clone has no signing key (git config user.signingkey <path to .pub>)');
if (git('commit.gpgsign') !== 'true') pre.push('this clone does not sign commits by default (git config commit.gpgsign true)');
if (pre.length) {
  console.error(`Not applying the ruleset: commit signing is not set up yet.\n- ${pre.join('\n- ')}\nSee CLAUDE.md, section "Stav hranice".`);
  process.exit(1);
}

let rulesets;
try {
  rulesets = gh([`repos/${repo}/rulesets`]);
} catch (err) {
  if (/403|Upgrade to GitHub Pro/.test(err.message)) {
    console.error(`Rulesets are not available on ${repo} (HTTP 403): the repository must be public (GitHub Free) or on GitHub Pro (A1). Nothing applied.`);
    process.exit(1);
  }
  throw err;
}
const existing = rulesets.find((r) => r.name === wanted.name);
console.log(existing ? `Updating ruleset ${existing.id} (${wanted.name}) on ${repo}` : `Creating ruleset ${wanted.name} on ${repo}`);
if (dryRun) process.exit(0);
const saved = existing
  ? gh(['-X', 'PUT', `repos/${repo}/rulesets/${existing.id}`, '--input', '-'], JSON.stringify(wanted))
  : gh(['-X', 'POST', `repos/${repo}/rulesets`, '--input', '-'], JSON.stringify(wanted));

// Verify what GitHub stored (the definition of done of W0-S).
const rules = Object.fromEntries(saved.rules.map((r) => [r.type, r.parameters || {}]));
const checks = (rules.required_status_checks?.required_status_checks || []).map((c) => c.context).sort();
const problems = [];
if (!rules.pull_request?.require_code_owner_review) problems.push('code owner review is not required');
if (!rules.required_status_checks?.strict_required_status_checks_policy) problems.push('status checks are not strict');
if (checks.join() !== 'content-guard,web-checks') problems.push(`required checks are ${checks.join(', ') || 'none'}`);
if (!rules.non_fast_forward || !rules.deletion) problems.push('force push / deletion are not blocked');
const bypass = saved.bypass_actors || [];
if (bypass.length !== 1 || bypass[0].actor_type !== 'RepositoryRole' || bypass[0].actor_id !== 5) problems.push('bypass is not limited to the admin role');
if (problems.length) { console.error('Ruleset stored, but:', problems.join('; ')); process.exit(1); }
console.log(`OK: ruleset ${saved.id} active — code owner review, strict checks (${checks.join(', ')}), no force push/deletion, bypass only admin (${bypass[0].bypass_mode}).`);
