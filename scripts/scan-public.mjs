#!/usr/bin/env node
// Public-repository scan: secrets, private e-mails/phones, message IDs, internal URLs and local paths.
//
//   node scripts/scan-public.mjs                 scan the working tree (git ls-files, or a plain walk outside git)
//   node scripts/scan-public.mjs --commits       also scan every commit's author/committer and message (git log --all)
//   ... --commits --rev <spec> [--rev <spec>]    scan only the commits of these revision specs (e.g. base..head)
//   node scripts/scan-public.mjs --dir <path>    scan another directory
//
// Exit code 1 on any finding. A finding means STOP: nothing may be pushed until it is removed or,
// when the value is public on purpose, added to the allowlist below with a reason.
import {execFileSync} from 'node:child_process';
import {readFileSync, readdirSync, statSync, existsSync} from 'node:fs';
import {join, relative, sep, extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const args = process.argv.slice(2);
const dirArg = args.indexOf('--dir');
const root = resolve(dirArg >= 0 ? args[dirArg + 1] : process.cwd());
const scanCommits = args.includes('--commits');
// Revision specs for --commits; without any, every ref is scanned (git log --all).
const revSpecs = args.flatMap((a, i) => (a === '--rev' && args[i + 1] ? [args[i + 1]] : []));

// ---- allowlists (values that are public on purpose) ----------------------------------------
// Public contact addresses shown on procelyx.cz (and aliases of the same public mailbox).
const PUBLIC_EMAILS = new Set([
  'jarda.vojtasek@procelyx.cz', 'info@procelyx.cz', 'jarda@procelyx.cz', 'web@procelyx.cz', 'info+web@procelyx.cz',
  'noreply@anthropic.com',
]);
// Placeholder / test domains (RFC 2606 and obviously fake one-letter domains used in tests).
const TEST_EMAIL_DOMAIN = /@(example\.(com|cz|org|net)|x\.cz|b\.cz)$/i;
// GitHub noreply addresses of users and of GitHub Apps / bots (e.g. 123+nexus-one-publisher[bot]@...).
const GITHUB_NOREPLY = /^\d+\+[A-Za-z0-9-]+(\[bot\])?@users\.noreply\.github\.com$/;
// Microsoft Bookings page ID that is part of the public booking link on procelyx.cz.
const PUBLIC_BOOKING_ID = /^[0-9a-f]{32}@arkance\.world$/;
const PUBLIC_PHONES = new Set(['+420724796243', '+420000000000']);
// Hosts that are already linked publicly from procelyx.cz.
const PUBLIC_HOSTS = new Set(['nexus-one-production.up.railway.app']);
// Files that legitimately talk about localhost (local dev guards, tests).
const LOCALHOST_OK = [/^src\//, /^tests\//, /^tools\/e2e-nexus\.mjs$/];
// The W0c migration snapshot holds page text with collapsed whitespace, which glues the contact labels to
// the address ("Emailjarda…@procelyx.czTelefon"). Only there, and only for these exact labels, the label is
// stripped and the rest must be exactly a public address; "ops-jarda@…" or "…@procelyx.czech" still fail.
const GLUED_TEXT_FILES = new Set(['tests/migration/__snapshots__/texts.json']);
const GLUED_PREFIX = /^(e-?mail|kontakt|contact)/;
const GLUED_SUFFIX = /(telefon|phone)$/;
export function isGluedPublicEmail(file, lower) {
  if (!GLUED_TEXT_FILES.has(file)) return false;
  const stripped = lower.replace(GLUED_PREFIX, '').replace(GLUED_SUFFIX, '');
  return stripped !== lower && PUBLIC_EMAILS.has(stripped);
}
// The scanner and its own test contain the patterns themselves.
const SELF = new Set(['scripts/scan-public.mjs', 'tests/scan-public.test.js']);

const SECRET_RULES = [
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['github-token', /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/],
  ['api-key-sk', /\bsk-(ant-|proj-|or-)?[A-Za-z0-9_-]{20,}/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}/],
  ['resend-key', /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/],
  ['slack-token', /\bxox[abpr]-[A-Za-z0-9-]{10,}/],
  ['aws-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['telegram-bot-token', /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['secret-assignment', /\b(secret|token|password|passwd|api[_-]?key|private[_-]?key)["']?\s*[:=]\s*["'`](?![^"'`]*(\$\{|<|…|\.\.\.))[A-Za-z0-9+/_=-]{24,}["'`]/i],
  ['connection-string', /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis):\/\/[^\s:"']+:[^\s@"']+@/i],
];
const MESSAGE_ID_RULES = [
  ['gmail-message-id', /@mail\.gmail\.com\b/i],
  ['message-id', /\b(gmail|message|thread)[ _-]?id\b[^\n]{0,12}\b[0-9a-f]{16}\b/i],
];
const LOCAL_PATH_RULES = [
  ['windows-path', /(^|[^A-Za-z0-9])[A-Z]:[\\/][A-Za-z]/],
  ['user-home-path', /(\/Users\/|\/home\/)[a-z][A-Za-z0-9._-]+\//],
];
const INTERNAL_URL_RULES = [
  ['railway-url', /\b([a-z0-9-]+\.)+(up\.)?railway\.(app|internal)\b/gi],
  ['internal-host', /\b[a-z0-9-]+\.internal\b/gi],
  ['script-project-url', /script\.google\.com\/(u\/\d+\/)?home\/projects\//i],
  ['localhost', /\b(localhost|127\.0\.0\.1)\b/i],
];

const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.jsonc', '.md', '.html', '.css', '.txt', '.xml', '.yml', '.yaml', '.gs', '.svg', '.vcf', '.webmanifest', '.toml', '']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.webp', '.png', '.avif', '.tif', '.tiff']);
const findings = [];
// Findings are printed to CI logs (public for a public repo): never echo a full secret, e-mail or phone.
export function maskSample(rule, sample) {
  const text = String(sample);
  if (rule === 'email' || rule === 'commit-email') return text.replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@/g, '$1***@');
  if (rule === 'phone') return text.slice(0, 7) + '***';
  if (/key|token|secret|jwt|password|connection/.test(rule)) return text.slice(0, 6) + '…(' + text.length + ' chars)';
  return text.slice(0, 80);
}
const add = (file, line, rule, sample) => findings.push({file, line, rule, sample: maskSample(rule, sample)});

function listFiles() {
  if (existsSync(join(root, '.git'))) {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {encoding: 'utf8'});
    return out.split('\0').filter(Boolean);
  }
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', '.git', '.wrangler'].includes(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p); else files.push(relative(root, p).split(sep).join('/'));
    }
  };
  walk(root);
  return files;
}

export function scanText(file, text, report = add) {
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const n = i + 1;
    for (const [rule, re] of SECRET_RULES) {
      const m = line.match(re);
      if (!m) continue;
      // Obvious test fixtures (tests/** with a value that says so) are not secrets.
      if (rule === 'secret-assignment' && file.startsWith('tests/') && /(test|fake|dummy|example)/i.test(m[0])) continue;
      report(file, n, rule, m[0]);
    }
    for (const [rule, re] of MESSAGE_ID_RULES) { const m = line.match(re); if (m) report(file, n, rule, m[0]); }
    for (const [rule, re] of LOCAL_PATH_RULES) { const m = line.match(re); if (m) report(file, n, rule, m[0].trim()); }
    for (const [rule, re] of INTERNAL_URL_RULES) {
      for (const m of line.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) {
        const host = m[0].toLowerCase();
        if (PUBLIC_HOSTS.has(host)) continue;
        if (rule === 'localhost' && LOCALHOST_OK.some((r) => r.test(file))) continue;
        report(file, n, rule, m[0]);
      }
    }
    for (const m of line.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) {
      const email = m[0];
      const lower = email.toLowerCase();
      if (PUBLIC_EMAILS.has(lower) || GITHUB_NOREPLY.test(email) || PUBLIC_BOOKING_ID.test(lower)) continue;
      if (isGluedPublicEmail(file, lower)) continue;
      if (TEST_EMAIL_DOMAIN.test(lower) && (file.startsWith('tests/') || file.startsWith('src/') || file.startsWith('tools/'))) continue;
      if (/\.(webp|jpe?g|png|svg|avif)$/i.test(email)) continue; // e.g. "image@2x.png"
      report(file, n, 'email', email);
    }
    for (const m of line.matchAll(/\+420[  ]?\d{3}[  ]?\d{3}[  ]?\d{3}/g)) {
      if (!PUBLIC_PHONES.has(m[0].replace(/[  ]/g, ''))) report(file, n, 'phone', m[0]);
    }
  });
}

async function scanImage(file, abs) {
  let sharp;
  try { sharp = (await import('sharp')).default; } catch { return; }
  try {
    const meta = await sharp(abs).metadata();
    if (meta.exif) {
      const exif = meta.exif.toString('latin1');
      // GPS IFD tag 0x8825 in either byte order, or explicit GPS strings.
      if (exif.includes('\x88\x25') || exif.includes('\x25\x88') || /GPS/i.test(exif)) add(file, 0, 'image-gps-exif', 'EXIF contains GPS data');
      else add(file, 0, 'image-exif', 'EXIF metadata present (strip before publishing)');
    }
    if (meta.xmp && /(GPS|Latitude|Longitude|creator|Author)/i.test(meta.xmp.toString('utf8'))) add(file, 0, 'image-xmp', 'XMP with location or author');
  } catch {
    // unreadable image — not a text leak; build/check handles broken assets
  }
}

/** Commit author/committer e-mails allowed in a public history: GitHub noreply (users, Apps, bots) and web-flow. */
export function isAllowedCommitEmail(email) {
  return GITHUB_NOREPLY.test(String(email)) || email === 'noreply@github.com';
}

function scanCommitMetadata() {
  const seen = new Set();
  const logs = (revSpecs.length ? revSpecs : ['--all']).map((rev) =>
    execFileSync('git', ['-C', root, 'log', rev, '--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x1e', '--'], {encoding: 'utf8'}));
  for (const rec of logs.join('\x1e').split('\x1e').map((r) => r.trim()).filter(Boolean)) {
    const [sha, an, ae, cn, ce, body] = rec.split('\0');
    if (seen.has(sha)) continue;
    seen.add(sha);
    for (const [who, email] of [[an, ae], [cn, ce]]) {
      if (!isAllowedCommitEmail(email)) add(`commit ${sha.slice(0, 8)}`, 0, 'commit-email', `${who} <${email}>`);
    }
    scanText(`commit ${sha.slice(0, 8)} message`, body || '');
  }
}

async function main() {
  const files = listFiles();
  for (const file of files) {
    if (SELF.has(file) || file === 'package-lock.json') continue;
    const abs = join(root, file);
    if (!existsSync(abs)) continue;
    const ext = extname(file).toLowerCase();
    if (IMAGE_EXT.has(ext)) { await scanImage(file, abs); continue; }
    if (!TEXT_EXT.has(ext)) continue;
    scanText(file, readFileSync(abs, 'utf8'));
    if (/^\.env|\.pem$|\.key$|\.p12$|\.dev\.vars/.test(file.split('/').pop())) add(file, 0, 'secret-file', file);
  }
  if (scanCommits) scanCommitMetadata();
  if (findings.length) {
    console.error(`scan-public: ${findings.length} finding(s) — STOP, nothing may be published:`);
    for (const f of findings) console.error(`  ${f.file}${f.line ? ':' + f.line : ''}  [${f.rule}]  ${f.sample}`);
    process.exit(1);
  }
  console.log(`scan-public: OK (${files.length} files${scanCommits ? ' + commit metadata' : ''})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
