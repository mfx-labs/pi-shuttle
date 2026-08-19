/**
 * PS-8A focused tests: release-lane install-core behavior — the
 * pi-shuttle release package is activated into persistent packages
 * storage by the core itself (the release installer runs from an
 * ephemeral shell extraction, so the bin link must never point into the
 * temp dir), with the same scan/identity/activation/rollback discipline
 * as components. Local-lane behavior is regression-covered by
 * installer-flow.test.ts (bin link → the package the installer runs
 * from).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInstall } from '../../src/installer/install.js';
import { readReceipt, writeReceipt } from '../../src/installer/receipt.js';
import { resolveLayout } from '../../src/host/environment.js';
import type { LayoutPaths } from '../../src/host/environment.js';
import { PI_SHUTTLE_VERSION } from '../../src/compat/manifest.js';
import { buildTarball, cleanupEnv, fullInstallEnv, gatewayFixtureFiles, makeEnv, piGuardFixtureFiles, GATEWAY_ARTIFACT_NAME, PI_GUARD_ARTIFACT_NAME } from '../helpers/installer-fixtures.js';

const PI_SHUTTLE_ARTIFACT_NAME = `pi-shuttle-${PI_SHUTTLE_VERSION}.tgz`;
const SHA_RE = /^[0-9a-f]{64}$/;

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function piShuttleFixtureFiles(): Record<string, string> {
  return {
    'package.json': JSON.stringify({
      name: 'pi-shuttle',
      version: PI_SHUTTLE_VERSION,
      type: 'module',
      private: true,
      bin: { 'pi-shuttle': './dist/cli.js' },
    }, null, 2),
    'dist/cli.js': '#!/usr/bin/env node\nconsole.log(\'pi-shuttle fixture cli\');\n',
  };
}

async function buildPiShuttleArtifact(env: string): Promise<string> {
  return buildTarball(env, piShuttleFixtureFiles(), PI_SHUTTLE_ARTIFACT_NAME);
}

function gatewayProbeFixtureFiles(smokeState: string): Record<string, string> {
  return {
    ...gatewayFixtureFiles(),
    'dist/cli.js': `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('--help')) {
  appendFileSync(${JSON.stringify(smokeState)}, 'help\\n');
  if (process.env.FIXTURE_GATEWAY_SMOKE_FAIL === '1') {
    process.stderr.write('Error: Cannot find module fixture-dependency\\n');
    process.exit(1);
  }
  console.log('project-gateway-mcp fixture help');
  process.exit(0);
}
if (args.includes('--version')) { console.log('0.1.0 (fixture)'); process.exit(0); }
process.exit(0);
`,
  };
}

function markComponentUnverified(layout: LayoutPaths, component: 'gateway' | 'piGuard'): void {
  const receipt = readReceipt(layout.installReceiptPath);
  assert.equal(receipt.ok, true);
  if (!receipt.ok) throw new Error('seed receipt unavailable');
  const entry = receipt.receipt.components[component];
  if (entry === null) throw new Error(`seed ${component} receipt entry unavailable`);
  const adjustedEntry = component === 'gateway'
    ? { ...entry, status: 'installed-unverified' as const, smoke: 'not-run' as const }
    : { ...entry, status: 'installed-unverified' as const, verifiedBy: 'unverified' as const };
  const adjusted = writeReceipt(layout.installReceiptPath, {
    ...receipt.receipt,
    result: 'PARTIAL',
    components: { ...receipt.receipt.components, [component]: adjustedEntry },
  });
  assert.equal(adjusted.ok, true);
}

async function seedOlderOwnedInstallation(
  env: string,
  runEnv: ReturnType<typeof fullInstallEnv>,
  shuttle: string,
  custom: { readonly installDir?: string; readonly binDir?: string } = {},
  installedVersion = '0.1.0',
): Promise<{ readonly layout: LayoutPaths; readonly oldTarget: string; readonly oldBin: string; readonly receiptBefore: string }> {
  const initial = await runWithFixturePi(runEnv, {
    selections: { gateway: true, piGuard: true },
    artifactDir: env,
    releasePackageTgz: shuttle,
    uid: 12345,
    ...custom,
  });
  assert.equal(initial.kind, 'COMPLETE', JSON.stringify(initial));
  const baseLayout = resolveLayout(env);
  const receipt = readReceipt(baseLayout.installReceiptPath);
  assert.equal(receipt.ok, true);
  if (!receipt.ok) throw new Error('seed receipt unavailable');
  const layout: LayoutPaths = {
    ...baseLayout,
    shareDir: receipt.receipt.installDir,
    binDir: receipt.receipt.binDir,
    storesDir: join(receipt.receipt.installDir, 'stores'),
    packagesDir: join(receipt.receipt.installDir, 'packages'),
    gitHomeDir: join(receipt.receipt.installDir, 'git-home'),
    gitTmpDir: join(receipt.receipt.installDir, 'git-tmp'),
    manifestsDir: join(receipt.receipt.installDir, 'manifests'),
  };

  const oldTarget = join(layout.packagesDir, `pi-shuttle@${installedVersion}`);
  const oldBin = join(oldTarget, 'dist', 'cli.js');
  mkdirSync(join(oldTarget, 'dist'), { recursive: true, mode: 0o700 });
  writeFileSync(join(oldTarget, 'package.json'), JSON.stringify({
    name: 'pi-shuttle',
    version: installedVersion,
    type: 'module',
    bin: { 'pi-shuttle': './dist/cli.js' },
  }, null, 2));
  writeFileSync(oldBin, `#!/usr/bin/env node\nconsole.log("pi-shuttle ${installedVersion} fixture");\n`);
  const binLink = join(layout.binDir, 'pi-shuttle');
  rmSync(binLink);
  symlinkSync(oldBin, binLink);
  rmSync(join(layout.packagesDir, `pi-shuttle@${PI_SHUTTLE_VERSION}`), { recursive: true, force: true });
  const written = writeReceipt(layout.installReceiptPath, { ...receipt.receipt, piShuttleVersion: installedVersion });
  assert.equal(written.ok, true);
  return { layout, oldTarget, oldBin, receiptBefore: readFileSync(layout.installReceiptPath, 'utf8') };
}

async function seedSameVersionPartial(
  env: string,
  runEnv: ReturnType<typeof fullInstallEnv>,
  shuttle: string,
  missing: 'gateway' | 'piGuard',
): Promise<{ readonly layout: LayoutPaths; readonly receiptBefore: string }> {
  const initial = await runWithFixturePi(runEnv, {
    selections: { gateway: true, piGuard: true }, artifactDir: env, releasePackageTgz: shuttle, uid: 12345,
  });
  assert.equal(initial.kind, 'COMPLETE', JSON.stringify(initial));
  const layout = resolveLayout(env);
  const receipt = readReceipt(layout.installReceiptPath);
  assert.equal(receipt.ok, true);
  if (!receipt.ok) throw new Error('seed receipt unavailable');
  if (missing === 'gateway') {
    rmSync(join(layout.packagesDir, 'project-gateway-artifact-core@0.1.0'), { recursive: true, force: true });
  } else {
    rmSync(join(layout.packagesDir, 'pi-guard@0.1.2'), { recursive: true, force: true });
    const piState = runEnv.extraEnv.FIXTURE_PI_STATE;
    if (typeof piState === 'string') writeFileSync(piState, '');
  }
  const adjusted = writeReceipt(layout.installReceiptPath, {
    ...receipt.receipt,
    result: 'PARTIAL',
    components: { ...receipt.receipt.components, [missing]: null },
    omitted: [missing === 'gateway' ? 'project-gateway-mcp' : 'pi-guard'],
  });
  assert.equal(adjusted.ok, true);
  return { layout, receiptBefore: readFileSync(layout.installReceiptPath, 'utf8') };
}

/** PATH dict for direct runInstall calls (fixture bin + env). */
function pathEnvFor(runEnv: { readonly home: string; readonly fixtureBin: string; readonly extraEnv: NodeJS.ProcessEnv }): Record<string, string> {
  return {
    HOME: runEnv.home,
    PATH: [runEnv.fixtureBin, join(runEnv.home, '.local', 'bin'), process.env.PATH ?? ''].join(':'),
    ...(Object.fromEntries(Object.entries(runEnv.extraEnv).filter(([, v]) => typeof v === 'string')) as Record<string, string>),
  };
}

