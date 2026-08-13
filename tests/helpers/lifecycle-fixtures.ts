/**
 * PS-4 test fixtures: fake Gateway CLI (bootstrap + start modes with
 * truthful-state failure controls), fake git, fake pi reuse, isolated
 * installation environments (receipt + package + runtime config), and the
 * real-CLI subprocess runner. Tests may spawn processes; production code
 * never does outside `src/process/runner.ts`.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { GATEWAY_PACKAGE_VERSION, PI_GUARD_VERSION } from '../../src/compat/manifest.js';
import { canonicalizePath, resolveLayout } from '../../src/host/environment.js';
import { componentDirName, GATEWAY_PACKAGE_NAME } from '../../src/installer/components.js';
import { writeReceipt, newReceipt } from '../../src/installer/receipt.js';
import type { ComponentStatus, GatewaySmoke } from '../../src/installer/receipt.js';
import { writeFakePi } from './installer-fixtures.js';

/** Create a fresh isolated environment root (0700), on its CANONICAL spelling. */
export function makeEnv(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ps4-test-'));
  chmodSync(dir, 0o700);
  // PS6-TEST-001: the product canonicalizes project roots (realpath); on
  // macOS `os.tmpdir()` returns /var/folders/... whose canonical spelling
  // is /private/var/folders/... — fixtures must live on the canonical
  // spelling so raw == canonical expectations hold on every platform.
  // No-op on Linux (no /var symlink in /tmp).
  return canonicalizePath(dir) ?? dir;
}

export function cleanupEnv(env: string): void {
  rmSync(env, { recursive: true, force: true });
}

export interface FixtureGatewayScriptOptions {
  /** Bootstrap failure/success controls (env-driven at run time). */
  readonly modes?: readonly string[];
}

/**
 * The fake Gateway CLI. Production-shape surface:
 *   `node <bin> bootstrap --config <f> [--output <o>]` — reads the config,
 *   realpath-resolves the workspace root, derives a deterministic
 *   `sha-256:` identity, creates the "trusted store" evidence under the
 *   locator, and writes the resolved runtime configuration (0600). The
 *   identity is a pure function of the config, so exact re-runs are
 *   byte-identical (idempotent replay model).
 *   `node <bin> --config <f>` (start) — prints one protocol marker line,
 *   waits for stdin EOF, exits with `FIXTURE_GATEWAY_EXIT` (signal tests
 *   use the default SIGTERM behavior).
 *   `node <bin> --help` — exit 0 (doctor smoke).
 *
 * Failure controls (env `FIXTURE_GATEWAY_MODE`):
 *   exit1      → bootstrap exits 1 with a typed diagnostic;
 *   no-output  → bootstrap exits 0 WITHOUT writing the output file;
 *   malformed  → bootstrap writes invalid JSON to the output file;
 *   mismatch   → bootstrap resolves a DIFFERENT workspace root;
 *   slow       → bootstrap sleeps 3000 ms (lock contention tests).
 *
 * Additional controls: `FIXTURE_GATEWAY_ARTIFACT` overrides the resolved
 * workspace artifactLocation (SIR-PS4-001 correlation tests — any value
 * other than the prepared `<root>/artifacts` must fail closed);
 * `FIXTURE_GATEWAY_IMMEDIATE=1` makes the start mode exit right after the
 * marker (no stdin wait) with `FIXTURE_GATEWAY_EXIT` (signal-listener
 * lifecycle tests).
 */
