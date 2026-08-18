/**
 * pi-shuttle architectural static guards (genuine invariants only — no
 * incidental line-count pins):
 *
 * 1. Network/tunnel/MCP-SDK vocabulary is FORBIDDEN everywhere except the
 *    PS-8A release acquisition boundary (`src/installer/release/acquire.ts`):
 *    the ONLY network surface in the product — HTTPS-only downloads of
 *    digest-verified release assets, reachable only from the release
 *    installer bootstrap. No other module may perform network behavior.
 * 2. Subprocess execution exists ONLY inside the shared process boundary
 *    (`src/process/runner.ts`, extracted in PS-4 from the PS-3 installer
 *    boundary); the CLI/config/registry layers remain subprocess-free.
 * 3. `process.env` is confined to the host seam, the process boundary, and
 *    the release installer entry (its own direct-execution CLI boundary,
 *    exactly like the pi-guard compatibility probe).
 * 4. `node:crypto` is confined to identity derivation and artifact
 *    digest verification.
 * 5. `node:fs` is confined to the leaf modules with per-module exact
 *    allowlists. Filesystem MUTATION vocabulary lives only in the
 *    persistence writer (state/config documents), the installer boundary
 *    (ordinary local operator package management), and the approved
 *    lifecycle operator-directory boundary (`src/lifecycle/projects.ts`
 *    — trusted store parent locators, git isolation dirs, artifact dirs,
 *    and its own disposable probe files only).
 * 6. No trusted-authority vocabulary: pi-shuttle must never mint or
 *    reference Gateway provenance/capability/approval machinery.
 * 7. The Gateway bootstrap verb and `--config` argv are reachable only
 *    through the lifecycle boundary (fixed argv shapes); inherited stdio
 *    exists only inside the fixed start spawn shape.
 * 8. Package surface stays a single private bin with zero runtime
 *    dependencies.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..');
const SRC = join(REPO, 'src');

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(p));
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

function rel(file: string): string {
  return file.slice(REPO.length + 1);
}

const files = collectTsFiles(SRC);
assert.ok(files.length >= 20, 'the pi-shuttle source tree must exist');

const INSTALLER = (file: string): boolean => rel(file).startsWith('src/installer/');

/**
 * PS-8A network carve-out: the release acquisition boundary only. This
 * module performs HTTPS downloads of digest-verified release assets for
 * the official release installer; nothing else in src may touch the
 * network vocabulary.
 */
const NETWORK_EXEMPT = new Set(['src/installer/release/acquire.ts']);

/** Exact node:fs named-import allowlists per fs-bearing module. */
const FS_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  'src/persistence/writer.ts': ['mkdirSync', 'openSync', 'closeSync', 'writeSync', 'fsyncSync', 'renameSync', 'unlinkSync', 'fchmodSync'],
  'src/persistence/lock.ts': ['closeSync', 'constants', 'fstatSync', 'lstatSync', 'openSync', 'readSync', 'unlinkSync', 'writeSync'],
  'src/host/environment.ts': ['realpathSync'],
  'src/compat/pi-guard-probe.ts': ['existsSync', 'realpathSync'],
  'src/config/json.ts': ['openSync', 'closeSync', 'readSync', 'fstatSync'],
  // PS-3 installer boundary (ordinary local operator package management):
  'src/installer/preflight.ts': ['mkdirSync'],
  'src/installer/components.ts': ['existsSync', 'lstatSync', 'mkdirSync', 'renameSync', 'rmSync'],
  'src/installer/install.ts': ['lstatSync', 'mkdirSync', 'readdirSync', 'readlinkSync', 'realpathSync', 'renameSync', 'rmSync', 'symlinkSync'],
  'src/installer/artifact.ts': ['closeSync', 'constants', 'createReadStream', 'fstatSync', 'lstatSync', 'openSync', 'readdirSync', 'readSync'],
  'src/installer/archive.ts': ['createReadStream', 'lstatSync', 'readFileSync'],
  // PS-8A release boundary (verified staging + handoff files):
  'src/installer/release/acquire.ts': ['createWriteStream', 'rmSync', 'mkdirSync'],
  'src/installer/release/bootstrap.ts': ['existsSync', 'mkdirSync', 'readFileSync', 'realpathSync', 'rmSync', 'mkdtempSync'],
  // Installer entry direct-execution guard (symlink-safe argv comparison):
  'src/installer/main.ts': ['realpathSync'],
  'src/process/runner.ts': ['accessSync', 'constants'],
  // PS-4 lifecycle boundary (approved operator-directory creation + probes):
  'src/lifecycle/state.ts': ['existsSync'],
  'src/lifecycle/projects.ts': ['mkdirSync', 'statSync', 'unlinkSync', 'existsSync'],
  'src/lifecycle/start.ts': ['statSync'],
  'src/command/doctor.ts': ['existsSync', 'lstatSync', 'readdirSync', 'readlinkSync', 'realpathSync', 'statSync'],
  // Manifest-native authority validation (NEW-STATE Slice A; read-only):
  'src/manifest-native/fs.ts': ['closeSync', 'constants', 'fstatSync', 'lstatSync', 'openSync', 'readSync'],
  'src/manifest-native/state.ts': ['readdirSync'],
};