/**
 * Direct runInstall resolves `pi` against the RUNNING process env (the
 * subprocess runner in installer-flow sets PATH for the spawned main).
 * This file runs in its own test process, so pointing the process PATH
 * at the fixture bin is isolated and safe.
 */
async function runWithFixturePi(runEnv: { readonly home: string; readonly fixtureBin: string; readonly extraEnv: NodeJS.ProcessEnv }, options: Parameters<typeof runInstall>[1]): Promise<ReturnType<typeof runInstall>> {
  const oldPath = process.env.PATH;
  const oldVersion = process.env.FIXTURE_PI_VERSION;
  const oldState = process.env.FIXTURE_PI_STATE;
  const pathEnv = pathEnvFor(runEnv);
  process.env.PATH = pathEnv.PATH;
  process.env.FIXTURE_PI_VERSION = '0.83.0';
  process.env.FIXTURE_PI_STATE = runEnv.extraEnv.FIXTURE_PI_STATE ?? '';
  try {
    return await runInstall({ home: runEnv.home, platform: 'linux', arch: 'x64', pathEnv }, options);
  } finally {
    process.env.PATH = oldPath;
    if (oldVersion === undefined) delete process.env.FIXTURE_PI_VERSION; else process.env.FIXTURE_PI_VERSION = oldVersion;
    if (oldState === undefined) delete process.env.FIXTURE_PI_STATE; else process.env.FIXTURE_PI_STATE = oldState;
  }
}

test('release core: activates the pi-shuttle package and links the bin to persistent packages storage', async () => {
  const env = makeEnv();
  try {
    const gateway = await buildTarball(env, gatewayFixtureFiles(), GATEWAY_ARTIFACT_NAME);
    const piguard = await buildTarball(env, piGuardFixtureFiles(), PI_GUARD_ARTIFACT_NAME);
    const shuttle = await buildPiShuttleArtifact(env);
    const piState = join(env, 'pi-state.txt');
    const runEnv = fullInstallEnv(env, '0.83.0', piState);
    const outcome = await runWithFixturePi(runEnv, {
      selections: { gateway: true, piGuard: true },
      artifactDir: env,
      expectGatewaySha256: sha256File(gateway),
      expectPiGuardSha256: sha256File(piguard),
      releasePackageTgz: shuttle,
      uid: 12345,
    });
    assert.equal(outcome.kind, 'COMPLETE', JSON.stringify(outcome));

    const layout = resolveLayout(env);
    const receipt = readReceipt(layout.installReceiptPath);
    assert.equal(receipt.ok, true);
    if (!receipt.ok) return;
    assert.equal(receipt.receipt.result, 'COMPLETE');
    assert.equal(receipt.receipt.components.gateway?.digestVerified, true, 'release digests are verified against expectations');
    assert.equal(receipt.receipt.components.piGuard?.digestVerified, true);

    // The activated pi-shuttle package is persistent packages storage…
    const shuttleTarget = join(layout.packagesDir, `pi-shuttle@${PI_SHUTTLE_VERSION}`);
    assert.ok(existsSync(join(shuttleTarget, 'dist', 'cli.js')), 'pi-shuttle package must be activated into packages storage');
    // …and the bin link points there — never into an ephemeral extraction.
    const link = readlinkSync(join(layout.binDir, 'pi-shuttle'));
    assert.equal(link, join(shuttleTarget, 'dist', 'cli.js'));
    assert.ok(!link.includes('pi-shuttle-release.'), 'bin link must not point into the release temp extraction');

    // Staging cleaned.
    assert.equal(readdirSync(layout.stagingDir).length, 0, 'staging must be empty after success');
  } finally {
    cleanupEnv(env);
  }
});

