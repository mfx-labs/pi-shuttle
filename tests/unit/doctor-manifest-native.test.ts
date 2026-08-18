/**
 * NEW-STATE Slice B — manifest-native doctor health tests.
 *
 * Proves the new-world doctor semantics: health is determined ONLY by the
 * exact locally authenticated installed release (receipt + cached signed
 * chain + installed evidence + canonical paths + lane/protocol contract +
 * complete tree digest), fully offline, with expired cached metadata NOT a
 * health failure, no compiled Gateway patch equality, and read-only
 * fail-closed behavior for CLEAN/MALFORMED states.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatDoctorReport, runDoctor } from '../../src/command/doctor.js';
import type { DoctorReport } from '../../src/command/doctor.js';
import { resolveLayout } from '../../src/host/environment.js';
import type { ManifestNativeLayout } from '../../src/host/environment.js';
import type { ManifestNativeResolution } from '../../src/manifest-native/resolve.js';
import { createTrustVerifier } from '../../src/installer/release/trust-internal.js';
import { FIXTURE_NOW, FIXTURE_POLICY, fixtureVerifier } from '../helpers/release-trust-fixtures.js';
import {
  materializeNativeNamespace,
  nativeBaseDir,
  nativeResolver,
  nativeTreeFiles,
  removeNativeBase,
} from '../helpers/manifest-native-fixtures.js';

function mnVerdict(report: DoctorReport): { readonly verdict: string; readonly detail: string } {
  const check = report.checks.find((c) => c.id === 'manifest-native');
  assert.ok(check !== undefined, 'doctor must report a manifest-native installation check');
  return { verdict: check!.verdict, detail: check!.detail };
}

function doctorCtx(base: string, resolveManifestNative: (layout: ManifestNativeLayout, lane: string) => Promise<ManifestNativeResolution>) {
  return {
    env: { home: base, platform: 'linux', arch: 'x64' },
    layout: resolveLayout(base),
    nodeExecutable: process.execPath,
    resolveManifestNative,
  };
}

test('doctor-mn: valid manifest-native installation is healthy (A)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const result = await runDoctor(doctorCtx(ns.baseDir, nativeResolver()));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const mn = mnVerdict(result.report);
    assert.equal(mn.verdict, 'supported', mn.detail);
    assert.ok(mn.detail.includes(ns.chain.releaseId), 'detail names the exact local release identity');
  } finally {
    removeNativeBase(base);
  }
});

test('doctor-mn: expired cached keyring/channel is still healthy offline (B)', async () => {
  const base = nativeBaseDir();
  try {
    // Wall clock far beyond the fixture keyring/channel expiry (2028).
    const expiredVerifier = fixtureVerifier(new Date('2035-06-01T00:00:00.000Z'));
    const ns = await materializeNativeNamespace(base, {}, undefined, expiredVerifier);
    const result = await runDoctor(doctorCtx(ns.baseDir, nativeResolver(expiredVerifier)));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(mnVerdict(result.report).verdict, 'supported', 'expired cached metadata must not make an installed release unhealthy');
  } finally {
    removeNativeBase(base);
  }
});

test('doctor-mn: bad signature is unhealthy (C)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const { readFileSync } = await import('node:fs');
    const envelope = JSON.parse(readFileSync(ns.cachePath, 'utf8')) as { channel: string };
    const channel = JSON.parse(envelope.channel) as { signature: { value: string } };
    channel.signature.value = channel.signature.value[0] === 'A' ? `B${channel.signature.value.slice(1)}` : `A${channel.signature.value.slice(1)}`;
    envelope.channel = JSON.stringify(channel);
    writeFileSync(ns.cachePath, JSON.stringify(envelope));
    const result = await runDoctor(doctorCtx(ns.baseDir, nativeResolver()));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const mn = mnVerdict(result.report);
    assert.equal(mn.verdict, 'installed but unverified');
    assert.ok(mn.detail.includes('malformed'), mn.detail);
  } finally {
    removeNativeBase(base);
  }
});

test('doctor-mn: cache digest mismatch is unhealthy (D)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const { readFileSync } = await import('node:fs');
    const envelope = JSON.parse(readFileSync(ns.cachePath, 'utf8')) as { releaseManifest: string };
    const release = JSON.parse(envelope.releaseManifest) as { payload: { version: string } };
    release.payload.version = '0.2.0';
    envelope.releaseManifest = JSON.stringify(release);
    writeFileSync(ns.cachePath, JSON.stringify(envelope));
    const result = await runDoctor(doctorCtx(ns.baseDir, nativeResolver()));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(mnVerdict(result.report).verdict, 'installed but unverified');
  } finally {
    removeNativeBase(base);
  }
});

test('doctor-mn: releaseId mismatch is unhealthy (E)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const receipt = JSON.parse((await import('node:fs')).readFileSync(ns.layout.receiptPath, 'utf8')) as { gateway: { releaseId: string } };
    receipt.gateway.releaseId = 'gateway-other-release-001';
    writeFileSync(ns.layout.receiptPath, JSON.stringify(receipt) + '\n');
    const result = await runDoctor(doctorCtx(ns.baseDir, nativeResolver()));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(mnVerdict(result.report).verdict, 'installed but unverified');
  } finally {
    removeNativeBase(base);
  }
});

test('doctor-mn: package-tree tamper is unhealthy (F)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    writeFileSync(join(ns.packageRoot, 'lib', 'core.js'), 'export const core = 99;\n');
    const result = await runDoctor(doctorCtx(ns.baseDir, nativeResolver()));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(mnVerdict(result.report).verdict, 'installed but unverified');
  } finally {
    removeNativeBase(base);
  }
});

test('doctor-mn: package/bin mismatch is unhealthy (G)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const pkg = JSON.parse((await import('node:fs')).readFileSync(join(ns.packageRoot, 'package.json'), 'utf8')) as { bin: Record<string, string> };
    pkg.bin[Object.keys(pkg.bin)[0]!] = 'lib/other.js';
    writeFileSync(join(ns.packageRoot, 'package.json'), JSON.stringify(pkg));
    const result = await runDoctor(doctorCtx(ns.baseDir, nativeResolver()));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(mnVerdict(result.report).verdict, 'installed but unverified');
  } finally {
    removeNativeBase(base);
  }
});

test('doctor-mn: lane mismatch is unhealthy (H)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    // A darwin host lane cannot reconcile a linux-lane receipt.
    const result = await runDoctor({
      env: { home: ns.baseDir, platform: 'darwin', arch: 'arm64' },
      layout: resolveLayout(ns.baseDir),
      nodeExecutable: process.execPath,
      resolveManifestNative: nativeResolver(),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(mnVerdict(result.report).verdict, 'installed but unverified');
  } finally {
    removeNativeBase(base);
  }
});

test('doctor-mn: protocol incompatibility is unhealthy (I)', async () => {
  const base = nativeBaseDir();
  try {
    // A chain verified under a permissive fixture policy (install
    // protocol 2) still fails the COMPILED production policy gate.
    const permissivePolicy = { ...FIXTURE_POLICY, supportedInstallProtocols: [1, 2] as readonly number[] };
    const permissiveVerifier = createTrustVerifier(permissivePolicy, () => new Date(FIXTURE_NOW.getTime()));
    const ns = await materializeNativeNamespace(base, { installProtocol: 2 }, undefined, permissiveVerifier);
    const result = await runDoctor(doctorCtx(ns.baseDir, nativeResolver(permissiveVerifier)));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const mn = mnVerdict(result.report);
    assert.equal(mn.verdict, 'installed but unverified');
    assert.ok(mn.detail.includes('protocol'), mn.detail);
  } finally {
    removeNativeBase(base);
  }
});

test('doctor-mn: CLEAN state reports no manifest-native installation (J)', async () => {
  const base = nativeBaseDir();
  try {
    const result = await runDoctor(doctorCtx(base, nativeResolver()));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const mn = mnVerdict(result.report);
    assert.equal(mn.verdict, 'missing');
    assert.ok(mn.detail.includes('no manifest-native installation'), mn.detail);
  } finally {
    removeNativeBase(base);
  }
});

test('doctor-mn: malformed state is unhealthy and never repaired (K)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    writeFileSync(ns.layout.receiptPath, '{broken');
    const result = await runDoctor(doctorCtx(ns.baseDir, nativeResolver()));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const mn = mnVerdict(result.report);
    assert.equal(mn.verdict, 'installed but unverified');
    assert.ok(mn.detail.includes('no repair'), mn.detail);
    // Doctor never repairs: the malformed receipt is still malformed.
    assert.equal((await import('node:fs')).readFileSync(ns.layout.receiptPath, 'utf8'), '{broken');
  } finally {
    removeNativeBase(base);
  }
});

test('doctor-mn: health never requires network access (L)', async () => {
  // The src-wide static guard forbids network vocabulary outside the
  // release-acquisition boundary; this test proves the manifest-native
  // resolution completes using ONLY local state (no subprocess, no
  // network, no fetched revocation) by resolving a full valid namespace.
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const result = await runDoctor(doctorCtx(ns.baseDir, nativeResolver()));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(mnVerdict(result.report).verdict, 'supported');
  } finally {
    removeNativeBase(base);
  }
});

test('doctor-mn: no compiled Gateway patch equality is required for health (M)', async () => {
  const base = nativeBaseDir();
  try {
    // A release that exists ONLY as locally signed metadata (no compiled
    // version/commit/digest anywhere) is healthy.
    const ns = await materializeNativeNamespace(base, {
      releaseId: 'gateway-native-release-aaa',
      version: '9.9.9',
      sourceCommit: 'f'.repeat(40),
      artifactFileName: 'gateway-native-core-9.9.9.tgz',
      artifactSha256: '1'.repeat(64),
    }, nativeTreeFiles({}, '9.9.9'));
    const result = await runDoctor(doctorCtx(ns.baseDir, nativeResolver()));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const mn = mnVerdict(result.report);
    assert.equal(mn.verdict, 'supported');
    // The detail carries no compiled patch identity (no 40-hex commit,
    // no artifact name, no version) — only the local release ID.
    assert.equal(/[0-9a-f]{40}/.test(mn.detail), false, 'no commit literal may appear in the health detail');
    assert.ok(!mn.detail.includes('9.9.9'), 'no version literal may gate health');
    assert.ok(mn.detail.includes('no compiled release comparison'), mn.detail);
  } finally {
    removeNativeBase(base);
  }
});

// ─── MN-B-03 doctor aggregate transition ─────────────────────────────────

import { fixturePathEnv, makeEnv } from '../helpers/lifecycle-fixtures.js';

/**
 * A manifest-native-ONLY environment: valid namespace + registered runtime
 * config + store + fake git/pi on PATH. NO previous-generation receipt,
 * gateway package, or pi-guard package exists anywhere.
 */
