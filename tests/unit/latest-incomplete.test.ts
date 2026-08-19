import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInstall, classifyInstallationState } from '../../src/installer/install.js';
import { readReceipt } from '../../src/installer/receipt.js';
import { gatewayDescriptorForLane } from '../../src/compat/manifest.js';
import { hashPackageTree } from '../../src/installer/artifact.js';
import { piShuttlePackageDirName } from '../../src/installer/components.js';
import { resolveLayout } from '../../src/host/environment.js';
import { buildTarball, cleanupEnv, fullInstallEnv, gatewayFixtureFiles, makeEnv, piGuardFixtureFiles } from '../helpers/installer-fixtures.js';
import { recursiveStateSnapshot } from '../helpers/state-snapshot.js';

const SOURCE_A = `mfx-labs/pi-shuttle@${'a'.repeat(40)}`;
const SOURCE = `mfx-labs/pi-shuttle@${'b'.repeat(40)}`;
const PHYSICAL_SOURCE = 'mfx-labs/pi-shuttle@5e6aef60dce37299cc7af2c6add10905be03a396';

function shuttleFiles(version = '0.1.3', body = 'console.log("fixture pi-shuttle");'): Record<string, string> {
  return {
    'package.json': JSON.stringify({ name: 'pi-shuttle', version, type: 'module', bin: { 'pi-shuttle': './dist/cli.js' } }),
    'dist/cli.js': `#!/usr/bin/env node\n${body}\n`,
  };
}

function writeShuttlePackage(root: string, version = '0.1.3', body = 'console.log("fixture pi-shuttle");'): void {
  mkdirSync(join(root, 'dist'), { recursive: true, mode: 0o700 });
  for (const [name, content] of Object.entries(shuttleFiles(version, body))) writeFileSync(join(root, name), content, { mode: 0o700 });
}

function activateLatestCommand(layout: ReturnType<typeof resolveLayout>, target: string): string {
  mkdirSync(layout.binDir, { recursive: true, mode: 0o700 });
  rmSync(join(layout.binDir, 'pi-shuttle'), { force: true });
  symlinkSync(join(target, 'dist', 'cli.js'), join(layout.binDir, 'pi-shuttle'));
  return target;
}

function seedActiveLatest(layout: ReturnType<typeof resolveLayout>, source = SOURCE, body = 'console.log("fixture pi-shuttle");'): string {
  const target = join(layout.packagesDir, piShuttlePackageDirName('0.1.3', source));
  writeShuttlePackage(target, '0.1.3', body);
  return activateLatestCommand(layout, target);
}

function seedMatchingActiveLatest(layout: ReturnType<typeof resolveLayout>, source = SOURCE): string {
  const target = join(layout.packagesDir, piShuttlePackageDirName('0.1.3', source));
  cpSync(join(layout.packagesDir, 'pi-shuttle@0.1.3'), target, { recursive: true });
  return activateLatestCommand(layout, target);
}

async function withFixturePi<T>(runEnv: ReturnType<typeof fullInstallEnv>, fn: () => Promise<T>): Promise<T> {
  const old = {
    path: process.env.PATH,
    version: process.env.FIXTURE_PI_VERSION,
    state: process.env.FIXTURE_PI_STATE,
  };
  process.env.PATH = [runEnv.fixtureBin, process.env.PATH ?? ''].join(':');
  process.env.FIXTURE_PI_VERSION = String(runEnv.extraEnv.FIXTURE_PI_VERSION ?? '0.83.0');
  if (runEnv.extraEnv.FIXTURE_PI_STATE === undefined) delete process.env.FIXTURE_PI_STATE;
  else process.env.FIXTURE_PI_STATE = runEnv.extraEnv.FIXTURE_PI_STATE;
  try {
    return await fn();
  } finally {
    if (old.path === undefined) delete process.env.PATH; else process.env.PATH = old.path;
    if (old.version === undefined) delete process.env.FIXTURE_PI_VERSION; else process.env.FIXTURE_PI_VERSION = old.version;
    if (old.state === undefined) delete process.env.FIXTURE_PI_STATE; else process.env.FIXTURE_PI_STATE = old.state;
  }
}