test('release core: same-version rerun is a verified no-op with the same persistent link', async () => {
  const env = makeEnv();
  try {
    const gateway = await buildTarball(env, gatewayFixtureFiles(), GATEWAY_ARTIFACT_NAME);
    const piguard = await buildTarball(env, piGuardFixtureFiles(), PI_GUARD_ARTIFACT_NAME);
    const shuttle = await buildPiShuttleArtifact(env);
    const piState = join(env, 'pi-state.txt');
    const runEnv = fullInstallEnv(env, '0.83.0', piState);
    const options = {
      selections: { gateway: true, piGuard: true },
      artifactDir: env,
      releasePackageTgz: shuttle,
      uid: 12345,
    } as const;
    const first = await runWithFixturePi(runEnv, options);
    assert.equal(first.kind, 'COMPLETE', JSON.stringify(first));
    const layout = resolveLayout(env);
    const linkAfterFirst = readlinkSync(join(layout.binDir, 'pi-shuttle'));
    const receiptAfterFirst = readFileSync(layout.installReceiptPath, 'utf8');

    const second = await runWithFixturePi(runEnv, options);
    assert.equal(second.kind, 'ALREADY_INSTALLED', JSON.stringify(second));
    const receipt = readReceipt(layout.installReceiptPath);
    assert.equal(receipt.ok && receipt.receipt.result, 'COMPLETE');
    assert.equal(readlinkSync(join(layout.binDir, 'pi-shuttle')), linkAfterFirst, 'rerun must not replace the persistent link');
    assert.equal(readFileSync(layout.installReceiptPath, 'utf8'), receiptAfterFirst, 'no-op must not rewrite the receipt');
  } finally {
    cleanupEnv(env);
  }
});

test('release core: same-version intact unverified Gateway is re-verified without reinstall', async () => {
  const env = makeEnv();
  try {
    const smokeState = join(env, 'gateway-smoke.txt');
    await buildTarball(env, gatewayProbeFixtureFiles(smokeState), GATEWAY_ARTIFACT_NAME);
    const shuttle = await buildPiShuttleArtifact(env);
    const runEnv = fullInstallEnv(env, '0.83.0', join(env, 'pi-state.txt'));
    const initial = await runWithFixturePi(runEnv, {
      selections: { gateway: true, piGuard: false }, artifactDir: env, releasePackageTgz: shuttle, uid: 12345,
    });
    assert.equal(initial.kind, 'PARTIAL', JSON.stringify(initial));
    const layout = resolveLayout(env);
    const gatewayDir = join(layout.packagesDir, 'project-gateway-artifact-core@0.1.0');
    const gatewayBin = join(gatewayDir, 'dist', 'cli.js');
    const sentinel = join(gatewayDir, 'preserve.txt');
    writeFileSync(sentinel, 'gateway');
    const gatewayBytes = readFileSync(gatewayBin);
    const linkBefore = readlinkSync(join(layout.binDir, 'pi-shuttle'));
    const packagesBefore = readdirSync(layout.packagesDir).sort();
    writeFileSync(smokeState, '');
    markComponentUnverified(layout, 'gateway');
    writeFileSync(join(env, GATEWAY_ARTIFACT_NAME), 'must not be consumed');

    const outcome = await runWithFixturePi(runEnv, { selections: { gateway: true, piGuard: false }, uid: 12345 });
    assert.equal(outcome.kind, 'PARTIAL', JSON.stringify(outcome));
    assert.ok(readFileSync(smokeState, 'utf8').split('\n').filter(Boolean).length >= 1, 'Gateway --help smoke must be rerun');
    assert.deepEqual(readFileSync(gatewayBin), gatewayBytes, 'Gateway package bytes must be preserved');
    assert.equal(readFileSync(sentinel, 'utf8'), 'gateway');
    assert.deepEqual(readdirSync(layout.packagesDir).sort(), packagesBefore, 'Gateway must not be reinstalled');
    assert.equal(readlinkSync(join(layout.binDir, 'pi-shuttle')), linkBefore, 're-verification must not replace the command entry');
    const receipt = readReceipt(layout.installReceiptPath);
    assert.equal(receipt.ok, true);
    if (receipt.ok) {
      assert.equal(receipt.receipt.components.gateway?.status, 'installed-verified');
      assert.equal(receipt.receipt.components.gateway?.smoke, 'passed');
    }
  } finally {
    cleanupEnv(env);
  }
});

test('release core: same-version intact unverified pi-guard is re-verified without a second pi install', async () => {
  const env = makeEnv();
  const oldListMarker = process.env.FIXTURE_PI_CHMOD_DIR_ON_LIST;
  try {
    await buildTarball(env, piGuardFixtureFiles(), PI_GUARD_ARTIFACT_NAME);
    const shuttle = await buildPiShuttleArtifact(env);
    const piState = join(env, 'pi-state.txt');
    const runEnv = fullInstallEnv(env, '0.83.0', piState);
    const initial = await runWithFixturePi(runEnv, {
      selections: { gateway: false, piGuard: true }, artifactDir: env, releasePackageTgz: shuttle, uid: 12345,
    });
    assert.equal(initial.kind, 'PARTIAL', JSON.stringify(initial));
    const layout = resolveLayout(env);
    const piGuardDir = join(layout.packagesDir, 'pi-guard@0.1.2');
    const source = join(piGuardDir, 'extensions', 'pi-guard', 'index.ts');
    const sentinel = join(piGuardDir, 'preserve.txt');
    const listMarker = join(env, 'pi-list-marker');
    mkdirSync(listMarker, { mode: 0o700 });
    writeFileSync(sentinel, 'pi-guard');
    const sourceBytes = readFileSync(source);
    const piStateBefore = readFileSync(piState, 'utf8');
    markComponentUnverified(layout, 'piGuard');
    process.env.FIXTURE_PI_CHMOD_DIR_ON_LIST = listMarker;

    const outcome = await runWithFixturePi(runEnv, { selections: { gateway: false, piGuard: true }, uid: 12345 });
    assert.equal(outcome.kind, 'PARTIAL', JSON.stringify(outcome));
    assert.equal(statSync(listMarker).mode & 0o777, 0o500, 'pi list must be rerun');
    assert.equal(readFileSync(piState, 'utf8'), piStateBefore, 'pi install must not run again');
    assert.deepEqual(readFileSync(source), sourceBytes, 'pi-guard source bytes must be preserved');
    assert.equal(readFileSync(sentinel, 'utf8'), 'pi-guard');
    const receipt = readReceipt(layout.installReceiptPath);
    assert.equal(receipt.ok, true);
    if (receipt.ok) {
      assert.equal(receipt.receipt.components.piGuard?.status, 'installed-verified');
      assert.equal(receipt.receipt.components.piGuard?.verifiedBy, 'pi-list');
    }
  } finally {
    if (oldListMarker === undefined) delete process.env.FIXTURE_PI_CHMOD_DIR_ON_LIST;
    else process.env.FIXTURE_PI_CHMOD_DIR_ON_LIST = oldListMarker;
    cleanupEnv(env);
  }
});

