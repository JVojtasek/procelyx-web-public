import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac, timingSafeEqual} from 'node:crypto';
import {drainNexusQueue, deliverOrQueue, requeueDeadEntries, QUEUE_TTL_S, MAX_RETENTION_S} from '../src/nexus.js';
import {PRIVACY_PROCESSING_HTML} from '../src/privacy.js';
import worker from '../src/index.js';
import {SECRET, WEBSITE_KEY, fakeKV, baseEnv, captureLogs} from './nexus-helpers.js';

const NOW = Date.UTC(2026, 8, 30, 10, 0, 0);
const MIN = 60_000, HOUR = 3_600_000;
const uuid = i => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const bodyFor = key => JSON.stringify({type: 'WEB_FORM', idempotencyKey: key, payload: {name: 'Jan Tajný', email: 'tajny@example.com', message: 'Tajná zpráva'}});

// Seeds q:<key> exactly as deliverOrQueue stores it.
async function seed(kv, key, {nextAt = NOW - MIN, attempts = 1, firstAt = NOW - 10 * MIN, metadata = true} = {}) {
  await kv.put('q:' + key, JSON.stringify({v: 1, body: bodyFor(key), attempts, nextAt, firstAt}), {expirationTtl: 3600, metadata: metadata ? {nextAt, attempts, firstAt} : undefined});
  kv.calls.put.length = 0;
}
function nexusFake(status = 202) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push(init); return Response.json({ok: status < 300}, {status: typeof status === 'function' ? status(calls.length) : status}); };
  return {calls, fetchImpl};
}
// Minimal copy of Nexus verifyInboundSignature (window 300 s, timingSafeEqual).
function nexusVerify(headers, rawBody, nowMs) {
  const ts = headers['X-Nexus-Timestamp'], sig = headers['X-Nexus-Signature'];
  if (!/^\d{1,12}$/.test(ts) || !/^v1=[0-9a-f]{64}$/.test(sig)) return false;
  if (Math.abs(Math.floor(nowMs / 1000) - Number(ts)) > 300) return false;
  const expected = createHmac('sha256', SECRET).update(`${ts}.${rawBody}`).digest();
  return headers['X-Nexus-Website'] === WEBSITE_KEY && timingSafeEqual(expected, Buffer.from(sig.slice(3), 'hex'));
}

test('only due entries are sent; not-due entries are decided from list metadata without get()', async () => {
  const env = baseEnv(); const kv = env.NEXUS_QUEUE;
  await seed(kv, uuid(1));
  await seed(kv, uuid(2), {nextAt: NOW + 10 * MIN});
  const {calls, fetchImpl} = nexusFake(202);
  const summary = await drainNexusQueue(env, {fetchImpl, now: () => NOW});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body, bodyFor(uuid(1)));
  assert.deepEqual(kv.calls.get, ['q:' + uuid(1)]);
  assert.ok(!kv.store.has('q:' + uuid(1)), 'delivered entry is deleted');
  assert.ok(kv.store.has('q:' + uuid(2)));
  assert.equal(summary.sent, 1); assert.equal(summary.skipped, 1); assert.equal(summary.queued, 2);
});

test('pages through list() with the cursor: a due entry on the second page is sent', async () => {
  const env = baseEnv(); const kv = env.NEXUS_QUEUE;
  for (let i = 1; i <= 149; i++) await seed(kv, uuid(i), {nextAt: NOW + HOUR});
  await seed(kv, uuid(150));
  const {calls, fetchImpl} = nexusFake(202);
  const summary = await drainNexusQueue(env, {fetchImpl, now: () => NOW});
  assert.equal(kv.calls.list.length, 2);
  assert.equal(kv.calls.list[1].cursor, '100');
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].body).idempotencyKey, uuid(150));
  assert.equal(kv.calls.get.length, 1);
  assert.equal(summary.queued, 150);
});

test('503 requeues with attempts+1 and a later nextAt in both the value and the metadata', async () => {
  const env = baseEnv(); const kv = env.NEXUS_QUEUE;
  await seed(kv, uuid(1), {attempts: 2});
  const {fetchImpl} = nexusFake(503);
  const summary = await drainNexusQueue(env, {fetchImpl, now: () => NOW});
  const stored = kv.store.get('q:' + uuid(1));
  const entry = JSON.parse(stored.value);
  assert.equal(entry.attempts, 3);
  assert.equal(entry.nextAt, NOW + 20 * MIN);
  assert.equal(entry.body, bodyFor(uuid(1)));
  assert.deepEqual(stored.metadata, {nextAt: NOW + 20 * MIN, attempts: 3, firstAt: NOW - 10 * MIN});
  assert.equal(summary.requeued, 1);
});

