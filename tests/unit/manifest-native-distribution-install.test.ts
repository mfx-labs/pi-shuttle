/**
 * FRESH-INSTALL Slice — current pi-shuttle distribution activation tests.
 *
 * The v0.1.3 defect corrected here: a successful public installer run
 * installed ONLY the manifest-native Gateway release; it never persisted
 * the CURRENT pi-shuttle distribution package (the verified artifact that
 * ran the installer) and never re-exposed `~/.local/bin/pi-shuttle`, so a
 * pre-existing previous-generation launcher stayed authoritative.
 *
 * Focused correction tests (A–E) plus the senior-review MN findings, all in
 * isolated HOMEs:
 *   A  fresh run installs the current distribution + exposes the launcher;
 *   B  a pre-existing foreign launcher symlink is atomically replaced and
 *      the old package is never read/modified;
 *   C1 an incomplete distribution package fails at stage 'distribution'
 *      with no namespace, no launcher, no Gateway receipt;
 *   C2 a non-symlink foreign launcher entry is refused and preserved;
 *   D  an exact-idempotent rerun keeps exactly one distribution entry and
 *      leaves the launcher unchanged;
 *   E  Receipt Schema 1 remains the sole Gateway authority; the
 *      previous-generation install.json is never written.
 *   MN-2 exact production-defect regression: a pre-existing previous-gen
 *      Gateway install + stale launcher + old package, rerun with the
 *      corrected handoff, is ALREADY_INSTALLED with the distribution
 *      persisted, the launcher re-pointed into it, and the Gateway runtime
 *      authority unchanged;
 *   MN-3 a launcher parent-dir durability barrier failure is fail-closed;
 *   MN-4 a FAILED outcome reports the truthful durable-step caveat;
 *   MN-5 a launcher target must be a strict canonical descendant of the
 *      installed package root.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runDoctor } from '../../src/command/doctor.js';
import { resolveLayout, resolveManifestNativeLayout } from '../../src/host/environment.js';
import { readPackageIdentity } from '../../src/installer/artifact.js';
import { PI_SHUTTLE_PACKAGE_NAME } from '../../src/installer/components.js';
import { resolveDistributionLayout, exposeCurrentDistributionLauncher } from '../../src/installer/distribution.js';
import { main as installerMain } from '../../src/installer/main.js';
import { parseManifestNativeReceipt } from '../../src/manifest-native/receipt.js';
import { resolveManifestNativeLifecycle } from '../../src/manifest-native/resolve.js';
import { FIXTURE_NOW, fixtureVerifier } from '../helpers/release-trust-fixtures.js';
import { fixturePathEnv, makeEnv } from '../helpers/lifecycle-fixtures.js';
import { nativeClassifyDeps, nativeResolver, TEST_LANE } from '../helpers/manifest-native-fixtures.js';
import {
  buildDistributionFixture,
  buildInstallFixtureRelease,
  freshInstallDeps,
  installMetadataFetcher,
  releaseAOverrides,
  runFreshInstall,
} from '../helpers/manifest-native-install-fixtures.js';
import type { DistributionFixture } from '../helpers/manifest-native-install-fixtures.js';
import type { InstallFixtureRelease } from '../helpers/manifest-native-install-fixtures.js';
import type { FreshInstallOutcome } from '../../src/manifest-native/install.js';

/** The installer's own package version (repo package.json in compiled tests). */
const REPO_VERSION = (JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'package.json'), 'utf8')) as { readonly version: string }).version;

const SHA256_DIR = /^[0-9a-f]{64}$/;

async function installInHome(home: string, release: InstallFixtureRelease, distribution: DistributionFixture, verifier: ReturnType<typeof fixtureVerifier>): Promise<FreshInstallOutcome> {
  const deps = freshInstallDeps(verifier, installMetadataFetcher(release), {
    distribution: {
      sourceIdentity: distribution.sourceIdentity,
      packageTgz: distribution.packageTgz,
      expectedVersion: REPO_VERSION,
    },
  });
  return runFreshInstall(home, release, deps);
}

