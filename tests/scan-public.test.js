import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {scanText, maskSample, isAllowedCommitEmail, isLegacyCommitEmailFinding, matchesLegacyCommitEmailFingerprint, scanCommitRecord} from '../scripts/scan-public.mjs';

const scan = (file, text) => { const out = []; scanText(file, text, (f, line, rule, sample) => out.push({f, line, rule, sample})); return out; };
const rules = (file, text) => scan(file, text).map((x) => x.rule);

test('secrets are reported', () => {
  assert.deepEqual(rules('src/a.js', 'const k = "ghp_' + 'A'.repeat(36) + '";'), ['github-token']);
  assert.deepEqual(rules('public/a.js', 'x = "sk-ant-' + 'b'.repeat(30) + '"'), ['api-key-sk']);
  assert.deepEqual(rules('README.md', '-----BEGIN OPENSSH ' + 'PRIVATE KEY-----'), ['private-key']);
  assert.deepEqual(rules('src/a.js', 'const password = "' + 'Zx9'.repeat(10) + '";'), ['secret-assignment']);
  assert.deepEqual(rules('tests/a.test.js', "const secret='test-only-shared-secret-not-for-production';"), []);
});

test('private e-mails, phones, message IDs, internal URLs and local paths are reported', () => {
  assert.deepEqual(rules('ADMIN_RUNBOOK.md', 'účet jan.novak@firma.cz'), ['email']);
  assert.deepEqual(rules('public/index.html', 'tel +420 777 123 456'), ['phone']);
  // Synthetic values only: no real mailbox IDs or machine paths in the public repo.
  assert.deepEqual(rules('docs.md', 'Gmail ID `0123456789abcdef`'), ['message-id']);
  assert.deepEqual(rules('docs.md', 'https://api-internal.up.railway.app/x'), ['railway-url']);
  assert.deepEqual(rules('docs.md', 'cd C:' + String.fromCharCode(92) + 'Users'), ['windows-path']);
  assert.deepEqual(rules('public/app.js', 'fetch("http://localhost:3001")'), ['localhost']);
});

test('public contacts and allowed hosts pass', () => {
  assert.deepEqual(rules('public/index.html', 'mailto:jarda.vojtasek@procelyx.cz +420 724 796 243'), []);
  assert.deepEqual(rules('public/index.html', 'https://nexus-one-production.up.railway.app/discovery/start'), []);
  assert.deepEqual(rules('tests/a.test.js', 'customer@example.com http://localhost:3001'), []);
  assert.deepEqual(rules('src/nexus.js', "new Set(['localhost', '127.0.0.1'])"), []);
  assert.deepEqual(rules('public/index.html', 'https://procelyx.cz/images/a.webp'), []);
});

test('addresses that only contain a public address are still reported', () => {
  for (const email of ['ops-jarda@procelyx.cz', 'sales-info@procelyx.cz', 'ops-jarda.vojtasek@procelyx.cz', 'adminjarda.vojtasek@procelyx.cz', 'jarda.vojtasek@procelyx.czech']) {
    assert.deepEqual(rules('public/x.html', email), ['email'], email);
    assert.deepEqual(rules('content/i18n/cs.json', email), ['email'], email);
    assert.deepEqual(rules('tests/migration/__snapshots__/texts.json', email), ['email'], email);
  }
  // Labels glued to the address are tolerated only in the migration snapshot with collapsed whitespace.
  const glued = '"Emailjarda.vojtasek@procelyx.czTelefon+420 724 796 243 Contactjarda.vojtasek@procelyx.cz"';
  assert.deepEqual(rules('tests/migration/__snapshots__/texts.json', glued), []);
  assert.deepEqual(rules('public/x.html', glued), ['email', 'email']);
  assert.deepEqual(rules('tests/migration/__snapshots__/texts.json', 'Emailops-jarda@procelyx.czTelefon'), ['email']);
});

test('commit e-mails: GitHub noreply of users, Apps and bots pass; private addresses do not', () => {
  assert.ok(isAllowedCommitEmail('183314933+JVojtasek@users.noreply.github.com'));
  assert.ok(isAllowedCommitEmail('123456+nexus-one-publisher[bot]@users.noreply.github.com'));
  assert.ok(isAllowedCommitEmail('49699333+dependabot[bot]@users.noreply.github.com'));
  assert.ok(isAllowedCommitEmail('41898282+github-actions[bot]@users.noreply.github.com'));
  assert.ok(isAllowedCommitEmail('noreply@github.com'));
  assert.ok(!isAllowedCommitEmail('jan.novak@firma.cz'));
  assert.ok(!isAllowedCommitEmail('nexus-one-publisher[bot]@users.noreply.github.com'));
  assert.ok(!isAllowedCommitEmail('1+evil[bot]x@users.noreply.github.com'));
});

