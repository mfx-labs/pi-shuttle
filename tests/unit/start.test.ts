/**
 * NEW-STATE Slice B — `pi-shuttle start` manifest-native runtime tests.
 *
 * Proves: valid installations resolve the exact verified bin and launch
 * through the RUNNING Node executable with the fixed `--config` argv
 * composition; expired cached metadata still starts offline; every
 * integrity class (malformed receipt, tampered cache, tree drift, path
 * change, symlinked/unsafe-moded/wrong-type bin, lane/protocol mismatch)
 * refuses BEFORE any child; CLEAN refuses without fallback; the full tree
 * hash runs before spawn; signal/exit behavior is preserved.
 *
 * Fixture namespaces are verified through the fixture provenance gate
 * (the production verifier cannot verify fixture-signed chains); no real
 * Gateway or user runtime state is ever touched — fake process targets
 * only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveLayout } from '../../src/host/environment.js';
import { createTrustVerifier } from '../../src/installer/release/trust-internal.js';
import { FIXTURE_NOW, FIXTURE_POLICY, fixtureVerifier } from '../helpers/release-trust-fixtures.js';
import { FAKE_GATEWAY_SCRIPT, fixturePathEnv, makeEnv } from '../helpers/lifecycle-fixtures.js';
import {
  materializeNativeNamespace,
  nativeBaseDir,
  nativeResolver,
  nativeTreeFiles,
  removeNativeBase,
} from '../helpers/manifest-native-fixtures.js';
import { runStartCommand } from '../../src/lifecycle/start.js';
import type { StartContext } from '../../src/lifecycle/start.js';

/** A bin that records its own resolved path (proves the exact verified bin is executed). */
const RECORDING_BIN = `import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.FIXTURE_BIN_RECORD, process.argv[1] + '\\n');\n`;

/** A bin that waits for a signal (signal-forwarding tests). */
const WAITING_BIN = `import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.FIXTURE_READY_FILE, 'ready');\nprocess.stdin.resume();\n`;

function startTreeFiles(binContent: string, version = '0.1.1'): Record<string, string> {
  return nativeTreeFiles({ 'bin/run.js': binContent, 'lib/core.js': 'export const core = 1;\n' }, version);
}

/** Full healthy manifest-native start environment (namespace + runtime config). */
async function startEnv(extra: NodeJS.ProcessEnv = {}, options: { readonly binContent?: string; readonly verifier?: ReturnType<typeof fixtureVerifier> } = {}): Promise<{
  readonly env: string;
  readonly layout: ReturnType<typeof resolveLayout>;
  readonly pathEnv: NodeJS.ProcessEnv;
  readonly ns: Awaited<ReturnType<typeof materializeNativeNamespace>>;
  readonly ctx: StartContext;
}> {
  const env = makeEnv();
  const layout = resolveLayout(env);
  const verifier = options.verifier ?? fixtureVerifier(FIXTURE_NOW);
  const ns = await materializeNativeNamespace(env, {}, startTreeFiles(options.binContent ?? FAKE_GATEWAY_SCRIPT), verifier);
  // Registered runtime config (what `project add` persists), with a
  // locally present store parent so the store pre-check passes.
  const storeId = '0123456789abcdef0123456789abcdef';
  const locator = join(layout.storesDir, storeId);
  mkdirSync(join(locator, 'store-v1'), { recursive: true, mode: 0o700 });
  mkdirSync(join(locator, 'config-v1'), { recursive: true, mode: 0o700 });
  mkdirSync(layout.gitHomeDir, { recursive: true, mode: 0o700 });
  mkdirSync(layout.gitTmpDir, { recursive: true, mode: 0o700 });
  const root = join(env, 'proj');
  mkdirSync(root, { mode: 0o700 });
  mkdirSync(join(root, 'artifacts'), { recursive: true, mode: 0o700 });
  mkdirSync(layout.configDir, { recursive: true, mode: 0o700 });
  writeFileSync(layout.runtimeConfigPath, JSON.stringify({
    surfaces: [{
      surfaceId: `pgw-${storeId}`,
      locator,
      serviceUid: 1000,
      forbiddenRoots: [root],
      configurationIdentity: `sha-256:${'0'.repeat(64)}`,
      configurationVersion: '2',
      limitProfile: {},
      workspaces: [{ workspaceId: `pgw:w:${storeId}`, root, artifactLocation: join(root, 'artifacts') }],
      gitPath: '/fixture/git',
      gitHome: join(layout.gitHomeDir, storeId),
      gitTmpdir: join(layout.gitTmpDir, storeId),
    }],
  }, null, 2) + '\n', { mode: 0o600 });
  const pathEnv = fixturePathEnv(env, { HOME: env, ...extra });
  return {
    env,
    layout,
    pathEnv,
    ns,
    ctx: {
      env: { home: env, platform: 'linux', arch: 'x64' },
      layout,
      nodeExecutable: process.execPath,
      pathEnv,
      resolveManifestNative: nativeResolver(verifier),
    },
  };
}

