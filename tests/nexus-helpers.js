// Shared helpers for Nexus forwarding tests (not a test file itself).
export const WEBSITE_KEY = 'ws_abcdefghijklmnopqrstuvwx';
export const SECRET = 'a'.repeat(64);
export const NEXUS_URL = 'https://nexus.example.com/api/public/v1/inbound';

// In-memory stand-in for a Cloudflare KV namespace (put/get/delete/list with metadata, TTL and cursor paging).
export function fakeKV({failPut = false} = {}) {
  const store = new Map();
  const calls = {put: [], get: [], delete: [], list: []};
  return {
    store, calls,
    async put(key, value, options = {}) {
      calls.put.push({key, value, options});
      if (failPut) throw new Error('kv down');
      store.set(key, {value, metadata: options.metadata ?? null, expirationTtl: options.expirationTtl});
    },
    async get(key) { calls.get.push(key); return store.has(key) ? store.get(key).value : null; },
    async delete(key) { calls.delete.push(key); store.delete(key); },
    async list({prefix = '', limit = 1000, cursor} = {}) {
      calls.list.push({prefix, limit, cursor});
      const names = [...store.keys()].filter(k => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = names.slice(start, start + limit);
      const complete = start + limit >= names.length;
      return {keys: page.map(name => ({name, metadata: store.get(name).metadata})), list_complete: complete, ...(complete ? {} : {cursor: String(start + limit)})};
    }
  };
}

export const baseEnv = (overrides = {}) => ({
  NEXUS_ENABLED: 'true', NEXUS_INBOUND_URL: NEXUS_URL,
  NEXUS_WEBSITE_KEY: WEBSITE_KEY, NEXUS_INBOUND_SECRET: SECRET, NEXUS_QUEUE: fakeKV(), ...overrides
});

// Captures console output so tests can assert that no personal data is logged.
export async function captureLogs(fn) {
  const lines = [];
  const orig = {log: console.log, error: console.error, warn: console.warn, info: console.info};
  for (const k of Object.keys(orig)) console[k] = (...args) => lines.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
  try { const result = await fn(); return {result, lines, text: lines.join('\n')}; }
  finally { Object.assign(console, orig); }
}
