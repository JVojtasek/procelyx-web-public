#!/usr/bin/env node
// npm run dev: `wrangler dev` without the release gate on every rebuild (see tools/wrangler-build.mjs).
import {spawnSync} from 'node:child_process';

const r = spawnSync('npx', ['wrangler', 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {...process.env, PROCELYX_SKIP_GATE: '1'},
});
process.exit(r.status ?? 1);
