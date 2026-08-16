/**
 * C2 — operator-visible Gateway identity: focused regressions for doctor
 * and version output. Both derive Gateway identity EXCLUSIVELY from
 * hostLane() → gatewayDescriptorForLane(); the historical commit is never
 * presented as universal and no fallback to another lane identity exists.
 *
 *   - linux doctor expects the historical package identity;
 *   - darwin-x86_64 doctor expects ONLY the macOS fork identity
 *     (@project-gateway/macos-core 0.1.0 @ a90284b…, bin
 *     project-gateway-macos-mcp) — name/version/commit/bin drift are
 *     findings under the closed taxonomy;
 *   - darwin-arm64 stays historical;
 *   - unknown/unmapped lanes fail closed (doctor: missing, no fallback;
 *     version: no identity claim);
 *   - version text is lane-selected; state-free invocation makes no lane
 *     claim (SIR-PS2-010).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../src/app.js';
import { runDoctor } from '../../src/command/doctor.js';
import type { DoctorCheck } from '../../src/command/doctor.js';
import { resolveLayout } from '../../src/host/environment.js';
import { cleanupEnv, fixturePathEnv, installFixtureGateway, makeEnv, writeReceiptFixture } from '../helpers/lifecycle-fixtures.js';
import { GATEWAY_FIXTURE_BIN } from '../helpers/installer-fixtures.js';

const INTEL_COMMIT = 'a90284b06420effb1ec1eeef14e7ed82e02c64e9';
const HISTORICAL_COMMIT = '55f764290a4567a20557f1db19d2a6fb97572a97';

function verdicts(report: { readonly checks: readonly DoctorCheck[] }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const check of report.checks) out[check.id] = check.verdict;
  return out;
}

function ctx(env: string, platform: string, arch: string): { readonly env: { readonly home: string; readonly platform: string; readonly arch: string }; readonly layout: ReturnType<typeof resolveLayout>; readonly pathEnv: NodeJS.ProcessEnv } {
  return { env: { home: env, platform, arch }, layout: resolveLayout(env), pathEnv: fixturePathEnv(env) };
}

/** An installed package carrying ONLY the macOS fork identity (Intel lane). */
function writeIntelGatewayPackage(env: string): { readonly installPath: string; readonly binPath: string } {
  const layout = resolveLayout(env);
  const installPath = join(layout.packagesDir, 'project-gateway-macos-core@0.1.0');
  mkdirSync(join(installPath, 'dist'), { recursive: true, mode: 0o700 });
  writeFileSync(join(installPath, 'package.json'), JSON.stringify({
    name: '@project-gateway/macos-core',
    version: '0.1.0',
    type: 'module',
    bin: { 'project-gateway-macos-mcp': './dist/cli.js' },
  }, null, 2), { mode: 0o600 });
  const binPath = join(installPath, 'dist', 'cli.js');
  writeFileSync(binPath, GATEWAY_FIXTURE_BIN, { mode: 0o700 });
  return { installPath, binPath };
}

async function gatewayVerdictFor(c: ReturnType<typeof ctx>): Promise<{ readonly verdict: string; readonly report: string }> {
  const result = await runDoctor(c);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  return { verdict: verdicts(result.report)['gateway'] ?? '', report: result.report.checks.map((k) => `${k.id}: ${k.verdict} — ${k.detail}`).join('\n') };
}

test('C2 doctor: linux expects the historical package identity (unchanged)', async () => {
  const env = makeEnv();
  try {
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const { verdict, report } = await gatewayVerdictFor(ctx(env, 'linux', 'x64'));
    assert.equal(verdict, 'supported', report);
  } finally {
    cleanupEnv(env);
  }
});

test('C2 doctor: darwin-x86_64 expects the macOS fork package/version/commit/bin', async () => {
  const env = makeEnv();
  try {
    const { installPath, binPath } = writeIntelGatewayPackage(env);
    writeReceiptFixture(env, { gateway: { status: 'installed-verified', installPath, binPath, version: '0.1.0', commit: INTEL_COMMIT } });
    const { verdict, report } = await gatewayVerdictFor(ctx(env, 'darwin', 'x64'));
    assert.equal(verdict, 'supported', report);
    assert.ok(report.includes(`commit ${INTEL_COMMIT}`), report);
  } finally {
    cleanupEnv(env);
  }
});

test('C2 doctor: darwin-x86_64 does NOT accept the historical package identity', async () => {
  const env = makeEnv();
  try {
    // Historical package name under an Intel-shaped receipt: drift.
    const { installPath, binPath } = writeIntelGatewayPackage(env);
    writeFileSync(join(installPath, 'package.json'), JSON.stringify({
      name: '@project-gateway/artifact-core',
      version: '0.1.0',
      type: 'module',
      bin: { 'project-gateway-macos-mcp': './dist/cli.js' },
    }, null, 2), { mode: 0o600 });
    writeReceiptFixture(env, { gateway: { status: 'installed-verified', installPath, binPath, version: '0.1.0', commit: INTEL_COMMIT } });
    const { verdict, report } = await gatewayVerdictFor(ctx(env, 'darwin', 'x64'));
    assert.equal(verdict, 'installed but unverified', report);
    assert.ok(report.includes('drifted'), report);
  } finally {
    cleanupEnv(env);
  }
});

