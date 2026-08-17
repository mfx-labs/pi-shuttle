import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { dirname, join } from 'node:path';
import { runInstall } from '../../src/installer/install.js';
import { readReceipt } from '../../src/installer/receipt.js';
import { resolveLayout } from '../../src/host/environment.js';
import { buildTarball, cleanupEnv, fullInstallEnv, gatewayFixtureFiles, makeEnv, piGuardFixtureFiles } from '../helpers/installer-fixtures.js';
import { acquireLatestArtifacts } from '../../src/installer/release/latest.js';
import { LATEST_HANDOFF_ENV, main as installerMain } from '../../src/installer/main.js';
import { recursiveStateSnapshot } from '../helpers/state-snapshot.js';
import type { RecursivePathSnapshot } from '../helpers/state-snapshot.js';

const SOURCE = `mfx-labs/pi-shuttle@${'b'.repeat(40)}`;

function piShuttleFiles(version = '0.1.1'): Record<string, string> {
  return {
    'package.json': JSON.stringify({ name: 'pi-shuttle', version, type: 'module', bin: { 'pi-shuttle': './dist/cli.js' } }),
    'dist/cli.js': '#!/usr/bin/env node\nconsole.log("fixture pi-shuttle");\n',
  };
}

async function withFixturePi<T>(runEnv: ReturnType<typeof fullInstallEnv>, fn: () => Promise<T>): Promise<T> {
  const oldPath = process.env.PATH;
  const oldVersion = process.env.FIXTURE_PI_VERSION;
  const oldState = process.env.FIXTURE_PI_STATE;
  process.env.PATH = [runEnv.fixtureBin, process.env.PATH ?? ''].join(':');
  process.env.FIXTURE_PI_VERSION = String(runEnv.extraEnv.FIXTURE_PI_VERSION ?? '0.83.0');
  if (runEnv.extraEnv.FIXTURE_PI_STATE === undefined) delete process.env.FIXTURE_PI_STATE;
  else process.env.FIXTURE_PI_STATE = runEnv.extraEnv.FIXTURE_PI_STATE;
  try {
    return await fn();
  } finally {
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    if (oldVersion === undefined) delete process.env.FIXTURE_PI_VERSION; else process.env.FIXTURE_PI_VERSION = oldVersion;
    if (oldState === undefined) delete process.env.FIXTURE_PI_STATE; else process.env.FIXTURE_PI_STATE = oldState;
  }
}

async function seedOwnedState(env: string, removeReceipt = true) {
  const gateway = await buildTarball(env, gatewayFixtureFiles(), 'project-gateway-artifact-core-0.1.0.tgz');
  const piGuard = await buildTarball(env, piGuardFixtureFiles(), 'pi-guard-0.1.2.tgz');
  const shuttle = await buildTarball(env, piShuttleFiles(), 'pi-shuttle-0.1.1.tgz');
  const piState = join(env, 'pi-state.txt');
  const runEnv = fullInstallEnv(env, '0.83.0', piState);
  const outcome = await withFixturePi(runEnv, () => runInstall({ home: env, platform: 'linux', arch: 'x64' }, {
    selections: { gateway: true, piGuard: true },
    artifactDir: env,
    releasePackageTgz: shuttle,
    uid: 12345,
  }));
  assert.equal(outcome.kind, 'COMPLETE', JSON.stringify(outcome));
  const layout = resolveLayout(env);
  const project = join(env, 'project-fixture');
  mkdirSync(join(layout.storesDir, 'store-fixture'), { recursive: true, mode: 0o700 });
  writeFileSync(join(layout.storesDir, 'store-fixture', 'state.bin'), Buffer.from([0, 1, 2, 255]));
  mkdirSync(layout.configDir, { recursive: true, mode: 0o700 });
  writeFileSync(layout.runtimeConfigPath, JSON.stringify({ schemaVersion: 1, surfaces: [{ id: 'fixture-project' }] }));
  mkdirSync(project, { mode: 0o700 });
  writeFileSync(join(project, 'tracked.txt'), 'project fixture state\n');
  if (removeReceipt) rmSync(layout.installReceiptPath);
  return { runEnv, shuttle, piState, gateway, piGuard, project };
}

function latestOptions(shuttle: string, extra: Record<string, unknown> = {}) {
  return {
    selections: { gateway: false, piGuard: false },
    releasePackageTgz: shuttle,
    sourceIdentity: SOURCE,
    uid: 12345,
    ...extra,
  } as Parameters<typeof runInstall>[1];
}

