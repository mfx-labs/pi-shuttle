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
import { existsSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInstall } from '../../src/installer/install.js';
import { readReceipt } from '../../src/installer/receipt.js';
import { resolveLayout } from '../../src/host/environment.js';
import { PI_SHUTTLE_VERSION } from '../../src/compat/manifest.js';
import { buildTarball, cleanupEnv, fullInstallEnv, gatewayFixtureFiles, makeEnv, piGuardFixtureFiles, GATEWAY_ARTIFACT_NAME, PI_GUARD_ARTIFACT_NAME } from '../helpers/installer-fixtures.js';

const PI_SHUTTLE_ARTIFACT_NAME = 'pi-shuttle-0.1.0.tgz';
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
    const shuttleTarget = join(layout.packagesDir, 'pi-shuttle@0.1.0');
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

test('release core: rerun is idempotent — same COMPLETE, same persistent link', async () => {
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

    const second = await runWithFixturePi(runEnv, options);
    assert.equal(second.kind, 'COMPLETE', JSON.stringify(second));
    const receipt = readReceipt(layout.installReceiptPath);
    assert.equal(receipt.ok && receipt.receipt.result, 'COMPLETE');
    assert.equal(readlinkSync(join(layout.binDir, 'pi-shuttle')), linkAfterFirst, 'rerun must not replace the persistent link');
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
    assert.equal(existsSync(join(layout.packagesDir, 'pi-shuttle@0.1.0')), false, 'no pi-shuttle activation may exist');
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
    assert.equal(existsSync(join(layout.packagesDir, 'pi-shuttle@0.1.0')), false);
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

