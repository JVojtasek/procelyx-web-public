import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {nexusConfigured, buildLeadEvent, signNexus, classifyStatus, NEXUS_TIMEOUT_MS, QUEUE_TTL_S} from '../src/nexus.js';
import {PRIVACY_VERSION, PRIVACY_VERSION_LABEL, PRIVACY_NOTICE_TEXT, PRIVACY_PROCESSING_HTML} from '../src/privacy.js';
import {normalizeLead} from '../src/contact.js';

const fixture = name => readFile(new URL('./fixtures/' + name, import.meta.url), 'utf8').then(JSON.parse);
import {WEBSITE_KEY, SECRET, baseEnv} from './nexus-helpers.js';
// Normalized lead (output of normalizeLead) with optional marketing context fields.
const fixtureLead = {company:'Test firma',name:'Test uživatel',email:'customer@example.com',phone:'+420 000 000 000',area:'Provoz',message:'Potřebujeme zlepšit předávání práce.',page:'https://procelyx.cz/',website:'',submissionId:'5c2f8d41-7aa6-4d5a-83cc-346c85fb3449',utmSource:'linkedin',utmMedium:'social',utmCampaign:'audit-2026',referrer:'https://www.google.com/'};

test('B-1 constants', () => {
  assert.equal(NEXUS_TIMEOUT_MS, 8000);
  assert.equal(QUEUE_TTL_S, 7 * 24 * 3600);
});

test('signNexus matches node:crypto HMAC-SHA256 over "<ts>.<body>" with v1= prefix (Appendix B)', async () => {
  const body = JSON.stringify({type: 'WEB_FORM', idempotencyKey: '5c2f8d41-7aa6-4d5a-83cc-346c85fb3449', payload: {name: 'Jiří'}});
  const ts = 1790000000;
  const expected = 'v1=' + createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');
  assert.equal(await signNexus(SECRET, ts, body), expected);
  assert.match(await signNexus(SECRET, ts, body), /^v1=[0-9a-f]{64}$/);
  assert.notEqual(await signNexus(SECRET, ts + 1, body), expected);
});

test('signNexus matches the fixed vector shared with Nexus One (src/lib/web/signature.test.ts)', async () => {
  assert.equal(await signNexus('nexus-test-secret-0123456789abcdef0123456789abcdef', 1790000000, '{"type":"WEB_FORM"}'), 'v1=cae4716cd77d74112f63be3a4015ced7045ed534dff000a3c68e369ed395d062');
});

// worker-event.json is the canonical event: Nexus One keeps a byte-identical copy in
// src/lib/web/__fixtures__/worker-event.json and validates it with InboundEventSchema/toLeadRow.
test('buildLeadEvent produces exactly the shared worker-event.json fixture', async () => {
  const lead = fixtureLead;
  const event = buildLeadEvent(lead, {idempotencyKey: lead.submissionId, submittedAt: '2026-09-30T08:15:00.000Z'});
  assert.deepEqual(event, await fixture('worker-event.json'));
  assert.equal(event.consent.version, PRIVACY_VERSION);
  assert.equal(event.consent.text, PRIVACY_NOTICE_TEXT);
  assert.equal(event.consent.marketing, false);
});

test('buildLeadEvent maps empty optional fields to null and omits empty context values', () => {
  const lead = normalizeLead({name:'Test kontakt',email:'customer@example.com',message:'Zpráva'});
  const event = buildLeadEvent(lead, {idempotencyKey: '5c2f8d41-7aa6-4d5a-83cc-346c85fb3449', submittedAt: '2026-09-30T08:15:00.000Z'});
  assert.deepEqual(event.payload, {name:'Test kontakt',email:'customer@example.com',phone:null,company:null,message:'Zpráva',area:null});
  assert.deepEqual(event.context, {pageUrl:'https://procelyx.cz/',referrer:null});
  assert.equal(event.formKey, 'contact');
  assert.equal(event.type, 'WEB_FORM');
});