test('release core: failed same-version re-verification stays unverified without reinstall', async () => {
  const env = makeEnv();
  const oldSmokeFailure = process.env.FIXTURE_GATEWAY_SMOKE_FAIL;
  try {
    const smokeState = join(env, 'gateway-smoke.txt');
    await buildTarball(env, gatewayProbeFixtureFiles(smokeState), GATEWAY_ARTIFACT_NAME);
    const shuttle = await buildPiShuttleArtifact(env);
    const runEnv = fullInstallEnv(env, '0.83.0', join(env, 'pi-state.txt'));
    const initial = await runWithFixturePi(runEnv, {
      selections: { gateway: true, piGuard: false }, artifactDir: env, releasePackageTgz: shuttle, uid: 12345,
    });
    assert.equal(initial.kind, 'PARTIAL', JSON.stringify(initial));
    const layout = resolveLayout(env);
    const gatewayDir = join(layout.packagesDir, 'project-gateway-artifact-core@0.1.0');
    const gatewayBin = join(gatewayDir, 'dist', 'cli.js');
    const sentinel = join(gatewayDir, 'preserve.txt');
    writeFileSync(sentinel, 'gateway');
    const gatewayBytes = readFileSync(gatewayBin);
    const linkBefore = readlinkSync(join(layout.binDir, 'pi-shuttle'));
    const packagesBefore = readdirSync(layout.packagesDir).sort();
    markComponentUnverified(layout, 'gateway');
    writeFileSync(smokeState, '');
    process.env.FIXTURE_GATEWAY_SMOKE_FAIL = '1';

    const outcome = await runWithFixturePi(runEnv, { selections: { gateway: true, piGuard: false }, uid: 12345 });
    assert.equal(outcome.kind, 'PARTIAL', JSON.stringify(outcome));
    assert.ok(readFileSync(smokeState, 'utf8').split('\n').filter(Boolean).length >= 1, 'Gateway smoke must be attempted');
    assert.deepEqual(readFileSync(gatewayBin), gatewayBytes);
    assert.equal(readFileSync(sentinel, 'utf8'), 'gateway');
    assert.deepEqual(readdirSync(layout.packagesDir).sort(), packagesBefore, 'failed verification must not reinstall');
    assert.equal(readlinkSync(join(layout.binDir, 'pi-shuttle')), linkBefore, 'failed verification must not replace the command entry');
    const receipt = readReceipt(layout.installReceiptPath);
    assert.equal(receipt.ok, true);
    if (receipt.ok) {
      assert.equal(receipt.receipt.components.gateway?.status, 'installed-unverified');
      assert.equal(receipt.receipt.components.gateway?.smoke, 'not-run');
    }
  } finally {
    if (oldSmokeFailure === undefined) delete process.env.FIXTURE_GATEWAY_SMOKE_FAIL;
    else process.env.FIXTURE_GATEWAY_SMOKE_FAIL = oldSmokeFailure;
    cleanupEnv(env);
  }
});

test('release core: same-version PARTIAL completion installs missing pi-guard without reinstalling Gateway', async () => {
  const env = makeEnv();
  try {
    await buildTarball(env, gatewayFixtureFiles(), GATEWAY_ARTIFACT_NAME);
    await buildTarball(env, piGuardFixtureFiles(), PI_GUARD_ARTIFACT_NAME);
    const shuttle = await buildPiShuttleArtifact(env);
    const piState = join(env, 'pi-state.txt');
    const runEnv = fullInstallEnv(env, '0.83.0', piState);
    const seeded = await seedSameVersionPartial(env, runEnv, shuttle, 'piGuard');
    const gatewaySentinel = join(seeded.layout.packagesDir, 'project-gateway-artifact-core@0.1.0', 'preserve.txt');
    const shuttleSentinel = join(seeded.layout.packagesDir, `pi-shuttle@${PI_SHUTTLE_VERSION}`, 'preserve.txt');
    writeFileSync(gatewaySentinel, 'gateway');
    writeFileSync(shuttleSentinel, 'pi-shuttle');
    writeFileSync(join(env, GATEWAY_ARTIFACT_NAME), Buffer.from('must not be consumed'));

    const outcome = await runWithFixturePi(runEnv, {
      selections: { gateway: true, piGuard: true }, artifactDir: env, releasePackageTgz: shuttle, uid: 12345,
    });
    assert.equal(outcome.kind, 'COMPLETE', JSON.stringify(outcome));
    assert.equal(readFileSync(gatewaySentinel, 'utf8'), 'gateway', 'verified Gateway package must be reused');
    assert.equal(readFileSync(shuttleSentinel, 'utf8'), 'pi-shuttle', 'same-version pi-shuttle package must be reused');
    assert.equal(existsSync(join(seeded.layout.packagesDir, 'pi-guard@0.1.2')), true);
    assert.match(readFileSync(piState, 'utf8'), /pi-guard@0\.1\.2/);
    const receipt = readReceipt(seeded.layout.installReceiptPath);
    assert.equal(receipt.ok, true);
    if (receipt.ok) {
      assert.equal(receipt.receipt.result, 'COMPLETE');
      assert.equal(receipt.receipt.components.gateway?.status, 'installed-verified');
      assert.equal(receipt.receipt.components.piGuard?.status, 'installed-verified');
      assert.deepEqual(receipt.receipt.omitted, []);
    }
  } finally {
    cleanupEnv(env);
  }
});

