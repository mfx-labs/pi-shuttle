/**
 * C1 — lane-aware installer consumption identity: focused regression.
 * Proves the installer component layer consumes ONLY the per-lane
 * descriptor selected by gatewayDescriptorForLane() (ADR-002 A):
 *
 *   - linux:        historical descriptor → artifact-core/artifact-core tgz/
 *                   project-gateway-mcp bin, byte-identical behavior;
 *   - darwin-arm64: the SAME historical descriptor — never the fork;
 *   - darwin-x86_64: the macOS fork descriptor (macos-core identity, Intel
 *                   artifact filename, macos-mcp bin) — a fixture carrying
 *                   ONLY the Intel identity proves no historical
 *                   package/artifact/bin constant is consumed;
 *   - unknown lane: selector fails closed (ERR-MANIFEST-NO-GATEWAY-LANE);
 *   - receipt:      gateway version/commit derive from the SELECTED
 *                   descriptor, never from historical constants.
 *
 * Real artifact installs use the npm-pack-style fixture tarballs; the
 * gateway smoke fixture always exits 0 on --help (installed-verified).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gatewayDescriptorForLane, HISTORICAL_GATEWAY_DESCRIPTOR, MACOS_INTEL_GATEWAY_DESCRIPTOR } from '../../src/compat/manifest.js';
import type { GatewayLaneDescriptor } from '../../src/compat/manifest.js';
import { inspectExistingGateway, installGatewayComponent } from '../../src/installer/components.js';
import type { GatewayInstallResult } from '../../src/installer/components.js';
import { gatewayReceiptEntryFromResult } from '../../src/installer/install.js';
import { resolveExecutable } from '../../src/installer/process.js';
import { buildTarball, cleanupEnv, GATEWAY_ARTIFACT_NAME, GATEWAY_FIXTURE_BIN, gatewayFixtureFiles, makeEnv } from '../helpers/installer-fixtures.js';

const LINUX_LANE = 'linux-x86_64-posix-utf8-node22';
const ARM64_LANE = 'darwin-arm64-posix-utf8-node22';
const INTEL_LANE = 'darwin-x86_64-posix-utf8-node22';
const INTEL_COMMIT = 'a90284b06420effb1ec1eeef14e7ed82e02c64e9';
const INTEL_ARTIFACT_NAME = 'project-gateway-macos-core-0.1.0.tgz';
const INTEL_IDENTITY = { packageName: '@project-gateway/macos-core', artifactFileName: INTEL_ARTIFACT_NAME, binName: 'project-gateway-macos-mcp' };
const HISTORICAL_IDENTITY = { packageName: '@project-gateway/artifact-core', artifactFileName: GATEWAY_ARTIFACT_NAME, binName: 'project-gateway-mcp' };

/** Install a synthetic gateway artifact through the component layer with the given descriptor-derived identity. */
async function installWithDescriptor(env: string, descriptor: GatewayLaneDescriptor, files: Record<string, string>, artifactName: string): Promise<{ readonly ok: boolean; readonly result: unknown }> {
  await buildTarball(env, files, artifactName);
  const packagesDir = join(env, 'packages');
  const stagingDir = join(env, 'staging');
  mkdirSync(packagesDir, { recursive: true, mode: 0o700 });
  const run = await installGatewayComponent({
    context: {
      artifactDir: env,
      packagesDir,
      stagingDir,
      nodeExecutable: process.execPath,
      platform: 'linux',
      pathEnv: process.env,
    },
    expectedVersion: descriptor.version,
    expectedCommit: descriptor.commit,
    identity: { packageName: descriptor.packageName, artifactFileName: descriptor.artifactFileName, binName: descriptor.binName },
    tarExecutable: resolveExecutable('tar')!,
  });
  return { ok: run.ok, result: run };
}

test('C1: linux lane selects the historical descriptor and installs the historical identity', async () => {
  const env = makeEnv();
  try {
    const selected = gatewayDescriptorForLane(LINUX_LANE);
    assert.ok(selected.ok);
    if (!selected.ok) return;
    assert.equal(selected.descriptor, HISTORICAL_GATEWAY_DESCRIPTOR, 'linux must resolve to the frozen historical descriptor');
    assert.equal(selected.descriptor.packageName, '@project-gateway/artifact-core');
    assert.equal(selected.descriptor.artifactFileName, GATEWAY_ARTIFACT_NAME);
    assert.equal(selected.descriptor.binName, 'project-gateway-mcp');

    const run = await installWithDescriptor(env, selected.descriptor, gatewayFixtureFiles(), GATEWAY_ARTIFACT_NAME);
    assert.equal(run.ok, true, JSON.stringify(run.result));
    if (!run.ok) return;
    const value = (run.result as { readonly value: GatewayInstallResult }).value;
    assert.equal(value.status, 'installed-verified');
    assert.ok(value.installPath.endsWith(join('packages', 'project-gateway-artifact-core@0.1.0')), value.installPath);
    assert.ok(value.binPath.endsWith(join('dist', 'cli.js')), value.binPath);
    assert.equal(value.smoke, 'passed');
  } finally {
    cleanupEnv(env);
  }
});

