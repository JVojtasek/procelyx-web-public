import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {forwardLeadToNexus, deliverOrQueue, nextDelayMs, QUEUE_TTL_S} from '../src/nexus.js';
import {WEBSITE_KEY, SECRET, NEXUS_URL, fakeKV, baseEnv, captureLogs} from './nexus-helpers.js';

const KEY = '5c2f8d41-7aa6-4d5a-83cc-346c85fb3449';
const BODY = JSON.stringify({type: 'WEB_FORM', idempotencyKey: KEY, payload: {name: 'Jan Tajný', email: 'tajny@example.com', message: 'Tajná zpráva'}});
const NOW = Date.UTC(2026, 8, 30, 10, 0, 0);
const MIN = 60_000, HOUR = 3_600_000;
// Never resolves; rejects only when the request signal aborts (AbortSignal.timeout). The ref'd timer keeps
// the event loop alive because Node's AbortSignal.timeout timer is unref'd.
const hanging = (url, init) => new Promise((_, reject) => { const keepAlive = setTimeout(() => {}, 10_000); init.signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(init.signal.reason); }); });
const respond = (status, body = {ok: true}) => async () => Response.json(body, {status});

test('nextDelayMs: exponential from 5 min capped at 6 h; slow retries wait at least 1 h', () => {
  assert.equal(nextDelayMs(1, false), 5 * MIN);
  assert.equal(nextDelayMs(2, false), 10 * MIN);
  assert.equal(nextDelayMs(3, false), 20 * MIN);
  assert.equal(nextDelayMs(20, false), 6 * HOUR);
  assert.equal(nextDelayMs(1, true), HOUR);
  assert.equal(nextDelayMs(6, true), 160 * MIN);
  assert.equal(nextDelayMs(30, true), 6 * HOUR);
});

test('forwardLeadToNexus posts the exact body with website, timestamp (seconds) and verifiable signature', async () => {
  let seen;
  const result = await forwardLeadToNexus(baseEnv(), BODY, KEY, {now: () => NOW, fetchImpl: async (url, init) => { seen = {url, init}; return Response.json({ok: true, leadId: 'x'}, {status: 202}); }});
  assert.equal(result, 'ok');
  assert.equal(seen.url, NEXUS_URL);
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.body, BODY);
  assert.equal(seen.init.headers['Content-Type'], 'application/json');
  assert.equal(seen.init.headers['X-Nexus-Website'], WEBSITE_KEY);
  const ts = seen.init.headers['X-Nexus-Timestamp'];
  assert.equal(ts, String(Math.floor(NOW / 1000)));
  assert.equal(seen.init.headers['X-Nexus-Signature'], 'v1=' + createHmac('sha256', SECRET).update(`${ts}.${BODY}`).digest('hex'));
  assert.ok(seen.init.signal instanceof AbortSignal);
});

test('forwardLeadToNexus never throws: network error and hanging fetch (timeout) are retries', async () => {
  assert.equal(await forwardLeadToNexus(baseEnv(), BODY, KEY, {fetchImpl: async () => { throw new TypeError('fetch failed'); }}), 'retry');
  assert.equal(await forwardLeadToNexus(baseEnv(), BODY, KEY, {fetchImpl: hanging, timeoutMs: 20}), 'retry');
});

test('deliverOrQueue: 202 and 200 duplicate write nothing to KV', async () => {
  for (const send of [respond(202, {ok: true, leadId: 'l1'}), respond(200, {ok: true, leadId: 'l1', duplicate: true})]) {
    const env = baseEnv();
    assert.equal(await deliverOrQueue(env, BODY, KEY, {fetchImpl: send, now: () => NOW}), 'ok');
    assert.equal(env.NEXUS_QUEUE.calls.put.length, 0);
  }
});

test('deliverOrQueue: 500 queues q:<key> with attempts 1, nextAt +5 min and the same values in metadata', async () => {
  const env = baseEnv();
  assert.equal(await deliverOrQueue(env, BODY, KEY, {fetchImpl: respond(500), now: () => NOW}), 'retry');
  const [put] = env.NEXUS_QUEUE.calls.put;
  assert.equal(put.key, 'q:' + KEY);
  const entry = JSON.parse(put.value);
  assert.deepEqual(entry, {v: 1, body: BODY, attempts: 1, nextAt: NOW + 5 * MIN, firstAt: NOW});
  assert.deepEqual(put.options.metadata, {nextAt: NOW + 5 * MIN, attempts: 1, firstAt: NOW});
  assert.equal(put.options.expirationTtl, QUEUE_TTL_S);
});

test('deliverOrQueue: 429, network error and timeout are queued', async () => {
  for (const [fetchImpl, timeoutMs] of [[respond(429)], [async () => { throw new Error('ECONNREFUSED'); }], [hanging, 20]]) {
    const env = baseEnv();
    assert.equal(await deliverOrQueue(env, BODY, KEY, {fetchImpl, timeoutMs, now: () => NOW}), 'retry');
    assert.ok(env.NEXUS_QUEUE.store.has('q:' + KEY));
  }
});

test('deliverOrQueue: 401 and 403 are queued with at least 1 h delay (retry_slow)', async () => {
  for (const status of [401, 403]) {
    const env = baseEnv();
    assert.equal(await deliverOrQueue(env, BODY, KEY, {fetchImpl: respond(status, {error: 'x'}), now: () => NOW}), 'retry_slow');
    const entry = JSON.parse(env.NEXUS_QUEUE.store.get('q:' + KEY).value);
    assert.ok(entry.nextAt - NOW >= HOUR);
    assert.equal(env.NEXUS_QUEUE.store.get('q:' + KEY).metadata.nextAt, entry.nextAt);
  }
});

test('deliverOrQueue: 422 and 413 go to dead:<key> for 7 days, never to q:', async () => {
  for (const status of [413, 422]) {
    const env = baseEnv();
    assert.equal(await deliverOrQueue(env, BODY, KEY, {fetchImpl: respond(status, {error: 'validation_failed'}), now: () => NOW}), 'dead');
    const kv = env.NEXUS_QUEUE;
    assert.ok(!kv.store.has('q:' + KEY));
    const dead = kv.store.get('dead:' + KEY);
    assert.ok(dead);
    assert.equal(JSON.parse(dead.value).body, BODY);
    assert.deepEqual(dead.metadata, {reason: 'rejected', status, at: NOW, attempts: 1, firstAt: NOW});
    assert.equal(dead.expirationTtl, 7 * 24 * 3600);
  }
});

test('deliverOrQueue never throws when KV put fails', async () => {
  const env = baseEnv({NEXUS_QUEUE: fakeKV({failPut: true})});
  const {result, text} = await captureLogs(() => deliverOrQueue(env, BODY, KEY, {fetchImpl: respond(503), now: () => NOW}));
  assert.equal(result, 'retry');
  assert.ok(text.includes('nexus_queue_failed'));
});

test('logs never contain personal data from the body', async () => {
  const scenarios = [respond(202), respond(500), respond(401), respond(422), async () => { throw new Error('boom tajny@example.com'); }];
  for (const fetchImpl of scenarios) {
    const {lines, text} = await captureLogs(() => deliverOrQueue(baseEnv(), BODY, KEY, {fetchImpl, now: () => NOW}));
    assert.ok(lines.length >= 1);
    for (const secret of ['tajny@example.com', 'Jan Tajný', 'Tajná zpráva', SECRET]) assert.ok(!text.includes(secret), text);
    assert.ok(text.includes('nexus_forward'));
  }
});