function protectedPaths(env: string, piState: string, project: string): Record<string, string> {
  const layout = resolveLayout(env);
  const commandLink = join(layout.binDir, 'pi-shuttle');
  const commandTarget = readlinkSync(commandLink);
  const shuttlePackage = dirname(dirname(commandTarget));
  const gatewayPackage = join(layout.packagesDir, 'project-gateway-artifact-core@0.1.0');
  const piGuardPackage = join(layout.packagesDir, 'pi-guard@0.1.2');
  return {
    receipt: layout.installReceiptPath,
    commandLink,
    commandTarget,
    shuttlePackage,
    gatewayPackage,
    gatewayExecutable: join(gatewayPackage, 'dist', 'cli.js'),
    piGuardPackage,
    piGuardSource: join(piGuardPackage, 'extensions', 'pi-guard', 'index.ts'),
    piState,
    stores: layout.storesDir,
    config: layout.configDir,
    runtimeConfig: layout.runtimeConfigPath,
    project,
    installerStaging: layout.stagingDir,
    installerLogs: layout.logsDir,
  };
}

function without(snapshot: readonly RecursivePathSnapshot[], ...labels: readonly string[]): readonly RecursivePathSnapshot[] {
  return snapshot.filter((entry) => !labels.includes(entry.label));
}

function entry(snapshot: readonly RecursivePathSnapshot[], label: string): RecursivePathSnapshot {
  const found = snapshot.find((item) => item.label === label);
  assert.ok(found, `missing snapshot entry ${label}`);
  return found;
}

test('receipt-less recovery reconstructs truthful latest provenance without reinstalling intact components', async () => {
  const env = makeEnv();
  try {
    const seeded = await seedOwnedState(env);
    const layout = resolveLayout(env);
    const beforePiState = readFileSync(seeded.piState, 'utf8');
    rmSync(layout.stateDir, { recursive: true, force: true });
    assert.equal(existsSync(layout.stateDir), false, 'positive recovery must start without stateDir');
    const startedAt = Date.now();
    const outcome = await withFixturePi(seeded.runEnv, () => runInstall({ home: env, platform: 'linux', arch: 'x64' }, latestOptions(seeded.shuttle)));
    const finishedAt = Date.now();
    assert.equal(outcome.kind, 'ALREADY_INSTALLED', JSON.stringify(outcome));
    assert.equal(existsSync(layout.stateDir), true, 'the attempt must retain its atomically created stateDir after recovery');
    assert.equal(existsSync(join(layout.stateDir, 'install.lock')), false, 'the normal install lock must be released');
    const receipt = readReceipt(layout.installReceiptPath);
    assert.equal(receipt.ok, true);
    if (!receipt.ok) return;
    assert.equal(receipt.receipt.channel, undefined);
    assert.equal(receipt.receipt.sourceIdentity, undefined);
    assert.equal(receipt.receipt.installedAt, undefined);
    const recoveredAt = Date.parse(receipt.receipt.recovery?.recoveredAt ?? '');
    assert.equal(Number.isFinite(recoveredAt), true);
    assert.equal(recoveredAt >= startedAt && recoveredAt <= finishedAt, true, 'recoveredAt must be generated during recovery');
    assert.equal(receipt.receipt.recovery?.originalInstalledAt, null);
    assert.equal(receipt.receipt.recovery?.originalChannel, 'unknown');
    assert.equal(receipt.receipt.recovery?.recoveredBy, SOURCE);
    assert.equal(receipt.receipt.components.gateway?.artifactSha256, null);
    assert.equal(receipt.receipt.components.gateway?.digestVerified, false);
    assert.equal(receipt.receipt.components.piGuard?.artifactSha256, null);
    assert.equal(receipt.receipt.components.piGuard?.digestVerified, false);
    assert.equal(readFileSync(seeded.piState, 'utf8'), beforePiState, 'recovery must not reinstall pi-guard');
  } finally {
    cleanupEnv(env);
  }
});