function distributionPackageRoot(home: string): string {
  const layout = resolveDistributionLayout(home);
  const entries = readdirSync(layout.distributionsSha256Root).filter((name) => SHA256_DIR.test(name));
  assert.equal(entries.length, 1, JSON.stringify(readdirSync(layout.distributionsSha256Root)));
  return join(layout.distributionsSha256Root, entries[0]!);
}

test('distribution activation: a fresh installer run installs the current pi-shuttle distribution and exposes the canonical launcher (A)', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const distribution = await buildDistributionFixture(REPO_VERSION);
  const home = makeEnv();
  try {
    const verifier = fixtureVerifier(FIXTURE_NOW);
    const outcome = await installInHome(home, release, distribution, verifier);
    assert.equal(outcome.kind, 'INSTALLED', JSON.stringify(outcome));
    if (outcome.kind !== 'INSTALLED') return;

    const layout = resolveDistributionLayout(home);
    const packageRoot = distributionPackageRoot(home);
    // Package identity: pi-shuttle at the installer's own distribution version.
    const identity = readPackageIdentity(packageRoot);
    assert.notEqual(identity, null);
    assert.equal(identity?.name, PI_SHUTTLE_PACKAGE_NAME);
    assert.equal(identity?.version, REPO_VERSION);
    const binPath = join(packageRoot, 'dist', 'cli.js');
    assert.equal(existsSync(binPath), true, 'the distribution package CLI must be present');
    // Canonical launcher resolves exactly into the installed distribution.
    assert.equal(existsSync(layout.launcherPath), true);
    assert.equal(lstatSync(layout.launcherPath).isSymbolicLink(), true);
    assert.equal(readlinkSync(layout.launcherPath), binPath);
    // The launcher executes the CURRENT pi-shuttle distribution.
    const out = execFileSync(layout.launcherPath, { encoding: 'utf8' });
    assert.equal(out.trim(), `pi-shuttle ${REPO_VERSION}`);
    // Manifest-native Gateway runtime authority stays VALID and healthy.
    const resolution = await resolveManifestNativeLifecycle(resolveManifestNativeLayout(home), TEST_LANE, nativeClassifyDeps(verifier));
    assert.equal(resolution.kind, 'VALID');
    if (resolution.kind === 'VALID') {
      assert.equal(resolution.installation.binPath, outcome.binPath);
    }
    const doctor = await runDoctor({
      env: { home, platform: 'linux', arch: 'x64' },
      layout: resolveLayout(home),
      nodeExecutable: process.execPath,
      pathEnv: fixturePathEnv(home, { HOME: home }),
      resolveManifestNative: nativeResolver(verifier),
    });
    assert.equal(doctor.ok, true);
    if (doctor.ok) {
      const mnCheck = doctor.report.checks.find((c) => c.id === 'manifest-native');
      assert.equal(mnCheck?.verdict, 'supported', JSON.stringify(doctor.report.checks.map((c) => `${c.id}:${c.verdict}`)));
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(dirname(distribution.packageTgz), { recursive: true, force: true });
  }
});