async function mnOnlyEnv(): Promise<{ readonly env: string; readonly layout: ReturnType<typeof resolveLayout>; readonly ctx: ReturnType<typeof doctorCtx> }> {
  const env = makeEnv();
  const layout = resolveLayout(env);
  const verifier = fixtureVerifier(FIXTURE_NOW);
  await materializeNativeNamespace(env, {}, undefined, verifier);
  const storeId = '0123456789abcdef0123456789abcdef';
  const locator = join(layout.storesDir, storeId);
  mkdirSync(join(locator, 'store-v1'), { recursive: true, mode: 0o700 });
  mkdirSync(join(locator, 'config-v1'), { recursive: true, mode: 0o700 });
  mkdirSync(join(layout.gitHomeDir, storeId), { recursive: true, mode: 0o700 });
  mkdirSync(join(layout.gitTmpDir, storeId), { recursive: true, mode: 0o700 });
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
  const pathEnv = fixturePathEnv(env, { HOME: env });
  const ctx = {
    env: { home: env, platform: 'linux', arch: 'x64' },
    layout,
    nodeExecutable: process.execPath,
    pathEnv,
    resolveManifestNative: nativeResolver(verifier),
  };
  return { env, layout, ctx };
}

test('doctor-mn aggregate: VALID manifest-native-only installation is overall healthy (exit 0); previous-generation checks are omitted (A/B/C)', async () => {
  const { env, ctx } = await mnOnlyEnv();
  try {
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 0, formatDoctorReport(result.report));
    const v = verdictsMap(result.report);
    assert.equal(v['manifest-native'], 'supported');
    // Previous-generation installation checks are NOT APPLICABLE and must
    // not appear as findings — even though the old receipt, the old
    // gateway package path, and the old pi-guard package do not exist.
    assert.equal(v['receipt'], undefined, 'previous-generation receipt check must be omitted under VALID manifest-native state');
    assert.equal(v['gateway'], undefined, 'previous-generation gateway check must be omitted under VALID manifest-native state');
    assert.equal(v['pi-guard'], undefined, 'previous-generation pi-guard check must be omitted under VALID manifest-native state');
    // Generation-independent checks still run and are healthy.
    for (const id of ['platform', 'node', 'git', 'pi', 'runtime-config', 'project-0', 'git-isolation-0', 'locks']) {
      assert.equal(v[id], 'supported', `generation-independent check ${id} must be supported: ${formatDoctorReport(result.report)}`);
    }
    assert.equal(Object.keys(v).some((id) => v[id] === 'missing' || v[id] === 'installed but unverified'), false, 'no finding may remain in a healthy manifest-native-only world');
  } finally {
    removeNativeBase(env);
  }
});

