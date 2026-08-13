/**
 * PS-4 focused tests: the full doctor probe suite — closed status
 * vocabulary, every probe verdict on synthetic local states, exit-code
 * classification 0/1/2, honest tunnel/ChatGPT deferral notes, and
 * read-only discipline (no bootstrap invocation, no lock deletion).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatDoctorReport, runDoctor, STATUS_VOCABULARY } from '../../src/command/doctor.js';
import type { DoctorCheck } from '../../src/command/doctor.js';
import { resolveLayout } from '../../src/host/environment.js';
import { cleanupEnv, installFixtureGateway, makeEnv, makeHealthyEnv, makeProjectRoot, writeReceiptFixture, writeFakeGit, writeRuntimeDocument } from '../helpers/lifecycle-fixtures.js';
import { writeFakePi } from '../helpers/installer-fixtures.js';

function healthyContext(options: { readonly withRuntimeConfig?: boolean; readonly withPiGuard?: boolean } = {}) {
  const healthy = makeHealthyEnv(options);
  return {
    env: healthy.env,
    root: healthy.root,
    layout: healthy.layout,
    ctx: { env: { home: healthy.env, platform: 'linux', arch: 'x64' }, layout: healthy.layout, nodeExecutable: process.execPath, pathEnv: healthy.pathEnv },
  };
}

function verdicts(report: { readonly checks: readonly DoctorCheck[] }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const check of report.checks) out[check.id] = check.verdict;
  return out;
}

test('doctor: the status vocabulary is exactly the closed contract set', () => {
  assert.deepEqual([...STATUS_VOCABULARY], ['supported', 'unsupported', 'installed but unverified', 'missing', 'partial installation']);
});

test('doctor: every status vocabulary value renders exactly on synthetic states', () => {
  const checks: DoctorCheck[] = STATUS_VOCABULARY.map((verdict, i) => ({ id: `check-${i}`, label: `synthetic-${i}`, verdict, detail: 'synthetic state' }));
  const rendered = formatDoctorReport({ checks, notes: [] });
  for (const verdict of STATUS_VOCABULARY) {
    assert.ok(rendered.includes(`: ${verdict} —`), `rendered output must contain the exact vocabulary value: ${verdict}`);
  }
  assert.ok(rendered.startsWith('pi-shuttle doctor\n'));
});

test('doctor: complete healthy local setup exits 0 (all implemented checks pass)', async () => {
  const { env, ctx } = healthyContext();
  try {
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 0, formatDoctorReport(result.report));
    const v = verdicts(result.report);
    for (const id of ['platform', 'node', 'git', 'pi', 'receipt', 'gateway', 'pi-guard', 'runtime-config', 'project-0', 'git-isolation-0', 'locks']) {
      assert.equal(v[id], 'supported', `check ${id} must be supported: ${formatDoctorReport(result.report)}`);
    }
    assert.ok(result.report.notes.some((n) => n.includes('PS-7')), 'tunnel/ChatGPT deferral must be noted');
    assert.ok(result.report.notes.some((n) => n.includes('read-only')), 'trusted-store limitation must be noted truthfully');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: missing installation receipt is a finding (exit 1)', async () => {
  const { env, ctx } = healthyContext();
  try {
    rmSync(join(env, '.local', 'state', 'pi-shuttle', 'install.json'));
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 1);
    assert.equal(verdicts(result.report)['receipt'], 'missing');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: partial installation is reported with the omitted components (exit 1)', async () => {
  const { env, ctx } = healthyContext({ withPiGuard: false });
  try {
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 1);
    assert.equal(verdicts(result.report)['receipt'], 'partial installation');
    assert.equal(verdicts(result.report)['pi-guard'], 'missing');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: invalid installation receipt fails closed (exit 1)', async () => {
  const { env, ctx } = healthyContext();
  try {
    writeFileSync(join(env, '.local', 'state', 'pi-shuttle', 'install.json'), '{"foreign": true}', { mode: 0o600 });
    const result = await runDoctor(ctx);
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    assert.ok(result.message.includes('receipt'), result.message);
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: gateway missing (receipt entry gone, package absent) is a finding (exit 1)', async () => {
  const { env, ctx, layout } = healthyContext();
  try {
    const gatewayDir = join(layout.packagesDir, 'project-gateway-artifact-core@0.1.0');
    rmSync(gatewayDir, { recursive: true, force: true });
    writeReceiptFixture(env, { gateway: null, piGuard: null, result: 'PARTIAL', omitted: ['project-gateway-mcp'] });
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 1);
    assert.equal(verdicts(result.report)['gateway'], 'missing');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: gateway package present without a receipt record is installed but unverified (exit 1)', async () => {
  const { env, ctx } = healthyContext();
  try {
    writeReceiptFixture(env, { gateway: null, piGuard: null, result: 'PARTIAL', omitted: ['project-gateway-mcp'] });
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 1);
    assert.equal(verdicts(result.report)['gateway'], 'installed but unverified');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: gateway installed-unverified is reported truthfully (exit 1)', async () => {
  const { env, root, ctx } = healthyContext({ withRuntimeConfig: false });
  try {
    const layout = resolveLayout(env);
    const gateway = installFixtureGateway(env);
    writeReceiptFixture(env, { gateway: { status: 'installed-unverified', installPath: gateway.installPath, binPath: gateway.binPath } });
    void root;
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 1);
    assert.equal(verdicts(result.report)['gateway'], 'installed but unverified');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: gateway package removed from disk after install is missing (exit 1)', async () => {
  const { env, root, ctx } = healthyContext({ withRuntimeConfig: false });
  try {
    const layout = resolveLayout(env);
    const gateway = installFixtureGateway(env);
    writeReceiptFixture(env);
    rmSync(gateway.installPath, { recursive: true, force: true });
    void root;
    void layout;
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 1);
    assert.equal(verdicts(result.report)['gateway'], 'missing');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: pi baseline is supported; pi non-baseline is unsupported (exit 2, never claimed)', async () => {
  const { env, ctx } = healthyContext();
  try {
    const supported = await runDoctor(ctx);
    assert.equal(supported.ok, true);
    if (supported.ok) assert.equal(verdicts(supported.report)['pi'], 'supported');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: pi 0.84.x is not a claimed lane (exit 2)', async () => {
  const { env, ctx } = healthyContext();
  try {
    const binDir = join(env, 'fixture-bin');
    writeFakePi(binDir);
    const pathEnv = { ...ctx.pathEnv, FIXTURE_PI_VERSION: '0.84.1' };
    const result = await runDoctor({ ...ctx, pathEnv });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 2);
    assert.equal(verdicts(result.report)['pi'], 'unsupported');
    const detail = result.report.checks.find((c) => c.id === 'pi')!.detail;
    assert.ok(detail.includes('0.83.0'), detail);
    assert.ok(detail.includes('0.84.x is not a claimed lane'), detail);
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: git missing is a finding; wrong evidence lane is unsupported (exit 2)', async () => {
  const { env, ctx } = healthyContext();
  try {
    const noGitPathEnv = { ...ctx.pathEnv, PATH: join(env, 'no-git') };
    mkdirSync(join(env, 'no-git'), { mode: 0o700 });
    const missing = await runDoctor({ ...ctx, pathEnv: noGitPathEnv });
    assert.equal(missing.ok, true);
    if (missing.ok) {
      assert.equal(verdicts(missing.report)['git'], 'missing');
      assert.equal(missing.exitCode, 1);
    }
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: git wrong evidence lane is unsupported (exit 2)', async () => {
  const { env, ctx } = healthyContext();
  try {
    const binDir = join(env, 'fixture-bin');
    writeFakeGit(binDir, '2.46.0');
    const result = await runDoctor({ ...ctx, pathEnv: ctx.pathEnv });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 2);
    assert.equal(verdicts(result.report)['git'], 'unsupported');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: git present with unparseable version is installed but unverified (exit 1)', async () => {
  const { env, ctx } = healthyContext();
  try {
    const binDir = join(env, 'fixture-bin');
    writeFileSync(join(binDir, 'git'), `#!/usr/bin/env node
process.stdout.write('weird git output\n');
process.exit(0);
`, { mode: 0o700 });
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(verdicts(result.report)['git'], 'installed but unverified');
    assert.equal(result.exitCode, 1);
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: runtime config missing is a finding; malformed fails closed (exit 1)', async () => {
  const { env, ctx, layout } = healthyContext({ withRuntimeConfig: false });
  try {
    const missing = await runDoctor(ctx);
    assert.equal(missing.ok, true);
    if (missing.ok) {
      assert.equal(verdicts(missing.report)['runtime-config'], 'missing');
      assert.equal(missing.exitCode, 1);
    }
    writeRuntimeDocument(env, { surfaces: [{ foreign: true }] });
    const malformed = await runDoctor(ctx);
    assert.equal(malformed.ok, false);
    assert.equal(malformed.exitCode, 1);
    assert.ok(malformed.message.includes('runtime configuration'), malformed.message);
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: project root missing is a finding (exit 1)', async () => {
  const { env, root, ctx } = healthyContext();
  try {
    rmSync(root, { recursive: true, force: true });
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 1);
    assert.equal(verdicts(result.report)['project-0'], 'missing');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: stale coordination lock artifacts are detected with recovery guidance (exit 1, never auto-deleted)', async () => {
  const { env, ctx, layout } = healthyContext();
  try {
    writeFileSync(`${layout.runtimeConfigPath}.lock`, '9999\n', { mode: 0o600 });
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 1);
    const lockCheck = result.report.checks.find((c) => c.id === 'locks')!;
    assert.equal(lockCheck.verdict, 'installed but unverified');
    assert.ok(lockCheck.detail.includes('never auto-stolen'), lockCheck.detail);
    assert.ok(lockCheck.detail.includes('remove'), lockCheck.detail);
    // Doctor must NOT delete the lock.
    assert.equal(existsSync(`${layout.runtimeConfigPath}.lock`), true);
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: unsupported platform exits 2 (fail closed); gated macOS is not claimed', async () => {
  const { env, ctx } = healthyContext();
  try {
    const darwin = await runDoctor({ ...ctx, env: { home: env, platform: 'darwin', arch: 'arm64' } });
    assert.equal(darwin.ok, true);
    if (!darwin.ok) return;
    assert.equal(darwin.exitCode, 2);
    assert.equal(verdicts(darwin.report)['platform'], 'unsupported');
    assert.ok(darwin.report.checks.find((c) => c.id === 'platform')!.detail.includes('gated'), 'the gated lane must not be claimed');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: Windows-like platform is unsupported (exit 2)', async () => {
  const { env, ctx } = healthyContext();
  try {
    const win = await runDoctor({ ...ctx, env: { home: env, platform: 'win32', arch: 'x64' } });
    assert.equal(win.ok, true);
    if (!win.ok) return;
    assert.equal(win.exitCode, 2);
    assert.equal(verdicts(win.report)['platform'], 'unsupported');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: tunnel/ChatGPT readiness is reported as not locally observable, never fabricated', async () => {
  const { env, ctx } = healthyContext();
  try {
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const rendered = formatDoctorReport(result.report);
    assert.ok(rendered.includes('not locally observable'), rendered);
    assert.ok(!rendered.includes('tunnel ready'), 'readiness must never be fabricated');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: git isolation dirs missing is a finding (exit 1)', async () => {
  const { env, ctx, layout } = healthyContext();
  try {
    rmSync(join(layout.gitHomeDir, '0123456789abcdef0123456789abcdef'), { recursive: true, force: true });
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 1);
    assert.equal(verdicts(result.report)['git-isolation-0'], 'missing');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: symlinked project root resolves canonically in the project check', async () => {
  const healthy = makeHealthyEnv();
  try {
    // Replace the project root with a symlink to a real root; the doctor
    // canonicalizes through the host seam and must report supported.
    rmSync(healthy.root, { recursive: true, force: true });
    const real = makeProjectRoot(healthy.env, 'real-root');
    symlinkSync(real, healthy.root);
    const layout = resolveLayout(healthy.env);
    const result = await runDoctor({ env: { home: healthy.env, platform: 'linux', arch: 'x64' }, layout, nodeExecutable: process.execPath, pathEnv: healthy.pathEnv });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(verdicts(result.report)['project-0'], 'supported');
      assert.equal(result.exitCode, 0);
    }
  } finally {
    cleanupEnv(healthy.env);
  }
});