function codeOf(outcome: { readonly exitCode: number }): number {
  return outcome.exitCode;
}

test('start-mn: valid installation resolves the exact verified bin and launches through the running Node (A/N)', async () => {
  const { env, layout, ns, ctx } = await startEnv({}, { binContent: RECORDING_BIN });
  const record = join(env, 'bin-record.txt');
  try {
    const outcome = await runStartCommand({ ...ctx, pathEnv: { ...ctx.pathEnv, FIXTURE_BIN_RECORD: record }, forwardSignals: false });
    assert.equal(codeOf(outcome), 0, outcome.stderr);
    assert.equal(outcome.stdout, '', 'pi-shuttle must never write to the protocol stream');
    const recorded = (await import('node:fs')).readFileSync(record, 'utf8').trim();
    assert.equal(recorded, ns.binPath, 'the EXACT verified bin path must be executed (not a caller-provided executable)');
    assert.equal(recorded.startsWith(ns.packageRoot), true, 'the executed bin must be confined to the verified package root');
    assert.equal(outcome.stderr, '');
    void layout;
  } finally {
    removeNativeBase(env);
  }
});

test('start-mn: valid expired cached metadata still starts offline (B)', async () => {
  const expiredVerifier = fixtureVerifier(new Date('2035-06-01T00:00:00.000Z'));
  const { env, ctx } = await startEnv({}, { binContent: RECORDING_BIN, verifier: expiredVerifier });
  const record = join(env, 'bin-record.txt');
  try {
    const outcome = await runStartCommand({ ...ctx, pathEnv: { ...ctx.pathEnv, FIXTURE_BIN_RECORD: record } });
    assert.equal(codeOf(outcome), 0, 'cached keyring/channel expiration must not block an otherwise valid installed release');
    assert.equal(outcome.stderr, '');
  } finally {
    rmSync(record, { force: true });
    removeNativeBase(env);
  }
});

test('start-mn: malformed receipt refuses before any child (C)', async () => {
  const { env, ns, ctx } = await startEnv();
  try {
    writeFileSync(ns.layout.receiptPath, '{broken');
    const outcome = await runStartCommand(ctx);
    assert.equal(codeOf(outcome), 1);
    assert.equal(outcome.stdout, '', 'no Gateway child may be spawned');
    assert.ok(outcome.stderr.includes('ERR-MN-START-STATE-MALFORMED'), outcome.stderr);
  } finally {
    removeNativeBase(env);
  }
});

test('start-mn: tampered cache refuses before any child (D)', async () => {
  const { env, ns, ctx } = await startEnv();
  try {
    const envelope = JSON.parse((await import('node:fs')).readFileSync(ns.cachePath, 'utf8')) as { releaseManifest: string };
    const release = JSON.parse(envelope.releaseManifest) as { payload: { version: string } };
    release.payload.version = '0.2.0';
    envelope.releaseManifest = JSON.stringify(release);
    writeFileSync(ns.cachePath, JSON.stringify(envelope));
    const outcome = await runStartCommand(ctx);
    assert.equal(codeOf(outcome), 1);
    assert.equal(outcome.stdout, '');
    assert.ok(outcome.stderr.includes('ERR-MN-START-STATE-MALFORMED'), outcome.stderr);
  } finally {
    removeNativeBase(env);
  }
});