test('release core: same-version PARTIAL completion installs missing Gateway without reinstalling pi-guard', async () => {
  const env = makeEnv();
  try {
    await buildTarball(env, gatewayFixtureFiles(), GATEWAY_ARTIFACT_NAME);
    await buildTarball(env, piGuardFixtureFiles(), PI_GUARD_ARTIFACT_NAME);
    const shuttle = await buildPiShuttleArtifact(env);
    const piState = join(env, 'pi-state.txt');
    const runEnv = fullInstallEnv(env, '0.83.0', piState);
    const seeded = await seedSameVersionPartial(env, runEnv, shuttle, 'gateway');
    const piGuardSentinel = join(seeded.layout.packagesDir, 'pi-guard@0.1.2', 'preserve.txt');
    writeFileSync(piGuardSentinel, 'pi-guard');
    const piStateBefore = readFileSync(piState, 'utf8');
    writeFileSync(join(env, PI_GUARD_ARTIFACT_NAME), Buffer.from('must not be consumed'));

    const outcome = await runWithFixturePi(runEnv, {
      selections: { gateway: true, piGuard: true }, artifactDir: env, releasePackageTgz: shuttle, uid: 12345,
    });
    assert.equal(outcome.kind, 'COMPLETE', JSON.stringify(outcome));
    assert.equal(existsSync(join(seeded.layout.packagesDir, 'project-gateway-artifact-core@0.1.0')), true);
    assert.equal(readFileSync(piGuardSentinel, 'utf8'), 'pi-guard', 'verified pi-guard package must be reused');
    assert.equal(readFileSync(piState, 'utf8'), piStateBefore, 'pi install must not run for verified pi-guard');
    const receipt = readReceipt(seeded.layout.installReceiptPath);
    assert.equal(receipt.ok, true);
    if (receipt.ok) {
      assert.equal(receipt.receipt.result, 'COMPLETE');
      assert.equal(receipt.receipt.components.gateway?.status, 'installed-verified');
      assert.equal(receipt.receipt.components.piGuard?.status, 'installed-verified');
      assert.deepEqual(receipt.receipt.omitted, []);
    }
  } finally {
    cleanupEnv(env);
  }
});

test('release core: same-version PARTIAL rerun is a no-op when its missing component is not requested', async () => {
  const env = makeEnv();
  try {
    await buildTarball(env, gatewayFixtureFiles(), GATEWAY_ARTIFACT_NAME);
    await buildTarball(env, piGuardFixtureFiles(), PI_GUARD_ARTIFACT_NAME);
    const shuttle = await buildPiShuttleArtifact(env);
    const runEnv = fullInstallEnv(env, '0.83.0', join(env, 'pi-state.txt'));
    const seeded = await seedSameVersionPartial(env, runEnv, shuttle, 'piGuard');
    const linkBefore = readlinkSync(join(seeded.layout.binDir, 'pi-shuttle'));
    const packagesBefore = readdirSync(seeded.layout.packagesDir).sort();
    const outcome = await runWithFixturePi(runEnv, { selections: { gateway: true, piGuard: false }, uid: 12345 });
    assert.equal(outcome.kind, 'ALREADY_INSTALLED', JSON.stringify(outcome));
    assert.equal(readFileSync(seeded.layout.installReceiptPath, 'utf8'), seeded.receiptBefore);
    assert.equal(readlinkSync(join(seeded.layout.binDir, 'pi-shuttle')), linkBefore);
    assert.deepEqual(readdirSync(seeded.layout.packagesDir).sort(), packagesBefore);
  } finally {
    cleanupEnv(env);
  }
});

test('release core: verified older installation reports a controlled upgrade opportunity without implicit mutation', async () => {
  const env = makeEnv();
  try {
    await buildTarball(env, gatewayFixtureFiles(), GATEWAY_ARTIFACT_NAME);
    await buildTarball(env, piGuardFixtureFiles(), PI_GUARD_ARTIFACT_NAME);
    const shuttle = await buildPiShuttleArtifact(env);
    const runEnv = fullInstallEnv(env, '0.83.0', join(env, 'pi-state.txt'));
    const seeded = await seedOlderOwnedInstallation(env, runEnv, shuttle);
    const outcome = await runWithFixturePi(runEnv, {
      selections: { gateway: true, piGuard: true }, artifactDir: env, releasePackageTgz: shuttle, uid: 12345,
    });
    assert.deepEqual(outcome, { kind: 'UPGRADE_AVAILABLE', installedVersion: '0.1.0', installerVersion: PI_SHUTTLE_VERSION });
    const layout = resolveLayout(env);
    assert.equal(readlinkSync(join(layout.binDir, 'pi-shuttle')), seeded.oldBin);
    assert.equal(readFileSync(layout.installReceiptPath, 'utf8'), seeded.receiptBefore);
    assert.equal(existsSync(join(layout.packagesDir, `pi-shuttle@${PI_SHUTTLE_VERSION}`)), false);
  } finally {
    cleanupEnv(env);
  }
});

