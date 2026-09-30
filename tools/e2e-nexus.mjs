// Local end-to-end harness: Worker contact handler -> local Nexus One (NOT part of `npm test`).
//
// Runs the real handleContact / drainNexusQueue against a Nexus One dev server on localhost
// (normally started on a temporary Neon branch, see the Nexus plan A-19). No real e-mail is sent
// (the mail provider is faked) and the KV queue is an in-memory Map. Prints only PASS/FAIL lines,
// never the secret or form data.
//
//   E2E_SECRET_OUT=<file>            file written by the Nexus e2e script: JSON {"websiteKey","secret"}
//                                    (also accepted: "inboundSecret", or KEY=VALUE lines with
//                                    NEXUS_WEBSITE_KEY / NEXUS_INBOUND_SECRET)
//   NEXUS_E2E_URL=http://localhost:3001   optional, local Nexus One origin (localhost/127.0.0.1 only)
//   E2E_MODULE_OFF_CMD / E2E_MODULE_ON_CMD optional shell commands that disable / restore the "web"
//                                    module of the test organisation for scenario 5 (skipped without them)
//
//   node tools/e2e-nexus.mjs
//
// Scenarios: 1 delivery (202) · 2 same submissionId (200 duplicate) · 3 outage -> KV queue -> drain
// delivers · 4 outage longer than the 300 s signature window -> re-signed retry passes · 5 module
// disabled -> 403 stays in q: (retry_slow, not dead) -> module restored -> drain delivers.
import {readFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {handleContact} from '../src/contact.js';
import {drainNexusQueue} from '../src/nexus.js';

const origin = process.env.NEXUS_E2E_URL || 'http://localhost:3001';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) { console.error('NEXUS_E2E_URL must be a local http://localhost:<port> origin.'); process.exit(2); }
const INBOUND = origin + '/api/public/v1/inbound';
const DOWN = 'http://localhost:3999/api/public/v1/inbound';

function readSecrets(path) {
  if (!path) { console.error('Set E2E_SECRET_OUT to the file written by the Nexus e2e script.'); process.exit(2); }
  const raw = readFileSync(path, 'utf8').trim();
  let websiteKey, secret;
  try {
    const j = JSON.parse(raw);
    websiteKey = j.websiteKey ?? j.NEXUS_WEBSITE_KEY; secret = j.secret ?? j.inboundSecret ?? j.NEXUS_INBOUND_SECRET;
  } catch {
    for (const line of raw.split(/\r?\n/)) {
      const [k, ...rest] = line.split('='); const v = rest.join('=').trim();
      if (/^(NEXUS_WEBSITE_KEY|websiteKey)$/.test(k.trim())) websiteKey = v;
      if (/^(NEXUS_INBOUND_SECRET|secret|inboundSecret)$/.test(k.trim())) secret = v;
    }
  }
  if (!/^ws_[a-z0-9]{24}$/.test(websiteKey || '') || !secret || secret.length < 32) { console.error('E2E_SECRET_OUT does not contain a valid websiteKey and secret.'); process.exit(2); }
  return {websiteKey, secret};
}
const {websiteKey, secret} = readSecrets(process.env.E2E_SECRET_OUT);

function memoryKV() {
  const store = new Map();
  return {
    store,
    async put(key, value, options = {}) { store.set(key, {value, metadata: options.metadata ?? null}); },
    async get(key) { return store.get(key)?.value ?? null; },
    async delete(key) { store.delete(key); },
    async list({prefix = '', limit = 1000, cursor} = {}) {
      const names = [...store.keys()].filter(k => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0, done = start + limit >= names.length;
      return {keys: names.slice(start, start + limit).map(name => ({name, metadata: store.get(name).metadata})), list_complete: done, ...(done ? {} : {cursor: String(start + limit)})};
    },
    keys(prefix) { return [...store.keys()].filter(k => k.startsWith(prefix)); },
    // Simulates time passing for queued entries (the signature always uses the real clock).
    ageBy(ms) {
      for (const [key, item] of store) {
        const entry = JSON.parse(item.value);
        entry.nextAt -= ms; entry.firstAt -= ms;
        store.set(key, {value: JSON.stringify(entry), metadata: item.metadata && {...item.metadata, nextAt: item.metadata.nextAt - ms, firstAt: item.metadata.firstAt - ms}});
      }
    }
  };
}

const nexusStatuses = [];
// Local Nexus calls go to the real network; everything else (the mail provider) is faked.
async function send(url, init) {
  if (/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(String(url))) {
    try { const r = await fetch(url, init); nexusStatuses.push(r.status); return r; }
    catch (e) { nexusStatuses.push(0); throw e; }
  }
  return Response.json({id: 'e2e-fake-mail'});
}

function makeEnv(kv, url = INBOUND) {
  return {
    CONTACT_PROVIDER: 'resend', RESEND_API_KEY: 'e2e-fake', CONTACT_TO: 'e2e@example.com', CONTACT_FROM: 'E2E <e2e@example.com>',
    CONTACT_RATE_LIMITER: {limit: async () => ({success: true})},
    NEXUS_ENABLED: 'true', NEXUS_INBOUND_URL: url, NEXUS_WEBSITE_KEY: websiteKey, NEXUS_INBOUND_SECRET: secret, NEXUS_QUEUE: kv
  };
}
function contactRequest(submissionId, n) {
  return new Request('https://procelyx.cz/api/contact', {
    method: 'POST', headers: {origin: 'https://procelyx.cz', 'content-type': 'application/json'},
    body: JSON.stringify({name: 'E2E Harness', email: `e2e-harness-${n}@example.com`, company: 'TEST 1B harness – ignorovat',
      message: 'TEST 1B – ignorovat. Automatický test přeposílání z webu do Nexus One.', page: 'https://procelyx.cz/', submissionId,
      utmSource: 'e2e', utmMedium: 'harness', utmCampaign: '1b-web-leads'})
  });
}
async function submit(env, submissionId, n) {
  const waits = [];
  const response = await handleContact(contactRequest(submissionId, n), env, send, {waitUntil: p => waits.push(p)});
  const body = await response.json();
  await Promise.all(waits);
  return {status: response.status, ok: body.ok === true, scheduled: waits.length};
}
const last = () => nexusStatuses[nexusStatuses.length - 1];

let failed = 0;
async function scenario(name, fn) {
  try { await fn(); console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '-', e.message); }
}
function expect(cond, what) { if (!cond) throw new Error(what); }