test('C1: darwin-arm64 keeps the SAME historical descriptor — never the macOS fork', () => {
  const selected = gatewayDescriptorForLane(ARM64_LANE);
  assert.ok(selected.ok);
  if (!selected.ok) return;
  assert.equal(selected.descriptor, HISTORICAL_GATEWAY_DESCRIPTOR, 'arm64 must resolve to the frozen historical descriptor');
  assert.notEqual(selected.descriptor, MACOS_INTEL_GATEWAY_DESCRIPTOR, 'arm64 must never resolve to the macOS fork');
  assert.equal(selected.descriptor.binName, 'project-gateway-mcp');
});

test('C1: darwin-x86_64 selects ONLY the macOS fork descriptor with the Intel identity', () => {
  const selected = gatewayDescriptorForLane(INTEL_LANE);
  assert.ok(selected.ok);
  if (!selected.ok) return;
  assert.equal(selected.descriptor, MACOS_INTEL_GATEWAY_DESCRIPTOR);
  assert.deepEqual(
    {
      repository: selected.descriptor.repository,
      commit: selected.descriptor.commit,
      version: selected.descriptor.version,
      packageName: selected.descriptor.packageName,
      artifactFileName: selected.descriptor.artifactFileName,
      binName: selected.descriptor.binName,
    },
    {
      repository: 'mfx-labs/project-gateway-macos',
      commit: INTEL_COMMIT,
      version: '0.1.0',
      packageName: '@project-gateway/macos-core',
      artifactFileName: INTEL_ARTIFACT_NAME,
      binName: 'project-gateway-macos-mcp',
    },
  );
  assert.equal(selected.descriptor.artifactSha256, null, 'A digest stays null in C1');
});

test('C1: Intel artifact consumption uses ONLY the descriptor identity — no historical package/bin constant', async () => {
  const env = makeEnv();
  try {
    // A fixture carrying ONLY the Intel identity: if any historical
    // constant (artifact-core name, historical tgz filename,
    // project-gateway-mcp bin) were consumed, the artifact lookup,
    // identity verification, or bin resolution would fail.
    const run = await installWithDescriptor(
      env,
      MACOS_INTEL_GATEWAY_DESCRIPTOR,
      gatewayFixtureFiles({ name: '@project-gateway/macos-core', bin: { 'project-gateway-macos-mcp': './dist/cli.js' } }),
      INTEL_ARTIFACT_NAME,
    );
    assert.equal(run.ok, true, JSON.stringify(run.result));
    if (!run.ok) return;
    const value = (run.result as { readonly value: GatewayInstallResult }).value;
    assert.equal(value.status, 'installed-verified');
    assert.ok(value.installPath.endsWith(join('packages', 'project-gateway-macos-core@0.1.0')), value.installPath);
    assert.ok(value.binPath.endsWith(join('dist', 'cli.js')), value.binPath);
    assert.equal(value.smoke, 'passed');
  } finally {
    cleanupEnv(env);
  }
});

test('C1: unknown/unmapped lane fails closed at the selector — never another lane identity', () => {
  for (const lane of ['win32-x64-posix-utf8-node22', 'darwin-ia32-posix-utf8-node22', '']) {
    const selected = gatewayDescriptorForLane(lane);
    assert.equal(selected.ok, false, `lane ${JSON.stringify(lane)} must be refused`);
    if (!selected.ok) assert.equal(selected.code, 'ERR-MANIFEST-NO-GATEWAY-LANE');
  }
});

test('C1: gateway receipt version/commit derive from the SELECTED descriptor', () => {
  const fakeResult: GatewayInstallResult = {
    status: 'installed-verified',
    installPath: '/tmp/packages/project-gateway-macos-core@0.1.0',
    binPath: '/tmp/packages/project-gateway-macos-core@0.1.0/dist/cli.js',
    artifactSha256: 'a'.repeat(64),
    digestVerified: false,
    smoke: 'passed',
    created: true,
  };
  const intelEntry = gatewayReceiptEntryFromResult(MACOS_INTEL_GATEWAY_DESCRIPTOR, fakeResult);
  assert.equal(intelEntry.version, '0.1.0');
  assert.equal(intelEntry.commit, INTEL_COMMIT, 'Intel receipt commit must be the selected descriptor commit');
  const historicalEntry = gatewayReceiptEntryFromResult(HISTORICAL_GATEWAY_DESCRIPTOR, fakeResult);
  assert.equal(historicalEntry.version, '0.1.0');
  assert.equal(historicalEntry.commit, '55f764290a4567a20557f1db19d2a6fb97572a97', 'historical receipt commit unchanged');
  assert.equal(intelEntry.digestVerified, false);
  assert.equal(intelEntry.commitVerified, false);
});