test('after a 24 h outage the retry is re-signed with a new timestamp and the same body and passes a 300 s verifier', async () => {
  const env = baseEnv(); const kv = env.NEXUS_QUEUE; const key = uuid(7);
  const first = nexusFake(500);
  await deliverOrQueue(env, bodyFor(key), key, {fetchImpl: first.fetchImpl, now: () => NOW});
  const later = NOW + 24 * HOUR;
  const second = nexusFake(202);
  await drainNexusQueue(env, {fetchImpl: second.fetchImpl, now: () => later});
  assert.equal(second.calls.length, 1);
  const [a, b] = [first.calls[0], second.calls[0]];
  assert.equal(b.body, a.body);
  assert.notEqual(b.headers['X-Nexus-Timestamp'], a.headers['X-Nexus-Timestamp']);
  assert.equal(nexusVerify(a.headers, a.body, later), false, 'the original signature is stale after 24 h');
  assert.equal(nexusVerify(b.headers, b.body, later), true);
  assert.equal(kv.store.size, 0);
});

test('422 moves the entry to dead:<key>', async () => {
  const env = baseEnv(); const kv = env.NEXUS_QUEUE;
  await seed(kv, uuid(1));
  const summary = await drainNexusQueue(env, {fetchImpl: nexusFake(422).fetchImpl, now: () => NOW});
  assert.ok(!kv.store.has('q:' + uuid(1)));
  const dead = kv.store.get('dead:' + uuid(1));
  assert.equal(JSON.parse(dead.value).body, bodyFor(uuid(1)));
  assert.equal(dead.metadata.reason, 'rejected'); assert.equal(dead.metadata.status, 422);
  assert.equal(summary.dead, 1);
});

test('an entry close to the queue TTL is moved to dead:<key> with reason expired, not dropped and not sent', async () => {
  const env = baseEnv(); const kv = env.NEXUS_QUEUE;
  await seed(kv, uuid(1), {firstAt: NOW - (QUEUE_TTL_S - 3600 + 1) * 1000});
  const {calls, fetchImpl} = nexusFake(202);
  const summary = await drainNexusQueue(env, {fetchImpl, now: () => NOW});
  assert.equal(calls.length, 0);
  assert.ok(!kv.store.has('q:' + uuid(1)));
  const dead = kv.store.get('dead:' + uuid(1));
  assert.equal(dead.metadata.reason, 'expired');
  assert.equal(JSON.parse(dead.value).body, bodyFor(uuid(1)));
  assert.equal(summary.dead, 1);
});

test('an expiring entry is moved to dead: even when its next retry is not due yet', async () => {
  const env = baseEnv(); const kv = env.NEXUS_QUEUE;
  await seed(kv, uuid(1), {firstAt: NOW - (QUEUE_TTL_S - 1800) * 1000, nextAt: NOW + 5 * HOUR, attempts: 12});
  const {calls, fetchImpl} = nexusFake(202);
  await drainNexusQueue(env, {fetchImpl, now: () => NOW});
  assert.equal(calls.length, 0);
  assert.ok(!kv.store.has('q:' + uuid(1)));
  assert.equal(kv.store.get('dead:' + uuid(1)).metadata.reason, 'expired');
});

test('dead: entries never outlive the retention stated on privacy.html (counted from firstAt)', async () => {
  assert.equal(MAX_RETENTION_S, 14 * 24 * 3600);
  assert.ok(PRIVACY_PROCESSING_HTML.includes(`nejdéle ${MAX_RETENTION_S / 86400} dní`), 'privacy text must state the same maximum');
  // expired: moved in the last hour of the queue TTL
  const env = baseEnv(); const kv = env.NEXUS_QUEUE;
  const expiredFirstAt = NOW - (QUEUE_TTL_S - 1800) * 1000;
  await seed(kv, uuid(1), {firstAt: expiredFirstAt});
  // rejected late: 422 after 6.5 days of retries
  const lateFirstAt = NOW - Math.floor(6.5 * 24) * HOUR;
  await seed(kv, uuid(2), {firstAt: lateFirstAt});
  await drainNexusQueue(env, {fetchImpl: nexusFake(422).fetchImpl, now: () => NOW});
  for (const [i, firstAt] of [[1, expiredFirstAt], [2, lateFirstAt]]) {
    const dead = kv.store.get('dead:' + uuid(i));
    assert.ok(dead, 'dead:' + i);
    assert.ok(dead.expirationTtl >= 60);
    assert.ok((NOW - firstAt) / 1000 + dead.expirationTtl <= MAX_RETENTION_S, `dead:${i} TTL ${dead.expirationTtl} exceeds the stated maximum`);
  }
  // an immediate rejection keeps the full 7 days for a manual replay
  const env2 = baseEnv();
  await deliverOrQueue(env2, bodyFor(uuid(3)), uuid(3), {fetchImpl: nexusFake(422).fetchImpl, now: () => NOW});
  assert.equal(env2.NEXUS_QUEUE.store.get('dead:' + uuid(3)).expirationTtl, 7 * 24 * 3600);
});

test('maxPerRun limits delivery attempts per run', async () => {
  const env = baseEnv(); const kv = env.NEXUS_QUEUE;
  for (let i = 1; i <= 30; i++) await seed(kv, uuid(i));
  const {calls, fetchImpl} = nexusFake(202);
  await drainNexusQueue(env, {fetchImpl, now: () => NOW, maxPerRun: 5});
  assert.equal(calls.length, 5);
  assert.equal([...kv.store.keys()].length, 25);
  const second = nexusFake(202);
  await drainNexusQueue(env, {fetchImpl: second.fetchImpl, now: () => NOW});
  assert.equal(second.calls.length, 20);
});