test('receipt-less recovery never owns or removes a concurrently created state directory', async () => {
  const env = makeEnv();
  try {
    const seeded = await seedOwnedState(env);
    const layout = resolveLayout(env);
    rmSync(layout.stateDir, { recursive: true, force: true });
    const paths = protectedPaths(env, seeded.piState, seeded.project);
    const before = recursiveStateSnapshot(paths);
    const lock = join(layout.stateDir, 'install.lock');
    const sentinel = join(layout.stateDir, 'concurrent.sentinel');
    const outcome = await withFixturePi(seeded.runEnv, () => runInstall({ home: env, platform: 'linux', arch: 'x64' }, latestOptions(seeded.shuttle, {
      afterReceiptlessPreproof: () => {
        mkdirSync(layout.stateDir, { recursive: true, mode: 0o700 });
        writeFileSync(lock, 'concurrent lock\n', { mode: 0o600 });
        writeFileSync(sentinel, 'concurrent state\n', { mode: 0o600 });
      },
    })));
    assert.equal(outcome.kind, 'REFUSED', JSON.stringify(outcome));
    if (outcome.kind === 'REFUSED') assert.match(outcome.reason, /in progress/);
    assert.equal(existsSync(layout.stateDir), true, 'EEXIST stateDir is never attempt-owned');
    assert.equal(readFileSync(lock, 'utf8'), 'concurrent lock\n');
    assert.equal(readFileSync(sentinel, 'utf8'), 'concurrent state\n');
    assert.equal(existsSync(layout.installReceiptPath), false);
    assert.equal(existsSync(layout.stagingDir), false);
    assert.deepEqual(recursiveStateSnapshot(paths), before, 'the refused attempt must preserve all installation and unrelated state');
  } finally {
    cleanupEnv(env);
  }
});

test('locked receipt-less revalidation refuses an ownership fact changed after pre-proof', async () => {
  const env = makeEnv();
  try {
    const seeded = await seedOwnedState(env);
    const layout = resolveLayout(env);
    rmSync(layout.stateDir, { recursive: true, force: true });
    const commandLink = join(layout.binDir, 'pi-shuttle');
    const foreign = join(env, 'foreign-command');
    writeFileSync(foreign, 'foreign command\n');
    const paths = protectedPaths(env, seeded.piState, seeded.project);
    const before = recursiveStateSnapshot(paths);
    const outcome = await withFixturePi(seeded.runEnv, () => runInstall({ home: env, platform: 'linux', arch: 'x64' }, latestOptions(seeded.shuttle, {
      afterReceiptlessPreproof: () => {
        rmSync(commandLink);
        symlinkSync(foreign, commandLink);
      },
    })));
    assert.equal(outcome.kind, 'REFUSED', JSON.stringify(outcome));
    if (outcome.kind === 'REFUSED') assert.match(outcome.reason, /foreign pi-shuttle command target/);
    const after = recursiveStateSnapshot(paths);
    assert.deepEqual(without(after, 'commandLink'), without(before, 'commandLink'), 'locked refusal must preserve every fact except the externally changed link');
    assert.equal(readlinkSync(commandLink), foreign, 'locked refusal must not repair the changed external fact');
    assert.equal(existsSync(layout.installReceiptPath), false, 'locked refusal must not recover a receipt');
    assert.equal(existsSync(layout.stagingDir), false, 'locked refusal must not begin upgrade mutation');
    assert.equal(existsSync(layout.stateDir), false, 'the same empty attempt-created stateDir is safely removed after refusal');
  } finally {
    cleanupEnv(env);
  }
});

test('receipt-based installer flow still acquires and respects the existing install lock', async () => {
  const env = makeEnv();
  try {
    const seeded = await seedOwnedState(env, false);
    const layout = resolveLayout(env);
    const lock = join(layout.stateDir, 'install.lock');
    writeFileSync(lock, 'existing lock\n', { mode: 0o600 });
    const paths = { ...protectedPaths(env, seeded.piState, seeded.project), installLock: lock };
    const before = recursiveStateSnapshot(paths);
    const outcome = await withFixturePi(seeded.runEnv, () => runInstall({ home: env, platform: 'linux', arch: 'x64' }, latestOptions(seeded.shuttle)));
    assert.equal(outcome.kind, 'REFUSED', JSON.stringify(outcome));
    if (outcome.kind === 'REFUSED') assert.match(outcome.reason, /in progress/);
    const after = recursiveStateSnapshot(paths);
    assert.deepEqual(after, before, 'receipt-based lock refusal must preserve receipt, lock, and installation state');
    assert.deepEqual(entry(after, 'installerStaging').inventory, ['.'], 'existing empty staging must remain empty');
  } finally {
    cleanupEnv(env);
  }
});