test('release core: accepted upgrade activates beside old state, switches safely, and preserves data and unchanged components', async () => {
  const env = makeEnv();
  try {
    const gateway = await buildTarball(env, gatewayFixtureFiles(), GATEWAY_ARTIFACT_NAME);
    const piguard = await buildTarball(env, piGuardFixtureFiles(), PI_GUARD_ARTIFACT_NAME);
    const shuttle = await buildPiShuttleArtifact(env);
    const piState = join(env, 'pi-state.txt');
    const runEnv = fullInstallEnv(env, '0.83.0', piState);
    const seeded = await seedOlderOwnedInstallation(env, runEnv, shuttle);
    const layout = resolveLayout(env);
    const storeSentinel = join(layout.storesDir, 'preserve-store.txt');
    const configSentinel = layout.runtimeConfigPath;
    const gatewaySentinel = join(layout.packagesDir, 'project-gateway-artifact-core@0.1.0', 'preserve.txt');
    const piGuardSentinel = join(layout.packagesDir, 'pi-guard@0.1.2', 'preserve.txt');
    mkdirSync(layout.storesDir, { recursive: true, mode: 0o700 });
    writeFileSync(storeSentinel, 'store');
    writeFileSync(configSentinel, '{"project":"preserve"}\n');
    writeFileSync(gatewaySentinel, 'gateway');
    writeFileSync(piGuardSentinel, 'pi-guard');
    const piStateBefore = readFileSync(piState, 'utf8');
    const offers: Array<[string, string]> = [];

    const outcome = await runWithFixturePi(runEnv, {
      selections: { gateway: true, piGuard: true },
      artifactDir: env,
      expectGatewaySha256: sha256File(gateway),
      expectPiGuardSha256: sha256File(piguard),
      releasePackageTgz: shuttle,
      uid: 12345,
      confirmUpgrade: async (installed, installer) => { offers.push([installed, installer]); return true; },
    });
    assert.deepEqual(offers, [['0.1.0', PI_SHUTTLE_VERSION]], 'upgrade must be offered after ownership verification');
    assert.equal(outcome.kind, 'COMPLETE', JSON.stringify(outcome));
    if (outcome.kind === 'COMPLETE') assert.equal(outcome.upgradedFrom, '0.1.0');
    const currentTarget = join(layout.packagesDir, `pi-shuttle@${PI_SHUTTLE_VERSION}`);
    assert.equal(readlinkSync(join(layout.binDir, 'pi-shuttle')), join(currentTarget, 'dist', 'cli.js'));
    assert.equal(existsSync(seeded.oldTarget), true, 'old known-good package is retained');
    assert.equal(readFileSync(storeSentinel, 'utf8'), 'store');
    assert.equal(readFileSync(configSentinel, 'utf8'), '{"project":"preserve"}\n', 'project/runtime configuration must be preserved');
    assert.equal(readFileSync(gatewaySentinel, 'utf8'), 'gateway', 'unchanged Gateway package must not be replaced');
    assert.equal(readFileSync(piGuardSentinel, 'utf8'), 'pi-guard', 'unchanged pi-guard package must not be replaced');
    assert.equal(readFileSync(piState, 'utf8'), piStateBefore, 'exact existing pi-guard source must not be installed again');
    const receipt = readReceipt(layout.installReceiptPath);
    assert.equal(receipt.ok, true);
    if (receipt.ok) {
      assert.equal(receipt.receipt.piShuttleVersion, PI_SHUTTLE_VERSION);
      assert.equal(receipt.receipt.components.gateway?.artifactSha256, sha256File(gateway));
      assert.equal(receipt.receipt.components.piGuard?.artifactSha256, sha256File(piguard));
    }
  } finally {
    cleanupEnv(env);
  }
});

test('release core: upgrade reuses the absolute custom layout recorded by the prior receipt', async () => {
  const env = makeEnv();
  try {
    await buildTarball(env, gatewayFixtureFiles(), GATEWAY_ARTIFACT_NAME);
    await buildTarball(env, piGuardFixtureFiles(), PI_GUARD_ARTIFACT_NAME);
    const shuttle = await buildPiShuttleArtifact(env);
    const runEnv = fullInstallEnv(env, '0.83.0', join(env, 'pi-state.txt'));
    const installDir = join(env, 'custom-share');
    const binDir = join(env, 'custom-bin');
    const seeded = await seedOlderOwnedInstallation(env, runEnv, shuttle, { installDir, binDir });
    const outcome = await runWithFixturePi(runEnv, {
      selections: { gateway: true, piGuard: true }, artifactDir: env, releasePackageTgz: shuttle, uid: 12345,
      confirmUpgrade: async () => true,
    });
    assert.equal(outcome.kind, 'COMPLETE', JSON.stringify(outcome));
    assert.equal(readlinkSync(join(binDir, 'pi-shuttle')), join(installDir, 'packages', `pi-shuttle@${PI_SHUTTLE_VERSION}`, 'dist', 'cli.js'));
    assert.equal(existsSync(seeded.oldTarget), true);
    const receipt = readReceipt(resolveLayout(env).installReceiptPath);
    assert.equal(receipt.ok, true);
    if (receipt.ok) {
      assert.equal(receipt.receipt.installDir, installDir);
      assert.equal(receipt.receipt.binDir, binDir);
    }
  } finally {
    cleanupEnv(env);
  }
});

test('release core: declined upgrade preserves the prior usable installation byte-for-byte', async () => {
  const env = makeEnv();
  try {
    await buildTarball(env, gatewayFixtureFiles(), GATEWAY_ARTIFACT_NAME);
    await buildTarball(env, piGuardFixtureFiles(), PI_GUARD_ARTIFACT_NAME);
    const shuttle = await buildPiShuttleArtifact(env);
    const runEnv = fullInstallEnv(env, '0.83.0', join(env, 'pi-state.txt'));
    const seeded = await seedOlderOwnedInstallation(env, runEnv, shuttle);
    const outcome = await runWithFixturePi(runEnv, {
      selections: { gateway: true, piGuard: true }, artifactDir: env, releasePackageTgz: shuttle, uid: 12345,
      confirmUpgrade: async () => false,
    });
    assert.equal(outcome.kind, 'UPGRADE_DECLINED', JSON.stringify(outcome));
    const layout = resolveLayout(env);
    assert.equal(readlinkSync(join(layout.binDir, 'pi-shuttle')), seeded.oldBin);
    assert.equal(readFileSync(layout.installReceiptPath, 'utf8'), seeded.receiptBefore);
    assert.equal(existsSync(join(layout.packagesDir, `pi-shuttle@${PI_SHUTTLE_VERSION}`)), false);
  } finally {
    cleanupEnv(env);
  }
});