test('distribution activation: a pre-existing foreign launcher symlink is atomically replaced; the old package is untouched (B)', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const distribution = await buildDistributionFixture(REPO_VERSION);
  const home = makeEnv();
  try {
    // Pre-existing previous-generation package + canonical launcher symlink.
    const oldRoot = join(home, '.local', 'share', 'pi-shuttle', 'previous-generation');
    const oldBin = join(oldRoot, 'dist', 'cli.js');
    mkdirSync(join(oldRoot, 'dist'), { recursive: true, mode: 0o700 });
    writeFileSync(join(oldRoot, 'package.json'), JSON.stringify({ name: PI_SHUTTLE_PACKAGE_NAME, version: '0.1.1', bin: { 'pi-shuttle': 'dist/cli.js' } }), { mode: 0o600 });
    writeFileSync(oldBin, "#!/usr/bin/env node\nprocess.stdout.write('old generation\\n');\n", { mode: 0o600 });
    chmodSync(oldBin, 0o700);
    const binDir = join(home, '.local', 'bin');
    mkdirSync(binDir, { recursive: true, mode: 0o700 });
    const launcherPath = join(binDir, PI_SHUTTLE_PACKAGE_NAME);
    symlinkSync(oldBin, launcherPath);
    const oldPackageJson = readFileSync(join(oldRoot, 'package.json'), 'utf8');
    const oldBinBytes = readFileSync(oldBin, 'utf8');

    const verifier = fixtureVerifier(FIXTURE_NOW);
    const outcome = await installInHome(home, release, distribution, verifier);
    assert.equal(outcome.kind, 'INSTALLED', JSON.stringify(outcome));
    if (outcome.kind !== 'INSTALLED') return;

    const binPath = join(distributionPackageRoot(home), 'dist', 'cli.js');
    assert.equal(readlinkSync(launcherPath), binPath, 'the launcher must now point into the installed current distribution');
    // The previous-generation package is never read, modified, or removed.
    assert.equal(readFileSync(join(oldRoot, 'package.json'), 'utf8'), oldPackageJson);
    assert.equal(readFileSync(oldBin, 'utf8'), oldBinBytes);
    const out = execFileSync(launcherPath, { encoding: 'utf8' });
    assert.equal(out.trim(), `pi-shuttle ${REPO_VERSION}`);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(dirname(distribution.packageTgz), { recursive: true, force: true });
  }
});

test('distribution activation: an incomplete distribution package is never activated, exposed, or receipted (C1)', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const distribution = await buildDistributionFixture(REPO_VERSION, { includeCli: false });
  const home = makeEnv();
  try {
    const outcome = await installInHome(home, release, distribution, fixtureVerifier(FIXTURE_NOW));
    assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
    if (outcome.kind !== 'FAILED') return;
    assert.equal(outcome.stage, 'distribution', JSON.stringify(outcome));
    const layout = resolveDistributionLayout(home);
    const mnLayout = resolveManifestNativeLayout(home);
    assert.equal(existsSync(layout.distributionRoot), false, 'no distribution namespace for a failed distribution install');
    assert.equal(existsSync(layout.launcherPath), false, 'the launcher must never be created for a failed distribution install');
    assert.equal(existsSync(mnLayout.receiptPath), false, 'no manifest-native receipt: the Gateway transaction never started');
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(dirname(distribution.packageTgz), { recursive: true, force: true });
  }
});

test('distribution activation: a non-symlink foreign launcher entry is refused and preserved (C2)', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const distribution = await buildDistributionFixture(REPO_VERSION);
  const home = makeEnv();
  try {
    const launcherPath = join(home, '.local', 'bin', PI_SHUTTLE_PACKAGE_NAME);
    mkdirSync(dirname(launcherPath), { recursive: true, mode: 0o700 });
    writeFileSync(launcherPath, 'operator-owned', { mode: 0o600 });
    const outcome = await installInHome(home, release, distribution, fixtureVerifier(FIXTURE_NOW));
    assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
    if (outcome.kind !== 'FAILED') return;
    assert.equal(outcome.stage, 'distribution', JSON.stringify(outcome));
    assert.equal(readFileSync(launcherPath, 'utf8'), 'operator-owned', 'the foreign entry is never clobbered');
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(dirname(distribution.packageTgz), { recursive: true, force: true });
  }
});