test('start-mn: tree content change refuses (full tree hash before spawn) (E/M)', async () => {
  const { env, ns, ctx } = await startEnv();
  try {
    writeFileSync(join(ns.packageRoot, 'lib', 'core.js'), 'export const core = 2;\n');
    const outcome = await runStartCommand(ctx);
    assert.equal(codeOf(outcome), 1);
    assert.equal(outcome.stdout, '', 'the tampered tree must be detected by the full hash BEFORE spawn');
    assert.ok(outcome.stderr.includes('ERR-MN-START-STATE-MALFORMED'), outcome.stderr);
    assert.ok(outcome.stderr.includes('tree'), outcome.stderr);
  } finally {
    removeNativeBase(env);
  }
});

test('start-mn: path change refuses before any child (F)', async () => {
  const { env, ns, ctx } = await startEnv();
  try {
    const { renameSync } = await import('node:fs');
    renameSync(join(ns.packageRoot, 'bin', 'run.js'), join(ns.packageRoot, 'bin', 'moved.js'));
    const outcome = await runStartCommand(ctx);
    assert.equal(codeOf(outcome), 1);
    assert.equal(outcome.stdout, '');
    assert.ok(outcome.stderr.includes('ERR-MN-START-STATE-MALFORMED'), outcome.stderr);
  } finally {
    removeNativeBase(env);
  }
});

test('start-mn: symlinked bin refuses before any child (G)', async () => {
  const { env, ns, ctx } = await startEnv();
  try {
    rmSync(ns.binPath);
    symlinkSync(join(ns.packageRoot, 'lib', 'core.js'), ns.binPath);
    const outcome = await runStartCommand(ctx);
    assert.equal(codeOf(outcome), 1);
    assert.equal(outcome.stdout, '');
    assert.ok(outcome.stderr.includes('ERR-MN-START-STATE-MALFORMED'), outcome.stderr);
  } finally {
    removeNativeBase(env);
  }
});

test('start-mn: unsafe bin mode refuses before any child (H, MN-B-04 mode policy)', async () => {
  const { env, ns, ctx } = await startEnv({ FIXTURE_GATEWAY_START: '1' });
  try {
    // Modes are excluded from the tree digest, but the runtime mode policy
    // (enforced in the same tree walk) fails closed on group/world bits —
    // resolution becomes MALFORMED and start refuses before any child.
    chmodSync(ns.binPath, 0o644);
    const outcome = await runStartCommand(ctx);
    assert.equal(codeOf(outcome), 1);
    assert.equal(outcome.stdout, '', 'no child may spawn with an unsafe bin');
    assert.ok(outcome.stderr.includes('ERR-MN-START-STATE-MALFORMED'), outcome.stderr);
    assert.ok(outcome.stderr.includes('mode'), outcome.stderr);
  } finally {
    removeNativeBase(env);
  }
});

test('start-mn: unsafe imported-module mode refuses before any child (MN-B-04 propagation)', async () => {
  const { env, ns, ctx } = await startEnv();
  try {
    // A non-bin imported module with group/world access must fail closed —
    // not only the bin.
    chmodSync(join(ns.packageRoot, 'lib', 'core.js'), 0o644);
    const outcome = await runStartCommand(ctx);
    assert.equal(codeOf(outcome), 1);
    assert.equal(outcome.stdout, '', 'no child may spawn when an imported module is unsafe');
    assert.ok(outcome.stderr.includes('ERR-MN-START-STATE-MALFORMED'), outcome.stderr);
  } finally {
    removeNativeBase(env);
  }
});

