// Forwarding of accepted contact-form inquiries to Nexus One (W2).
// Runs only after the e-mail was accepted, inside ctx.waitUntil, and never changes
// the response to the visitor. Disabled unless NEXUS_ENABLED === 'true'.
// Never log the request body, e-mail, name or any other form content.
import {PRIVACY_NOTICE_TEXT, PRIVACY_VERSION} from './privacy.js';

export const NEXUS_TIMEOUT_MS = 8000;
export const QUEUE_TTL_S = 7 * 24 * 3600;

const WEBSITE_KEY_RE = /^ws_[a-z0-9]{24}$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

export function nexusConfigured(env) {
  if (!env || env.NEXUS_ENABLED !== 'true') return false;
  const kv = env.NEXUS_QUEUE;
  if (!kv || typeof kv.put !== 'function' || typeof kv.get !== 'function' || typeof kv.list !== 'function' || typeof kv.delete !== 'function') return false;
  if (!WEBSITE_KEY_RE.test(env.NEXUS_WEBSITE_KEY || '')) return false;
  if (typeof env.NEXUS_INBOUND_SECRET !== 'string' || env.NEXUS_INBOUND_SECRET.length < 32) return false;
  let url;
  try { url = new URL(env.NEXUS_INBOUND_URL || ''); } catch { return false; }
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname));
}

const orNull = value => (typeof value === 'string' && value.trim() ? value : null);

// Event body for POST /api/public/v1/inbound (see tests/fixtures/worker-event.json).
export function buildLeadEvent(lead, {idempotencyKey, submittedAt}) {
  const utm = {};
  for (const [key, field] of [['source', 'utmSource'], ['medium', 'utmMedium'], ['campaign', 'utmCampaign'], ['content', 'utmContent'], ['term', 'utmTerm']]) {
    if (orNull(lead[field])) utm[key] = lead[field];
  }
  const context = {pageUrl: orNull(lead.page), referrer: orNull(lead.referrer)};
  if (Object.keys(utm).length) context.utm = utm;
  return {
    type: 'WEB_FORM',
    idempotencyKey,
    submittedAt,
    formKey: 'contact',
    payload: {
      name: orNull(lead.name), email: orNull(lead.email), phone: orNull(lead.phone),
      company: orNull(lead.company), message: orNull(lead.message), area: orNull(lead.area)
    },
    context,
    consent: {marketing: false, text: PRIVACY_NOTICE_TEXT, version: PRIVACY_VERSION}
  };
}

const hex = buffer => Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');

