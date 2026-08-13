#!/usr/bin/env node
/**
 * PS-6R: the committed pi-guard compatibility probe (CI entry). The
 * probe logic lives in ONE place — src/compat/pi-guard-probe.ts,
 * compiled to dist/compat/pi-guard-probe.js — and is shared by the
 * installer, doctor, and CI. This script is a thin delegate that spawns
 * the compiled probe with the same environment contract, preserving the
 * PS-5/PS-6 CI interface:
 *
 *   PI_LOADER   = absolute path to pi's extension loader
 *                 (<pi>/dist/core/extensions/loader.js)
 *   PI_GUARD_ENTRY = absolute path to the installed pi-guard extension
 *                 entry (<packages>/pi-guard@0.1.2/extensions/pi-guard/index.ts)
 *   HOME        = isolated operator home
 *
 * Exit: 0 = probe PASS; 1 = integration FAIL; 2 = usage/infrastructure.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = fileURLToPath(new URL('.', import.meta.url));
const probeCli = `${here}../dist/compat/pi-guard-probe.js`;

if (!existsSync(probeCli)) {
  console.error('pi-guard compatibility probe: compiled probe not found — run `npm run build` first');
  process.exit(2);
}
for (const v of ['PI_LOADER', 'PI_GUARD_ENTRY', 'HOME']) {
  if (!process.env[v]) {
    console.error(`pi-guard compatibility probe: ${v} is required`);
    process.exit(2);
  }
}
const run = spawnSync(process.execPath, [probeCli], {
  env: { ...process.env, PI_LOADER: process.env.PI_LOADER, PI_GUARD_ENTRY: process.env.PI_GUARD_ENTRY, HOME: process.env.HOME },
  stdio: 'inherit',
});
process.exit(run.status ?? 2);