test('entries without metadata (older format) are read once with get()', async () => {
  const env = baseEnv(); const kv = env.NEXUS_QUEUE;
  await seed(kv, uuid(1), {metadata: false});
  await seed(kv, uuid(2), {metadata: false, nextAt: NOW + HOUR});
  const {calls, fetchImpl} = nexusFake(202);
  await drainNexusQueue(env, {fetchImpl, now: () => NOW});
  assert.equal(calls.length, 1);
  assert.deepEqual(kv.calls.get.sort(), ['q:' + uuid(1), 'q:' + uuid(2)]);
});

test('one summary log with oldestAgeH and no personal data; queue older than 48 h logs nexus_queue_stale', async () => {
  const env = baseEnv(); const kv = env.NEXUS_QUEUE;
  await seed(kv, uuid(1), {nextAt: NOW + HOUR, firstAt: NOW - 50 * HOUR});
  await seed(kv, uuid(2));
  const {result, text, lines} = await captureLogs(() => drainNexusQueue(env, {fetchImpl: nexusFake(500).fetchImpl, now: () => NOW}));
  assert.equal(result.oldestAgeH, 50);
  const summary = lines.filter(l => l.startsWith('nexus_drain'));
  assert.equal(summary.length, 1);
  assert.match(summary[0], /"oldestAgeH":50/);
  assert.ok(text.includes('nexus_queue_stale'));
  for (const secret of ['tajny@example.com', 'Jan Tajný', 'Tajná zpráva', SECRET]) assert.ok(!text.includes(secret));
  const fresh = baseEnv(); await seed(fresh.NEXUS_QUEUE, uuid(3));
  const quiet = await captureLogs(() => drainNexusQueue(fresh, {fetchImpl: nexusFake(202).fetchImpl, now: () => NOW}));
  assert.ok(!quiet.text.includes('nexus_queue_stale'));
});

test('a failing KV item does not stop the drain and nothing throws', async () => {
  const env = baseEnv(); const kv = env.NEXUS_QUEUE;
  await seed(kv, uuid(1)); await seed(kv, uuid(2));
  const originalGet = kv.get;
  kv.get = async key => { if (key === 'q:' + uuid(1)) throw new Error('kv'); return originalGet.call(kv, key); };
  const {calls, fetchImpl} = nexusFake(202);
  await drainNexusQueue(env, {fetchImpl, now: () => NOW});
  assert.equal(calls.length, 1);
});

test('scheduled() drains only when forwarding is configured', async () => {
  const waited = [];
  const ctx = {waitUntil: p => waited.push(p)};
  await worker.scheduled({cron: '*/5 * * * *'}, {}, ctx);
  await worker.scheduled({cron: '*/5 * * * *'}, baseEnv({NEXUS_ENABLED: 'false'}), ctx);
  assert.equal(waited.length, 0);
  const env = baseEnv();
  await worker.scheduled({cron: '*/5 * * * *'}, env, ctx);
  assert.equal(waited.length, 1);
  await Promise.all(waited);
  assert.equal(env.NEXUS_QUEUE.calls.list.length, 1);
});

test('requeueDeadEntries moves dead:<key> back to q:<key> keeping the body, due now, attempts reset', async () => {
  const kv = fakeKV(); const key = uuid(9);
  await kv.put('dead:' + key, JSON.stringify({v: 1, body: bodyFor(key), attempts: 4, firstAt: NOW - 8 * 24 * HOUR, reason: 'expired', status: 0, at: NOW - HOUR}), {metadata: {reason: 'expired'}});
  await kv.put('dead:' + uuid(10), JSON.stringify({v: 1, body: bodyFor(uuid(10)), attempts: 1, firstAt: NOW, reason: 'rejected', status: 422, at: NOW}));
  const moved = await requeueDeadEntries(kv, {keys: [key], now: NOW});
  assert.deepEqual(moved, {moved: 1, missing: 0});
  assert.ok(!kv.store.has('dead:' + key));
  assert.ok(kv.store.has('dead:' + uuid(10)), 'only the selected key is moved');
  const q = kv.store.get('q:' + key);
  assert.deepEqual(JSON.parse(q.value), {v: 1, body: bodyFor(key), attempts: 0, nextAt: NOW, firstAt: NOW});
  assert.deepEqual(q.metadata, {nextAt: NOW, attempts: 0, firstAt: NOW});
  assert.equal(q.expirationTtl, QUEUE_TTL_S);
  assert.deepEqual(await requeueDeadEntries(kv, {all: true, now: NOW}), {moved: 1, missing: 0});
  assert.deepEqual(await requeueDeadEntries(kv, {keys: ['nope'], now: NOW}), {moved: 0, missing: 1});
  assert.equal([...kv.store.keys()].filter(k => k.startsWith('dead:')).length, 0);
});