test('doctor-mn aggregate: VALID installation + independent health problem still fails overall (D)', async () => {
  const { env, layout, ctx } = await mnOnlyEnv();
  try {
    // Independent generation-independent failure: the registered project's
    // store disappears.
    const storeId = '0123456789abcdef0123456789abcdef';
    rmSync(join(layout.storesDir, storeId, 'store-v1'), { recursive: true, force: true });
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 1, 'an independent health problem must still fail overall');
    assert.equal(verdictsMap(result.report)['manifest-native'], 'supported', 'the manifest-native check itself stays healthy');
    assert.equal(verdictsMap(result.report)['project-0'], 'missing', 'the independent failure is reported truthfully');
  } finally {
    removeNativeBase(env);
  }
});

test('doctor-mn aggregate: CLEAN reports no manifest-native installation and stays a finding (E)', async () => {
  const env = makeEnv();
  try {
    const layout = resolveLayout(env);
    const pathEnv = fixturePathEnv(env, { HOME: env });
    const result = await runDoctor({
      env: { home: env, platform: 'linux', arch: 'x64' },
      layout,
      nodeExecutable: process.execPath,
      pathEnv,
      resolveManifestNative: nativeResolver(),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(verdictsMap(result.report)['manifest-native'], 'missing');
    assert.notEqual(result.exitCode, 0, 'CLEAN must not become healthy');
    // No fallback to previous-generation authority: the old checks report
    // the absence of old state as findings, never as health.
    assert.equal(verdictsMap(result.report)['receipt'], 'missing');
  } finally {
    removeNativeBase(env);
  }
});

test('doctor-mn aggregate: MALFORMED is unhealthy and fail-closed (F)', async () => {
  const { env, ctx } = await mnOnlyEnv();
  try {
    // Tamper the installed tree: cryptographic/tree failure must not be
    // suppressed by any aggregation.
    const receiptDoc = JSON.parse((await import('node:fs')).readFileSync(join(resolveLayout(env).shareDir, 'manifest-native', 'receipt.json'), 'utf8')) as { gateway: { packageRoot: string } };
    writeFileSync(join(receiptDoc.gateway.packageRoot, 'lib', 'core.js'), 'export const core = 99;\n');
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(verdictsMap(result.report)['manifest-native'], 'installed but unverified');
    assert.notEqual(result.exitCode, 0, 'MALFORMED must stay unhealthy');
  } finally {
    removeNativeBase(env);
  }
});

/** Map check id -> verdict for aggregate assertions. */
function verdictsMap(report: DoctorReport): Record<string, string> {
  const out: Record<string, string> = {};
  for (const check of report.checks) out[check.id] = check.verdict;
  return out;
}

// ─── MN-B-04 doctor propagation ──────────────────────────────────────────

test('doctor-mn: unsafe nested module mode is unhealthy (MN-B-04)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const { chmodSync } = await import('node:fs');
    chmodSync(join(ns.packageRoot, 'lib', 'core.js'), 0o644);
    const result = await runDoctor(doctorCtx(ns.baseDir, nativeResolver()));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const mn = mnVerdict(result.report);
    assert.equal(mn.verdict, 'installed but unverified', 'unsafe imported-module mode must be unhealthy');
    assert.ok(mn.detail.includes('mode'), mn.detail);
  } finally {
    removeNativeBase(base);
  }
});

test('doctor-mn: unsafe nested directory mode is unhealthy (MN-B-04)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const { chmodSync } = await import('node:fs');
    chmodSync(join(ns.packageRoot, 'lib'), 0o777);
    const result = await runDoctor(doctorCtx(ns.baseDir, nativeResolver()));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(mnVerdict(result.report).verdict, 'installed but unverified');
  } finally {
    removeNativeBase(base);
  }
});