test('start-mn: unsafe nested directory mode refuses before any child (MN-B-04 propagation)', async () => {
  const { env, ns, ctx } = await startEnv();
  try {
    chmodSync(join(ns.packageRoot, 'lib'), 0o755);
    const outcome = await runStartCommand(ctx);
    assert.equal(codeOf(outcome), 1);
    assert.equal(outcome.stdout, '');
    assert.ok(outcome.stderr.includes('ERR-MN-START-STATE-MALFORMED'), outcome.stderr);
  } finally {
    removeNativeBase(env);
  }
});

test('start-mn: wrong bin type refuses before any child (I)', async () => {
  const { env, ns, ctx } = await startEnv();
  try {
    rmSync(ns.binPath);
    mkdirSync(ns.binPath, { mode: 0o700 });
    const outcome = await runStartCommand(ctx);
    assert.equal(codeOf(outcome), 1);
    assert.equal(outcome.stdout, '');
    assert.ok(outcome.stderr.includes('ERR-MN-START-STATE-MALFORMED'), outcome.stderr);
  } finally {
    removeNativeBase(env);
  }
});

test('start-mn: lane mismatch refuses before any child (J)', async () => {
  const { env, ctx } = await startEnv();
  try {
    const outcome = await runStartCommand({ ...ctx, env: { home: env, platform: 'darwin', arch: 'arm64' } });
    assert.equal(codeOf(outcome), 1);
    assert.equal(outcome.stdout, '');
    assert.ok(outcome.stderr.includes('ERR-MN-START-STATE-MALFORMED'), outcome.stderr);
    assert.ok(outcome.stderr.includes('lane'), outcome.stderr);
  } finally {
    removeNativeBase(env);
  }
});

test('start-mn: protocol mismatch refuses against the compiled policy (K)', async () => {
  const env = makeEnv();
  try {
    const permissivePolicy = { ...FIXTURE_POLICY, supportedInstallProtocols: [1, 2] as readonly number[] };
    const permissiveVerifier = createTrustVerifier(permissivePolicy, () => new Date(FIXTURE_NOW.getTime()));
    const layout = resolveLayout(env);
    const ns = await materializeNativeNamespace(env, { installProtocol: 2 }, startTreeFiles(RECORDING_BIN), permissiveVerifier);
    const pathEnv = fixturePathEnv(env, { HOME: env });
    mkdirSync(join(layout.storesDir, '0123456789abcdef0123456789abcdef', 'store-v1'), { recursive: true, mode: 0o700 });
    mkdirSync(layout.configDir, { recursive: true, mode: 0o700 });
    writeFileSync(layout.runtimeConfigPath, JSON.stringify({ surfaces: [{
      surfaceId: 'pgw-x', locator: join(layout.storesDir, '0123456789abcdef0123456789abcdef'),
      serviceUid: 1000, forbiddenRoots: [join(env, 'proj')], configurationIdentity: `sha-256:${'0'.repeat(64)}`,
      configurationVersion: '2', limitProfile: {},
      workspaces: [{ workspaceId: 'pgw:w:x', root: join(env, 'proj'), artifactLocation: join(env, 'proj', 'artifacts') }],
      gitPath: '/fixture/git', gitHome: join(layout.gitHomeDir, 'x'), gitTmpdir: join(layout.gitTmpDir, 'x'),
    }] }, null, 2) + '\n', { mode: 0o600 });
    const outcome = await runStartCommand({
      env: { home: env, platform: 'linux', arch: 'x64' },
      layout,
      nodeExecutable: process.execPath,
      pathEnv,
      resolveManifestNative: nativeResolver(permissiveVerifier),
    });
    assert.equal(codeOf(outcome), 1);
    assert.equal(outcome.stdout, '');
    assert.ok(outcome.stderr.includes('ERR-MN-START-STATE-MALFORMED'), outcome.stderr);
    assert.ok(outcome.stderr.includes('protocol'), outcome.stderr);
    void ns;
  } finally {
    removeNativeBase(env);
  }
});