test('C2 doctor: darwin-x86_64 wrong commit is a drift finding', async () => {
  const env = makeEnv();
  try {
    const { installPath, binPath } = writeIntelGatewayPackage(env);
    writeReceiptFixture(env, { gateway: { status: 'installed-verified', installPath, binPath, version: '0.1.0', commit: 'b6b50965ebd39aaebd0fa62c3e2ad7eb0f601af1' } });
    const { verdict, report } = await gatewayVerdictFor(ctx(env, 'darwin', 'x64'));
    assert.equal(verdict, 'installed but unverified', report);
    assert.ok(report.includes('commit drifted'), report);
  } finally {
    cleanupEnv(env);
  }
});

test('C2 doctor: darwin-x86_64 wrong bin declaration is a drift finding', async () => {
  const env = makeEnv();
  try {
    const { installPath, binPath } = writeIntelGatewayPackage(env);
    // Package declares the right name/version but the bin points elsewhere.
    writeFileSync(join(installPath, 'package.json'), JSON.stringify({
      name: '@project-gateway/macos-core',
      version: '0.1.0',
      type: 'module',
      bin: { 'project-gateway-macos-mcp': './dist/other.js' },
    }, null, 2), { mode: 0o600 });
    writeReceiptFixture(env, { gateway: { status: 'installed-verified', installPath, binPath, version: '0.1.0', commit: INTEL_COMMIT } });
    const { verdict, report } = await gatewayVerdictFor(ctx(env, 'darwin', 'x64'));
    assert.equal(verdict, 'installed but unverified', report);
    assert.ok(report.includes('bin drifted'), report);
  } finally {
    cleanupEnv(env);
  }
});

test('C2 doctor: darwin-arm64 remains on the historical Gateway identity', async () => {
  const env = makeEnv();
  try {
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const { verdict, report } = await gatewayVerdictFor(ctx(env, 'darwin', 'arm64'));
    assert.equal(verdict, 'supported', report);
    assert.ok(report.includes(HISTORICAL_COMMIT), report);
    assert.ok(!report.includes('macos-core'), 'arm64 must never see the fork identity');
  } finally {
    cleanupEnv(env);
  }
});

test('C2 doctor: unknown/unmapped lane fails closed with no fallback identity', async () => {
  const env = makeEnv();
  try {
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const { verdict, report } = await gatewayVerdictFor(ctx(env, 'win32', 'x64'));
    assert.equal(verdict, 'missing', report);
    assert.ok(report.includes('not bound'), report);
    assert.ok(!report.includes(HISTORICAL_COMMIT), 'no historical identity may be claimed on an unmapped lane');
  } finally {
    cleanupEnv(env);
  }
});

test('C2 version: linux text is lane-selected to the historical descriptor', async () => {
  const outcome = await run(['--version'], { env: { home: '/tmp/c2-version', platform: 'linux', arch: 'x64', pathEnv: process.env } });
  assert.equal(outcome.exitCode, 0);
  assert.ok(outcome.stdout.includes(`gateway 0.1.0 (commit ${HISTORICAL_COMMIT})`), outcome.stdout);
  assert.ok(outcome.stdout.includes('linux-x86_64-posix-utf8-node22'), outcome.stdout);
  assert.ok(outcome.stdout.includes('@project-gateway/artifact-core'), outcome.stdout);
});

test('C2 version: darwin-x86_64 text reports the Intel descriptor, never the historical commit', async () => {
  const outcome = await run(['--version'], { env: { home: '/tmp/c2-version', platform: 'darwin', arch: 'x64', pathEnv: process.env } });
  assert.equal(outcome.exitCode, 0);
  assert.ok(outcome.stdout.includes(`gateway 0.1.0 (commit ${INTEL_COMMIT})`), outcome.stdout);
  assert.ok(outcome.stdout.includes('mfx-labs/project-gateway-macos'), outcome.stdout);
  assert.ok(outcome.stdout.includes('@project-gateway/macos-core'), outcome.stdout);
  assert.ok(outcome.stdout.includes('project-gateway-macos-mcp'), outcome.stdout);
  assert.ok(!outcome.stdout.includes(HISTORICAL_COMMIT), 'the historical commit must never be presented as universal');
});

test('C2 version: unmapped lane makes no identity claim (no Linux fallback)', async () => {
  const outcome = await run(['--version'], { env: { home: '/tmp/c2-version', platform: 'win32', arch: 'x64', pathEnv: process.env } });
  assert.equal(outcome.exitCode, 0);
  assert.ok(outcome.stdout.includes('not bound'), outcome.stdout);
  assert.ok(!outcome.stdout.includes(HISTORICAL_COMMIT), outcome.stdout);
});

test('C2 version: state-free invocation (no host environment) makes no lane claim and stays exit 0', async () => {
  const outcome = await run(['--version'], {});
  assert.equal(outcome.exitCode, 0);
  assert.ok(outcome.stdout.includes('host environment unavailable'), outcome.stdout);
  assert.ok(!outcome.stdout.includes(HISTORICAL_COMMIT), outcome.stdout);
});
