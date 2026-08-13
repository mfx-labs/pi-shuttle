/**
 * PS-4 focused tests: `pi-shuttle start` — runtime composition ONLY.
 * Proves: valid config launches the exact Gateway executable; malformed /
 * absent config refuses BEFORE any child; missing Gateway refuses; child
 * exit code propagation; signal forwarding; protocol-clean stdout (no
 * pi-shuttle text on the MCP stream); stderr diagnostics only before
 * start; and that start never invokes bootstrap.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { resolveLayout } from '../../src/host/environment.js';
import { runStartCommand } from '../../src/lifecycle/start.js';
import { cleanupEnv, fixturePathEnv, installFixtureGateway, makeEnv, makeProjectRoot, writeReceiptFixture } from '../helpers/lifecycle-fixtures.js';
import { newReceipt, writeReceipt } from '../../src/installer/receipt.js';
import type { InstallReceipt } from '../../src/installer/receipt.js';

/** Build a registered runtime config (what `project add` persists) directly. */
function writeRuntimeFixture(env: string, root: string, overrides: { readonly locator?: string } = {}): { readonly runtimePath: string; readonly locator: string } {
  const layout = resolveLayout(env);
  const storeId = '0123456789abcdef0123456789abcdef';
  const locator = overrides.locator ?? join(layout.storesDir, storeId);
  mkdirSync(join(locator, 'store-v1'), { recursive: true, mode: 0o700 });
  mkdirSync(join(locator, 'config-v1'), { recursive: true, mode: 0o700 });
  mkdirSync(join(layout.gitHomeDir, storeId), { recursive: true, mode: 0o700 });
  mkdirSync(join(layout.gitTmpDir, storeId), { recursive: true, mode: 0o700 });
  mkdirSync(join(root, 'artifacts'), { recursive: true, mode: 0o700 });
  const document = {
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
  };
  mkdirSync(layout.configDir, { recursive: true, mode: 0o700 });
  writeFileSync(layout.runtimeConfigPath, JSON.stringify(document, null, 2) + '\n', { mode: 0o600 });
  return { runtimePath: layout.runtimeConfigPath, locator };
}

/** A fully healthy start environment (receipt + package + runtime config). */
function startEnv(extra: NodeJS.ProcessEnv = {}): { readonly env: string; readonly root: string; readonly layout: ReturnType<typeof resolveLayout>; readonly pathEnv: NodeJS.ProcessEnv } {
  const env = makeEnv();
  const layout = resolveLayout(env);
  const gateway = installFixtureGateway(env);
  writeReceiptFixture(env);
  const root = makeProjectRoot(env);
  writeRuntimeFixture(env, root);
  return { env, root, layout, pathEnv: fixturePathEnv(env, { HOME: env, ...extra }) };
}

/** Run start with an open stdin so the fixture Gateway stays alive until EOF. */
function runStart(pathEnv: NodeJS.ProcessEnv): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  // The MCP client closes the connection after a bounded moment (models a
  // client EOF); the fixture Gateway then exits with the configured code.
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(import.meta.dirname, '..', '..', '..', 'dist', 'cli.js'), 'start'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: pathEnv,
    });
    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    child.stderr!.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    child.on('error', reject);
    child.stdin!.end();
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('start: valid config launches the exact Gateway; stdout stays protocol-clean; exit code propagates', async () => {
  const { env, pathEnv } = startEnv({ FIXTURE_GATEWAY_START: '1', FIXTURE_GATEWAY_EXIT: '42', FIXTURE_GATEWAY_MARKER: 'MARKER-LINE' });
  try {
    const run = await runStart(pathEnv);
    assert.equal(run.code, 42, run.stderr);
    // stdout contains ONLY the Gateway's own protocol marker — no pi-shuttle text.
    assert.equal(run.stdout, 'MARKER-LINE\n');
    assert.equal(run.stderr, '');
  } finally {
    cleanupEnv(env);
  }
});