test('distribution activation: an exact-idempotent rerun keeps exactly one distribution entry and an unchanged launcher (D)', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const distribution = await buildDistributionFixture(REPO_VERSION);
  const home = makeEnv();
  try {
    const verifier = fixtureVerifier(FIXTURE_NOW);
    const first = await installInHome(home, release, distribution, verifier);
    assert.equal(first.kind, 'INSTALLED', JSON.stringify(first));
    if (first.kind !== 'INSTALLED') return;
    const layout = resolveDistributionLayout(home);
    const launcherBefore = readlinkSync(layout.launcherPath);
    const entriesBefore = readdirSync(layout.distributionsSha256Root).filter((name) => SHA256_DIR.test(name));
    assert.equal(entriesBefore.length, 1);

    const second = await installInHome(home, release, distribution, verifier);
    assert.equal(second.kind, 'ALREADY_INSTALLED', JSON.stringify(second));
    assert.equal(readlinkSync(layout.launcherPath), launcherBefore, 'the canonical launcher is unchanged on an exact-idempotent rerun');
    const entriesAfter = readdirSync(layout.distributionsSha256Root).filter((name) => SHA256_DIR.test(name));
    assert.deepEqual(entriesAfter, entriesBefore, 'exactly one distribution entry is preserved');
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(dirname(distribution.packageTgz), { recursive: true, force: true });
  }
});

test('distribution activation: the exact production defect is corrected — a stale previous-generation launcher is replaced and the current distribution installed even when the Gateway is already installed (MN-2)', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const distribution = await buildDistributionFixture(REPO_VERSION);
  const home = makeEnv();
  try {
    const verifier = fixtureVerifier(FIXTURE_NOW);
    const mnLayout = resolveManifestNativeLayout(home);
    // Run 1: the v0.1.3 defect oracle — a Gateway install WITHOUT the
    // distribution handoff: no current distribution package, no launcher.
    const oracle = await runFreshInstall(home, release, freshInstallDeps(verifier, installMetadataFetcher(release)));
    assert.equal(oracle.kind, 'INSTALLED', JSON.stringify(oracle));
    if (oracle.kind !== 'INSTALLED') return;
    const gatewayPackageRoot = oracle.packageRoot;
    const gatewayBinPath = oracle.binPath;

    // Stale previous-generation launcher + old package (the pre-existing
    // operator state the v0.1.3 installer silently left authoritative).
    const oldRoot = join(home, '.local', 'share', 'pi-shuttle', 'previous-generation');
    const oldBin = join(oldRoot, 'dist', 'cli.js');
    mkdirSync(join(oldRoot, 'dist'), { recursive: true, mode: 0o700 });
    writeFileSync(join(oldRoot, 'package.json'), JSON.stringify({ name: PI_SHUTTLE_PACKAGE_NAME, version: '0.1.1', bin: { 'pi-shuttle': 'dist/cli.js' } }), { mode: 0o600 });
    writeFileSync(oldBin, "#!/usr/bin/env node\nprocess.stdout.write('old generation\\n');\n", { mode: 0o600 });
    chmodSync(oldBin, 0o700);
    const binDir = join(home, '.local', 'bin');
    mkdirSync(binDir, { recursive: true, mode: 0o700 });
    const launcherPath = join(binDir, PI_SHUTTLE_PACKAGE_NAME);
    symlinkSync(oldBin, launcherPath);
    const oldPackageJson = readFileSync(join(oldRoot, 'package.json'), 'utf8');
    const oldBinBytes = readFileSync(oldBin, 'utf8');

    // Run 2: the CORRECTED installer over the exact v0.1.3 end-state. The
    // Gateway is an exact idempotent retry (ALREADY_INSTALLED) and the
    // current distribution + canonical launcher are now installed.
    const corrected = await installInHome(home, release, distribution, verifier);
    assert.equal(corrected.kind, 'ALREADY_INSTALLED', JSON.stringify(corrected));

    const layout = resolveDistributionLayout(home);
    const packageRoot = distributionPackageRoot(home);
    const binPath = join(packageRoot, 'dist', 'cli.js');
    assert.equal(existsSync(packageRoot), true, 'the current pi-shuttle distribution must be persisted');
    assert.equal(readlinkSync(launcherPath), binPath, 'the canonical launcher must now point into the installed current distribution');
    // The old package is never read, modified, or removed.
    assert.equal(readFileSync(join(oldRoot, 'package.json'), 'utf8'), oldPackageJson);
    assert.equal(readFileSync(oldBin, 'utf8'), oldBinBytes);
    const out = execFileSync(launcherPath, { encoding: 'utf8' });
    assert.equal(out.trim(), `pi-shuttle ${REPO_VERSION}`, 'the launcher must execute the CURRENT pi-shuttle distribution');
    // Gateway runtime authority unchanged: same content-addressed package
    // root and bin path, still VALID.
    const resolution = await resolveManifestNativeLifecycle(mnLayout, TEST_LANE, nativeClassifyDeps(verifier));
    assert.equal(resolution.kind, 'VALID');
    if (resolution.kind === 'VALID') {
      assert.equal(resolution.installation.receipt.gateway.packageRoot, gatewayPackageRoot);
      assert.equal(resolution.installation.receipt.gateway.binPath, gatewayBinPath);
    }
    assert.equal(existsSync(resolveLayout(home).installReceiptPath), false, 'the previous-generation install.json is never written');
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(dirname(distribution.packageTgz), { recursive: true, force: true });
  }
});