test('printed findings never contain the full secret, e-mail or phone', () => {
  assert.equal(maskSample('commit-email', 'Jan <jan.novak@firma.cz>'), 'Jan <j***@firma.cz>');
  assert.equal(maskSample('phone', '+420 777 123 456'), '+420 77***');
  const token = 'ghp_' + 'A'.repeat(36);
  assert.ok(!maskSample('github-token', token).includes(token.slice(6)));
});

test('the historical waiver matches only its full commit SHA, author field and exact address fingerprint', () => {
  const sha='1d912681ca6dca80fe069d22a3a6137b9e626d6e',digest='5473a5134b018d189fa88885433100658e15e944be11de01116d3d6660ce3495';
  assert.ok(matchesLegacyCommitEmailFingerprint(sha,'author_email',digest));
  assert.ok(!matchesLegacyCommitEmailFingerprint('0'.repeat(40),'author_email',digest));
  assert.ok(!matchesLegacyCommitEmailFingerprint(sha.slice(0,8),'author_email',digest));
  assert.ok(!matchesLegacyCommitEmailFingerprint(sha,'committer_email',digest));
  assert.ok(!matchesLegacyCommitEmailFingerprint(sha,'author_email','0'.repeat(64)));
  assert.ok(!isLegacyCommitEmailFinding(sha,'author_email','other@example.com'));
  assert.deepEqual(rules('public/page.html','jan.novak@firma.cz'),['email']);
  const findings=[];
  scanCommitRecord({sha,an:'Owner',ae:'noreply@github.com',cn:'GitHub',ce:'noreply@github.com',body:'token ghp_'+'Z'.repeat(36)},(_file,_line,rule)=>findings.push(rule),()=>{});
  assert.deepEqual(findings,['github-token']);
});

test('real historical metadata is waived without exempting new commits, committers, tree or message leaks', t => {
  const sha='1d912681ca6dca80fe069d22a3a6137b9e626d6e';
  // Read the immutable historical metadata; never write its address into public source or logs.
  let email;
  try { email=execFileSync('git',['-C',fileURLToPath(new URL('../',import.meta.url)),'show','-s','--format=%ae',sha],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim(); }
  catch { t.skip('Historical commit is unavailable in this shallow checkout; exact fingerprint guards are tested independently. CI fetches the full history.'); return; }
  assert.ok(isLegacyCommitEmailFinding(sha,'author_email',email));
  assert.ok(!isAllowedCommitEmail(email),'the historical address must not become globally allowed');
  assert.ok(!isLegacyCommitEmailFinding('0'.repeat(40),'author_email',email),'new commits still fail');
  assert.ok(!isLegacyCommitEmailFinding(sha.slice(0,8),'author_email',email),'short commit IDs cannot match');
  assert.ok(!isLegacyCommitEmailFinding(sha,'committer_email',email),'the committer is not waived');
  assert.ok(!isLegacyCommitEmailFinding(sha,'author_email','other@example.com'),'a changed address is not waived');

  const record={sha,an:'Historical owner',ae:email,cn:'GitHub',ce:'noreply@github.com',body:'Ordinary message'};
  const check=(patch={})=>{
    const findings=[],warnings=[];
    scanCommitRecord({...record,...patch},(_file,_line,rule)=>findings.push(rule),message=>warnings.push(message));
    return {findings,warnings};
  };
  const historical=check();
  assert.deepEqual(historical.findings,[]);
  assert.equal(historical.warnings.length,1);
  assert.ok(!historical.warnings[0].includes(email));
  assert.deepEqual(check({sha:'0'.repeat(40)}).findings,['commit-email']);
  assert.deepEqual(check({ce:email}).findings,['commit-email']);
  assert.deepEqual(check({ae:'other@example.com'}).findings,['commit-email']);
  assert.deepEqual(check({body:'token ghp_'+'Z'.repeat(36)}).findings,['github-token']);
  assert.deepEqual(check({body:'Contact '+email}).findings,['email']);
  assert.deepEqual(rules('public/page.html',email),['email'],'public tree remains fully scanned');
});