// Appendix B: "v1=" + hex(HMAC_SHA256(secret, `${timestampS}.${rawBody}`)).
export async function signNexus(secret, timestampS, rawBody) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return 'v1=' + hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestampS}.${rawBody}`)));
}

// 401/403 are retried slowly: key rotation in progress or the web module may be re-enabled.
export function classifyStatus(status) {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401 || status === 403) return 'retry_slow';
  if (status === 413 || status === 422) return 'dead';
  return 'retry';
}

export const DEAD_TTL_S = 7 * 24 * 3600;
// Upper bound for how long an inquiry body stays in KV, counted from its first attempt (firstAt):
// up to QUEUE_TTL_S in q: plus the rest up to DEAD_TTL_S in dead:. privacy.html states this maximum
// (PRIVACY_PROCESSING_HTML). A manual replay (tools/replay-dead.mjs) starts a new window.
export const MAX_RETENTION_S = QUEUE_TTL_S + DEAD_TTL_S;
const MIN_KV_TTL_S = 60;
const RETRY_BASE_MS = 5 * 60 * 1000;
const RETRY_MAX_MS = 6 * 60 * 60 * 1000;
const SLOW_MIN_MS = 60 * 60 * 1000;

// Log only technical fields (stage, status, counts). Never the body, e-mail or name.
function log(event, data = {}) { console.log(event, data); }
function logError(event, data = {}) { console.error(event, data); }

// attempts = number of failed deliveries so far (1 after the first failure).
export function nextDelayMs(attempts, slow) {
  const delay = Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_MS);
  return slow ? Math.max(SLOW_MIN_MS, delay) : delay;
}

// One delivery attempt with a fresh timestamp and signature. Never throws.
// Returns 'ok' | 'retry' | 'retry_slow' | 'dead' and the HTTP status (0 = network error/timeout).
async function attemptDelivery(env, rawBody, {fetchImpl = fetch, now = Date.now, timeoutMs = NEXUS_TIMEOUT_MS} = {}) {
  try {
    const timestamp = Math.floor(now() / 1000);
    const signature = await signNexus(env.NEXUS_INBOUND_SECRET, timestamp, rawBody);
    const response = await fetchImpl(env.NEXUS_INBOUND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'Accept': 'application/json',
        'X-Nexus-Website': env.NEXUS_WEBSITE_KEY, 'X-Nexus-Timestamp': String(timestamp), 'X-Nexus-Signature': signature
      },
      body: rawBody,
      signal: AbortSignal.timeout(timeoutMs)
    });
    // Drain the body so the connection can be reused; its content is not needed.
    await response.arrayBuffer().catch(() => {});
    return {result: classifyStatus(response.status), status: response.status};
  } catch (error) {
    return {result: 'retry', status: 0, timeout: error?.name === 'TimeoutError' || error?.name === 'AbortError'};
  }
}

export async function forwardLeadToNexus(env, rawBody, idempotencyKey, options = {}) {
  return (await attemptDelivery(env, rawBody, options)).result;
}

function remainingTtlS(firstAt, nowMs) {
  return Math.max(MIN_KV_TTL_S, QUEUE_TTL_S - Math.floor((nowMs - firstAt) / 1000));
}

async function enqueue(env, key, entry, nowMs) {
  await env.NEXUS_QUEUE.put('q:' + key, JSON.stringify({v: 1, body: entry.body, attempts: entry.attempts, nextAt: entry.nextAt, firstAt: entry.firstAt}), {
    expirationTtl: remainingTtlS(entry.firstAt, nowMs),
    // Metadata lets the drain decide what is due from list() alone, without get().
    metadata: {nextAt: entry.nextAt, attempts: entry.attempts, firstAt: entry.firstAt}
  });
}

// Dead letters keep DEAD_TTL_S for a manual replay, but never past MAX_RETENTION_S since firstAt.
function deadTtlS(firstAt, nowMs) {
  const ageS = Number.isFinite(firstAt) ? Math.max(0, Math.floor((nowMs - firstAt) / 1000)) : 0;
  return Math.max(MIN_KV_TTL_S, Math.min(DEAD_TTL_S, MAX_RETENTION_S - ageS));
}

async function putDead(env, key, entry, {reason, status, at}) {
  await env.NEXUS_QUEUE.put('dead:' + key, JSON.stringify({v: 1, body: entry.body, attempts: entry.attempts, firstAt: entry.firstAt, reason, status, at}), {
    expirationTtl: deadTtlS(entry.firstAt, at),
    metadata: {reason, status, at, attempts: entry.attempts, firstAt: entry.firstAt}
  });
}

// First delivery right after the e-mail was accepted. Failures are stored in the KV outbox
// (q:<key>) for the scheduled drain, or in dead:<key> when Nexus rejects the event permanently.
export async function deliverOrQueue(env, rawBody, idempotencyKey, {fetchImpl = fetch, now = Date.now, attempts = 0, firstAt, timeoutMs} = {}) {
  const {result, status, timeout} = await attemptDelivery(env, rawBody, {fetchImpl, now, timeoutMs});
  const tried = attempts + 1;
  log('nexus_forward', {stage: 'nexus_forward', status, attempts: tried, result, ...(timeout ? {timeout: true} : {})});
  if (result === 'ok') return result;
  const nowMs = now();
  const entry = {body: rawBody, attempts: tried, firstAt: firstAt ?? nowMs};
  try {
    if (result === 'dead') await putDead(env, idempotencyKey, entry, {reason: 'rejected', status, at: nowMs});
    else await enqueue(env, idempotencyKey, {...entry, nextAt: nowMs + nextDelayMs(tried, result === 'retry_slow')}, nowMs);
  } catch {
    logError('nexus_queue_failed', {stage: 'nexus_queue', result});
  }
  return result;
}

const EXPIRE_MARGIN_MS = 60 * 60 * 1000;
const STALE_QUEUE_H = 48;

function parseEntry(raw) {
  try {
    const entry = JSON.parse(raw);
    return entry && typeof entry.body === 'string' ? entry : null;
  } catch { return null; }
}

// Scheduled retry of the KV outbox. Due entries are decided from list() metadata; only due
// entries are read with get(). Each retry is re-signed with a new timestamp, same body and key.
export async function drainNexusQueue(env, {fetchImpl = fetch, now = Date.now, maxPerRun = 20, maxListPages = 10, timeoutMs} = {}) {
  const kv = env.NEXUS_QUEUE;
  const summary = {sent: 0, requeued: 0, dead: 0, skipped: 0, queued: 0, oldestAgeH: 0};
  const nowMs = now();
  let attempted = 0, oldestFirstAt = null, cursor, pages = 0;
  const track = firstAt => { if (Number.isFinite(firstAt) && (oldestFirstAt === null || firstAt < oldestFirstAt)) oldestFirstAt = firstAt; };
  try {
    do {
      const page = await kv.list({prefix: 'q:', limit: 100, ...(cursor ? {cursor} : {})});
      pages++;
      cursor = page.list_complete ? undefined : page.cursor;
      for (const {name, metadata} of page.keys) {
        summary.queued++;
        try {
          let entry = null;
          let meta = metadata && Number.isFinite(metadata.nextAt) ? metadata : null;
          if (!meta) {
            entry = parseEntry(await kv.get(name));
            if (!entry) continue;
            meta = {nextAt: entry.nextAt, attempts: entry.attempts, firstAt: entry.firstAt};
          }
          track(meta.firstAt);
          // Entries in their last hour before the KV TTL are moved to dead: even when not due yet,
          // so a long backoff can never let an inquiry expire silently.
          const expiring = Number.isFinite(meta.firstAt) && nowMs - meta.firstAt > QUEUE_TTL_S * 1000 - EXPIRE_MARGIN_MS;
          if (!expiring && (meta.nextAt > nowMs || attempted >= maxPerRun)) { summary.skipped++; continue; }
          entry = entry || parseEntry(await kv.get(name));
          if (!entry) continue;
          const key = name.slice(2);
          const firstAt = Number.isFinite(entry.firstAt) ? entry.firstAt : nowMs;
          const attempts = Number.isFinite(entry.attempts) ? entry.attempts : 0;
          if (nowMs - firstAt > QUEUE_TTL_S * 1000 - EXPIRE_MARGIN_MS) {
            await putDead(env, key, {body: entry.body, attempts, firstAt}, {reason: 'expired', status: 0, at: nowMs});
            await kv.delete(name);
            summary.dead++;
            continue;
          }
          attempted++;
          const {result, status} = await attemptDelivery(env, entry.body, {fetchImpl, now, timeoutMs});
          if (result === 'ok') {
            await kv.delete(name);
            summary.sent++;
          } else if (result === 'dead') {
            await putDead(env, key, {body: entry.body, attempts: attempts + 1, firstAt}, {reason: 'rejected', status, at: nowMs});
            await kv.delete(name);
            summary.dead++;
          } else {
            const tried = attempts + 1;
            await enqueue(env, key, {body: entry.body, attempts: tried, firstAt, nextAt: nowMs + nextDelayMs(tried, result === 'retry_slow')}, nowMs);
            summary.requeued++;
          }
        } catch {
          logError('nexus_drain_item_failed', {stage: 'nexus_drain'});
        }
      }
    } while (cursor && pages < maxListPages);
  } catch {
    logError('nexus_drain_failed', {stage: 'nexus_drain'});
  }
  summary.oldestAgeH = oldestFirstAt === null ? 0 : Math.round((nowMs - oldestFirstAt) / 360_000) / 10;
  log('nexus_drain', {stage: 'nexus_drain', queued: summary.queued, sent: summary.sent, requeued: summary.requeued, dead: summary.dead, oldestAgeH: summary.oldestAgeH});
  if (summary.oldestAgeH > STALE_QUEUE_H) console.warn('nexus_queue_stale', {stage: 'nexus_drain', oldestAgeH: summary.oldestAgeH, queued: summary.queued});
  return summary;
}

// Manual replay after a fix (tools/replay-dead.mjs): moves dead:<key> back to q:<key>,
// due now, attempts reset, with a fresh queue TTL. The body is moved unchanged and never logged.
export async function requeueDeadEntries(kv, {keys = [], all = false, now = Date.now()} = {}) {
  let names = keys.map(k => (k.startsWith('dead:') ? k : 'dead:' + k));
  if (all) {
    names = [];
    let cursor;
    do {
      const page = await kv.list({prefix: 'dead:', limit: 1000, ...(cursor ? {cursor} : {})});
      names.push(...page.keys.map(k => k.name));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  }
  const result = {moved: 0, missing: 0};
  for (const name of names) {
    const entry = parseEntry(await kv.get(name));
    if (!entry) { result.missing++; continue; }
    await enqueue({NEXUS_QUEUE: kv}, name.slice('dead:'.length), {body: entry.body, attempts: 0, nextAt: now, firstAt: now}, now);
    await kv.delete(name);
    result.moved++;
  }
  return result;
}