// ─── Reconciliation identity correction (existing-package inspection) ────

/** Write an installed-package directory (metadata + optional bin file). */
function writeInstalledPackage(packagesDir: string, dirName: string, name: string, version: string, binName: string, withBinFile: boolean): string {
  const root = join(packagesDir, dirName);
  mkdirSync(join(root, 'dist'), { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name, version, type: 'module', bin: { [binName]: './dist/cli.js' } }));
  if (withBinFile) writeFileSync(join(root, 'dist', 'cli.js'), GATEWAY_FIXTURE_BIN, { mode: 0o700 });
  return root;
}

test('C1: reconciliation refuses an existing Intel package with the correct selected bin but WRONG package name', async () => {
  const env = makeEnv();
  try {
    const target = writeInstalledPackage(join(env, 'packages'), 'project-gateway-macos-core@0.1.0', '@project-gateway/artifact-core', '0.1.0', 'project-gateway-macos-mcp', true);
    const inspected = await inspectExistingGateway(target, process.execPath, INTEL_IDENTITY, '0.1.0');
    assert.equal(inspected.ok, false, 'wrong package name must be refused');
    if (!inspected.ok) {
      assert.equal(inspected.code, 'ERR-PS3-EXISTING-FOREIGN');
      assert.ok(inspected.message.includes('incompatible identity'), inspected.message);
    }
  } finally {
    cleanupEnv(env);
  }
});

test('C1: reconciliation refuses an existing Intel package with the correct selected bin and name but WRONG version', async () => {
  const env = makeEnv();
  try {
    const target = writeInstalledPackage(join(env, 'packages'), 'project-gateway-macos-core@0.1.0', '@project-gateway/macos-core', '0.0.9', 'project-gateway-macos-mcp', true);
    const inspected = await inspectExistingGateway(target, process.execPath, INTEL_IDENTITY, '0.1.0');
    assert.equal(inspected.ok, false, 'wrong version must be refused');
    if (!inspected.ok) {
      assert.equal(inspected.code, 'ERR-PS3-EXISTING-FOREIGN');
      assert.ok(inspected.message.includes('expected @project-gateway/macos-core@0.1.0'), inspected.message);
    }
  } finally {
    cleanupEnv(env);
  }
});

test('C1: a fully matching existing Intel package reconciles and produces descriptor-derived receipt identity', async () => {
  const env = makeEnv();
  try {
    // The directory name is deliberately the HISTORICAL layout name: a
    // successful reconciliation proves identity comes from installed
    // package metadata only, never from the target directory name.
    const target = writeInstalledPackage(join(env, 'packages'), 'project-gateway-artifact-core@0.1.0', '@project-gateway/macos-core', '0.1.0', 'project-gateway-macos-mcp', true);
    const inspected = await inspectExistingGateway(target, process.execPath, INTEL_IDENTITY, '0.1.0');
    assert.equal(inspected.ok, true, JSON.stringify(inspected));
    if (!inspected.ok || inspected.value === null) return;
    assert.equal(inspected.value.present, true);
    assert.equal(inspected.value.status, 'installed-verified');
    assert.equal(inspected.value.smoke, 'passed');
    // Receipt identity derives from the SELECTED descriptor, not the dir name.
    const entry = gatewayReceiptEntryFromResult(MACOS_INTEL_GATEWAY_DESCRIPTOR, {
      status: inspected.value.status,
      installPath: inspected.value.installPath,
      binPath: inspected.value.binPath,
      artifactSha256: 'a'.repeat(64),
      digestVerified: false,
      smoke: inspected.value.smoke,
      created: false,
    });
    assert.equal(entry.version, '0.1.0');
    assert.equal(entry.commit, INTEL_COMMIT);
  } finally {
    cleanupEnv(env);
  }
});

test('C1: Linux reconciliation behavior is unchanged (matching historical package still accepted)', async () => {
  const env = makeEnv();
  try {
    const target = writeInstalledPackage(join(env, 'packages'), 'project-gateway-artifact-core@0.1.0', '@project-gateway/artifact-core', '0.1.0', 'project-gateway-mcp', true);
    const inspected = await inspectExistingGateway(target, process.execPath, HISTORICAL_IDENTITY, '0.1.0');
    assert.equal(inspected.ok, true, JSON.stringify(inspected));
    if (!inspected.ok || inspected.value === null) return;
    assert.equal(inspected.value.status, 'installed-verified');
  } finally {
    cleanupEnv(env);
  }
});
