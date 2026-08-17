/**
 * PS-8A / D0D focused tests: release-builder target selection and
 * build-time package identity verification. The builder must select its
 * Gateway descriptor through the manifest authority, then verify the
 * packed package fields represented by that descriptor before accepting
 * any digest into the release envelope.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  DARWIN_ARM64_HOST_LANE,
  DARWIN_X86_64_HOST_LANE,
  HISTORICAL_GATEWAY_DESCRIPTOR,
  LINUX_HOST_LANE,
  MACOS_INTEL_GATEWAY_DESCRIPTOR,
} from '../../src/compat/manifest.js';
import { validateEnvelope } from '../../src/installer/release/envelope.js';

// The builder is a plain .mjs script at the repo root (dist-test mirrors
// only compiled TS); its direct-execution guard keeps importing it
// side-effect free.
const BUILDER = pathToFileURL(join(import.meta.dirname, '..', '..', '..', 'scripts', 'build-release.mjs')).href;
const {
  RELEASE_ENVELOPE_FILES,
  checksumLines,
  createReleaseEnvelope,
  readTgzPackageIdentity,
  releaseInventoryAssets,
  repositoryIdentityFromRemote,
  selectGatewayReleaseDescriptor,
  verifyGatewayPackageIdentity,
  verifyPackageIdentity,
} = await import(BUILDER);

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

function makeTgz(dir: string, name: string, version: string): string {
  const root = join(dir, 'root');
  mkdirSync(join(root, 'package'), { recursive: true });
  writeFileSync(join(root, 'package', 'package.json'), JSON.stringify({ name, version }));
  const tgz = join(dir, 'artifact.tgz');
  const result = spawnSync('tar', ['-czf', tgz, '-C', root, 'package'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `tar fixture failed: ${result.stderr}`);
  return tgz;
}

test('builder (F-02): readTgzPackageIdentity reads the identity from the packed artifact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps8a-builder.XXXXXX'));
  try {
    const tgz = makeTgz(dir, 'pi-shuttle', '0.1.0');
    const identity = readTgzPackageIdentity(tgz);
    assert.equal(identity.name, 'pi-shuttle');
    assert.equal(identity.version, '0.1.0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('builder (F-02): verifyPackageIdentity accepts the exact identity', () => {
  verifyPackageIdentity({ name: 'pi-shuttle', version: '0.1.0' }, 'pi-shuttle', '0.1.0', 'pi-shuttle');
  verifyPackageIdentity({ name: '@project-gateway/artifact-core', version: '0.1.0' }, '@project-gateway/artifact-core', '0.1.0', 'gateway');
  verifyPackageIdentity({ name: 'pi-guard', version: '0.1.2' }, 'pi-guard', '0.1.2', 'pi-guard');
});

test('builder (F-02): wrong name or version fails closed', () => {
  assert.throws(() => verifyPackageIdentity({ name: 'other-package', version: '0.1.0' }, 'pi-shuttle', '0.1.0', 'pi-shuttle'), /identity mismatch/);
  assert.throws(() => verifyPackageIdentity({ name: 'pi-shuttle', version: '0.2.0' }, 'pi-shuttle', '0.1.0', 'pi-shuttle'), /identity mismatch/);
  assert.throws(() => verifyPackageIdentity({ name: '@project-gateway/artifact-core', version: '0.2.0' }, '@project-gateway/artifact-core', '0.1.0', 'gateway'), /identity mismatch/);
  assert.throws(() => verifyPackageIdentity({ name: 'pi-guard', version: '0.1.1' }, 'pi-guard', '0.1.2', 'pi-guard'), /identity mismatch/);
});

test('builder (F-02): malformed or missing identity fails closed', () => {
  assert.throws(() => verifyPackageIdentity(null, 'pi-shuttle', '0.1.0', 'pi-shuttle'), /missing or malformed/);
  assert.throws(() => verifyPackageIdentity({}, 'pi-shuttle', '0.1.0', 'pi-shuttle'), /missing or malformed/);
  assert.throws(() => verifyPackageIdentity({ name: 'pi-shuttle' }, 'pi-shuttle', '0.1.0', 'pi-shuttle'), /missing or malformed/);
});

test('builder (F-02): a tgz without package.json is refused at read time', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps8a-builder.XXXXXX'));
  try {
    const root = join(dir, 'root');
    mkdirSync(join(root, 'package', 'dist'), { recursive: true });
    writeFileSync(join(root, 'package', 'dist', 'cli.js'), '// nothing');
    const tgz = join(dir, 'artifact.tgz');
    const result = spawnSync('tar', ['-czf', tgz, '-C', root, 'package'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.throws(() => readTgzPackageIdentity(tgz), /package\.json missing or unreadable/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('builder (F-02): a tgz with malformed package.json is refused at read time', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps8a-builder.XXXXXX'));
  try {
    const root = join(dir, 'root');
    mkdirSync(join(root, 'package'), { recursive: true });
    writeFileSync(join(root, 'package', 'package.json'), '{ not json !');
    const tgz = join(dir, 'artifact.tgz');
    const result = spawnSync('tar', ['-czf', tgz, '-C', root, 'package'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.throws(() => readTgzPackageIdentity(tgz), /malformed JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('builder (D0D): internal target selection uses the manifest descriptors with no fallback', () => {
  assert.deepEqual(selectGatewayReleaseDescriptor(LINUX_HOST_LANE), HISTORICAL_GATEWAY_DESCRIPTOR);
  const intel = selectGatewayReleaseDescriptor(DARWIN_X86_64_HOST_LANE);
  const arm64 = selectGatewayReleaseDescriptor(DARWIN_ARM64_HOST_LANE);
  assert.deepEqual(intel, MACOS_INTEL_GATEWAY_DESCRIPTOR);
  assert.deepEqual(arm64, MACOS_INTEL_GATEWAY_DESCRIPTOR);
  assert.deepEqual(arm64, intel, 'both Darwin targets select the same descriptor identity');
  assert.throws(() => selectGatewayReleaseDescriptor('darwin-riscv64-posix-utf8-node22'), /not materializable.*no Gateway distribution descriptor.*no fallback/);
});

test('builder (D0D): Linux and shared Darwin envelope fields come from the selected descriptor', () => {
  const digests = { piShuttleSha: SHA_A, gatewaySha: SHA_B, piGuardSha: SHA_C };
  for (const target of [LINUX_HOST_LANE, DARWIN_X86_64_HOST_LANE, DARWIN_ARM64_HOST_LANE]) {
    const descriptor = selectGatewayReleaseDescriptor(target);
    const envelope = createReleaseEnvelope(descriptor, digests);
    assert.deepEqual(envelope.gateway, {
      packageVersion: descriptor.version,
      sourceCommit: descriptor.commit,
      fileName: descriptor.artifactFileName,
      sha256: SHA_B,
    });
    assert.deepEqual(envelope.policy.gatewayDependencies, descriptor.dependencies);
    assert.equal(validateEnvelope(envelope, target).ok, true, target);
  }
});

test('builder (D0D): both Darwin targets materialize the same schema-v1 envelope identity', () => {
  const digests = { piShuttleSha: SHA_A, gatewaySha: SHA_B, piGuardSha: SHA_C };
  const intelEnvelope = createReleaseEnvelope(selectGatewayReleaseDescriptor(DARWIN_X86_64_HOST_LANE), digests);
  const arm64Envelope = createReleaseEnvelope(selectGatewayReleaseDescriptor(DARWIN_ARM64_HOST_LANE), digests);
  assert.deepEqual(arm64Envelope, intelEnvelope);
  assert.equal(intelEnvelope.gateway.fileName, 'project-gateway-macos-core-0.1.0.tgz');
  assert.equal(intelEnvelope.gateway.sourceCommit, 'a18bd287c9ccada7fd31932dbe9937062d0b6bc1');
});

test('builder (E2A): combined inventory contains both envelopes, both Gateways, and common assets exactly once', () => {
  const assets = releaseInventoryAssets([
    HISTORICAL_GATEWAY_DESCRIPTOR.artifactFileName,
    MACOS_INTEL_GATEWAY_DESCRIPTOR.artifactFileName,
  ]);
  assert.deepEqual(assets, [
    'install.sh',
    'pi-shuttle-0.1.0-linux-x86_64.json',
    'pi-shuttle-0.1.0-macos.json',
    'pi-shuttle-0.1.0.tgz',
    'project-gateway-artifact-core-0.1.0.tgz',
    'project-gateway-macos-core-0.1.0.tgz',
    'pi-guard-0.1.2.tgz',
  ]);
  assert.deepEqual(RELEASE_ENVELOPE_FILES, {
    linux: 'pi-shuttle-0.1.0-linux-x86_64.json',
    macos: 'pi-shuttle-0.1.0-macos.json',
  });
  for (const common of ['install.sh', 'pi-shuttle-0.1.0.tgz', 'pi-guard-0.1.2.tgz']) {
    assert.equal(assets.filter((asset: string) => asset === common).length, 1, `${common} must be common and singular`);
  }
  assert.throws(
    () => releaseInventoryAssets([HISTORICAL_GATEWAY_DESCRIPTOR.artifactFileName, HISTORICAL_GATEWAY_DESCRIPTOR.artifactFileName]),
    /duplicate asset names/,
  );
});

test('builder (E2A): SHA256SUMS rows cover the complete combined inventory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2a-sums.XXXXXX'));
  try {
    const assets = releaseInventoryAssets([
      HISTORICAL_GATEWAY_DESCRIPTOR.artifactFileName,
      MACOS_INTEL_GATEWAY_DESCRIPTOR.artifactFileName,
    ]);
    for (const [index, asset] of assets.entries()) writeFileSync(join(dir, asset), `asset-${index}`);
    const sums = checksumLines(dir, assets);
    assert.equal(sums.length, assets.length);
    assert.deepEqual(sums.map((line: string) => line.slice(66)).sort(), [...assets].sort());
    assert.equal(sums.every((line: string) => /^[0-9a-f]{64}  [^/]+$/.test(line)), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('builder (D0D): target/descriptor disagreement and artifact mismatch fail closed', () => {
  const digests = { piShuttleSha: SHA_A, gatewaySha: SHA_B, piGuardSha: SHA_C };
  const macEnvelope = createReleaseEnvelope(selectGatewayReleaseDescriptor(DARWIN_ARM64_HOST_LANE), digests);
  const wrongTarget = validateEnvelope(macEnvelope, LINUX_HOST_LANE);
  assert.equal(wrongTarget.ok, false, 'a Darwin descriptor envelope must not fall back to Linux');
  const wrongArtifact = validateEnvelope({
    ...macEnvelope,
    gateway: { ...macEnvelope.gateway, fileName: HISTORICAL_GATEWAY_DESCRIPTOR.artifactFileName },
  }, DARWIN_ARM64_HOST_LANE);
  assert.equal(wrongArtifact.ok, false);
});

test('builder (D0D): Gateway package name/version/bin/dependencies must match the selected descriptor', () => {
  const descriptor = selectGatewayReleaseDescriptor(DARWIN_ARM64_HOST_LANE);
  const identity = {
    name: descriptor.packageName,
    version: descriptor.version,
    bin: { [descriptor.binName]: './dist/runtime/mcp/cli.js' },
    dependencies: { ...descriptor.dependencies },
  };
  assert.equal(verifyGatewayPackageIdentity(identity, descriptor), './dist/runtime/mcp/cli.js');
  assert.throws(() => verifyGatewayPackageIdentity({ ...identity, name: HISTORICAL_GATEWAY_DESCRIPTOR.packageName }, descriptor), /identity mismatch/);
  assert.throws(() => verifyGatewayPackageIdentity({ ...identity, bin: {} }, descriptor), /does not declare the selected/);
  assert.throws(() => verifyGatewayPackageIdentity({ ...identity, dependencies: { ...identity.dependencies, ajv: '0.0.0' } }, descriptor), /dependencies do not equal/);
});

test('builder (D0D): Gateway checkout repository identity accepts canonical GitHub SSH/HTTPS forms only', () => {
  assert.equal(repositoryIdentityFromRemote('git@github.com:mfx-labs/project-gateway-macos.git'), 'mfx-labs/project-gateway-macos');
  assert.equal(repositoryIdentityFromRemote('https://github.com/mfx-labs/project-gateway.git'), 'mfx-labs/project-gateway');
  assert.equal(repositoryIdentityFromRemote('ssh://git@github.com/mfx-labs/project-gateway-macos.git'), 'mfx-labs/project-gateway-macos');
  assert.equal(repositoryIdentityFromRemote('/tmp/lookalike'), null);
  assert.equal(repositoryIdentityFromRemote('https://example.com/mfx-labs/project-gateway-macos.git'), null);
});