export const FAKE_GATEWAY_SCRIPT = `#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync, readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const mode = process.env.FIXTURE_GATEWAY_MODE ?? '';
const start = process.env.FIXTURE_GATEWAY_START === '1';
if (args.includes('--help')) { process.stdout.write('project-gateway-mcp fixture help\\n'); process.exit(0); }
if (start) {
  if (args[0] !== '--config' || args.length !== 2) { process.stderr.write('fixture: start requires exactly --config <file>\\n'); process.exit(3); }
  process.stdout.write((process.env.FIXTURE_GATEWAY_MARKER ?? 'PROTOCOL-MARKER') + '\\n');
  if (process.env.FIXTURE_GATEWAY_IMMEDIATE === '1') { process.exit(Number(process.env.FIXTURE_GATEWAY_EXIT ?? '0')); }
  process.stdin.resume();
  process.stdin.on('end', () => process.exit(Number(process.env.FIXTURE_GATEWAY_EXIT ?? '0')));
} else {
if (args[0] !== 'bootstrap' || args[1] !== '--config') { process.stderr.write('fixture: usage\\n'); process.exit(2); }
const configPath = args[2];
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
if (mode === 'exit1') { process.stderr.write('bootstrap: surface failed closed: ERR-FIXTURE\\n'); process.exit(1); }
let config;
try { config = JSON.parse(readFileSync(configPath, 'utf8')); } catch { process.stderr.write('bootstrap: config unreadable\\n'); process.exit(1); }
const input = config.surfaces[0];
if (mode === 'slow') await new Promise((r) => setTimeout(r, 3000));
if (mode === 'no-output') { process.stderr.write('bootstrap: surface ' + input.surfaceId + ' INITIALIZED\\n'); process.exit(0); }
const root = realpathSync(input.workspaces[0].root);
const identity = 'sha-256:' + createHash('sha256').update(JSON.stringify(config)).digest('hex');
const resolved = {
  surfaces: [{
    surfaceId: input.surfaceId,
    locator: input.locator,
    serviceUid: typeof process.getuid === 'function' ? process.getuid() : 0,
    forbiddenRoots: [...input.forbiddenRoots],
    configurationIdentity: identity,
    configurationVersion: input.configurationVersion,
    limitProfile: {},
    workspaces: [{ workspaceId: input.workspaces[0].workspaceId, root: mode === 'mismatch' ? root + '-other' : root, artifactLocation: process.env.FIXTURE_GATEWAY_ARTIFACT ?? input.workspaces[0].artifactLocation }],
    gitPath: input.gitPath,
    gitHome: input.gitHome,
    gitTmpdir: input.gitTmpdir,
  }],
};
mkdirSync(input.locator + '/store-v1', { recursive: true });
mkdirSync(input.locator + '/config-v1', { recursive: true });
writeFileSync(input.locator + '/store-v1/metadata.json', JSON.stringify({ identity, fixture: true }), { mode: 0o600 });
if (mode === 'malformed') { writeFileSync(outputPath, 'not json{{{', { mode: 0o600 }); process.stderr.write('bootstrap: surface ' + input.surfaceId + ' INITIALIZED\\n'); process.exit(0); }
const text = JSON.stringify(resolved, null, 2) + '\\n';
if (outputPath !== undefined) writeFileSync(outputPath, text, { mode: 0o600 });
else process.stdout.write(text);
process.stderr.write('bootstrap: surface ' + input.surfaceId + ' INITIALIZED identity=' + identity + '\\n');
process.exit(0);
}
`;

/** Install the fake Gateway package under the layout's packages dir. */
export function installFixtureGateway(env: string): { readonly installPath: string; readonly binPath: string } {
  const layout = resolveLayout(env);
  const installPath = join(layout.packagesDir, componentDirName(GATEWAY_PACKAGE_NAME, GATEWAY_PACKAGE_VERSION));
  mkdirSync(join(installPath, 'dist'), { recursive: true, mode: 0o700 });
  writeFileSync(join(installPath, 'package.json'), JSON.stringify({
    name: GATEWAY_PACKAGE_NAME,
    version: GATEWAY_PACKAGE_VERSION,
    type: 'module',
    bin: { 'project-gateway-mcp': './dist/cli.js' },
  }, null, 2), { mode: 0o600 });
  const binPath = join(installPath, 'dist', 'cli.js');
  writeFileSync(binPath, FAKE_GATEWAY_SCRIPT, { mode: 0o700 });
  chmodSync(binPath, 0o700);
  return { installPath, binPath };
}