test('release core: old package and symlink ownership are verified before an upgrade is offered', async (t) => {
  for (const corrupt of ['package', 'symlink'] as const) {
    await t.test(corrupt, async () => {
      const env = makeEnv();
      try {
        await buildTarball(env, gatewayFixtureFiles(), GATEWAY_ARTIFACT_NAME);
        await buildTarball(env, piGuardFixtureFiles(), PI_GUARD_ARTIFACT_NAME);
        const shuttle = await buildPiShuttleArtifact(env);
        const runEnv = fullInstallEnv(env, '0.83.0', join(env, 'pi-state.txt'));
        const seeded = await seedOlderOwnedInstallation(env, runEnv, shuttle);
        const layout = resolveLayout(env);
        if (corrupt === 'package') {
          writeFileSync(join(seeded.oldTarget, 'package.json'), JSON.stringify({ name: 'foreign', version: '0.1.0', bin: { 'pi-shuttle': './dist/cli.js' } }));
        } else {
          const foreign = join(env, 'foreign-cli.js');
          writeFileSync(foreign, 'foreign');
          rmSync(join(layout.binDir, 'pi-shuttle'));
          symlinkSync(foreign, join(layout.binDir, 'pi-shuttle'));
        }
        let offers = 0;
        const outcome = await runWithFixturePi(runEnv, {
          selections: { gateway: true, piGuard: true }, artifactDir: env, releasePackageTgz: shuttle, uid: 12345,
          confirmUpgrade: async () => { offers += 1; return true; },
        });
        assert.equal(outcome.kind, 'REFUSED', JSON.stringify(outcome));
        assert.equal(offers, 0, 'ownership failure must precede the upgrade prompt');
        assert.match(JSON.stringify(outcome), /corrupted|ownership|receipt/i);
        assert.equal(existsSync(join(layout.packagesDir, `pi-shuttle@${PI_SHUTTLE_VERSION}`)), false);
      } finally {
        cleanupEnv(env);
      }
    });
  }
});

test('release core: newer and unclassifiable installed versions refuse without mutation', async (t) => {
  for (const [installedVersion, expected] of [
    ['9.9.9', /newer than installer|downgrade/i],
    ['not-semver', /unclassifiable/i],
  ] as const) {
    await t.test(installedVersion, async () => {
      const env = makeEnv();
      try {
        await buildTarball(env, gatewayFixtureFiles(), GATEWAY_ARTIFACT_NAME);
        await buildTarball(env, piGuardFixtureFiles(), PI_GUARD_ARTIFACT_NAME);
        const shuttle = await buildPiShuttleArtifact(env);
        const piState = join(env, 'pi-state.txt');
        const runEnv = fullInstallEnv(env, '0.83.0', piState);
        const seeded = await seedOlderOwnedInstallation(env, runEnv, shuttle, {}, installedVersion);
        const gatewaySentinel = join(seeded.layout.packagesDir, 'project-gateway-artifact-core@0.1.0', 'preserve.txt');
        const piGuardSentinel = join(seeded.layout.packagesDir, 'pi-guard@0.1.2', 'preserve.txt');
        writeFileSync(gatewaySentinel, 'gateway');
        writeFileSync(piGuardSentinel, 'pi-guard');
        const packagesBefore = readdirSync(seeded.layout.packagesDir).sort();
        const piStateBefore = readFileSync(piState, 'utf8');
        let confirmations = 0;
        const outcome = await runWithFixturePi(runEnv, {
          selections: { gateway: true, piGuard: true }, artifactDir: env, releasePackageTgz: shuttle, uid: 12345,
          confirmUpgrade: async () => { confirmations += 1; return true; },
        });
        assert.equal(outcome.kind, 'REFUSED', JSON.stringify(outcome));
        assert.match(JSON.stringify(outcome), expected);
        assert.equal(confirmations, 0);
        assert.equal(readFileSync(seeded.layout.installReceiptPath, 'utf8'), seeded.receiptBefore, 'prior receipt must be byte-preserved');
        assert.equal(readlinkSync(join(seeded.layout.binDir, 'pi-shuttle')), seeded.oldBin);
        assert.deepEqual(readdirSync(seeded.layout.packagesDir).sort(), packagesBefore);
        assert.equal(readFileSync(gatewaySentinel, 'utf8'), 'gateway');
        assert.equal(readFileSync(piGuardSentinel, 'utf8'), 'pi-guard');
        assert.equal(readFileSync(piState, 'utf8'), piStateBefore);
      } finally {
        cleanupEnv(env);
      }
    });
  }
});

test('release core: failed new-package validation leaves the old receipt, package, and command usable', async () => {
  const env = makeEnv();
  try {
    await buildTarball(env, gatewayFixtureFiles(), GATEWAY_ARTIFACT_NAME);
    await buildTarball(env, piGuardFixtureFiles(), PI_GUARD_ARTIFACT_NAME);
    const shuttle = await buildPiShuttleArtifact(env);
    const runEnv = fullInstallEnv(env, '0.83.0', join(env, 'pi-state.txt'));
    const seeded = await seedOlderOwnedInstallation(env, runEnv, shuttle);
    writeFileSync(shuttle, Buffer.from('not a valid release package'));
    const outcome = await runWithFixturePi(runEnv, {
      selections: { gateway: true, piGuard: true }, artifactDir: env, releasePackageTgz: shuttle, uid: 12345,
      confirmUpgrade: async () => true,
    });
    assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
    const layout = resolveLayout(env);
    assert.equal(readlinkSync(join(layout.binDir, 'pi-shuttle')), seeded.oldBin);
    assert.equal(readFileSync(seeded.oldBin, 'utf8').includes('0.1.0'), true, 'old command bytes remain usable');
    assert.equal(readFileSync(layout.installReceiptPath, 'utf8'), seeded.receiptBefore);
    assert.equal(existsSync(join(layout.packagesDir, `pi-shuttle@${PI_SHUTTLE_VERSION}`)), false);
  } finally {
    cleanupEnv(env);
  }
});

