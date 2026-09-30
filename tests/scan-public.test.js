import test from 'node:test';
import assert from 'node:assert/strict';
import {scanText, maskSample, isAllowedCommitEmail} from '../scripts/scan-public.mjs';

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
