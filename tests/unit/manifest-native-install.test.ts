/**
 * FRESH-INSTALL Slice — production manifest-native fresh-install tests.
 *
 * Proves: the full production chain (signed selection -> artifact ->
 * extraction -> tree verification -> content-addressed package -> cache ->
 * receipt LAST); end-to-end install -> resolve -> doctor -> start;
 * future-release decoupling (A/B through identical code); idempotent
 * same-release retry; every failure ordering; install-lock concurrency;
 * pi-guard independence; no caller-selected release authority.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { runDoctor } from '../../src/command/doctor.js';
import { resolveLayout, resolveManifestNativeLayout } from '../../src/host/environment.js';
import { hashPackageTree } from '../../src/installer/artifact.js';
import { runStartCommand } from '../../src/lifecycle/start.js';
import { parseManifestNativeReceipt } from '../../src/manifest-native/receipt.js';
import { resolveManifestNativeLifecycle } from '../../src/manifest-native/resolve.js';
import { deriveCachePath, derivePackageRoot } from '../../src/manifest-native/paths.js';
import { CACHE_SCHEMA_VERSION, serializeManifestNativeCache } from '../../src/manifest-native/cache.js';
import { FIXTURE_NOW, fixtureVerifier } from '../helpers/release-trust-fixtures.js';
import { fixturePathEnv, makeEnv } from '../helpers/lifecycle-fixtures.js';
import { nativeClassifyDeps, nativeResolver } from '../helpers/manifest-native-fixtures.js';
import {
  buildInstallFixtureRelease,
  freshInstallDeps,
  installMetadataFetcher,
  releaseAOverrides,
  releaseBOverrides,
  runFreshInstall,
  FIXTURE_ARTIFACT_BASE,
  installTreeFiles,
  INSTALL_BIN_SCRIPT,
} from '../helpers/manifest-native-install-fixtures.js';
import type { InstallFixtureRelease } from '../helpers/manifest-native-install-fixtures.js';
import type { FreshInstallOutcome } from '../../src/manifest-native/install.js';
import { ioError } from '../helpers/manifest-native-install-fixtures.js';

function outcomeKind(outcome: FreshInstallOutcome): string {
  return outcome.kind;
}

/** Full healthy install env: HOME + runtime config + store + fake git/pi PATH. */
async function healthyInstallEnv(release: InstallFixtureRelease, fetcherOptions: Parameters<typeof installMetadataFetcher>[1] = {}): Promise<{
  readonly env: string;
  readonly layout: ReturnType<typeof resolveLayout>;
  readonly mnLayout: ReturnType<typeof resolveManifestNativeLayout>;
  readonly verifier: ReturnType<typeof fixtureVerifier>;
  readonly deps: ReturnType<typeof freshInstallDeps>;
  readonly outcome: FreshInstallOutcome;
}> {
  const env = makeEnv();
  const verifier = fixtureVerifier(FIXTURE_NOW);
  const fetcher = installMetadataFetcher(release, fetcherOptions);
  const deps = freshInstallDeps(verifier, fetcher);
  const outcome = await runFreshInstall(env, release, deps);
  const layout = resolveLayout(env);
  const mnLayout = resolveManifestNativeLayout(env);
  // Registered runtime config + store (for doctor/start end-to-end).
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
  return { env, layout, mnLayout, verifier, deps, outcome };
}

// ─── end-to-end acceptance (§28) ─────────────────────────────────────────