async function fixtureArtifacts(env: string) {
  const gateway = await buildTarball(env, gatewayFixtureFiles(), 'project-gateway-artifact-core-0.1.0.tgz');
  const piGuard = await buildTarball(env, piGuardFixtureFiles(), 'pi-guard-0.1.2.tgz');
  const shuttle = await buildTarball(env, shuttleFiles(), 'pi-shuttle-0.1.3.tgz');
  return { gateway, piGuard, shuttle };
}

async function seedStable(env: string) {
  const artifacts = await fixtureArtifacts(env);
  const piState = join(env, 'pi-state.txt');
  const runEnv = fullInstallEnv(env, '0.83.0', piState);
  const outcome = await withFixturePi(runEnv, () => runInstall(
    { home: env, platform: 'linux', arch: 'x64' },
    { selections: { gateway: true, piGuard: true }, artifactDir: env, releasePackageTgz: artifacts.shuttle, uid: 12345 },
  ));
  assert.equal(outcome.kind, 'COMPLETE', JSON.stringify(outcome));
  return { ...artifacts, piState, runEnv };
}

function latestOptions(shuttle: string, extra: Partial<Parameters<typeof runInstall>[1]> = {}): Parameters<typeof runInstall>[1] {
  return {
    selections: { gateway: true, piGuard: true },
    artifactDir: join(shuttle, '..'),
    releasePackageTgz: shuttle,
    sourceIdentity: SOURCE,
    uid: 12345,
    confirmIncompleteCleanup: async () => true,
    ...extra,
  };
}

function classify(env: string, sourceIdentity: string | undefined = SOURCE) {
  const descriptor = gatewayDescriptorForLane('linux-x86_64-posix-utf8-node22');
  if (!descriptor.ok) throw new Error(descriptor.message);
  return classifyInstallationState(resolveLayout(env), descriptor.descriptor, {
    packageName: descriptor.descriptor.packageName,
    artifactFileName: descriptor.descriptor.artifactFileName,
    binName: descriptor.descriptor.binName,
  }, sourceIdentity);
}