test('release core: post-switch component failure restores the old link and removes the new package', async () => {
  const env = makeEnv();
  try {
    await buildTarball(env, gatewayFixtureFiles(), GATEWAY_ARTIFACT_NAME);
    await buildTarball(env, piGuardFixtureFiles(), PI_GUARD_ARTIFACT_NAME);
    const shuttle = await buildPiShuttleArtifact(env);
    const piState = join(env, 'pi-state.txt');
    const runEnv = fullInstallEnv(env, '0.83.0', piState);
    const seeded = await seedOlderOwnedInstallation(env, runEnv, shuttle);
    const layout = resolveLayout(env);
    const prior = readReceipt(layout.installReceiptPath);
    assert.equal(prior.ok, true);
    if (!prior.ok) return;
    rmSync(join(layout.packagesDir, 'pi-guard@0.1.2'), { recursive: true, force: true });
    writeFileSync(piState, '');
    const adjusted = writeReceipt(layout.installReceiptPath, {
      ...prior.receipt,
      result: 'PARTIAL',
      components: { ...prior.receipt.components, piGuard: null },
      omitted: ['pi-guard'],
    });
    assert.equal(adjusted.ok, true);
    const receiptBefore = readFileSync(layout.installReceiptPath, 'utf8');
    writeFileSync(join(env, PI_GUARD_ARTIFACT_NAME), Buffer.from('invalid pi-guard archive'));

    const outcome = await runWithFixturePi(runEnv, {
      selections: { gateway: true, piGuard: true }, artifactDir: env, releasePackageTgz: shuttle, uid: 12345,
      confirmUpgrade: async () => true,
    });
    assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
    assert.equal(readlinkSync(join(layout.binDir, 'pi-shuttle')), seeded.oldBin, 'rollback must atomically restore the old command link');
    assert.equal(existsSync(join(layout.packagesDir, `pi-shuttle@${PI_SHUTTLE_VERSION}`)), false, 'new package must be removed after link restoration');
    assert.equal(existsSync(seeded.oldTarget), true);
    assert.equal(readFileSync(layout.installReceiptPath, 'utf8'), receiptBefore);
  } finally {
    cleanupEnv(env);
  }
});

test('release core: a corrupted release package fails closed with no mutation', async () => {
  const env = makeEnv();
  try {
    const gateway = await buildTarball(env, gatewayFixtureFiles(), GATEWAY_ARTIFACT_NAME);
    const piguard = await buildTarball(env, piGuardFixtureFiles(), PI_GUARD_ARTIFACT_NAME);
    const shuttle = join(env, PI_SHUTTLE_ARTIFACT_NAME);
    writeFileSync(shuttle, Buffer.from('this is not a gzip archive at all.'.repeat(20)));
    const piState = join(env, 'pi-state.txt');
    const runEnv = fullInstallEnv(env, '0.83.0', piState);
    const outcome = await runInstall(
      { home: env, platform: 'linux', arch: 'x64', pathEnv: pathEnvFor(runEnv) },
      {
        selections: { gateway: true, piGuard: true },
        artifactDir: env,
        releasePackageTgz: shuttle,
        uid: 12345,
      },
    );
    assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
    if (outcome.kind === 'FAILED') assert.equal(outcome.stage, 'release-package');

    const layout = resolveLayout(env);
    assert.equal(existsSync(join(layout.binDir, 'pi-shuttle')), false, 'no bin link may be created');
    assert.equal(existsSync(join(layout.packagesDir, `pi-shuttle@${PI_SHUTTLE_VERSION}`)), false, 'no pi-shuttle activation may exist');
    assert.equal(existsSync(join(layout.packagesDir, 'project-gateway-artifact-core@0.1.0')), false, 'no component activation may exist');
    assert.equal(existsSync(layout.installReceiptPath), false, 'no receipt may be written');
    assert.equal(readdirSync(layout.stagingDir).length, 0, 'staging must be rolled back');
  } finally {
    cleanupEnv(env);
  }
});

test('release core: identity mismatch in the release package is refused (foreign package bytes)', async () => {
  const env = makeEnv();
  try {
    const gateway = await buildTarball(env, gatewayFixtureFiles(), GATEWAY_ARTIFACT_NAME);
    const piguard = await buildTarball(env, piGuardFixtureFiles(), PI_GUARD_ARTIFACT_NAME);
    // A valid archive with the WRONG package identity.
    const shuttle = await buildTarball(env, {
      'package.json': JSON.stringify({ name: 'not-pi-shuttle', version: '9.9.9', bin: { x: './dist/cli.js' } }, null, 2),
      'dist/cli.js': '#!/usr/bin/env node\n',
    }, PI_SHUTTLE_ARTIFACT_NAME);
    const piState = join(env, 'pi-state.txt');
    const runEnv = fullInstallEnv(env, '0.83.0', piState);
    const outcome = await runInstall(
      { home: env, platform: 'linux', arch: 'x64', pathEnv: pathEnvFor(runEnv) },
      { selections: { gateway: false, piGuard: false }, releasePackageTgz: shuttle, uid: 12345 },
    );
    assert.equal(outcome.kind, 'FAILED', JSON.stringify(outcome));
    const layout = resolveLayout(env);
    assert.equal(existsSync(join(layout.binDir, 'pi-shuttle')), false);
    assert.equal(existsSync(join(layout.packagesDir, `pi-shuttle@${PI_SHUTTLE_VERSION}`)), false);
    assert.equal(existsSync(layout.installReceiptPath), false);
    assert.match(JSON.stringify(outcome), /pi-shuttle release/i);
    void gateway;
    void piguard;
  } finally {
    cleanupEnv(env);
  }
});

test('release core: artifact digests stay locally observed when no expectations are given', async () => {
  const env = makeEnv();
  try {
    const gateway = await buildTarball(env, gatewayFixtureFiles(), GATEWAY_ARTIFACT_NAME);
    const piguard = await buildTarball(env, piGuardFixtureFiles(), PI_GUARD_ARTIFACT_NAME);
    const shuttle = await buildPiShuttleArtifact(env);
    const piState = join(env, 'pi-state.txt');
    const runEnv = fullInstallEnv(env, '0.83.0', piState);
    const outcome = await runWithFixturePi(runEnv, { selections: { gateway: true, piGuard: true }, artifactDir: env, releasePackageTgz: shuttle, uid: 12345 });
    assert.equal(outcome.kind, 'COMPLETE', JSON.stringify(outcome));
    const receipt = readReceipt(resolveLayout(env).installReceiptPath);
    assert.equal(receipt.ok && receipt.receipt.components.gateway?.digestVerified, false, 'SIR-PS3-006: without expectations, digests are locally observed only');
    assert.match(receipt.ok ? receipt.receipt.components.gateway?.artifactSha256 ?? '' : '', SHA_RE);
  } finally {
    cleanupEnv(env);
  }
});