test('nexusConfigured requires NEXUS_ENABLED=true, KV, key format, long secret and https (http only on localhost)', () => {
  assert.equal(nexusConfigured(baseEnv()), true);
  assert.equal(nexusConfigured({}), false);
  assert.equal(nexusConfigured({...baseEnv(), NEXUS_ENABLED: 'false'}), false);
  assert.equal(nexusConfigured({...baseEnv(), NEXUS_ENABLED: undefined}), false);
  assert.equal(nexusConfigured({...baseEnv(), NEXUS_QUEUE: undefined}), false);
  assert.equal(nexusConfigured({...baseEnv(), NEXUS_INBOUND_SECRET: 'short'}), false);
  assert.equal(nexusConfigured({...baseEnv(), NEXUS_INBOUND_SECRET: undefined}), false);
  assert.equal(nexusConfigured({...baseEnv(), NEXUS_WEBSITE_KEY: 'ws_…'}), false);
  assert.equal(nexusConfigured({...baseEnv(), NEXUS_WEBSITE_KEY: 'ws_ABCDEFGHIJKLMNOPQRSTUVWX'}), false);
  assert.equal(nexusConfigured({...baseEnv(), NEXUS_INBOUND_URL: 'http://nexus.example.com/api/public/v1/inbound'}), false);
  assert.equal(nexusConfigured({...baseEnv(), NEXUS_INBOUND_URL: 'not a url'}), false);
  assert.equal(nexusConfigured({...baseEnv(), NEXUS_INBOUND_URL: ''}), false);
  assert.equal(nexusConfigured({...baseEnv(), NEXUS_INBOUND_URL: 'http://localhost:3001/api/public/v1/inbound'}), true);
  assert.equal(nexusConfigured({...baseEnv(), NEXUS_INBOUND_URL: 'http://127.0.0.1:3001/api/public/v1/inbound'}), true);
});

test('classifyStatus table', () => {
  for (const s of [200, 201, 202, 204]) assert.equal(classifyStatus(s), 'ok');
  for (const s of [401, 403]) assert.equal(classifyStatus(s), 'retry_slow');
  for (const s of [413, 422]) assert.equal(classifyStatus(s), 'dead');
  for (const s of [0, 400, 404, 405, 408, 429, 500, 502, 503, 504]) assert.equal(classifyStatus(s), 'retry');
});

test('privacy version in events equals the version on generated privacy.html', async () => {
  const html = await readFile(new URL('../public/privacy.html', import.meta.url), 'utf8');
  assert.ok(html.includes('Verze ze dne ' + PRIVACY_VERSION_LABEL), 'privacy.html must show PRIVACY_VERSION_LABEL — run node tools/legal-pages.mjs');
  assert.ok(html.includes(PRIVACY_PROCESSING_HTML), 'privacy.html must contain PRIVACY_PROCESSING_HTML — run node tools/legal-pages.mjs');
  assert.ok(!html.includes('nepředává je do CRM ani veřejnému AI modelu'));
  const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(index.includes(PRIVACY_NOTICE_TEXT), 'form notice must equal consent.text');
});

test('boundary e-mails: Worker accepts exactly what Nexus expects (worker-email-cases.json is shared with Nexus One)', async () => {
  const cases = await fixture('worker-email-cases.json');
  // Copy of Nexus InboundEventSchema LENIENT_EMAIL (src/lib/web/inbound-schema.ts).
  const LENIENT_EMAIL = /^[^\s@<>"\x00-\x1f\x7f]+@[^\s@<>"\x00-\x1f\x7f]+$/;
  const base = {name:'Test',message:'Zpráva',submissionId:'5c2f8d41-7aa6-4d5a-83cc-346c85fb3449'};
  assert.ok(cases.valid.length && cases.lenientButInvalid.length && cases.rejected.length);
  // valid: Nexus stores them lowercased (valid[].stored); the Worker forwards the input unchanged.
  for (const email of [...cases.valid.map(c => c.input), ...cases.lenientButInvalid]) {
    const lead = normalizeLead({...base, email});
    assert.ok(lead, 'worker must accept ' + JSON.stringify(email));
    const event = buildLeadEvent(lead, {idempotencyKey: base.submissionId, submittedAt: '2026-09-30T08:15:00.000Z'});
    assert.equal(event.payload.email, email);
    assert.match(event.payload.email, LENIENT_EMAIL, 'Nexus must accept ' + email);
  }
  // Worker-only extra cases: the Worker stays stricter than the shared list (Nexus may accept some of them).
  const workerOnly = ['a@b.cz\nx', 'a<b@x.cz', 'a@b', '"a"@x.cz'];
  for (const email of [...cases.rejected, ...workerOnly]) assert.equal(normalizeLead({...base, email}), null, 'worker must reject ' + JSON.stringify(email));
});