/** Fake git: `--version` (evidence lane) and `-C <root> rev-parse --git-dir` (read-only probe). */
export function writeFakeGit(binDir: string, version = '2.45.4'): string {
  const script = join(binDir, 'git');
  writeFileSync(script, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write('git version ${version}\\n'); process.exit(0); }
if (args.includes('rev-parse')) { process.stdout.write('.git\\n'); process.exit(0); }
process.stderr.write('fixture git: unexpected invocation: ' + args.join(' ') + '\\n');
process.exit(2);
`, { mode: 0o700 });
  chmodSync(script, 0o700);
  return script;
}

/** A fixture PATH environment: fake git + fake pi + real PATH + extra vars. */
export function fixturePathEnv(env: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const binDir = join(env, 'fixture-bin');
  mkdirSync(binDir, { mode: 0o700 });
  writeFakeGit(binDir);
  writeFakePi(binDir);
  return {
    ...process.env,
    ...extra,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
  };
}

export interface ReceiptFixtureOptions {
  readonly result?: 'COMPLETE' | 'PARTIAL';
  readonly gateway?: { readonly status: ComponentStatus; readonly installPath: string; readonly binPath: string; readonly smoke?: GatewaySmoke } | null;
  readonly piGuard?: { readonly status: ComponentStatus; readonly installPath: string } | null;
  readonly omitted?: readonly string[];
  readonly notes?: readonly string[];
}

/** Write a valid closed receipt under the env's state dir (default: COMPLETE, both components). */
export function writeReceiptFixture(env: string, options: ReceiptFixtureOptions = {}): void {
  const layout = resolveLayout(env);
  const gateway = options.gateway === undefined
    ? {
        status: 'installed-verified' as ComponentStatus,
        installPath: join(layout.packagesDir, componentDirName(GATEWAY_PACKAGE_NAME, GATEWAY_PACKAGE_VERSION)),
        binPath: join(layout.packagesDir, componentDirName(GATEWAY_PACKAGE_NAME, GATEWAY_PACKAGE_VERSION), 'dist', 'cli.js'),
      }
    : options.gateway;
  const piGuard = options.piGuard === undefined
    ? {
        status: 'installed-verified' as ComponentStatus,
        installPath: join(layout.packagesDir, componentDirName('pi-guard', PI_GUARD_VERSION)),
      }
    : options.piGuard;
  const receipt = newReceipt({
    platformLane: 'linux-x86_64-posix-utf8-node22',
    result: options.result ?? 'COMPLETE',
    installDir: layout.shareDir,
    binDir: layout.binDir,
    gateway: gateway === null ? null : {
      status: gateway.status,
      version: GATEWAY_PACKAGE_VERSION,
      commit: '7f3b4afdb43704e7dac82da7b086d8367347c641',
      commitVerified: false,
      digestVerified: false,
      artifactSha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      installPath: gateway.installPath,
      binPath: gateway.binPath,
      smoke: gateway.smoke ?? 'passed',
    },
    piGuard: piGuard === null ? null : {
      status: piGuard.status,
      version: PI_GUARD_VERSION,
      commit: '7a7580cc4cbd7926797564c72269394fc29a860a',
      commitVerified: false,
      digestVerified: false,
      artifactSha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      installPath: piGuard.installPath,
      sourcePath: piGuard.installPath,
      piVersion: '0.83.0',
      verifiedBy: 'pi-list',
    },
    omitted: options.omitted ?? [],
    notes: options.notes ?? [],
  });
  const written = writeReceipt(layout.installReceiptPath, receipt);
  if (!written.ok) throw new Error(`receipt fixture failed: ${written.message}`);
}

/** Create a project root with an observable marker file. */
export function makeProjectRoot(env: string, name = 'proj'): string {
  const root = join(env, name);
  mkdirSync(root, { mode: 0o700 });
  writeFileSync(join(root, 'MARKER.txt'), 'operator project content\n', { mode: 0o600 });
  return root;
}

/**
 * A complete healthy installation fixture: layout dirs, fake git + fake pi
 * on the fixture PATH, gateway package + receipt (COMPLETE), and (unless
 * disabled) a registered runtime config with a real project root, locator
 * parent + store, git isolation dirs, and the artifacts dir.
 */
export interface HealthyEnv {
  readonly env: string;
  readonly root: string;
  readonly layout: ReturnType<typeof resolveLayout>;
  readonly binPath: string;
  readonly pathEnv: NodeJS.ProcessEnv;
}

export function makeHealthyEnv(options: { readonly withRuntimeConfig?: boolean; readonly withPiGuard?: boolean } = {}): HealthyEnv {
  const env = makeEnv();
  const layout = resolveLayout(env);
  const binDir = join(env, 'fixture-bin');
  mkdirSync(binDir, { mode: 0o700 });
  writeFakeGit(binDir);
  writeFakePi(binDir);
  const gateway = installFixtureGateway(env);
  // pi-guard package identity (the doctor reads it read-only; the Pi store
  // state file confirms the exact source in `pi list`).
  const piGuardDir = join(layout.packagesDir, componentDirName('pi-guard', PI_GUARD_VERSION));
  mkdirSync(piGuardDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(piGuardDir, 'package.json'), JSON.stringify({
    name: 'pi-guard',
    version: PI_GUARD_VERSION,
    private: true,
  }, null, 2), { mode: 0o600 });
  const piState = join(env, 'pi-state.txt');
  writeFileSync(piState, `${piGuardDir}\n`, { mode: 0o600 });
  writeReceiptFixture(env, options.withPiGuard === false ? { piGuard: null, result: 'PARTIAL', omitted: ['pi-guard'] } : undefined);
  const root = makeProjectRoot(env);
  if (options.withRuntimeConfig !== false) {
    // Locator + store + git isolation dirs + artifacts (what `project add` creates)
    // plus the authoritative runtime document referencing them.
    const storeId = '0123456789abcdef0123456789abcdef';
    const locator = join(layout.storesDir, storeId);
    mkdirSync(join(locator, 'store-v1'), { recursive: true, mode: 0o700 });
    mkdirSync(join(locator, 'config-v1'), { recursive: true, mode: 0o700 });
    mkdirSync(join(layout.gitHomeDir, storeId), { recursive: true, mode: 0o700 });
    mkdirSync(join(layout.gitTmpDir, storeId), { recursive: true, mode: 0o700 });
    mkdirSync(join(root, 'artifacts'), { recursive: true, mode: 0o700 });
    writeRuntimeDocument(env, {
      surfaces: [{
        surfaceId: `pgw-${storeId}`,
        locator,
        serviceUid: 1000,
        forbiddenRoots: [root],
        configurationIdentity: `sha-256:${'0'.repeat(64)}`,
        configurationVersion: '2',
        limitProfile: {},
        workspaces: [{ workspaceId: `pgw:w:${storeId}`, root, artifactLocation: join(root, 'artifacts') }],
        gitPath: join(binDir, 'git'),
        gitHome: join(layout.gitHomeDir, storeId),
        gitTmpdir: join(layout.gitTmpDir, storeId),
      }],
    });
  }
  return {
    env,
    root,
    layout,
    binPath: gateway.binPath,
    pathEnv: {
      ...process.env,
      FIXTURE_PI_STATE: piState,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
    },
  };
}

/** Write a runtime document under the env's config dir (0600; parent created). */
export function writeRuntimeDocument(env: string, document: unknown): string {
  const layout = resolveLayout(env);
  mkdirSync(layout.configDir, { recursive: true, mode: 0o700 });
  const path = layout.runtimeConfigPath;
  writeFileSync(path, JSON.stringify(document, null, 2) + '\n', { mode: 0o600 });
  return path;
}

// ─── real-CLI subprocess runner ──────────────────────────────────────────

export const REPO = join(import.meta.dirname, '..', '..', '..');
export const CLI_PATH = join(REPO, 'dist', 'cli.js');

export interface CliRunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run the compiled real CLI with an env override (HOME + PATH + fixture controls). */
export function runCli(args: readonly string[], env: NodeJS.ProcessEnv, options: { readonly cwd?: string; readonly stdin?: 'open' | 'ignore' } = {}): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      stdio: options.stdin === 'open' ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
      env,
      cwd: options.cwd,
    });
    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    child.stderr!.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