const id1 = randomUUID();
await scenario('1 Nexus running: visitor 200, Nexus 202', async () => {
  const kv = memoryKV();
  const r = await submit(makeEnv(kv), id1, 1);
  expect(r.status === 200 && r.ok && r.scheduled === 1, `visitor response ${r.status}`);
  expect(last() === 202, `Nexus status ${last()}`);
  expect(kv.store.size === 0, 'KV must stay empty');
});

await scenario('2 same submissionId again: Nexus 200 duplicate', async () => {
  const kv = memoryKV();
  const r = await submit(makeEnv(kv), id1, 1);
  expect(r.status === 200 && r.ok, `visitor response ${r.status}`);
  expect(last() === 200, `Nexus status ${last()} (expected 200 duplicate)`);
  expect(kv.store.size === 0, 'KV must stay empty');
});

await scenario('3 outage: visitor 200, event queued; after recovery the drain delivers it', async () => {
  const kv = memoryKV(); const id = randomUUID();
  const r = await submit(makeEnv(kv, DOWN), id, 3);
  expect(r.status === 200 && r.ok, `visitor response ${r.status}`);
  expect(kv.keys('q:').length === 1 && kv.store.has('q:' + id), 'event must be in q:');
  kv.ageBy(6 * 60_000);
  const s = await drainNexusQueue(makeEnv(kv), {fetchImpl: send});
  expect(s.sent === 1 && last() === 202, `drain sent ${s.sent}, Nexus status ${last()}`);
  expect(kv.store.size === 0, 'KV must be empty after delivery');
});

await scenario('4 outage longer than 300 s: re-signed retry is accepted (not 401)', async () => {
  const kv = memoryKV(); const id = randomUUID();
  await submit(makeEnv(kv, DOWN), id, 4);
  expect(kv.store.has('q:' + id), 'event must be in q:');
  kv.ageBy(60 * 60_000);
  const s = await drainNexusQueue(makeEnv(kv), {fetchImpl: send});
  expect(s.sent === 1 && last() === 202, `drain sent ${s.sent}, Nexus status ${last()}`);
  expect(kv.store.size === 0, 'KV must be empty after delivery');
});

const off = process.env.E2E_MODULE_OFF_CMD, on = process.env.E2E_MODULE_ON_CMD;
if (!off || !on) console.log('SKIP 5 module disabled (set E2E_MODULE_OFF_CMD and E2E_MODULE_ON_CMD)');
else await scenario('5 module disabled: 403 stays in q: (retry_slow, not dead); after restore the drain delivers', async () => {
  const kv = memoryKV(); const id = randomUUID();
  execSync(off, {stdio: 'ignore'});
  try {
    const r = await submit(makeEnv(kv), id, 5);
    expect(r.status === 200 && r.ok, `visitor response ${r.status}`);
    expect(last() === 403, `Nexus status ${last()} (expected 403)`);
    expect(kv.store.has('q:' + id) && kv.keys('dead:').length === 0, 'event must be in q:, not dead:');
    const entry = JSON.parse(kv.store.get('q:' + id).value);
    expect(entry.nextAt - Date.now() >= 59 * 60_000, '403 must wait at least 1 h');
  } finally {
    execSync(on, {stdio: 'ignore'});
  }
  kv.ageBy(60 * 60_000);
  const s = await drainNexusQueue(makeEnv(kv), {fetchImpl: send});
  expect(s.sent === 1 && last() === 202, `drain sent ${s.sent}, Nexus status ${last()}`);
  expect(kv.store.size === 0, 'KV must be empty after delivery');
});

console.log(failed ? `${failed} scenario(s) failed` : 'All scenarios passed');
process.exit(failed ? 1 : 0);