function installCount(piState: string): number {
  try {
    return readFileSync(piState, 'utf8').split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

test('installation classifier: CLEAN, INSTALLED, and receipt-less leftovers map to the three states', async () => {
  const env = makeEnv();
  try {
    assert.equal(classify(env).kind, 'CLEAN');
    const seeded = await seedStable(env);
    assert.equal(classify(env).kind, 'INSTALLED');
    rmSync(resolveLayout(env).installReceiptPath);
    const incomplete = classify(env);
    assert.equal(incomplete.kind, 'INCOMPLETE');
    if (incomplete.kind === 'INCOMPLETE') assert.ok(incomplete.state.evidence.some((entry) => entry.includes('command leftover')));

    const rerun = await withFixturePi(seeded.runEnv, () => runInstall(
      { home: env, platform: 'linux', arch: 'x64' },
      latestOptions(seeded.shuttle, { confirmIncompleteCleanup: async () => false }),
    ));
    assert.equal(rerun.kind, 'INCOMPLETE_DECLINED');
  } finally {
    cleanupEnv(env);
  }
});

test('valid FINAL receipt follows the normal installed/same-version path', async () => {
  const env = makeEnv();
  try {
    const seeded = await seedStable(env);
    const result = await withFixturePi(seeded.runEnv, () => runInstall(
      { home: env, platform: 'linux', arch: 'x64' },
      { selections: { gateway: true, piGuard: true }, artifactDir: env, releasePackageTgz: seeded.shuttle, uid: 12345 },
    ));
    assert.equal(result.kind, 'ALREADY_INSTALLED', JSON.stringify(result));
  } finally {
    cleanupEnv(env);
  }
});

test('same-semver Stable to Latest requires channel-switch consent', async () => {
  const env = makeEnv();
  try {
    const seeded = await seedStable(env);
    const offers: Array<[string, string, unknown]> = [];
    const outcome = await withFixturePi(seeded.runEnv, () => runInstall(
      { home: env, platform: 'linux', arch: 'x64' },
      latestOptions(seeded.shuttle, {
        confirmUpgrade: async (installed, installer, transition) => {
          offers.push([installed, installer, transition]);
          return true;
        },
      }),
    ));
    assert.deepEqual(offers, [[
      '0.1.3',
      '0.1.3',
      { kind: 'stable-to-latest', latestSource: SOURCE },
    ]]);
    assert.equal(outcome.kind, 'COMPLETE', JSON.stringify(outcome));
    if (outcome.kind === 'COMPLETE') assert.deepEqual(outcome.sourceTransition, { kind: 'stable-to-latest', latestSource: SOURCE });
  } finally {
    cleanupEnv(env);
  }
});

test('Latest source changes require source-aware consent; an exact source is already installed', async () => {
  const env = makeEnv();
  try {
    const seeded = await seedStable(env);
    const first = await withFixturePi(seeded.runEnv, () => runInstall(
      { home: env, platform: 'linux', arch: 'x64' },
      latestOptions(seeded.shuttle, { sourceIdentity: SOURCE_A, confirmUpgrade: async () => true }),
    ));
    assert.equal(first.kind, 'COMPLETE', JSON.stringify(first));

    const offers: Array<[string, string, unknown]> = [];
    const update = await withFixturePi(seeded.runEnv, () => runInstall(
      { home: env, platform: 'linux', arch: 'x64' },
      latestOptions(seeded.shuttle, {
        confirmUpgrade: async (installed, installer, transition) => {
          offers.push([installed, installer, transition]);
          return true;
        },
      }),
    ));
    assert.deepEqual(offers, [[
      '0.1.3',
      '0.1.3',
      { kind: 'latest-source', installedSource: SOURCE_A, latestSource: SOURCE },
    ]]);
    assert.equal(update.kind, 'COMPLETE', JSON.stringify(update));
    if (update.kind === 'COMPLETE') assert.deepEqual(update.sourceTransition, { kind: 'latest-source', installedSource: SOURCE_A, latestSource: SOURCE });

    let confirmations = 0;
    const exact = await withFixturePi(seeded.runEnv, () => runInstall(
      { home: env, platform: 'linux', arch: 'x64' },
      latestOptions(seeded.shuttle, { confirmUpgrade: async () => { confirmations += 1; return true; } }),
    ));
    assert.deepEqual(exact, { kind: 'ALREADY_INSTALLED', version: '0.1.3' });
    assert.equal(confirmations, 0, 'an exact Latest source must not request update consent');
  } finally {
    cleanupEnv(env);
  }
});

test('known recovery receipt is INCOMPLETE; malformed or foreign receipt is REFUSED', async () => {
  const env = makeEnv();
  try {
    const seeded = await seedStable(env);
    const layout = resolveLayout(env);
    const final = JSON.parse(readFileSync(layout.installReceiptPath, 'utf8')) as Record<string, unknown>;
    delete final.installedAt;
    final.recovery = {
      recoveredAt: '2026-08-17T00:00:00.000Z',
      recoveredBy: PHYSICAL_SOURCE,
      originalInstalledAt: null,
      originalChannel: 'unknown',
    };
    writeFileSync(layout.installReceiptPath, `${JSON.stringify(final)}\n`, { mode: 0o600 });
    assert.equal(classify(env).kind, 'INCOMPLETE');

    writeFileSync(layout.installReceiptPath, '{"foreign":true}\n', { mode: 0o600 });
    assert.equal(classify(env).kind, 'REFUSED');
    const refused = await withFixturePi(seeded.runEnv, () => runInstall(
      { home: env, platform: 'linux', arch: 'x64' },
      latestOptions(seeded.shuttle),
    ));
    assert.equal(refused.kind, 'REFUSED');
    assert.equal(readFileSync(layout.installReceiptPath, 'utf8'), '{"foreign":true}\n');
  } finally {
    cleanupEnv(env);
  }
});

test('multiple retained pi-shuttle versions are INCOMPLETE evidence, not ambiguity', async () => {
  const env = makeEnv();
  try {
    const seeded = await seedStable(env);
    const layout = resolveLayout(env);
    rmSync(layout.installReceiptPath);
    const old = join(layout.packagesDir, 'pi-shuttle@0.1.0');
    mkdirSync(join(old, 'dist'), { recursive: true, mode: 0o700 });
    for (const [name, content] of Object.entries(shuttleFiles('0.1.0'))) writeFileSync(join(old, name), content, { mode: 0o700 });
    rmSync(join(layout.binDir, 'pi-shuttle'));
    symlinkSync(join(old, 'dist', 'cli.js'), join(layout.binDir, 'pi-shuttle'));

    const state = classify(env);
    assert.equal(state.kind, 'INCOMPLETE');
    if (state.kind === 'INCOMPLETE') {
      assert.equal(state.state.evidence.filter((entry) => entry.includes('retained pi-shuttle package')).length, 2);
    }
    const outcome = await withFixturePi(seeded.runEnv, () => runInstall(
      { home: env, platform: 'linux', arch: 'x64' },
      latestOptions(seeded.shuttle),
    ));
    assert.equal(outcome.kind, 'COMPLETE', JSON.stringify(outcome));
    assert.equal(existsSync(old), true);
    assert.equal(existsSync(join(layout.packagesDir, 'pi-shuttle@0.1.3')), true);
  } finally {
    cleanupEnv(env);
  }
});

test('out-of-root or foreign command target is REFUSED without mutation', async () => {
  const env = makeEnv();
  try {
    const artifacts = await fixtureArtifacts(env);
    const layout = resolveLayout(env);
    mkdirSync(layout.binDir, { recursive: true, mode: 0o700 });
    const foreign = join(env, 'foreign-command');
    writeFileSync(foreign, 'foreign\n');
    symlinkSync(foreign, join(layout.binDir, 'pi-shuttle'));
    const before = readlinkSync(join(layout.binDir, 'pi-shuttle'));
    const outcome = await runInstall(
      { home: env, platform: 'linux', arch: 'x64' },
      latestOptions(artifacts.shuttle),
    );
    assert.equal(outcome.kind, 'REFUSED');
    assert.equal(readlinkSync(join(layout.binDir, 'pi-shuttle')), before);
    assert.equal(existsSync(layout.installReceiptPath), false);
  } finally {
    cleanupEnv(env);
  }
});

test('declining incomplete cleanup performs no installation mutation', async () => {
  const env = makeEnv();
  try {
    const seeded = await seedStable(env);
    const layout = resolveLayout(env);
    rmSync(layout.installReceiptPath);
    const project = join(env, 'project');
    mkdirSync(project);
    writeFileSync(join(project, 'marker'), 'keep\n');
    mkdirSync(layout.storesDir, { recursive: true });
    writeFileSync(join(layout.storesDir, 'keep'), 'store\n');
    mkdirSync(layout.configDir, { recursive: true });
    writeFileSync(layout.runtimeConfigPath, '{"keep":true}\n');
    const paths = { command: join(layout.binDir, 'pi-shuttle'), packages: layout.packagesDir, gateway: join(layout.packagesDir, 'project-gateway-artifact-core@0.1.0'), piGuard: join(layout.packagesDir, 'pi-guard@0.1.2'), piState: seeded.piState, stores: layout.storesDir, config: layout.configDir, project };
    const before = recursiveStateSnapshot(paths);
    let calls = 0;
    const outcome = await withFixturePi(seeded.runEnv, () => runInstall(
      { home: env, platform: 'linux', arch: 'x64' },
      latestOptions(seeded.shuttle, { confirmIncompleteCleanup: async () => { calls += 1; return false; } }),
    ));
    assert.equal(outcome.kind, 'INCOMPLETE_DECLINED');
    assert.equal(calls, 1);
    assert.deepEqual(recursiveStateSnapshot(paths), before);
    assert.equal(existsSync(layout.installReceiptPath), false);
  } finally {
    cleanupEnv(env);
  }
});

test('accepted incomplete cleanup performs a fresh source-qualified Latest install and reuses components', async () => {
  const env = makeEnv();
  try {
    const seeded = await seedStable(env);
    const layout = resolveLayout(env);
    rmSync(layout.installReceiptPath);
    const oldCommand = readlinkSync(join(layout.binDir, 'pi-shuttle'));
    const gatewayPackage = join(layout.packagesDir, 'project-gateway-artifact-core@0.1.0', 'package.json');
    const gatewayBefore = readFileSync(gatewayPackage, 'utf8');
    const piInstallsBefore = installCount(seeded.piState);

    const outcome = await withFixturePi(seeded.runEnv, () => runInstall(
      { home: env, platform: 'linux', arch: 'x64' },
      latestOptions(seeded.shuttle),
    ));
    assert.equal(outcome.kind, 'COMPLETE', JSON.stringify(outcome));
    const target = join(layout.packagesDir, piShuttlePackageDirName('0.1.3', SOURCE));
    assert.notEqual(readlinkSync(join(layout.binDir, 'pi-shuttle')), oldCommand);
    assert.equal(readlinkSync(join(layout.binDir, 'pi-shuttle')), join(target, 'dist', 'cli.js'));
    assert.equal(readFileSync(gatewayPackage, 'utf8'), gatewayBefore, 'Gateway package is reused');
    assert.equal(installCount(seeded.piState), piInstallsBefore, 'pi-guard does not run a second pi install');
    const receipt = readReceipt(layout.installReceiptPath);
    assert.equal(receipt.ok, true);
    if (receipt.ok) {
      assert.equal(receipt.receipt.channel, 'latest');
      assert.equal(receipt.receipt.sourceIdentity, SOURCE);
      assert.equal(receipt.receipt.piShuttleInstallPath, target);
      const digest = await hashPackageTree(target);
      assert.equal(digest.ok && digest.value === receipt.receipt.piShuttleTreeSha256, true);
    }
  } finally {
    cleanupEnv(env);
  }
});

test('an inactive incomplete exact Latest destination is removed and recreated only after consent', async () => {
  const env = makeEnv();
  try {
    const artifacts = await fixtureArtifacts(env);
    const layout = resolveLayout(env);
    const target = join(layout.packagesDir, piShuttlePackageDirName('0.1.3', SOURCE));
    mkdirSync(join(target, 'dist'), { recursive: true, mode: 0o700 });
    for (const [name, content] of Object.entries(shuttleFiles('0.1.3', 'console.log("incomplete bytes");'))) writeFileSync(join(target, name), content, { mode: 0o700 });
    const state = classify(env);
    assert.equal(state.kind, 'INCOMPLETE');
    if (state.kind === 'INCOMPLETE') assert.equal(state.state.activeExactLatestTarget, undefined);
    const outcome = await runInstall(
      { home: env, platform: 'linux', arch: 'x64' },
      latestOptions(artifacts.shuttle, { selections: { gateway: false, piGuard: false } }),
    );
    assert.equal(outcome.kind, 'PARTIAL', JSON.stringify(outcome));
    assert.doesNotMatch(readFileSync(join(target, 'dist', 'cli.js'), 'utf8'), /incomplete bytes/);
    assert.equal(readlinkSync(join(layout.binDir, 'pi-shuttle')), join(target, 'dist', 'cli.js'));
  } finally {
    cleanupEnv(env);
  }
});

test('active exact Latest survives a later Gateway failure without a dangling command', async () => {
  const env = makeEnv();
  try {
    const seeded = await seedStable(env);
    const layout = resolveLayout(env);
    const target = seedMatchingActiveLatest(layout);
    rmSync(layout.installReceiptPath);
    const command = join(layout.binDir, 'pi-shuttle');
    const before = recursiveStateSnapshot({ active: target, command });
    const outcome = await withFixturePi(seeded.runEnv, () => runInstall(
      { home: env, platform: 'linux', arch: 'x64' },
      latestOptions(seeded.shuttle, { selections: { gateway: true, piGuard: false }, expectGatewaySha256: '0'.repeat(64) }),
    ));
    assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
    assert.equal(outcome.kind === 'FAILED' && outcome.stage, 'gateway');
    assert.deepEqual(recursiveStateSnapshot({ active: target, command }), before, 'the active package and command stay byte-identical');
    assert.equal(existsSync(readlinkSync(command)), true, 'the command target remains usable');
    assert.equal(existsSync(layout.installReceiptPath), false);
  } finally {
    cleanupEnv(env);
  }
});

test('matching active exact Latest reconciles only that current source-qualified target', async () => {
  const env = makeEnv();
  try {
    const seeded = await seedStable(env);
    const layout = resolveLayout(env);
    const target = seedMatchingActiveLatest(layout);
    rmSync(layout.installReceiptPath);
    const command = join(layout.binDir, 'pi-shuttle');
    const before = recursiveStateSnapshot({ active: target, command });
    const inode = lstatSync(target).ino;
    const piInstallsBefore = installCount(seeded.piState);
    let consents = 0;
    const outcome = await withFixturePi(seeded.runEnv, () => runInstall(
      { home: env, platform: 'linux', arch: 'x64' },
      latestOptions(seeded.shuttle, { confirmIncompleteCleanup: async () => { consents += 1; return true; } }),
    ));
    assert.equal(outcome.kind, 'COMPLETE', JSON.stringify(outcome));
    assert.equal(consents, 1);
    assert.equal(lstatSync(target).ino, inode, 'the active package is retained, not reactivated');
    assert.deepEqual(recursiveStateSnapshot({ active: target, command }), before);
    assert.equal(installCount(seeded.piState), piInstallsBefore, 'pi-guard is reverified without a second Pi install');
    const receipt = readReceipt(layout.installReceiptPath);
    assert.equal(receipt.ok, true);
    if (receipt.ok) {
      assert.equal(receipt.receipt.channel, 'latest');
      assert.equal(receipt.receipt.sourceIdentity, SOURCE);
      assert.equal(receipt.receipt.piShuttleInstallPath, target);
      assert.equal(receipt.receipt.components.gateway?.status, 'installed-verified');
      assert.equal(receipt.receipt.components.piGuard?.status, 'installed-verified');
    }
  } finally {
    cleanupEnv(env);
  }
});

test('different active exact Latest candidate is refused without touching package or command', async () => {
  const env = makeEnv();
  try {
    const artifacts = await fixtureArtifacts(env);
    const layout = resolveLayout(env);
    const target = seedActiveLatest(layout, SOURCE, 'console.log("different active bytes");');
    const command = join(layout.binDir, 'pi-shuttle');
    const before = recursiveStateSnapshot({ active: target, command });
    const outcome = await runInstall(
      { home: env, platform: 'linux', arch: 'x64' },
      latestOptions(artifacts.shuttle, { selections: { gateway: false, piGuard: false } }),
    );
    assert.equal(outcome.kind, 'REFUSED', JSON.stringify(outcome));
    assert.deepEqual(recursiveStateSnapshot({ active: target, command }), before);
    assert.equal(existsSync(layout.installReceiptPath), false);
  } finally {
    cleanupEnv(env);
  }
});

test('obsolete receipt lock alone is INCOMPLETE and cannot block final receipt publication', async () => {
  const env = makeEnv();
  try {
    const artifacts = await fixtureArtifacts(env);
    const layout = resolveLayout(env);
    mkdirSync(layout.stateDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(layout.stateDir, 'install.json.lock'), `${process.pid}\n`, { mode: 0o600 });
    const state = classify(env);
    assert.equal(state.kind, 'INCOMPLETE');
    if (state.kind === 'INCOMPLETE') assert.ok(state.state.evidence.some((entry) => entry.includes('obsolete install.json.lock')));
    let consents = 0;
    const outcome = await runInstall(
      { home: env, platform: 'linux', arch: 'x64' },
      latestOptions(artifacts.shuttle, {
        selections: { gateway: false, piGuard: false },
        confirmIncompleteCleanup: async () => { consents += 1; return true; },
      }),
    );
    assert.equal(outcome.kind, 'PARTIAL', JSON.stringify(outcome));
    assert.equal(consents, 1);
    assert.equal(existsSync(join(layout.stateDir, 'install.json.lock')), false);
    const receipt = readReceipt(layout.installReceiptPath);
    assert.equal(receipt.ok, true, 'one FINAL receipt is atomically published without a receipt lock');
    if (receipt.ok) {
      assert.equal(receipt.receipt.channel, 'latest');
      assert.equal(receipt.receipt.sourceIdentity, SOURCE);
    }
  } finally {
    cleanupEnv(env);
  }
});

test('failed Latest install leaves an old active 0.1.0 command usable', async () => {
  const env = makeEnv();
  try {
    const seeded = await seedStable(env);
    const layout = resolveLayout(env);
    const old = join(layout.packagesDir, 'pi-shuttle@0.1.0');
    writeShuttlePackage(old, '0.1.0', 'console.log("old active");');
    const command = join(layout.binDir, 'pi-shuttle');
    rmSync(command);
    symlinkSync(join(old, 'dist', 'cli.js'), command);
    rmSync(layout.installReceiptPath);
    const before = recursiveStateSnapshot({ old, command, packages: layout.packagesDir });
    const outcome = await withFixturePi(seeded.runEnv, () => runInstall(
      { home: env, platform: 'linux', arch: 'x64' },
      latestOptions(seeded.shuttle, { selections: { gateway: true, piGuard: false }, expectGatewaySha256: '0'.repeat(64) }),
    ));
    assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
    assert.deepEqual(recursiveStateSnapshot({ old, command, packages: layout.packagesDir }), before);
    assert.equal(existsSync(readlinkSync(command)), true);
    assert.equal(existsSync(layout.installReceiptPath), false);
  } finally {
    cleanupEnv(env);
  }
});

test('failed fresh reinstall leaves no final receipt, preserves old command, components, and retained packages', async () => {
  const env = makeEnv();
  try {
    const seeded = await seedStable(env);
    const layout = resolveLayout(env);
    rmSync(layout.installReceiptPath);
    const commandBefore = readlinkSync(join(layout.binDir, 'pi-shuttle'));
    const packagesBefore = recursiveStateSnapshot({ packages: layout.packagesDir });
    const piBefore = readFileSync(seeded.piState, 'utf8');
    const outcome = await withFixturePi(seeded.runEnv, () => runInstall(
      { home: env, platform: 'linux', arch: 'x64' },
      latestOptions(seeded.shuttle, { selections: { gateway: true, piGuard: false }, expectGatewaySha256: '0'.repeat(64) }),
    ));
    assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
    assert.equal(existsSync(layout.installReceiptPath), false);
    assert.equal(readlinkSync(join(layout.binDir, 'pi-shuttle')), commandBefore);
    assert.deepEqual(recursiveStateSnapshot({ packages: layout.packagesDir }), packagesBefore);
    assert.equal(readFileSync(seeded.piState, 'utf8'), piBefore);
  } finally {
    cleanupEnv(env);
  }
});

test('FINAL Latest receipt publication happens after activation and rolls activation back if atomic publication fails', async () => {
  const env = makeEnv();
  try {
    const seeded = await seedStable(env);
    const layout = resolveLayout(env);
    rmSync(layout.installReceiptPath);
    const commandBefore = readlinkSync(join(layout.binDir, 'pi-shuttle'));
    mkdirSync(`${layout.installReceiptPath}.tmp-${process.pid}`, { mode: 0o700 });
    const outcome = await withFixturePi(seeded.runEnv, () => runInstall(
      { home: env, platform: 'linux', arch: 'x64' },
      latestOptions(seeded.shuttle, { selections: { gateway: false, piGuard: false } }),
    ));
    assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
    assert.equal(outcome.kind === 'FAILED' && outcome.stage, 'receipt');
    assert.equal(existsSync(layout.installReceiptPath), false);
    assert.equal(readlinkSync(join(layout.binDir, 'pi-shuttle')), commandBefore, 'failed final publication restores the old command');
    assert.equal(existsSync(join(layout.packagesDir, piShuttlePackageDirName('0.1.3', SOURCE))), false, 'attempt package rolls back');
  } finally {
    cleanupEnv(env);
  }
});

test('exact physical-machine fixture cleans/reinstalls without touching projects, config, stores, Gateway, or pi-guard', async () => {
  const env = makeEnv();
  try {
    const seeded = await seedStable(env);
    const layout = resolveLayout(env);
    const final = JSON.parse(readFileSync(layout.installReceiptPath, 'utf8')) as Record<string, unknown>;
    const retained = join(layout.packagesDir, 'pi-shuttle@0.1.3');
    const active = join(layout.packagesDir, 'pi-shuttle@0.1.0');
    mkdirSync(join(active, 'dist'), { recursive: true, mode: 0o700 });
    for (const [name, content] of Object.entries(shuttleFiles('0.1.0', 'console.log("active 0.1.0");'))) writeFileSync(join(active, name), content, { mode: 0o700 });
    rmSync(join(layout.binDir, 'pi-shuttle'));
    symlinkSync(join(active, 'dist', 'cli.js'), join(layout.binDir, 'pi-shuttle'));
    const activeTree = await hashPackageTree(active);
    assert.equal(activeTree.ok, true);
    delete final.installedAt;
    final.piShuttleVersion = '0.1.0';
    final.piShuttleInstallPath = active;
    final.piShuttleTreeSha256 = activeTree.ok ? activeTree.value : '';
    final.recovery = {
      recoveredAt: '2026-08-17T00:00:00.000Z',
      recoveredBy: PHYSICAL_SOURCE,
      originalInstalledAt: null,
      originalChannel: 'unknown',
    };
    writeFileSync(layout.installReceiptPath, `${JSON.stringify(final, null, 2)}\n`, { mode: 0o600 });
    const dead = spawnDeadPid();
    writeFileSync(join(layout.stateDir, 'install.lock'), `${dead}\n`, { mode: 0o600 });
    writeFileSync(join(layout.stateDir, 'install.json.lock'), `${dead}\n`, { mode: 0o600 });

    const project = join(env, 'project');
    mkdirSync(project);
    writeFileSync(join(project, 'marker'), 'project\n');
    mkdirSync(layout.storesDir, { recursive: true });
    writeFileSync(join(layout.storesDir, 'marker'), 'stores\n');
    mkdirSync(layout.configDir, { recursive: true });
    writeFileSync(layout.runtimeConfigPath, '{"projects":["keep"]}\n');
    const protectedPaths = { project, stores: layout.storesDir, config: layout.configDir, gateway: join(layout.packagesDir, 'project-gateway-artifact-core@0.1.0'), piGuard: join(layout.packagesDir, 'pi-guard@0.1.2') };
    const before = recursiveStateSnapshot(protectedPaths);
    const piInstallsBefore = installCount(seeded.piState);
    let consentEvidence: readonly string[] = [];

    const outcome = await withFixturePi(seeded.runEnv, () => runInstall(
      { home: env, platform: 'linux', arch: 'x64' },
      latestOptions(seeded.shuttle, {
        sourceIdentity: PHYSICAL_SOURCE,
        confirmIncompleteCleanup: async (evidence) => { consentEvidence = evidence; return true; },
      }),
    ));
    assert.equal(outcome.kind, 'COMPLETE', JSON.stringify(outcome));
    assert.ok(consentEvidence.some((entry) => entry.includes('recovery/non-final receipt')));
    assert.ok(consentEvidence.some((entry) => entry.includes('stale install.lock')));
    assert.ok(consentEvidence.some((entry) => entry.includes('obsolete install.json.lock')));
    assert.deepEqual(recursiveStateSnapshot(protectedPaths), before);
    assert.equal(installCount(seeded.piState), piInstallsBefore);
    assert.equal(existsSync(active), true, 'old active package is retained');
    assert.equal(existsSync(retained), true, 'retained 0.1.3 package is retained');
    const latest = join(layout.packagesDir, piShuttlePackageDirName('0.1.3', PHYSICAL_SOURCE));
    assert.equal(readlinkSync(join(layout.binDir, 'pi-shuttle')), join(latest, 'dist', 'cli.js'));
    assert.equal(existsSync(join(layout.stateDir, 'install.lock')), false);
    assert.equal(existsSync(join(layout.stateDir, 'install.json.lock')), false);
    const receipt = readReceipt(layout.installReceiptPath);
    assert.equal(receipt.ok, true);
    if (receipt.ok) {
      assert.equal(receipt.receipt.channel, 'latest');
      assert.equal(receipt.receipt.sourceIdentity, PHYSICAL_SOURCE);
      assert.equal(receipt.receipt.piShuttleInstallPath, latest);
    }
    assert.equal(Object.hasOwn(JSON.parse(readFileSync(layout.installReceiptPath, 'utf8')), 'recovery'), false);
  } finally {
    cleanupEnv(env);
  }
});

function spawnDeadPid(): number {
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  return Number(child.stdout);
}