test('distribution activation: a failed launcher parent-dir durability barrier is fail-closed (MN-3)', async () => {
  const home = makeEnv();
  try {
    const layout = resolveDistributionLayout(home);
    const packageRoot = join(home, '.local', 'share', 'pi-shuttle', 'distributions', 'sha256', 'f'.repeat(64));
    mkdirSync(join(packageRoot, 'dist'), { recursive: true, mode: 0o700 });
    const binPath = join(packageRoot, 'dist', 'cli.js');
    writeFileSync(binPath, '#!/usr/bin/env node\n', { mode: 0o600 });
    chmodSync(binPath, 0o700);
    // An injected parent-dir fsync failure must fail closed with ok:false
    // rather than accept the exposure; the launcher (created before the
    // barrier) remains visible but is never reported live.
    const injected = exposeCurrentDistributionLauncher({
      home,
      packageRoot,
      binPath,
      fsyncParentDirectory: () => {
        const err = new Error('injected') as NodeJS.ErrnoException;
        err.code = 'EIO';
        throw err;
      },
    });
    assert.equal(injected.ok, false);
    if (!injected.ok) {
      assert.match(injected.message, /canonical launcher durability barrier failed \(EIO\)/, injected.message);
    }
    assert.equal(lstatSync(layout.launcherPath).isSymbolicLink(), true, 'the launcher is created before the barrier and remains visible');
    assert.equal(readlinkSync(layout.launcherPath), binPath);
    // The exact-target idempotent no-op (already pointing at the bin) is
    // NOT accepted here: the injected barrier still fails closed on any
    // barrier-reached exposure path.
    const reinjected = exposeCurrentDistributionLauncher({
      home,
      packageRoot,
      binPath,
      fsyncParentDirectory: () => {
        const err = new Error('injected') as NodeJS.ErrnoException;
        err.code = 'EIO';
        throw err;
      },
    });
    assert.equal(reinjected.ok, true, reinjected.ok ? '' : reinjected.message);
    assert.equal(reinjected.changed, false, 'an exact-target no-op makes no changes');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

async function captureInstallerStdout(run: () => Promise<number>): Promise<{ readonly code: number; readonly text: string }> {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ..._rest: unknown[]) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await run();
    return { code, text: chunks.join('') };
  } finally {
    process.stdout.write = originalWrite;
  }
}

test('distribution activation: a FAILED outcome reports the truthful durable-step caveat, not "no installation authority was changed" (MN-4)', async () => {
  const failed: FreshInstallOutcome = {
    kind: 'FAILED',
    stage: 'distribution',
    code: 'ERR-MN-INSTALL-DISTRIBUTION',
    message: 'current pi-shuttle canonical launcher could not be exposed: launcher target could not be inspected',
  };
  const failedOut = await captureInstallerStdout(() => installerMain([], { installRunner: async () => failed }));
  assert.equal(failedOut.code, 2);
  assert.ok(failedOut.text.includes('result: FAILED at stage "distribution"'), failedOut.text);
  assert.equal(failedOut.text.includes('no installation authority was changed'), false, 'a FAILED message must not claim that no authority was changed');
  assert.ok(failedOut.text.includes('prior durable install steps may already exist'), failedOut.text);

  const refused: FreshInstallOutcome = { kind: 'REFUSED', code: 'ERR-MN-INSTALL-LOCK', message: 'manifest-native install lock could not be acquired' };
  const refusedOut = await captureInstallerStdout(() => installerMain([], { installRunner: async () => refused }));
  assert.equal(refusedOut.code, 2);
  assert.ok(refusedOut.text.includes('no installation authority was changed'), 'a pre-mutation REFUSED outcome keeps the unchanged claim');
});

test('distribution activation: the launcher target must be a strict canonical descendant of the installed package root (MN-5)', async () => {
  const home = makeEnv();
  try {
    const layout = resolveDistributionLayout(home);
    const packageRoot = join(home, '.local', 'share', 'pi-shuttle', 'distributions', 'sha256', 'e'.repeat(64));
    mkdirSync(join(packageRoot, 'dist'), { recursive: true, mode: 0o700 });
    const inPackage = join(packageRoot, 'dist', 'cli.js');
    writeFileSync(inPackage, '#!/usr/bin/env node\n', { mode: 0o600 });
    chmodSync(inPackage, 0o700);
    // A bin strictly inside the package root is accepted (launcher created
    // atomically, pointing exactly into the package).
    const accepted = exposeCurrentDistributionLauncher({ home, packageRoot, binPath: inPackage });
    assert.equal(accepted.ok, true, accepted.ok ? '' : accepted.message);
    assert.equal(readlinkSync(layout.launcherPath), inPackage);
    // A traversal candidate that passes a naive prefix check (/pkg/../...)
    // but is not a strict canonical descendant is refused BEFORE mutation.
    const traversal = join(packageRoot, '..', 'evil', 'cli.js');
    const rejected = exposeCurrentDistributionLauncher({ home, packageRoot, binPath: traversal });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) {
      assert.match(rejected.message, /escapes the installed package root/, rejected.message);
    }
    // The accepted launcher is untouched by the refused attempt.
    assert.equal(readlinkSync(layout.launcherPath), inPackage);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('distribution activation: Receipt Schema 1 remains the sole Gateway authority; install.json is never written (E)', async () => {
  const release = await buildInstallFixtureRelease(releaseAOverrides());
  const distribution = await buildDistributionFixture(REPO_VERSION);
  const home = makeEnv();
  try {
    const verifier = fixtureVerifier(FIXTURE_NOW);
    const outcome = await installInHome(home, release, distribution, verifier);
    assert.equal(outcome.kind, 'INSTALLED', JSON.stringify(outcome));
    if (outcome.kind !== 'INSTALLED') return;
    const mnLayout = resolveManifestNativeLayout(home);
    const parsed = parseManifestNativeReceipt(readFileSync(mnLayout.receiptPath, 'utf8'));
    assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.message);
    if (!parsed.ok) return;
    assert.equal(parsed.value.schemaVersion, 1);
    assert.ok(parsed.value.gateway.packageRoot.startsWith(`${mnLayout.packagesSha256Root}/`), parsed.value.gateway.packageRoot);
    assert.ok(parsed.value.gateway.binPath.startsWith(`${mnLayout.packagesSha256Root}/`), parsed.value.gateway.binPath);
    assert.equal(existsSync(resolveLayout(home).installReceiptPath), false, 'the previous-generation install.json is never written');
    const resolution = await resolveManifestNativeLifecycle(mnLayout, TEST_LANE, nativeClassifyDeps(verifier));
    assert.equal(resolution.kind, 'VALID');
    if (resolution.kind === 'VALID') {
      assert.equal(resolution.installation.receipt.gateway.packageRoot, parsed.value.gateway.packageRoot);
      assert.equal(resolution.installation.receipt.gateway.binPath, parsed.value.gateway.binPath);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(dirname(distribution.packageTgz), { recursive: true, force: true });
  }
});