test('start-mn: CLEAN state refuses with a typed no-installation condition and no fallback (L)', async () => {
  const env = makeEnv();
  try {
    const layout = resolveLayout(env);
    const pathEnv = fixturePathEnv(env, { HOME: env });
    const outcome = await runStartCommand({
      env: { home: env, platform: 'linux', arch: 'x64' },
      layout,
      nodeExecutable: process.execPath,
      pathEnv,
      resolveManifestNative: nativeResolver(),
    });
    assert.equal(codeOf(outcome), 1);
    assert.equal(outcome.stdout, '');
    assert.ok(outcome.stderr.includes('ERR-MN-START-NO-INSTALLATION'), outcome.stderr);
    assert.ok(outcome.stderr.includes('no manifest-native installation'), outcome.stderr);
  } finally {
    removeNativeBase(env);
  }
});

test('start-mn: exit code propagates truthfully (O)', async () => {
  const { env, ctx } = await startEnv({ FIXTURE_GATEWAY_START: '1', FIXTURE_GATEWAY_IMMEDIATE: '1', FIXTURE_GATEWAY_EXIT: '42', FIXTURE_GATEWAY_MARKER: 'MARKER-LINE' });
  try {
    const outcome = await runStartCommand({ ...ctx, forwardSignals: false });
    assert.equal(codeOf(outcome), 42, 'the Gateway exit code must propagate as-is');
  } finally {
    removeNativeBase(env);
  }
});

test('start-mn: signal forwarding propagates the child signal status (O)', async () => {
  const { env, ctx } = await startEnv({}, { binContent: WAITING_BIN });
  const ready = join(env, 'ready.txt');
  try {
    const outcomePromise = runStartCommand({ ...ctx, pathEnv: { ...ctx.pathEnv, FIXTURE_READY_FILE: ready }, forwardSignals: true });
    // Wait for the child to be up (bounded), then forward SIGTERM through
    // the installed listeners exactly like the real CLI path.
    const deadline = Date.now() + 5000;
    while (!(await import('node:fs')).existsSync(ready)) {
      if (Date.now() > deadline) throw new Error('child never became ready');
      await new Promise((r) => setTimeout(r, 20));
    }
    process.emit('SIGTERM');
    const outcome = await outcomePromise;
    assert.equal(codeOf(outcome), 143, '128 + SIGTERM(15) = 143, the conventional propagated status');
    assert.equal(process.listenerCount('SIGTERM'), 0, 'forwarding listeners must be removed at the terminal state');
  } finally {
    rmSync(ready, { force: true });
    removeNativeBase(env);
  }
});

test('start-mn: no registered projects refuses before any child (config gate)', async () => {
  const { env, layout, pathEnv, ns } = await startEnv();
  try {
    rmSync(layout.runtimeConfigPath);
    const outcome = await runStartCommand({
      env: { home: env, platform: 'linux', arch: 'x64' },
      layout,
      nodeExecutable: process.execPath,
      pathEnv,
      resolveManifestNative: nativeResolver(),
    });
    assert.equal(codeOf(outcome), 1);
    assert.equal(outcome.stdout, '');
    assert.ok(outcome.stderr.includes('no registered projects'), outcome.stderr);
    void ns;
  } finally {
    removeNativeBase(env);
  }
});

test('start-mn: malformed runtime config refuses before any child', async () => {
  const { env, layout, pathEnv } = await startEnv();
  try {
    writeFileSync(layout.runtimeConfigPath, '{"foreign": true}', { mode: 0o600 });
    const outcome = await runStartCommand({
      env: { home: env, platform: 'linux', arch: 'x64' },
      layout,
      nodeExecutable: process.execPath,
      pathEnv,
      resolveManifestNative: nativeResolver(),
    });
    assert.equal(codeOf(outcome), 1);
    assert.equal(outcome.stdout, '');
    assert.ok(outcome.stderr.includes('invalid'), outcome.stderr);
  } finally {
    removeNativeBase(env);
  }
});