test('start: no registered projects refuses before any child (stderr only, stdout empty)', async () => {
  const env = makeEnv();
  try {
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const pathEnv = fixturePathEnv(env, { HOME: env, FIXTURE_GATEWAY_START: '1' });
    const run = await runStart(pathEnv);
    assert.equal(run.code, 1);
    assert.equal(run.stdout, '');
    assert.ok(run.stderr.includes('no registered projects'), run.stderr);
    assert.ok(run.stderr.includes('project add'), run.stderr);
  } finally {
    cleanupEnv(env);
  }
});

test('start: malformed runtime config refuses before any child', async () => {
  const env = makeEnv();
  try {
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const layout = resolveLayout(env);
    mkdirSync(layout.configDir, { recursive: true, mode: 0o700 });
    writeFileSync(layout.runtimeConfigPath, '{"foreign": true}', { mode: 0o600 });
    const pathEnv = fixturePathEnv(env, { HOME: env, FIXTURE_GATEWAY_START: '1', FIXTURE_GATEWAY_MARKER: 'MUST-NOT-APPEAR' });
    const run = await runStart(pathEnv);
    assert.equal(run.code, 1);
    assert.equal(run.stdout, '', 'no Gateway child may be spawned; nothing on the protocol stream');
    assert.ok(run.stderr.includes('invalid'), run.stderr);
  } finally {
    cleanupEnv(env);
  }
});

test('start: missing Gateway executable refuses before any child', async () => {
  const env = makeEnv();
  try {
    const gateway = installFixtureGateway(env);
    writeReceiptFixture(env);
    const root = makeProjectRoot(env);
    writeRuntimeFixture(env, root);
    rmSync(gateway.binPath);
    const pathEnv = fixturePathEnv(env, { HOME: env, FIXTURE_GATEWAY_START: '1', FIXTURE_GATEWAY_MARKER: 'MUST-NOT-APPEAR' });
    const run = await runStart(pathEnv);
    assert.equal(run.code, 1);
    assert.equal(run.stdout, '');
    assert.ok(run.stderr.includes('ERR-PS4-START-GATEWAY-BIN'), run.stderr);
  } finally {
    cleanupEnv(env);
  }
});

