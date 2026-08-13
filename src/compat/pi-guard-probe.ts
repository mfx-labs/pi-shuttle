/**
 * PS-6R: the committed pi-guard compatibility probe (product + CI).
 *
 * Verifies the ACTUAL extension-api-v1 integration surface pi-guard
 * requires, through pi's OWN extension loader (jiti + bundled-module
 * aliases) — exactly as `pi` does at session start:
 *
 *   - the extension module imports and its factory executes with ZERO
 *     load errors (fail closed otherwise);
 *   - the `guard` command is registered;
 *   - the required event surface is registered: session_start,
 *     session_shutdown, before_agent_start, tool_call (the readiness
 *     analysis §6 identified these hooks; `/guard` textual presence alone
 *     is NOT the whole proof);
 *   - the tool registry is reported (pi-guard registers its git-inspect
 *     tool lazily at session-start ownership determination, so an empty
 *     load-time tool map is by design — never a probe failure).
 *
 * Pi 0.83.0 (the known-good baseline) never needs this probe; any other
 * candidate >= 0.83.0 must PASS it before install/doctor accept the
 * integration. A probe that cannot run (loader not locatable, usage
 * error) FAILS closed — unprobed candidates are never claimed
 * compatible.
 *
 * Usable as a module (runPiGuardProbe) and as a CLI:
 *   env: PI_LOADER = pi's dist/core/extensions/loader.js
 *        (or PI_BIN = the pi executable, resolved to the loader)
 *        PI_GUARD_ENTRY = installed pi-guard extension entry (index.ts)
 *        HOME = isolated operator home
 *   exit 0 = PASS; 1 = integration FAIL; 2 = usage/infrastructure error.
 */
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

/** The event surface pi-guard registers at factory time (readiness §6). */
export const REQUIRED_GUARD_EVENTS: readonly string[] = [
  'session_start',
  'session_shutdown',
  'before_agent_start',
  'tool_call',
] as const;

export interface PiGuardProbeOptions {
  /** Absolute path to pi's dist/core/extensions/loader.js. */
  readonly loaderPath: string;
  /** Absolute path to the installed pi-guard extension entry (index.ts). */
  readonly extensionEntry: string;
  /** Isolated operator home passed to pi's loader. */
  readonly home: string;
}

export interface PiGuardProbeResult {
  readonly ok: boolean;
  /** Bounded human-readable detail (never raw hostile output). */
  readonly detail: string;
}

/**
 * Resolve pi's extension loader from the pi executable: the pi bin is a
 * symlink into `<pkg>/dist/cli.js`; the loader is
 * `<pkg>/dist/core/extensions/loader.js`. Returns null when the layout
 * does not resolve (fail closed — the caller must not accept a candidate
 * whose integration surface cannot be located).
 */
export function resolvePiLoaderFromBin(piBin: string): string | null {
  try {
    const resolved = realpathSync(piBin);
    // pi's bin is a symlink into `<pkg>/dist/cli.js`; the package root is
    // one directory above the bin's resolved `dist` dir, and the loader
    // lives at `<pkg>/dist/core/extensions/loader.js`.
    const packageRoot = join(dirname(resolved), '..');
    const loader = join(packageRoot, 'dist', 'core', 'extensions', 'loader.js');
    if (!existsSync(loader)) return null;
    return loader;
  } catch {
    return null;
  }
}

/** Run the probe in-process through pi's own loader. */
export async function runPiGuardProbe(options: PiGuardProbeOptions): Promise<PiGuardProbeResult> {
  const { loadExtensions } = await import(pathToFileURL(options.loaderPath).href);
  const result = await loadExtensions([options.extensionEntry], options.home);
  if (result.errors.length > 0) {
    return { ok: false, detail: `load errors: ${JSON.stringify(result.errors).slice(0, 300)}` };
  }
  const ext = result.extensions[0];
  if (ext === undefined) {
    return { ok: false, detail: 'no extension was loaded' };
  }
  const commands = [...ext.commands.keys()];
  if (!commands.includes('guard')) {
    return { ok: false, detail: `required command 'guard' is not registered (registered: ${commands.join(', ') || 'none'})` };
  }
  const handlers = [...ext.handlers.keys()];
  const missingEvents = REQUIRED_GUARD_EVENTS.filter((event) => !handlers.includes(event));
  if (missingEvents.length > 0) {
    return { ok: false, detail: `required event handlers are not registered: ${missingEvents.join(', ')}` };
  }
  return {
    ok: true,
    detail: `guard command + required events (${REQUIRED_GUARD_EVENTS.join(', ')}) verified through pi's own loader; tools at load: ${ext.tools.size}`,
  };
}

// ─── CLI main (spawned by the installer, doctor, and CI) ─────────────────

function usageError(message: string): never {
  console.error(`pi-guard compatibility probe: ${message}`);
  process.exit(2);
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const home = process.env.HOME;
  const entry = process.env.PI_GUARD_ENTRY;
  if (!home || !entry) usageError('PI_GUARD_ENTRY and HOME are required');
  let loader = process.env.PI_LOADER;
  if (!loader) {
    const piBin = process.env.PI_BIN;
    if (!piBin) usageError('PI_LOADER (or PI_BIN) is required');
    const resolved = resolvePiLoaderFromBin(piBin);
    if (resolved === null) usageError(`pi extension loader could not be resolved from PI_BIN ${piBin}`);
    loader = resolved;
  }
  const result = await runPiGuardProbe({ loaderPath: loader, extensionEntry: entry, home });
  console.log(`pi-guard compatibility probe: ${result.ok ? 'PASS' : 'FAIL'} — ${result.detail}`);
  process.exit(result.ok ? 0 : 1);
}