test('start-mn: missing trusted store parent refuses with re-add guidance', async () => {
  const env = makeEnv();
  try {
    const layout = resolveLayout(env);
    const verifier = fixtureVerifier(FIXTURE_NOW);
    const ns = await materializeNativeNamespace(env, {}, startTreeFiles(RECORDING_BIN), verifier);
    const pathEnv = fixturePathEnv(env, { HOME: env });
    const storeId = '0123456789abcdef0123456789abcdef';
    const missingLocator = join(layout.storesDir, storeId);
    mkdirSync(layout.configDir, { recursive: true, mode: 0o700 });
    writeFileSync(layout.runtimeConfigPath, JSON.stringify({ surfaces: [{
      surfaceId: `pgw-${storeId}`, locator: missingLocator, serviceUid: 1000,
      forbiddenRoots: [join(env, 'proj')], configurationIdentity: `sha-256:${'0'.repeat(64)}`,
      configurationVersion: '2', limitProfile: {},
      workspaces: [{ workspaceId: `pgw:w:${storeId}`, root: join(env, 'proj'), artifactLocation: join(env, 'proj', 'artifacts') }],
      gitPath: '/fixture/git', gitHome: join(layout.gitHomeDir, storeId), gitTmpdir: join(layout.gitTmpDir, storeId),
    }] }, null, 2) + '\n', { mode: 0o600 });
    const outcome = await runStartCommand({
      env: { home: env, platform: 'linux', arch: 'x64' },
      layout,
      nodeExecutable: process.execPath,
      pathEnv,
      resolveManifestNative: nativeResolver(verifier),
    });
    assert.equal(codeOf(outcome), 1);
    assert.equal(outcome.stdout, '');
    assert.ok(outcome.stderr.includes('ERR-PS4-START-STORE-MISSING'), outcome.stderr);
    assert.equal((await import('node:fs')).existsSync(missingLocator), false, 'start must never create store state');
    void ns;
  } finally {
    removeNativeBase(env);
  }
});

test('start-mn: never invokes bootstrap; fixed argv composition (O)', async () => {
  const { env, ctx } = await startEnv({ FIXTURE_GATEWAY_START: '1', FIXTURE_GATEWAY_IMMEDIATE: '1', FIXTURE_GATEWAY_EXIT: '0' });
  try {
    const outcome = await runStartCommand({ ...ctx, forwardSignals: false });
    // If start ever passed `bootstrap` or a non-`--config` argv shape, the
    // fixture exits 2/3. Exit 0 proves the exact fixed composition.
    assert.equal(codeOf(outcome), 0, outcome.stderr);
  } finally {
    removeNativeBase(env);
  }
});

test('start-mn: unsupported platform (windows) exits 2 without composing a Gateway process', async () => {
  const { env, layout, pathEnv } = await startEnv();
  try {
    const outcome = await runStartCommand({
      env: { home: env, platform: 'win32', arch: 'x64' },
      layout,
      nodeExecutable: process.execPath,
      pathEnv,
      resolveManifestNative: nativeResolver(),
    });
    assert.equal(codeOf(outcome), 2);
    assert.equal(outcome.stdout, '');
    assert.ok(outcome.stderr.includes('ERR-PS4-PREFLIGHT-PLATFORM'), outcome.stderr);
  } finally {
    removeNativeBase(env);
  }
});

test('start-mn: darwin lanes reach the manifest-native gate, never the platform gate', async () => {
  const env = makeEnv();
  try {
    const layout = resolveLayout(env);
    const pathEnv = fixturePathEnv(env, { HOME: env });
    for (const arch of ['x64', 'arm64']) {
      const outcome = await runStartCommand({
        env: { home: env, platform: 'darwin', arch },
        layout,
        nodeExecutable: process.execPath,
        pathEnv,
        resolveManifestNative: nativeResolver(),
      });
      assert.equal(codeOf(outcome), 1, `darwin/${arch} must reach the manifest-native gate`);
      assert.ok(outcome.stderr.includes('ERR-MN-START-NO-INSTALLATION'), outcome.stderr);
      assert.ok(!outcome.stderr.includes('ERR-PS4-PREFLIGHT-PLATFORM'), outcome.stderr);
    }
  } finally {
    removeNativeBase(env);
  }
});
