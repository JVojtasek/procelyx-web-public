#!/usr/bin/env node
// Wrangler custom build (wrangler.jsonc "build.command"): runs before every `wrangler deploy` (Workers Builds,
// dry run) and every `wrangler dev` start or rebuild.
//
// Always: npm run build. Then the release gate (npm test + npm run check), so a broken test or link stops a
// Workers Builds deploy. The gate is skipped only when PROCELYX_SKIP_GATE=1 is set explicitly: `npm run dev`
// (tools/dev.mjs) and the web-checks dry run (tests already ran there). Anything else fails closed.
import {spawnSync} from 'node:child_process';

const run = (script) => {
  const r = spawnSync('npm', ['run', script], {stdio: 'inherit', shell: process.platform === 'win32'});
  if (r.status !== 0) process.exit(r.status || 1);
};

run('build');
if (process.env.PROCELYX_SKIP_GATE === '1') {
  console.log('wrangler-build: PROCELYX_SKIP_GATE=1, tests and site check skipped');
} else {
  run('test');
  run('check');
}