test('start: missing trusted store parent refuses with re-add guidance', async () => {
  const env = makeEnv();
  try {
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const root = makeProjectRoot(env);
    const layout = resolveLayout(env);
    const storeId = '0123456789abcdef0123456789abcdef';
    const missingLocator = join(layout.storesDir, storeId);
    mkdirSync(join(layout.gitHomeDir, storeId), { recursive: true, mode: 0o700 });
    mkdirSync(join(layout.gitTmpDir, storeId), { recursive: true, mode: 0o700 });
    mkdirSync(join(root, 'artifacts'), { recursive: true, mode: 0o700 });
    // Runtime config referencing a locator that does NOT exist (the store
    // parent must never be created by the fixture here).
    mkdirSync(layout.configDir, { recursive: true, mode: 0o700 });
    writeFileSync(layout.runtimeConfigPath, JSON.stringify({
      surfaces: [{
        surfaceId: `pgw-${storeId}`,
        locator: missingLocator,
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
    const pathEnv = fixturePathEnv(env, { HOME: env, FIXTURE_GATEWAY_START: '1' });
    const run = await runStart(pathEnv);
    assert.equal(run.code, 1);
    assert.equal(run.stdout, '');
    assert.ok(run.stderr.includes('ERR-PS4-START-STORE-MISSING'), run.stderr);
    assert.equal(existsSync(missingLocator), false, 'start must never create store state');
  } finally {
    cleanupEnv(env);
  }
});

test('start: locator exists but store-v1 missing refuses before any child, with no filesystem mutation (SIR-PS4-002)', async () => {
  const env = makeEnv();
  try {
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const root = makeProjectRoot(env);
    const layout = resolveLayout(env);
    const storeId = '0123456789abcdef0123456789abcdef';
    const locator = join(layout.storesDir, storeId);
    mkdirSync(locator, { recursive: true, mode: 0o700 });
    mkdirSync(join(layout.gitHomeDir, storeId), { recursive: true, mode: 0o700 });
    mkdirSync(join(layout.gitTmpDir, storeId), { recursive: true, mode: 0o700 });
    mkdirSync(join(root, 'artifacts'), { recursive: true, mode: 0o700 });
    // Runtime config referencing a locator whose parent EXISTS but whose
    // store-v1 does NOT (partial state).
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
    const pathEnv = fixturePathEnv(env, { HOME: env, FIXTURE_GATEWAY_START: '1', FIXTURE_GATEWAY_MARKER: 'MUST-NOT-APPEAR' });
    const run = await runStart(pathEnv);
    assert.equal(run.code, 1);
    assert.equal(run.stdout, '', 'no Gateway child may be spawned; nothing on the protocol stream');
    assert.ok(run.stderr.includes('ERR-PS4-START-STORE-V1-MISSING'), run.stderr);
    assert.ok(run.stderr.includes('project add'), run.stderr);
    // Local presence observation only — never creates store state.
    assert.equal(existsSync(join(locator, 'store-v1')), false, 'start must never create store state');
  } finally {
    cleanupEnv(env);
  }
});

test('start: signal-forwarding listeners are removed after child exit; repeated invocations do not accumulate (SIR-PS4-003)', async () => {
  const env = makeEnv();
  try {
    const { layout, pathEnv } = startEnv({ FIXTURE_GATEWAY_START: '1', FIXTURE_GATEWAY_IMMEDIATE: '1' });
    const baseline = {
      SIGINT: process.listenerCount('SIGINT'),
      SIGTERM: process.listenerCount('SIGTERM'),
      SIGHUP: process.listenerCount('SIGHUP'),
    };
    const ctx = { env: { home: env, platform: 'linux', arch: 'x64' }, layout, nodeExecutable: process.execPath, pathEnv, forwardSignals: true };
    for (let i = 0; i < 3; i++) {
      const outcome = await runStartCommand(ctx);
      assert.equal(outcome.exitCode, 0, outcome.stderr);
      assert.equal(process.listenerCount('SIGINT'), baseline.SIGINT, 'SIGINT listeners must not accumulate');
      assert.equal(process.listenerCount('SIGTERM'), baseline.SIGTERM, 'SIGTERM listeners must not accumulate');
      assert.equal(process.listenerCount('SIGHUP'), baseline.SIGHUP, 'SIGHUP listeners must not accumulate');
    }
  } finally {
    cleanupEnv(env);
  }
});

test('start: cleanup removes only listeners installed by this invocation (SIR-PS4-003)', async () => {
  const env = makeEnv();
  try {
    const { layout, pathEnv } = startEnv({ FIXTURE_GATEWAY_START: '1', FIXTURE_GATEWAY_IMMEDIATE: '1' });
    const unrelated = (): void => { /* unrelated listener must survive cleanup */ };
    process.on('SIGTERM', unrelated);
    try {
      const baselineSigterm = process.listenerCount('SIGTERM');
      const ctx = { env: { home: env, platform: 'linux', arch: 'x64' }, layout, nodeExecutable: process.execPath, pathEnv, forwardSignals: true };
      const outcome = await runStartCommand(ctx);
      assert.equal(outcome.exitCode, 0, outcome.stderr);
      assert.equal(process.listenerCount('SIGTERM'), baselineSigterm, 'the unrelated listener must survive');
      assert.equal(process.listeners('SIGTERM').includes(unrelated), true, 'the unrelated listener must still be installed');
    } finally {
      process.removeListener('SIGTERM', unrelated);
    }
  } finally {
    cleanupEnv(env);
  }
});

test('start: unsupported platform exits 2 without composing a Gateway process', async () => {
  const env = makeEnv();
  try {
    const { layout } = startEnv({ FIXTURE_GATEWAY_START: '1' });
    const ctx = { env: { home: env, platform: 'darwin', arch: 'arm64' }, layout, nodeExecutable: process.execPath, pathEnv: fixturePathEnv(env, { FIXTURE_GATEWAY_START: '1' }) };
    const outcome = await runStartCommand(ctx);
    assert.equal(outcome.exitCode, 2);
    assert.equal(outcome.stdout, '');
    assert.ok(outcome.stderr.includes('ERR-PS4-PREFLIGHT-PLATFORM'), outcome.stderr);
  } finally {
    cleanupEnv(env);
  }
});

test('start: no receipt refuses (fail closed; never infers from disk)', async () => {
  const env = makeEnv();
  try {
    installFixtureGateway(env);
    const root = makeProjectRoot(env);
    writeRuntimeFixture(env, root);
    const pathEnv = fixturePathEnv(env, { HOME: env, FIXTURE_GATEWAY_START: '1' });
    const run = await runStart(pathEnv);
    assert.equal(run.code, 1);
    assert.ok(run.stderr.includes('ERR-PS4-RECEIPT-ABSENT'), run.stderr);
    assert.equal(run.stdout, '');
  } finally {
    cleanupEnv(env);
  }
});

test('start: signal forwarding propagates the child signal status (real CLI, SIGTERM)', async () => {
  const env = makeEnv();
  try {
    const { pathEnv } = startEnv({ FIXTURE_GATEWAY_START: '1' });
    const child = await new Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }>((resolve, reject) => {
      const proc = spawn(process.execPath, [join(import.meta.dirname, '..', '..', '..', 'dist', 'cli.js'), 'start'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: pathEnv,
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d: Buffer) => {
        stdout += d.toString('utf8');
        // The Gateway marker on stdout proves the child is up; then signal
        // the pi-shuttle process (which forwards to the Gateway child).
        if (stdout.includes('PROTOCOL-MARKER')) proc.kill('SIGTERM');
      });
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
      proc.on('error', reject);
      proc.on('close', (code) => resolve({ code, stdout, stderr }));
    });
    // 128 + SIGTERM(15) = 143, the conventional propagated status.
    assert.equal(child.code, 143, child.stderr);
    assert.equal(child.stdout, 'PROTOCOL-MARKER\n', 'no pi-shuttle text may contaminate the protocol stream');
  } finally {
    cleanupEnv(env);
  }
});

test('start: never invokes bootstrap — the fixture rejects any bootstrap argv in start mode', async () => {
  const env = makeEnv();
  try {
    const gateway = installFixtureGateway(env);
    writeReceiptFixture(env);
    const root = makeProjectRoot(env);
    writeRuntimeFixture(env, root);
    // If pi-shuttle start ever passed `bootstrap`, the fixture exits 3/4.
    const pathEnv = fixturePathEnv(env, { HOME: env, FIXTURE_GATEWAY_START: '1' });
    const run = await runStart(pathEnv);
    assert.equal(run.code, 0, run.stderr);
    assert.ok(run.stdout.includes('PROTOCOL-MARKER'), run.stdout);
    assert.ok(existsSync(gateway.binPath));
  } finally {
    cleanupEnv(env);
  }
});

test('start: direct handler refuses on unverified gateway receipt entry', async () => {
  const env = makeEnv();
  try {
    const gateway = installFixtureGateway(env);
    const layout = resolveLayout(env);
    const receipt = newReceipt({
      platformLane: 'linux-x86_64-posix-utf8-node22',
      result: 'PARTIAL',
      installDir: layout.shareDir,
      binDir: layout.binDir,
      gateway: {
        status: 'installed-unverified',
        version: '0.1.0',
        commit: '7f3b4afdb43704e7dac82da7b086d8367347c641',
        commitVerified: false,
        digestVerified: false,
        artifactSha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        installPath: gateway.installPath,
        binPath: gateway.binPath,
        smoke: 'not-run',
      },
      piGuard: null,
      omitted: ['pi-guard'],
      notes: [],
    });
    const written = writeReceipt(layout.installReceiptPath, receipt);
    assert.equal(written.ok, true);
    const root = makeProjectRoot(env);
    writeRuntimeFixture(env, root);
    const ctx = { env: { home: env, platform: 'linux', arch: 'x64' }, layout, nodeExecutable: process.execPath, pathEnv: fixturePathEnv(env, { FIXTURE_GATEWAY_START: '1' }) };
    const outcome = await runStartCommand(ctx);
    assert.equal(outcome.exitCode, 1);
    assert.ok(outcome.stderr.includes('ERR-PS4-RECEIPT-GATEWAY-UNVERIFIED'), outcome.stderr);
  } finally {
    cleanupEnv(env);
  }
});