test('ps2/ps3 static guard: no network/tunnel/MCP vocabulary in src (PS-8A release acquisition boundary exempt)', () => {
  for (const file of files) {
    if (NETWORK_EXEMPT.has(rel(file))) continue;
    const content = readFileSync(file, 'utf8');
    for (const forbidden of [
      'node:net', 'node:http', 'node:https', 'node:tls', 'node:dgram',
      "from '@modelcontextprotocol'", 'fetch(', 'WebSocket', 'oauth', 'OAuth', 'sudo',
    ]) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not reach ${forbidden}`);
    }
  }
  // The carve-out is the release acquisition module and nothing else.
  const acquire = readFileSync(join(SRC, 'installer', 'release', 'acquire.ts'), 'utf8');
  assert.equal(acquire.includes('node:https'), true, 'the release acquisition boundary must use HTTPS');
  assert.equal(acquire.includes("from 'node:http'"), false, 'plain HTTP is never reachable');
});

test('ps2/ps3/ps4 static guard: subprocess execution exists only inside the shared process boundary', () => {
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (rel(file) === 'src/process/runner.ts') continue;
    assert.equal(content.includes('node:child_process'), false, `${rel(file)} must not import child_process`);
    assert.equal(content.includes('spawn('), false, `${rel(file)} must not spawn processes`);
    assert.equal(content.includes('exec('), false, `${rel(file)} must not exec`);
  }
});

test('ps2/ps3/ps4 static guard: process.env is confined to the host seam and the process boundary', () => {
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    // The pi-guard compatibility probe is a process boundary: its CLI main
    // (spawned by the installer/doctor/CI through the shared runner) reads
    // its env contract directly, exactly like the runner itself. The
    // release installer entry (PS-8A) is likewise its own direct-execution
    // CLI boundary (spawned by the release install.sh).
    if (rel(file) === 'src/host/environment.ts' || rel(file) === 'src/process/runner.ts' || rel(file) === 'src/compat/pi-guard-probe.ts' || rel(file) === 'src/installer/release/bootstrap.ts') continue;
    assert.equal(content.includes('process.env'), false, `${rel(file)} must not read the environment directly`);
  }
});

test('ps2/ps3 static guard: node:crypto is confined to identity derivation, artifact digests, and signed release metadata', () => {
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (rel(file) === 'src/registry/identity.ts' || rel(file) === 'src/installer/artifact.ts' || rel(file) === 'src/installer/release/trust-internal.ts') continue;
    assert.equal(content.includes('node:crypto'), false, `${rel(file)} must not use crypto`);
  }
});

test('slice1 static guard: generic trust construction stays behind the fixed production boundary', () => {
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (rel(file) === 'src/installer/release/trust.ts' || rel(file) === 'src/installer/release/trust-internal.ts') continue;
    assert.equal(content.includes("release/trust-internal.js"), false, `${rel(file)} must not import the generic trust implementation`);
    assert.equal(content.includes("./trust-internal.js"), false, `${rel(file)} must not import the generic trust implementation`);
  }
  const exportsGenericVerifier = (source: string): boolean => /export\s+(?:(?:(?:async\s+)?function|const|let|var)\s+createTrustVerifier\b|default\s+createTrustVerifier\b|\{[^}]*\bcreateTrustVerifier\b[^}]*\})/s.test(source);
  assert.equal(exportsGenericVerifier("export { createTrustVerifier } from './trust-internal.js';"), true);
  assert.equal(exportsGenericVerifier("export { createTrustVerifier as verifierFactory } from './trust-internal.js';"), true);
  const boundary = readFileSync(join(SRC, 'installer', 'release', 'trust.ts'), 'utf8');
  assert.equal(exportsGenericVerifier(boundary), false, 'production trust boundary must not export arbitrary-policy verifier construction');
  // NEW-STATE Slice A correction: the ONLY require*/provenance exports on
  // the production boundary are the two narrow runtime provenance gates;
  // nothing else (no WeakSet, no mutation, no verifier factory) is exported.
  const exportedFunctions = [...boundary.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)].map((m) => m[1]!);
  assert.deepEqual(
    exportedFunctions.filter((name) => name.startsWith('require')),
    ['requireVerifiedReleaseSelection', 'requireVerifiedInstalledEvidence'],
    'the production trust boundary exports exactly the two narrow provenance gates',
  );
  assert.equal(exportedFunctions.includes('createTrustVerifier'), false, 'createTrustVerifier must never be exported');
  for (const forbidden of ['WeakSet', 'selectionAuthority', 'installedEvidenceAuthority', 'keyringAuthority']) {
    assert.equal(boundary.includes(forbidden), false, `production trust boundary must not expose ${forbidden}`);
  }
});

test('ps2/ps3 static guard: node:fs is confined to leaf modules with exact allowlists', () => {
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (!content.includes('node:fs')) continue;
    const allowed = FS_ALLOWLIST[rel(file)];
    assert.ok(allowed !== undefined, `${rel(file)} imports node:fs outside the allowed set`);
    for (const m of content.matchAll(/import\s*\{([^}]+)\}\s*from\s*'node:fs'/g)) {
      for (const name of m[1]!.split(',').map((s) => s.trim()).filter((s) => s.length > 0)) {
        assert.ok(allowed.includes(name), `${rel(file)} imports ${name} outside the allowlist`);
      }
    }
  }
});

test('ps2/ps3 static guard: filesystem mutation vocabulary lives only in the writer, the shared lock, the installer boundary, and the approved lifecycle operator-directory boundary', () => {
  const MUTATING = ['renameSync', 'mkdirSync', 'unlinkSync', 'rmSync', 'cpSync', 'chmodSync', 'symlinkSync', 'writeFileSync', 'copyFileSync', 'truncateSync'];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (rel(file) === 'src/persistence/writer.ts' || rel(file) === 'src/persistence/lock.ts' || INSTALLER(file) || rel(file) === 'src/lifecycle/projects.ts') continue;
    for (const name of MUTATING) {
      assert.equal(content.includes(name), false, `${rel(file)} must not mutate the filesystem (${name})`);
    }
  }
});

test('ps4 static guard: the Gateway bootstrap verb is reachable only through the lifecycle boundary with a fixed argv shape', () => {
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (rel(file) === 'src/lifecycle/projects.ts') continue;
    assert.equal(content.includes("'bootstrap'"), false, `${rel(file)} must not invoke the Gateway bootstrap verb`);
    if (rel(file) !== 'src/process/runner.ts') {
      assert.equal(content.includes("'--config'"), false, `${rel(file)} must not build Gateway CLI argv`);
    }
  }
});

test('ps4 static guard: the start runtime path uses inherited stdio only through the fixed spawnGatewayForStart shape', () => {
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (rel(file) === 'src/process/runner.ts' || rel(file) === 'src/lifecycle/start.ts') continue;
    assert.equal(content.includes('stdio: \'inherit\''), false, `${rel(file)} must not inherit stdio outside the start spawn boundary`);
    assert.equal(content.includes('spawnGatewayForStart'), false, `${rel(file)} must not bypass the fixed start spawn shape (only src/lifecycle/start.ts may call it)`);
  }
});

test('ps2/ps3 static guard: no trusted-authority vocabulary in src', () => {
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const forbidden of [
      'initializeTrustedStore', 'createStorageBootstrapActionProvenance', 'StorageBootstrapActionProvenance',
      'TrustedStorageBootstrapInput', 'createInitializationCapability', 'RuntimeGrant', 'TrustedReceipt',
      'ExecutionResult', 'markValidatedTrustedWorkspaceConfiguration',
    ]) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not reference trusted-authority machinery (${forbidden})`);
    }
  }
});

test('ps2/ps3 static guard: package surface stays a single private bin with zero runtime dependencies', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
    readonly bin?: Record<string, string>;
    readonly private?: boolean;
    readonly dependencies?: Record<string, string>;
  };
  assert.deepEqual(Object.keys(pkg.bin ?? {}), ['pi-shuttle'], 'exactly one executable: pi-shuttle');
  assert.equal(pkg.private, true, 'package must stay private/unpublished');
  assert.equal(pkg.dependencies, undefined, 'no runtime dependencies');
});