test('install: full chain from CLEAN produces INSTALLED and a VALID runtime lifecycle (receipt LAST)', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const { env, mnLayout, verifier, outcome } = await healthyInstallEnv(release);
  try {
    assert.equal(outcome.kind, 'INSTALLED', JSON.stringify(outcome));
    if (outcome.kind !== 'INSTALLED') return;
    assert.equal(outcome.releaseId, release.chain.releaseId);
    // Resolver: VALID with runtime-proven installation.
    const resolution = await resolveManifestNativeLifecycle(mnLayout, 'linux-x86_64-posix-utf8-node22', nativeClassifyDeps(verifier));
    assert.equal(resolution.kind, 'VALID');
    if (resolution.kind !== 'VALID') return;
    assert.equal(resolution.installation.binPath, outcome.binPath);
    assert.equal(resolution.installation.packageRoot, outcome.packageRoot);
    const pathEnv = fixturePathEnv(env, { HOME: env });
    // Doctor: healthy manifest-native check.
    const doctor = await runDoctor({
      env: { home: env, platform: 'linux', arch: 'x64' },
      layout: resolveLayout(env),
      nodeExecutable: process.execPath,
      pathEnv,
      resolveManifestNative: nativeResolver(verifier),
    });
    assert.equal(doctor.ok, true);
    if (!doctor.ok) return;
    const mnCheck = doctor.report.checks.find((c) => c.id === 'manifest-native');
    assert.equal(mnCheck?.verdict, 'supported', JSON.stringify(doctor.report.checks.map((c) => `${c.id}:${c.verdict}`)));
    // Start: resolves the exact verified bin through the running Node.
    const record = join(env, 'bin-record.txt');
    const started = await runStartCommand({
      env: { home: env, platform: 'linux', arch: 'x64' },
      layout: resolveLayout(env),
      nodeExecutable: process.execPath,
      pathEnv: { ...pathEnv, FIXTURE_BIN_RECORD: record },
      resolveManifestNative: nativeResolver(verifier),
    });
    assert.equal(started.exitCode, 0, started.stderr);
    assert.equal(readFileSync(record, 'utf8').trim(), outcome.binPath, 'start must execute the exact verified installed bin');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

// ─── future-release decoupling (§26/§27) ─────────────────────────────────

test('install: Release A and Release B install through the IDENTICAL production code with no release branching', async () => {
  const releaseA = await buildInstallFixtureRelease(releaseAOverrides());
  const releaseB = await buildInstallFixtureRelease(releaseBOverrides());
  // Fully distinct per-release identities.
  assert.notEqual(releaseA.chain.releaseId, releaseB.chain.releaseId);
  assert.notEqual(releaseA.chain.releaseManifestSha256, releaseB.chain.releaseManifestSha256);
  assert.notEqual(releaseA.version, releaseB.version);
  assert.notEqual(releaseA.artifactFileName, releaseB.artifactFileName);
  assert.notEqual(releaseA.artifactSha256, releaseB.artifactSha256);
  assert.notEqual(releaseA.packageTreeSha256, releaseB.packageTreeSha256);
  // Stable compatibility contracts are shared.
  const payloadA = JSON.parse(releaseA.chain.releaseText) as { payload: { installProtocol: number; runtimeProtocol: number; packageName: string; binName: string } };
  const payloadB = JSON.parse(releaseB.chain.releaseText) as { payload: { installProtocol: number; runtimeProtocol: number; packageName: string; binName: string } };
  assert.equal(payloadA.payload.installProtocol, payloadB.payload.installProtocol);
  assert.equal(payloadA.payload.runtimeProtocol, payloadB.payload.runtimeProtocol);
  assert.equal(payloadA.payload.packageName, payloadB.payload.packageName);
  assert.equal(payloadA.payload.binName, payloadB.payload.binName);

  // Two separate CLEAN namespaces; identical production code.
  const envA = makeEnv();
  const envB = makeEnv();
  try {
    const verifier = fixtureVerifier(FIXTURE_NOW);
    const outcomeA = await runFreshInstall(envA, releaseA, freshInstallDeps(verifier, installMetadataFetcher(releaseA)));
    const outcomeB = await runFreshInstall(envB, releaseB, freshInstallDeps(verifier, installMetadataFetcher(releaseB)));
    assert.equal(outcomeA.kind, 'INSTALLED', JSON.stringify(outcomeA));
    assert.equal(outcomeB.kind, 'INSTALLED', JSON.stringify(outcomeB));
    if (outcomeA.kind !== 'INSTALLED' || outcomeB.kind !== 'INSTALLED') return;
    assert.equal(outcomeA.releaseId, releaseA.chain.releaseId);
    assert.equal(outcomeB.releaseId, releaseB.chain.releaseId);
    assert.notEqual(outcomeA.packageRoot, outcomeB.packageRoot, 'content-addressed roots differ');
    const mnA = resolveManifestNativeLayout(envA);
    const mnB = resolveManifestNativeLayout(envB);
    const resolutionA = await resolveManifestNativeLifecycle(mnA, 'linux-x86_64-posix-utf8-node22', nativeClassifyDeps(verifier));
    const resolutionB = await resolveManifestNativeLifecycle(mnB, 'linux-x86_64-posix-utf8-node22', nativeClassifyDeps(verifier));
    assert.equal(resolutionA.kind, 'VALID');
    assert.equal(resolutionB.kind, 'VALID');
    // No production source constant changes were needed: the fixture
    // identities must not exist anywhere in src/.
    const sources = collectSrc();
    for (const id of [releaseA.chain.releaseId, releaseB.chain.releaseId, 'gateway-native-core-0.1.1.tgz', 'gateway-native-core-0.2.0.tgz']) {
      for (const file of sources) {
        assert.equal(file.content.includes(id), false, `${file.rel} must not contain the fixture release identity ${id}`);
      }
    }
  } finally {
    rmSync(envA, { recursive: true, force: true });
    rmSync(envB, { recursive: true, force: true });
  }
});

// ─── idempotent retry / existing state (§5, §23) ─────────────────────────

test('install: VALID same-release retry is idempotent; different release is refused (update required)', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const env = makeEnv();
  try {
    const verifier = fixtureVerifier(FIXTURE_NOW);
    const deps = freshInstallDeps(verifier, installMetadataFetcher(release));
    const first = await runFreshInstall(env, release, deps);
    assert.equal(first.kind, 'INSTALLED');
    // Same release again: ALREADY_INSTALLED, state preserved.
    const again = await runFreshInstall(env, release, freshInstallDeps(verifier, installMetadataFetcher(release)));
    assert.equal(again.kind, 'ALREADY_INSTALLED', JSON.stringify(again));
    if (again.kind !== 'ALREADY_INSTALLED') return;
    assert.equal(again.releaseId, release.chain.releaseId);
    const resolution = await resolveManifestNativeLifecycle(resolveManifestNativeLayout(env), 'linux-x86_64-posix-utf8-node22', nativeClassifyDeps(verifier));
    assert.equal(resolution.kind, 'VALID', 'the idempotent retry must leave a VALID installation');
    // A different release is refused: no update in this generation.
    const releaseB = await buildInstallFixtureRelease(releaseBOverrides());
    const different = await runFreshInstall(env, releaseB, freshInstallDeps(verifier, installMetadataFetcher(releaseB)));
    assert.equal(different.kind, 'ALREADY_INSTALLED_UPDATE_REQUIRED', JSON.stringify(different));
    if (different.kind !== 'ALREADY_INSTALLED_UPDATE_REQUIRED') return;
    assert.equal(different.installedReleaseId, release.chain.releaseId);
    assert.equal(different.selectedReleaseId, releaseB.chain.releaseId);
    const after = await resolveManifestNativeLifecycle(resolveManifestNativeLayout(env), 'linux-x86_64-posix-utf8-node22', nativeClassifyDeps(verifier));
    assert.equal(after.kind, 'VALID', 'the refused update must not disturb the installed release');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('install: CLEAN orphan content-addressed package is fully revalidated and reused without redownload', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const env = makeEnv();
  try {
    const verifier = fixtureVerifier(FIXTURE_NOW);
    const mnLayout = resolveManifestNativeLayout(env);
    // Orphan: place the exact content-addressed package WITHOUT receipt/cache.
    const target = derivePackageRoot(mnLayout, release.packageTreeSha256);
    assert.ok(target !== null);
    mkdirSync(join(target, 'lib'), { recursive: true, mode: 0o700 });
    mkdirSync(join(target, 'bin'), { recursive: true, mode: 0o700 });
    for (const [rel, content] of Object.entries(installTreeFiles(release.version, INSTALL_BIN_SCRIPT))) {
      writeFileSync(join(target, rel), content);
      chmodSync(join(target, rel), 0o600);
    }
    const requested: string[] = [];
    const baseFetcher = installMetadataFetcher(release);
    const recordingFetcher: typeof baseFetcher = async (url: string) => {
      requested.push(url);
      return baseFetcher(url, 0);
    };
    const outcome = await runFreshInstall(env, release, freshInstallDeps(verifier, recordingFetcher));
    assert.equal(outcome.kind, 'INSTALLED', JSON.stringify(outcome));
    if (outcome.kind !== 'INSTALLED') return;
    assert.equal(outcome.packageRoot, target, 'the orphan package must be reused at the content-addressed root');
    assert.equal(requested.some((url) => url.includes(release.artifactFileName)), false, 'no artifact download may occur when the package revalidates exactly');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('install: MALFORMED starting state fails closed with no mutation and no metadata fetch', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const env = makeEnv();
  try {
    const verifier = fixtureVerifier(FIXTURE_NOW);
    const mnLayout = resolveManifestNativeLayout(env);
    mkdirSync(mnLayout.authorityRoot, { recursive: true, mode: 0o700 });
    writeFileSync(mnLayout.receiptPath, '{broken', { mode: 0o600 });
    const requested: string[] = [];
    const baseFetcher = installMetadataFetcher(release);
    const recordingFetcher: typeof baseFetcher = async (url: string) => {
      requested.push(url);
      return baseFetcher(url, 0);
    };
    const outcome = await runFreshInstall(env, release, freshInstallDeps(verifier, recordingFetcher));
    assert.equal(outcome.kind, 'REFUSED', JSON.stringify(outcome));
    if (outcome.kind !== 'REFUSED') return;
    assert.equal(outcome.code, 'ERR-MN-INSTALL-STATE-MALFORMED');
    assert.equal(requested.length, 0, 'no metadata or artifact may be fetched from a malformed starting state');
    assert.equal(readFileSync(mnLayout.receiptPath, 'utf8'), '{broken', 'malformed state must not be touched');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

// ─── failure ordering (§29) ──────────────────────────────────────────────

test('install: bad channel/release signature fails before any artifact authority (A)', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const env = makeEnv();
  try {
    // Serve a channel signed for a DIFFERENT release (cross-document replay).
    const other = await buildInstallFixtureRelease(releaseBOverrides());
    const fetcher = installMetadataFetcher(release);
    const base = fetcher;
    const tampered: typeof base = async (url: string) => {
      if (url.endsWith('/stable-channel.json')) {
        const bytes = Buffer.from(other.chain.channelText, 'utf8');
        return { status: 200, body: Readable.from([bytes]), contentLength: bytes.length };
      }
      return base(url, 0);
    };
    const verifier = fixtureVerifier(FIXTURE_NOW);
    const outcome = await runFreshInstall(env, release, freshInstallDeps(verifier, tampered));
    assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
    if (outcome.kind !== 'FAILED') return;
    assert.equal(outcome.stage, 'selection');
    assert.equal(existsSync(join(resolveManifestNativeLayout(env).packagesRoot)), false, 'no package authority may exist');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('install: artifact SHA mismatch fails before extraction/publication (B)', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const env = makeEnv();
  try {
    // Serve DIFFERENT artifact bytes than the signed digest.
    const fetcher = installMetadataFetcher(release);
    const base = fetcher;
    const tampered: typeof base = async (url: string) => {
      if (url.endsWith(`/${release.artifactFileName}`)) {
        const bytes = Buffer.from('tampered artifact bytes');
        return { status: 200, body: Readable.from([bytes]), contentLength: bytes.length };
      }
      return base(url, 0);
    };
    const outcome = await runFreshInstall(env, release, freshInstallDeps(fixtureVerifier(FIXTURE_NOW), tampered));
    assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
    if (outcome.kind !== 'FAILED') return;
    assert.equal(outcome.stage, 'artifact');
    const mnLayout = resolveManifestNativeLayout(env);
    assert.equal(existsSync(join(mnLayout.packagesRoot)), false, 'no package materialization may occur');
    assert.equal(existsSync(mnLayout.receiptPath), false, 'no receipt may be published');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('install: archive with a symlink member fails before final package/receipt (C)', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const env = makeEnv();
  try {
    // Build an artifact containing a symlink member.
    const { mkdtempSync, symlinkSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'pi-shuttle-archive-bad-'));
    try {
      const tree = join(dir, 'package');
      mkdirSync(join(tree, 'lib'), { recursive: true, mode: 0o700 });
      writeFileSync(join(tree, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }), { mode: 0o600 });
      symlinkSync('package.json', join(tree, 'lib', 'linked.json'));
      const { runProcess, resolveExecutable } = await import('../../src/installer/process.js');
      const tgzPath = join(dir, 'bad.tgz');
      const tar = resolveExecutable('tar');
      assert.ok(tar !== null);
      const packed = await runProcess(tar, ['-czf', tgzPath, '-C', dir, 'package']);
      assert.equal(packed.exitCode, 0, packed.stderr);
      const bytes = readFileSync(tgzPath);
      const artifactSha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
      // Sign a chain binding THIS artifact digest (schema-valid), so the
      // archive scan is the first failure.
      const badRelease = await buildInstallFixtureRelease({ ...releaseAOverrides(), artifactSha256, artifactFileName: 'bad-archive.tgz' });
      const fetcher = installMetadataFetcher(badRelease);
      const base = fetcher;
      const serving: typeof base = async (url: string) => {
        if (url.endsWith('/bad-archive.tgz')) {
          return { status: 200, body: Readable.from([bytes]), contentLength: bytes.length };
        }
        return base(url, 0);
      };
      const outcome = await runFreshInstall(env, badRelease, freshInstallDeps(fixtureVerifier(FIXTURE_NOW), serving));
      assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
      if (outcome.kind !== 'FAILED') return;
      assert.equal(outcome.stage, 'archive');
      assert.equal(existsSync(join(resolveManifestNativeLayout(env).packagesRoot)), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('install: package identity mismatch fails before any receipt (D)', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const env = makeEnv();
  try {
    // Build an artifact whose package.json identity differs from the signed
    // release (the tree digest is still the real digest of that tree).
    const dir = mkdtempSync(join(tmpdir(), 'pi-shuttle-identity-bad-'));
    try {
      const tree = join(dir, 'package');
      mkdirSync(join(tree, 'lib'), { recursive: true, mode: 0o700 });
      mkdirSync(join(tree, 'bin'), { recursive: true, mode: 0o700 });
      writeFileSync(join(tree, 'package.json'), JSON.stringify({ name: 'forged-package-name', version: release.version, bin: { 'forged-bin': 'bin/run.js' } }), { mode: 0o600 });
      writeFileSync(join(tree, 'lib', 'core.js'), 'export const core = 1;\n', { mode: 0o600 });
      writeFileSync(join(tree, 'bin', 'run.js'), INSTALL_BIN_SCRIPT, { mode: 0o600 });
      const treeDigest = await hashPackageTree(tree, {}, { requireOwnerPrivateModes: true });
      assert.equal(treeDigest.ok, true);
      if (!treeDigest.ok) return;
      const { runProcess, resolveExecutable } = await import('../../src/installer/process.js');
      const tgzPath = join(dir, 'forged.tgz');
      const tar = resolveExecutable('tar');
      assert.ok(tar !== null);
      const packed = await runProcess(tar, ['-czf', tgzPath, '-C', dir, 'package']);
      assert.equal(packed.exitCode, 0, packed.stderr);
      const bytes = readFileSync(tgzPath);
      const artifactSha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
      // Signed release declares the COMPILED contract identity + this real
      // tree digest; only the artifact's package identity is wrong.
      const badRelease = await buildInstallFixtureRelease({ ...releaseAOverrides(), artifactSha256, artifactFileName: 'forged-identity.tgz', packageTreeSha256: treeDigest.value });
      const fetcher = installMetadataFetcher(badRelease);
      const base = fetcher;
      const serving: typeof base = async (url: string) => {
        if (url.endsWith('/forged-identity.tgz')) {
          return { status: 200, body: Readable.from([bytes]), contentLength: bytes.length };
        }
        return base(url, 0);
      };
      const outcome = await runFreshInstall(env, badRelease, freshInstallDeps(fixtureVerifier(FIXTURE_NOW), serving));
      assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
      if (outcome.kind !== 'FAILED') return;
      assert.equal(outcome.stage, 'package');
      assert.equal(existsSync(resolveManifestNativeLayout(env).receiptPath), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('install: staging tree SHA mismatch fails before any receipt (E)', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const env = makeEnv();
  try {
    // Sign the chain with a packageTreeSha256 that does NOT match the real
    // artifact tree (schema-valid; the staging hash is the gate).
    const badRelease = await buildInstallFixtureRelease({ ...releaseAOverrides(), packageTreeSha256: 'e'.repeat(64) });
    const outcome = await runFreshInstall(env, badRelease, freshInstallDeps(fixtureVerifier(FIXTURE_NOW), installMetadataFetcher(badRelease)));
    assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
    if (outcome.kind !== 'FAILED') return;
    assert.equal(outcome.stage, 'package-tree');
    const mnLayout = resolveManifestNativeLayout(env);
    assert.equal(existsSync(mnLayout.receiptPath), false, 'no receipt may be published on a tree mismatch');
    const badTarget = derivePackageRoot(mnLayout, badRelease.packageTreeSha256);
    assert.ok(badTarget !== null);
    assert.equal(existsSync(badTarget), false, 'no conflicting package may be materialized');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('install: conflicting existing content-addressed package fails closed (F/K)', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const env = makeEnv();
  try {
    const mnLayout = resolveManifestNativeLayout(env);
    // Pre-place a WRONG tree (valid identity, conflicting content) at the
    // content-addressed target.
    const target = derivePackageRoot(mnLayout, release.packageTreeSha256);
    assert.ok(target !== null);
    const contract = JSON.parse(release.chain.releaseText) as { payload: { packageName: string; version: string; binName: string } };
    mkdirSync(join(target, 'lib'), { recursive: true, mode: 0o700 });
    mkdirSync(join(target, 'bin'), { recursive: true, mode: 0o700 });
    writeFileSync(join(target, 'package.json'), JSON.stringify({ name: contract.payload.packageName, version: contract.payload.version, bin: { [contract.payload.binName]: 'bin/run.js' } }), { mode: 0o600 });
    writeFileSync(join(target, 'lib', 'wrong.js'), 'export const wrong = true;\n', { mode: 0o600 });
    writeFileSync(join(target, 'bin', 'run.js'), '#!/usr/bin/env node\n', { mode: 0o600 });
    const outcome = await runFreshInstall(env, release, freshInstallDeps(fixtureVerifier(FIXTURE_NOW), installMetadataFetcher(release)));
    assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
    if (outcome.kind !== 'FAILED') return;
    assert.equal(outcome.stage, 'package-materialize');
    assert.match(outcome.message, /refusing to overwrite/);
    assert.equal(existsSync(join(target, 'lib', 'wrong.js')), true, 'the conflicting package must never be overwritten');
    assert.equal(existsSync(mnLayout.receiptPath), false);
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('install: cache publication failure produces no receipt (G/J)', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const env = makeEnv();
  try {
    const mnLayout = resolveManifestNativeLayout(env);
    // Conflicting immutable cache object at the derived path.
    const cachePath = deriveCachePath(mnLayout, release.chain.releaseId, release.chain.releaseManifestSha256);
    assert.ok(cachePath !== null);
    mkdirSync(join(cachePath, '..'), { recursive: true, mode: 0o700 });
    writeFileSync(cachePath, serializeManifestNativeCache({ cacheSchemaVersion: CACHE_SCHEMA_VERSION, keyringText: '{}', channelText: '{}', releaseManifestText: '{}' }), { mode: 0o600 });
    const outcome = await runFreshInstall(env, release, freshInstallDeps(fixtureVerifier(FIXTURE_NOW), installMetadataFetcher(release)));
    assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
    if (outcome.kind !== 'FAILED') return;
    assert.equal(outcome.stage, 'cache');
    assert.equal(existsSync(mnLayout.receiptPath), false, 'no receipt may be published when the cache conflicts');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('install: receipt publication failure leaves no valid installation (H)', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const env = makeEnv();
  try {
    const mnLayout = resolveManifestNativeLayout(env);
    // io seam: fail the receipt's atomic link (2nd link call) while the
    // cache link succeeds (1st call) — deterministic receipt-stage failure.
    const { realDurableIo } = await import('../../src/manifest-native/write.js');
    let linkCalls = 0;
    const io = {
      ...realDurableIo,
      link: (from: string, to: string) => {
        linkCalls += 1;
        if (linkCalls === 2) throw ioError('EACCES');
        linkSync(from, to);
      },
    };
    const outcome = await runFreshInstall(env, release, freshInstallDeps(fixtureVerifier(FIXTURE_NOW), installMetadataFetcher(release), { io }));
    assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
    if (outcome.kind !== 'FAILED') return;
    assert.equal(outcome.stage, 'receipt');
    assert.equal(existsSync(mnLayout.receiptPath), false, 'no final receipt may exist');
    const resolution = await resolveManifestNativeLifecycle(mnLayout, 'linux-x86_64-posix-utf8-node22', nativeClassifyDeps(fixtureVerifier(FIXTURE_NOW)));
    assert.notEqual(resolution.kind, 'VALID', 'a failed receipt publication must not leave a valid installation');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('install: receipt post-publication durability failure preserves receipt/cache/package (I)', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const env = makeEnv();
  try {
    const mnLayout = resolveManifestNativeLayout(env);
    // io seam: fail the SECOND parent-directory fsync (receipt parent),
    // after the receipt link succeeded.
    const { realDurableIo: realIo } = await import('../../src/manifest-native/write.js');
    let dirFsyncs = 0;
    const io = {
      ...realIo,
      fsyncDirectory: (fd: number) => {
        dirFsyncs += 1;
        if (dirFsyncs === 2) throw ioError('EIO');
        fsyncSync(fd);
      },
    };
    const outcome = await runFreshInstall(env, release, freshInstallDeps(fixtureVerifier(FIXTURE_NOW), installMetadataFetcher(release), { io }));
    assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
    if (outcome.kind !== 'FAILED') return;
    assert.equal(outcome.stage, 'receipt');
    assert.match(outcome.message, /durably|POST-RENAME|durability/, outcome.message);
    // Everything referenced is preserved.
    assert.equal(existsSync(mnLayout.receiptPath), true, 'the published receipt must remain visible');
    const cachePath = deriveCachePath(mnLayout, release.chain.releaseId, release.chain.releaseManifestSha256);
    assert.ok(cachePath !== null);
    assert.equal(existsSync(cachePath), true, 'the cache must be preserved');
    const packageRoot = derivePackageRoot(mnLayout, release.packageTreeSha256);
    assert.ok(packageRoot !== null);
    assert.equal(existsSync(join(packageRoot, 'bin', 'run.js')), true, 'the package must be preserved');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

// ─── concurrency (§30) ───────────────────────────────────────────────────

test('install: a held install lock serializes cooperating attempts (no competing publication)', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const env = makeEnv();
  try {
    const { acquireInstallLock, releaseInstallLock } = await import('../../src/persistence/lock.js');
    const mnLayout = resolveManifestNativeLayout(env);
    mkdirSync(mnLayout.stateRoot, { recursive: true, mode: 0o700 });
    const held = acquireInstallLock(mnLayout.installLockPath);
    assert.equal(held.ok, true);
    if (!held.ok) return;
    try {
      const outcome = await runFreshInstall(env, release, freshInstallDeps(fixtureVerifier(FIXTURE_NOW), installMetadataFetcher(release)));
      assert.equal(outcome.kind, 'REFUSED', JSON.stringify(outcome));
      if (outcome.kind !== 'REFUSED') return;
      assert.match(outcome.message, /another pi-shuttle installer is running|lock/i, outcome.message);
      assert.equal(existsSync(mnLayout.receiptPath), false, 'no competing receipt may be published while the lock is held');
    } finally {
      releaseInstallLock(held.fd, mnLayout.installLockPath);
    }
    // After release, the same attempt succeeds (final state: one exact VALID installation).
    const retry = await runFreshInstall(env, release, freshInstallDeps(fixtureVerifier(FIXTURE_NOW), installMetadataFetcher(release)));
    assert.equal(retry.kind, 'INSTALLED', JSON.stringify(retry));
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

// ─── pi-guard independence (§37) ─────────────────────────────────────────

test('install: the transaction never consults, installs, or records pi-guard; the receipt stays closed', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const env = makeEnv();
  try {
    const layout = resolveLayout(env);
    // A previous-generation pi-guard package + a MALFORMED old receipt: the
    // manifest-native transaction must neither read them nor be disturbed.
    mkdirSync(join(layout.packagesDir, 'pi-guard-0.1.2'), { recursive: true, mode: 0o700 });
    writeFileSync(join(layout.packagesDir, 'pi-guard-0.1.2', 'package.json'), JSON.stringify({ name: 'pi-guard', version: '0.1.2' }), { mode: 0o600 });
    mkdirSync(layout.stateDir, { recursive: true, mode: 0o700 });
    writeFileSync(layout.installReceiptPath, '{previous-generation receipt, deliberately malformed}', { mode: 0o600 });
    const outcome = await runFreshInstall(env, release, freshInstallDeps(fixtureVerifier(FIXTURE_NOW), installMetadataFetcher(release)));
    assert.equal(outcome.kind, 'INSTALLED', JSON.stringify(outcome));
    if (outcome.kind !== 'INSTALLED') return;
    // The old receipt was never read or rewritten.
    assert.equal(readFileSync(layout.installReceiptPath, 'utf8'), '{previous-generation receipt, deliberately malformed}');
    // The manifest-native receipt is the closed Schema-1 shape (any
    // pi-guard field would make parsing fail).
    const receiptText = readFileSync(resolveManifestNativeLayout(env).receiptPath, 'utf8');
    const parsed = parseManifestNativeReceipt(receiptText);
    assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.message);
    assert.equal(receiptText.includes('pi-guard'), false, 'no pi-guard identity may appear in Receipt Schema 1');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

// ─── helpers ─────────────────────────────────────────────────────────────

function collectSrc(): Array<{ readonly rel: string; readonly content: string }> {
  const repo = join(import.meta.dirname, '..', '..', '..');
  const out: Array<{ readonly rel: string; readonly content: string }> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.ts')) out.push({ rel: p.slice(repo.length + 1), content: readFileSync(p, 'utf8') });
    }
  };
  walk(join(repo, 'src'));
  return out;
}


// ─── FI-01: package durability barrier for EVERY accepted final package ──

import { fsyncSync as realFsyncSync } from 'node:fs';
import { realPackageDurabilityIo } from '../../src/manifest-native/install.js';
import type { PackageDurabilityIo } from '../../src/manifest-native/install.js';

/** Counting + failing package-durability seam. */
function countingPackageIo(counts: { file: number; dir: number }, failOn?: { readonly kind: 'file' | 'dir'; readonly at: number }): PackageDurabilityIo & { readonly counts: typeof counts } {
  const io = { ...realPackageDurabilityIo, counts };
  io.fsyncFile = (fd) => {
    counts.file += 1;
    if (failOn?.kind === 'file' && counts.file === failOn.at) throw ioError('EIO');
    realFsyncSync(fd);
  };
  io.fsyncDirectory = (fd) => {
    counts.dir += 1;
    if (failOn?.kind === 'dir' && counts.dir === failOn.at) throw ioError('EIO');
    realFsyncSync(fd);
  };
  return io;
}

test('install: FI-01-A reused orphan package (never fsynced) receives file+directory+parent durability barriers before cache/receipt', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const env = makeEnv();
  try {
    const mnLayout = resolveManifestNativeLayout(env);
    // Manual exact materialization with ORDINARY test writes — no fsync,
    // no publication/durability implementation.
    const target = derivePackageRoot(mnLayout, release.packageTreeSha256);
    assert.ok(target !== null);
    mkdirSync(join(target, 'lib'), { recursive: true, mode: 0o700 });
    mkdirSync(join(target, 'bin'), { recursive: true, mode: 0o700 });
    for (const [rel, content] of Object.entries(installTreeFiles(release.version, INSTALL_BIN_SCRIPT))) {
      writeFileSync(join(target, rel), content);
      chmodSync(join(target, rel), 0o600);
    }
    const counts = { file: 0, dir: 0 };
    const packageIo = countingPackageIo(counts);
    const outcome = await runFreshInstall(env, release, freshInstallDeps(fixtureVerifier(FIXTURE_NOW), installMetadataFetcher(release), { packageIo }));
    assert.equal(outcome.kind, 'INSTALLED', JSON.stringify(outcome));
    if (outcome.kind !== 'INSTALLED') return;
    // The reused package crossed the durability barrier: every regular file
    // fsynced through an opened FD, every directory fsynced, and the two
    // content-address parents fsynced (dir count = in-tree dirs + 2).
    assert.equal(counts.file, 3, `all 3 regular files must be fsynced (got ${counts.file})`);
    assert.equal(counts.dir, 5, `3 in-tree directories + 2 content-address parents must be fsynced (got ${counts.dir})`);
    // Cache + receipt published after the barrier.
    const cachePath = deriveCachePath(mnLayout, release.chain.releaseId, release.chain.releaseManifestSha256);
    assert.ok(cachePath !== null);
    assert.equal(existsSync(cachePath), true, 'cache must be published after the package durability barrier');
    assert.equal(existsSync(mnLayout.receiptPath), true, 'receipt must be published after the package durability barrier');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('install: FI-01-B reused package regular-file fsync failure -> no cache, no receipt, package preserved', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const env = makeEnv();
  try {
    const mnLayout = resolveManifestNativeLayout(env);
    const target = derivePackageRoot(mnLayout, release.packageTreeSha256);
    assert.ok(target !== null);
    mkdirSync(join(target, 'lib'), { recursive: true, mode: 0o700 });
    mkdirSync(join(target, 'bin'), { recursive: true, mode: 0o700 });
    for (const [rel, content] of Object.entries(installTreeFiles(release.version, INSTALL_BIN_SCRIPT))) {
      writeFileSync(join(target, rel), content);
      chmodSync(join(target, rel), 0o600);
    }
    const counts = { file: 0, dir: 0 };
    const packageIo = countingPackageIo(counts, { kind: 'file', at: 1 });
    const outcome = await runFreshInstall(env, release, freshInstallDeps(fixtureVerifier(FIXTURE_NOW), installMetadataFetcher(release), { packageIo }));
    assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
    if (outcome.kind !== 'FAILED') return;
    assert.equal(outcome.stage, 'package-durability');
    const cachePath = deriveCachePath(mnLayout, release.chain.releaseId, release.chain.releaseManifestSha256);
    assert.ok(cachePath !== null);
    assert.equal(existsSync(cachePath), false, 'no cache may be published when the reused package fails durability');
    assert.equal(existsSync(mnLayout.receiptPath), false, 'no receipt may be published');
    assert.equal(existsSync(join(target, 'bin', 'run.js')), true, 'the package is preserved — no rollback, no deletion');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('install: FI-01-B reused package directory fsync failure -> no cache, no receipt', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const env = makeEnv();
  try {
    const mnLayout = resolveManifestNativeLayout(env);
    const target = derivePackageRoot(mnLayout, release.packageTreeSha256);
    assert.ok(target !== null);
    mkdirSync(join(target, 'lib'), { recursive: true, mode: 0o700 });
    mkdirSync(join(target, 'bin'), { recursive: true, mode: 0o700 });
    for (const [rel, content] of Object.entries(installTreeFiles(release.version, INSTALL_BIN_SCRIPT))) {
      writeFileSync(join(target, rel), content);
      chmodSync(join(target, rel), 0o600);
    }
    const counts = { file: 0, dir: 0 };
    const packageIo = countingPackageIo(counts, { kind: 'dir', at: 1 });
    const outcome = await runFreshInstall(env, release, freshInstallDeps(fixtureVerifier(FIXTURE_NOW), installMetadataFetcher(release), { packageIo }));
    assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
    if (outcome.kind !== 'FAILED') return;
    assert.equal(outcome.stage, 'package-durability');
    assert.equal(existsSync(mnLayout.receiptPath), false);
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('install: FI-01-B reused package parent-directory fsync failure -> no cache, no receipt, package preserved', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const env = makeEnv();
  try {
    const mnLayout = resolveManifestNativeLayout(env);
    const target = derivePackageRoot(mnLayout, release.packageTreeSha256);
    assert.ok(target !== null);
    mkdirSync(join(target, 'lib'), { recursive: true, mode: 0o700 });
    mkdirSync(join(target, 'bin'), { recursive: true, mode: 0o700 });
    for (const [rel, content] of Object.entries(installTreeFiles(release.version, INSTALL_BIN_SCRIPT))) {
      writeFileSync(join(target, rel), content);
      chmodSync(join(target, rel), 0o600);
    }
    // In-tree dirs = root + lib + bin = 3; the FIRST parent fsync is the
    // 4th directory fsync call.
    const counts = { file: 0, dir: 0 };
    const packageIo = countingPackageIo(counts, { kind: 'dir', at: 4 });
    const outcome = await runFreshInstall(env, release, freshInstallDeps(fixtureVerifier(FIXTURE_NOW), installMetadataFetcher(release), { packageIo }));
    assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
    if (outcome.kind !== 'FAILED') return;
    assert.equal(outcome.stage, 'package-durability');
    assert.equal(existsSync(mnLayout.receiptPath), false, 'no receipt may be published');
    assert.equal(existsSync(join(target, 'lib', 'core.js')), true, 'the package is preserved');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('install: FI-01-E created package receives the same durability protection (failure -> no cache/receipt)', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const env = makeEnv();
  try {
    const mnLayout = resolveManifestNativeLayout(env);
    const counts = { file: 0, dir: 0 };
    const packageIo = countingPackageIo(counts, { kind: 'file', at: 1 });
    const outcome = await runFreshInstall(env, release, freshInstallDeps(fixtureVerifier(FIXTURE_NOW), installMetadataFetcher(release), { packageIo }));
    assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
    if (outcome.kind !== 'FAILED') return;
    assert.equal(outcome.stage, 'package-durability');
    assert.equal(existsSync(mnLayout.receiptPath), false, 'no receipt may be published after a created-package durability failure');
    // The materialized package remains (no destructive rollback after visibility).
    const target = derivePackageRoot(mnLayout, release.packageTreeSha256);
    assert.ok(target !== null);
    assert.equal(existsSync(join(target, 'bin', 'run.js')), true, 'the materialized package is preserved');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('install: FI-01-C substituted inode fails closed BEFORE the substituted object is fsynced or accepted', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const env = makeEnv();
  try {
    const mnLayout = resolveManifestNativeLayout(env);
    const target = derivePackageRoot(mnLayout, release.packageTreeSha256);
    assert.ok(target !== null);
    mkdirSync(join(target, 'lib'), { recursive: true, mode: 0o700 });
    mkdirSync(join(target, 'bin'), { recursive: true, mode: 0o700 });
    for (const [rel, content] of Object.entries(installTreeFiles(release.version, INSTALL_BIN_SCRIPT))) {
      writeFileSync(join(target, rel), content);
      chmodSync(join(target, rel), 0o600);
    }
    // A different inode (substitution): the openRegularFile seam returns an
    // fd of a DIFFERENT file; the real fstat identity gate must reject it
    // before any fsync.
    const other = join(env, 'substitute.txt');
    writeFileSync(other, 'different inode', { mode: 0o600 });
    const otherFd = openSync(other, 'r');
    let fileFsyncs = 0;
    const packageIo: PackageDurabilityIo = {
      ...realPackageDurabilityIo,
      openRegularFile: () => otherFd,
      fsyncFile: (fd) => { fileFsyncs += 1; realFsyncSync(fd); },
    };
    const outcome = await runFreshInstall(env, release, freshInstallDeps(fixtureVerifier(FIXTURE_NOW), installMetadataFetcher(release), { packageIo }));
    assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
    if (outcome.kind !== 'FAILED') return;
    assert.equal(outcome.stage, 'package-durability');
    assert.equal(fileFsyncs, 0, 'the substituted object must never be fsynced');
    assert.equal(existsSync(mnLayout.receiptPath), false);
    // NOTE: the durability barrier already closed the injected fd
    // best-effort on failure; no second close here.
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('install: FI-01-G exact same-release retry applies package durability before success; a barrier failure refuses', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const env = makeEnv();
  try {
    const verifier = fixtureVerifier(FIXTURE_NOW);
    const first = await runFreshInstall(env, release, freshInstallDeps(verifier, installMetadataFetcher(release)));
    assert.equal(first.kind, 'INSTALLED');
    // Retry with a counting seam: the reused package must cross the
    // durability barrier (3 files + 3 dirs + 2 parents) before success.
    const counts = { file: 0, dir: 0 };
    const retry = await runFreshInstall(env, release, freshInstallDeps(verifier, installMetadataFetcher(release), { packageIo: countingPackageIo(counts) }));
    assert.equal(retry.kind, 'ALREADY_INSTALLED', JSON.stringify(retry));
    if (retry.kind !== 'ALREADY_INSTALLED') return;
    assert.equal(counts.file, 3, `the retry must fsync every reused package file (got ${counts.file})`);
    assert.equal(counts.dir, 5, `the retry must fsync in-tree dirs + content-address parents (got ${counts.dir})`);
    // Retry with a failing package barrier: no ALREADY_INSTALLED success.
    const failed = await runFreshInstall(env, release, freshInstallDeps(verifier, installMetadataFetcher(release), { packageIo: countingPackageIo({ file: 0, dir: 0 }, { kind: 'file', at: 1 }) }));
    assert.equal(failed.kind, 'FAILED', JSON.stringify(failed));
    if (failed.kind !== 'FAILED') return;
    assert.equal(failed.stage, 'package-durability');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});
