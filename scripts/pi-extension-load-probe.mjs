#!/usr/bin/env node
/**
 * PS-6 Lane B evidence probe: load the installed pi-guard extension through
 * pi 0.83.0's OWN extension loader (jiti + bundled-module aliases), exactly
 * as `pi` does at session start — the PS-5 methodology, parameterized for
 * the darwin lane. Read-only; isolated HOME; no provider authentication;
 * no real user Pi state.
 *
 * Usage (env):
 *   PI_LOADER   = absolute path to pi's extension loader
 *                 (<pi-lane>/node_modules/@earendil-works/pi-coding-agent/
 *                  dist/core/extensions/loader.js)
 *   PI_GUARD_ENTRY = absolute path to the installed pi-guard extension entry
 *                 (<packages>/pi-guard@0.1.2/extensions/pi-guard/index.ts)
 *   HOME        = isolated operator home
 *
 * Exit: 0 = extension imports, factory runs, `/guard` command registers,
 *          zero load errors; 1 = load errors; 2 = no extension/command.
 */
import { pathToFileURL } from 'node:url';

const loaderPath = process.env.PI_LOADER;
const entry = process.env.PI_GUARD_ENTRY;
const home = process.env.HOME;

if (!loaderPath || !entry || !home) {
  console.error('PI_LOADER / PI_GUARD_ENTRY / HOME are required');
  process.exit(2);
}

// pi 0.83.0's own extension loader (jiti + bundled-module aliases), loaded
// from the isolated lane's installed package — never a pi-shuttle copy.
const { loadExtensions } = await import(pathToFileURL(loaderPath).href);

const result = await loadExtensions([entry], home);
console.log('pi version lane: isolated 0.83.0 (probe via its own loader)');
console.log('extension paths loaded:', result.extensions.map((e) => e.path));
console.log('load errors:', result.errors.length === 0 ? 'NONE' : JSON.stringify(result.errors));
const ext = result.extensions[0];
if (ext) {
  console.log('registered commands:', [...ext.commands.keys()]);
  console.log('registered tools:', [...ext.tools.keys()]);
}
if (result.errors.length > 0) process.exit(1);
if (!ext || ext.commands.size === 0) process.exit(2);
console.log('pi-guard extension load: OK');