test('latest wrong digest preserves representative protected installation state byte-for-byte', async () => {
  const env = makeEnv();
  try {
    const seeded = await seedOwnedState(env, false);
    const layout = resolveLayout(env);
    const acquisitionStage = join(env, 'latest-artifacts');
    mkdirSync(acquisitionStage, { mode: 0o700 });
    const paths = { ...protectedPaths(env, seeded.piState, seeded.project), acquisitionStage };
    const before = recursiveStateSnapshot(paths);
    const receiptBefore = readFileSync(layout.installReceiptPath, 'utf8');
    const commandBefore = readlinkSync(join(layout.binDir, 'pi-shuttle'));
    const calls: string[] = [];
    let installerCalls = 0;
    const fetcher = async (url: string) => {
      calls.push(url);
      return { status: 200, body: Readable.from([Buffer.from('wrong gateway bytes')]), contentLength: 'wrong gateway bytes'.length };
    };
    const overrides = {
      HOME: env,
      [LATEST_HANDOFF_ENV.source]: SOURCE,
      [LATEST_HANDOFF_ENV.packageTgz]: seeded.shuttle,
      [LATEST_HANDOFF_ENV.artifactDir]: acquisitionStage,
    };
    const previous = new Map(Object.keys(overrides).map((key) => [key, process.env[key]]));
    for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
    let exitCode: number;
    try {
      exitCode = await installerMain(['--batch', '--gateway', 'yes', '--pi-guard', 'no'], {
        latestAcquirer: (lane, selections, stage) => acquireLatestArtifacts(lane, selections, stage, fetcher),
        installRunner: async () => { installerCalls += 1; return { kind: 'COMPLETE' }; },
      });
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
    assert.equal(exitCode, 2);
    assert.equal(calls.length, 1);
    assert.equal(installerCalls, 0, 'wrong digest must never reach the installation mutation runner');
    assert.deepEqual(recursiveStateSnapshot(paths), before, 'wrong digest must preserve every protected object, link target, inventory, and file digest');
    assert.equal(readFileSync(layout.installReceiptPath, 'utf8'), receiptBefore, 'no new or rewritten receipt');
    assert.equal(readlinkSync(join(layout.binDir, 'pi-shuttle')), commandBefore, 'no command-link replacement');
    assert.deepEqual(entry(recursiveStateSnapshot(paths), 'installerStaging').inventory, ['.'], 'no installer staging residue or installation mutation');
    assert.deepEqual(entry(recursiveStateSnapshot(paths), 'acquisitionStage').inventory, ['.'], 'unverified acquisition bytes must be removed');
  } finally {
    cleanupEnv(env);
  }
});

test('receipt-less recovery of an older owned package preserves upgrade consent and then performs controlled upgrade', async () => {
  const env = makeEnv();
  try {
    const seeded = await seedOwnedState(env);
    const layout = resolveLayout(env);
    const current = join(layout.packagesDir, 'pi-shuttle@0.1.1');
    const old = join(layout.packagesDir, 'pi-shuttle@0.1.0');
    rmSync(current, { recursive: true, force: true });
    mkdirSync(join(old, 'dist'), { recursive: true, mode: 0o700 });
    writeFileSync(join(old, 'package.json'), JSON.stringify({ name: 'pi-shuttle', version: '0.1.0', bin: { 'pi-shuttle': './dist/cli.js' } }));
    writeFileSync(join(old, 'dist', 'cli.js'), '#!/usr/bin/env node\n');
    rmSync(join(layout.binDir, 'pi-shuttle'));
    symlinkSync(join(old, 'dist', 'cli.js'), join(layout.binDir, 'pi-shuttle'));

    const paths = protectedPaths(env, seeded.piState, seeded.project);
    const beforeDecline = recursiveStateSnapshot(paths);
    const piInstallsBefore = readFileSync(seeded.piState, 'utf8').split('\n').filter(Boolean).length;
    const declined = await withFixturePi(seeded.runEnv, () => runInstall({ home: env, platform: 'linux', arch: 'x64' }, latestOptions(seeded.shuttle, { confirmUpgrade: async () => false })));
    assert.equal(declined.kind, 'UPGRADE_DECLINED', JSON.stringify(declined));
    const recovered = readReceipt(layout.installReceiptPath);
    assert.equal(recovered.ok, true);
    if (!recovered.ok) return;
    assert.equal(recovered.receipt.piShuttleVersion, '0.1.0');
    assert.equal(recovered.receipt.installedAt, undefined);
    assert.equal(recovered.receipt.channel, undefined);
    assert.equal(recovered.receipt.sourceIdentity, undefined);
    assert.equal(recovered.receipt.recovery?.originalChannel, 'unknown');
    assert.equal(recovered.receipt.recovery?.originalInstalledAt, null);
    assert.equal(recovered.receipt.recovery?.recoveredBy, SOURCE);
    assert.equal(Number.isFinite(Date.parse(recovered.receipt.recovery?.recoveredAt ?? '')), true);
    const afterDecline = recursiveStateSnapshot(paths);
    assert.deepEqual(without(afterDecline, 'receipt'), without(beforeDecline, 'receipt'), 'only the truthful recovery receipt may differ after decline');
    assert.equal(entry(beforeDecline, 'receipt').exists, false);
    assert.equal(entry(afterDecline, 'receipt').type, 'file');
    for (const label of ['shuttlePackage', 'commandTarget', 'commandLink', 'gatewayPackage', 'gatewayExecutable', 'piGuardPackage', 'piGuardSource']) {
      assert.deepEqual(entry(afterDecline, label), entry(beforeDecline, label), `${label} must remain byte/state-identical`);
    }
    for (const label of ['piState', 'stores', 'config', 'runtimeConfig', 'project', 'installerStaging', 'installerLogs']) {
      assert.deepEqual(entry(afterDecline, label), entry(beforeDecline, label), `${label} unrelated state must remain unchanged`);
    }
    assert.equal(readlinkSync(join(layout.binDir, 'pi-shuttle')), join(old, 'dist', 'cli.js'), 'decline must not replace the command link');
    assert.equal(existsSync(current), false, 'decline must not activate the new pi-shuttle package');
    assert.equal(readFileSync(seeded.piState, 'utf8').split('\n').filter(Boolean).length, piInstallsBefore, 'decline must not run a second pi install');

    const gatewayBefore = readFileSync(join(layout.packagesDir, 'project-gateway-artifact-core@0.1.0', 'package.json'), 'utf8');
    const piStateBefore = readFileSync(seeded.piState, 'utf8');
    const failed = await withFixturePi(seeded.runEnv, () => runInstall({ home: env, platform: 'linux', arch: 'x64' }, latestOptions(seeded.shuttle, {
      selections: { gateway: true, piGuard: false },
      artifactDir: env,
      expectGatewaySha256: '0'.repeat(64),
      confirmUpgrade: async () => true,
    })));
    assert.equal(failed.kind, 'FAILED', JSON.stringify(failed));
    assert.equal(readlinkSync(join(layout.binDir, 'pi-shuttle')), join(old, 'dist', 'cli.js'));
    assert.equal(readFileSync(join(layout.packagesDir, 'project-gateway-artifact-core@0.1.0', 'package.json'), 'utf8'), gatewayBefore);
    assert.equal(readFileSync(seeded.piState, 'utf8'), piStateBefore, 'digest failure must not reinstall pi-guard');
    const afterFailure = readReceipt(layout.installReceiptPath);
    assert.equal(afterFailure.ok, true);
    if (!afterFailure.ok) return;
    assert.equal(afterFailure.receipt.recovery?.originalChannel, 'unknown');
    assert.equal(afterFailure.receipt.channel, undefined);

    const upgraded = await withFixturePi(seeded.runEnv, () => runInstall({ home: env, platform: 'linux', arch: 'x64' }, latestOptions(seeded.shuttle, { confirmUpgrade: async () => true })));
    assert.equal(upgraded.kind, 'COMPLETE', JSON.stringify(upgraded));
    assert.equal(readlinkSync(join(layout.binDir, 'pi-shuttle')), join(layout.packagesDir, 'pi-shuttle@0.1.1', 'dist', 'cli.js'));
    assert.equal(readFileSync(join(layout.packagesDir, 'project-gateway-artifact-core@0.1.0', 'package.json'), 'utf8'), gatewayBefore);
    assert.equal(readFileSync(seeded.piState, 'utf8'), piStateBefore, 'controlled pi-shuttle upgrade must not reinstall pi-guard');
    const upgradedReceipt = readReceipt(layout.installReceiptPath);
    assert.equal(upgradedReceipt.ok, true);
    if (!upgradedReceipt.ok) return;
    assert.equal(upgradedReceipt.receipt.channel, 'latest');
    assert.equal(upgradedReceipt.receipt.sourceIdentity, SOURCE);
    assert.equal(upgradedReceipt.receipt.recovery, undefined);
    assert.equal(typeof upgradedReceipt.receipt.installedAt, 'string');
  } finally {
    cleanupEnv(env);
  }
});

test('receipt-less recovery refuses a foreign command link and leaves the receipt absent', async () => {
  const env = makeEnv();
  try {
    const seeded = await seedOwnedState(env);
    const layout = resolveLayout(env);
    rmSync(join(layout.binDir, 'pi-shuttle'));
    const foreign = join(env, 'foreign-command');
    writeFileSync(foreign, 'foreign');
    symlinkSync(foreign, join(layout.binDir, 'pi-shuttle'));
    const outcome = await withFixturePi(seeded.runEnv, () => runInstall({ home: env, platform: 'linux', arch: 'x64' }, latestOptions(seeded.shuttle)));
    assert.equal(outcome.kind, 'REFUSED', JSON.stringify(outcome));
    assert.equal(existsSync(layout.installReceiptPath), false);
    assert.equal(readlinkSync(join(layout.binDir, 'pi-shuttle')), foreign);
  } finally {
    cleanupEnv(env);
  }
});

test('ambiguous receipt-less recovery refuses before creating a missing state directory', async () => {
  const env = makeEnv();
  try {
    const seeded = await seedOwnedState(env);
    const layout = resolveLayout(env);
    cpSync(join(layout.packagesDir, 'pi-shuttle@0.1.1'), join(layout.packagesDir, 'pi-shuttle@0.1.0'), { recursive: true });
    rmSync(layout.stateDir, { recursive: true, force: true });
    const paths = protectedPaths(env, seeded.piState, seeded.project);
    const before = recursiveStateSnapshot(paths);
    const outcome = await withFixturePi(seeded.runEnv, () => runInstall({ home: env, platform: 'linux', arch: 'x64' }, latestOptions(seeded.shuttle)));
    assert.equal(outcome.kind, 'REFUSED', JSON.stringify(outcome));
    assert.equal(existsSync(layout.stateDir), false, 'ambiguous recovery must not create stateDir');
    assert.equal(existsSync(layout.installReceiptPath), false);
    assert.deepEqual(recursiveStateSnapshot(paths), before, 'ambiguous recovery must preserve protected state');
  } finally {
    cleanupEnv(env);
  }
});

test('receipt-less recovery refuses ambiguous pi-shuttle packages and Gateway/pi-guard drift', async (t) => {
  await t.test('duplicate pi-shuttle packages', async () => {
    const env = makeEnv();
    try {
      const seeded = await seedOwnedState(env);
      const layout = resolveLayout(env);
      cpSync(join(layout.packagesDir, 'pi-shuttle@0.1.1'), join(layout.packagesDir, 'pi-shuttle@0.1.0'), { recursive: true });
      const outcome = await withFixturePi(seeded.runEnv, () => runInstall({ home: env, platform: 'linux', arch: 'x64' }, latestOptions(seeded.shuttle)));
      assert.equal(outcome.kind, 'REFUSED', JSON.stringify(outcome));
      assert.equal(existsSync(layout.installReceiptPath), false);
    } finally {
      cleanupEnv(env);
    }
  });

  await t.test('Gateway path drift', async () => {
    const env = makeEnv();
    try {
      const seeded = await seedOwnedState(env);
      const layout = resolveLayout(env);
      rmSync(join(layout.packagesDir, 'project-gateway-artifact-core@0.1.0'), { recursive: true, force: true });
      mkdirSync(join(layout.packagesDir, 'project-gateway-artifact-core@0.1.0-foreign'), { mode: 0o700 });
      const outcome = await withFixturePi(seeded.runEnv, () => runInstall({ home: env, platform: 'linux', arch: 'x64' }, latestOptions(seeded.shuttle)));
      assert.equal(outcome.kind, 'REFUSED', JSON.stringify(outcome));
      assert.equal(existsSync(layout.installReceiptPath), false);
    } finally {
      cleanupEnv(env);
    }
  });

  await t.test('pi-guard source drift', async () => {
    const env = makeEnv();
    try {
      const seeded = await seedOwnedState(env);
      writeFileSync(join(env, 'pi-state.txt'), join(env, 'foreign-pi-guard') + '\n');
      const outcome = await withFixturePi(seeded.runEnv, () => runInstall({ home: env, platform: 'linux', arch: 'x64' }, latestOptions(seeded.shuttle)));
      assert.equal(outcome.kind, 'REFUSED', JSON.stringify(outcome));
      assert.equal(existsSync(resolveLayout(env).installReceiptPath), false);
    } finally {
      cleanupEnv(env);
    }
  });
});
