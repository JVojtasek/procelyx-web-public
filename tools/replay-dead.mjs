// Manual replay of Nexus One dead letters (dead:<idempotencyKey>) after the cause was fixed.
//
//   node tools/replay-dead.mjs                 list dead letters (key, reason, HTTP status, time) — default, changes nothing
//   node tools/replay-dead.mjs --key <uuid>    move one entry back to the queue (repeatable)
//   node tools/replay-dead.mjs --all           move every dead letter back to the queue
//
// Moved entries are due immediately (attempts 0, fresh 7-day TTL); the next Worker cron run
// (every 5 minutes) delivers them with a new signature. Uses the remote NEXUS_QUEUE binding from
// wrangler.jsonc and the local wrangler login. Never prints the stored inquiry body.
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {requeueDeadEntries} from '../src/nexus.js';

const root = resolve(import.meta.dirname, '..');
const wranglerBin = resolve(root, 'node_modules/wrangler/bin/wrangler.js');

function wrangler(args) {
  const run = spawnSync(process.execPath, [wranglerBin, 'kv', 'key', ...args, '--binding', 'NEXUS_QUEUE', '--remote'], {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  if (run.status !== 0) throw new Error(`wrangler kv key ${args[0]} failed (exit ${run.status}); check "npx wrangler whoami" and the NEXUS_QUEUE binding`);
  return run.stdout;
}

// KV-like adapter over the wrangler CLI (same interface as the Worker binding).
const kv = {
  async list({prefix}) {
    const out = wrangler(['list', '--prefix', prefix]);
    return {keys: JSON.parse(out.slice(out.indexOf('['))), list_complete: true};
  },
  async get(name) {
    const out = wrangler(['get', name, '--text']);
    return out.trim() ? out.trim() : null;
  },
  async put(name, value, {expirationTtl, metadata} = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'procelyx-replay-'));
    try {
      const file = join(dir, 'value.json');
      writeFileSync(file, value, {mode: 0o600});
      const args = ['put', name, '--path', file];
      if (expirationTtl) args.push('--ttl', String(expirationTtl));
      if (metadata) args.push('--metadata', JSON.stringify(metadata));
      wrangler(args);
    } finally { rmSync(dir, {recursive: true, force: true}); }
  },
  async delete(name) { wrangler(['delete', name]); }
};

const argv = process.argv.slice(2);
const keys = argv.flatMap((arg, i) => (arg === '--key' && argv[i + 1] ? [argv[i + 1]] : []));
const all = argv.includes('--all');
if (keys.some(k => !/^[0-9a-f-]{36}$/i.test(k))) { console.error('Každý --key musí být idempotencyKey (UUID).'); process.exit(2); }

if (!all && !keys.length) {
  const {keys: dead} = await kv.list({prefix: 'dead:'});
  if (!dead.length) console.log('Fronta dead: je prázdná.');
  for (const {name, metadata} of dead) {
    const m = metadata || {};
    console.log(`${name}  reason=${m.reason ?? '?'}  status=${m.status ?? '?'}  at=${m.at ? new Date(m.at).toISOString() : '?'}  attempts=${m.attempts ?? '?'}`);
  }
  console.log(`Celkem: ${dead.length}. Přehrání: --key <uuid> nebo --all.`);
} else {
  const result = await requeueDeadEntries(kv, {keys, all, now: Date.now()});
  console.log(`Přesunuto zpět do fronty: ${result.moved}, nenalezeno: ${result.missing}. Doručí je nejbližší cron Workeru (do 5 minut).`);
}
